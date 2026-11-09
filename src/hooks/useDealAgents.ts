import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The CA agent and document mover (deal-agents edge function). The tables are
 * newer than the generated types, hence the `as never` casts, as in
 * useDealDocuments.
 */

export type CaFlag = { clause: string; quote: string; why: string };

export type CaRun = {
  id: string;
  deal_id: string;
  status:
    | "starting"
    | "running"
    | "needs_approval"
    | "needs_attention"
    | "done"
    | "failed"
    | "cancelled"
    | "disabled"
    | "no_link";
  ca_url: string | null;
  platform: string | null;
  deal_room_urls: { url: string; text: string }[];
  progress: string | null;
  ca_standard: boolean | null;
  ca_summary: string | null;
  ca_flags: CaFlag[];
  ca_text_path: string | null;
  signed_copy_path: string | null;
  signed_as: { name: string; title: string | null; company: string; email: string } | null;
  signed_at: string | null;
  documents_found: number;
  documents_added: number;
  attention: string | null;
  error: string | null;
  agent_notes: string | null;
  cost_usd: number | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  finished_at: string | null;
};

export type SignerProfile = {
  full_name: string;
  title: string | null;
  company: string;
  email: string;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  signature_path: string | null;
  enabled: boolean;
  portal_logins: { platform: string; username: string; hosts: string[] }[];
};

export type DealAgentsStatus = {
  configured: boolean;
  up_to_date: boolean;
  signing_enabled: boolean;
  logins: { platform: string; username: string; hosts: string[] }[];
  run_budget_usd: number;
};

export const OPEN_RUN_STATUSES: CaRun["status"][] = ["starting", "running", "needs_approval"];
const CHECK_EVERY_MS = 20_000;
const runKey = (dealId: string) => ["deal_ca_run", dealId];

/** Pull the real message out of a FunctionsHttpError, which hides the body. */
async function invokeError(error: unknown): Promise<Error> {
  try {
    const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context?.json?.();
    if (body?.error) return new Error(body.error);
  } catch {
    // fall through
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function callDealAgents<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("deal-agents", { body });
  if (error) throw await invokeError(error);
  return data as T;
}

/** Starts the CA agent (and the attachment import) for a deal. Accept and the Sign CA button call this. */
export const startDealAgents = (dealId: string) => callDealAgents<CaRun>({ action: "start", deal_id: dealId });

/** The deal's latest CA run, checked every 20 s while it is open. */
export function useLatestCaRun(dealId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: runKey(dealId ?? ""),
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_ca_runs" as never)
        .select("*")
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as CaRun | null;
    },
  });

  const run = query.data;
  const polling = !!run && (run.status === "starting" || run.status === "running");
  useEffect(() => {
    if (!polling || !run) return;
    const t = setInterval(async () => {
      try {
        const next = await callDealAgents<CaRun>({ action: "check", run_id: run.id });
        if (next) qc.setQueryData(runKey(run.deal_id), next);
        if (next && !OPEN_RUN_STATUSES.includes(next.status)) {
          qc.invalidateQueries({ queryKey: ["deal_documents", run.deal_id] });
        }
      } catch {
        // A failed check is retried on the next tick.
      }
    }, CHECK_EVERY_MS);
    return () => clearInterval(t);
  }, [polling, run, qc]);

  return query;
}

export function useCaRunAction(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { action: "start" } | { action: "approve" | "cancel"; runId: string }) =>
      args.action === "start"
        ? startDealAgents(dealId)
        : callDealAgents<CaRun>({ action: args.action, run_id: args.runId }),
    onSuccess: (run) => {
      if (run) qc.setQueryData(runKey(dealId), run);
      qc.invalidateQueries({ queryKey: ["deal_documents", dealId] });
    },
  });
}

// ---------------------------------------------------------------- settings

export function useSignerProfile() {
  return useQuery({
    queryKey: ["ca_signer_profile"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ca_signer_profile" as never).select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data as unknown as SignerProfile | null;
    },
  });
}

export function useUpdateSignerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<SignerProfile, "portal_logins">>) => {
      const { error } = await supabase
        .from("ca_signer_profile" as never)
        .update({ ...patch, updated_at: new Date().toISOString() } as never)
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ca_signer_profile"] }),
  });
}

export function useDealAgentsStatus() {
  return useQuery({
    queryKey: ["deal_agents_status"],
    queryFn: () => callDealAgents<DealAgentsStatus>({ action: "status" }),
  });
}

export function useDealAgentsAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => callDealAgents(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deal_agents_status"] });
      qc.invalidateQueries({ queryKey: ["ca_signer_profile"] });
    },
  });
}
