import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ModelInputPick, RenovationLevel } from "../../supabase/functions/_shared/dealModel";

/**
 * Generated pro forma models (deal_models). The run happens in an Anthropic
 * Managed Agents session started by the generate-model function; nothing here
 * writes to the table. While a run is open the page asks the function to check
 * on it every CHECK_MS, which is also what collects a finished model.
 *
 * The table is newer than the generated types, hence the `as never` casts, as
 * in useDealDocuments.
 */

export const DEAL_MODELS_BUCKET = "deal-models";
const CHECK_MS = 20_000;

export type DealModel = {
  id: string;
  deal_id: string;
  status: "starting" | "running" | "done" | "failed";
  complete: boolean | null;
  progress: string | null;
  error: string | null;
  inputs: Record<string, { id: string; file_name: string }>;
  options: { renovation_level?: RenovationLevel; notes?: string };
  storage_path: string | null;
  file_name: string | null;
  qc_report: string | null;
  skipped: string[] | null;
  cost_usd: number | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export const isOpen = (m: DealModel) => m.status === "starting" || m.status === "running";

const modelsKey = (dealId: string) => ["deal_models", dealId];

export function useDealModels(dealId: string | undefined) {
  return useQuery({
    queryKey: modelsKey(dealId ?? ""),
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_models" as never)
        .select("id,deal_id,status,complete,progress,error,inputs,options,storage_path,file_name,qc_report,skipped,cost_usd,created_by,created_at,started_at,finished_at")
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as DealModel[];
    },
  });
}

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

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("generate-model", { body });
  if (error) throw await invokeError(error);
  return data;
}

/**
 * While a run is open, ask the function to check on it. Keeps going with the tab
 * in the background: people leave during a 20-minute run.
 */
export function useCheckOpenModels(dealId: string, models: DealModel[]) {
  const qc = useQueryClient();
  const openIds = models.filter(isOpen).map((m) => m.id).join(",");
  useEffect(() => {
    if (!openIds) return;
    let stopped = false;
    const tick = async () => {
      await Promise.all(openIds.split(",").map((id) => invoke({ action: "check", model_id: id }).catch(() => null)));
      if (!stopped) qc.invalidateQueries({ queryKey: modelsKey(dealId) });
    };
    tick();
    const t = setInterval(tick, CHECK_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [openIds, dealId, qc]);
}

export function useStartDealModel(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { inputs: ModelInputPick; options: { renovation_level: RenovationLevel; notes: string } }) =>
      invoke({ action: "start", deal_id: dealId, ...args }),
    onSettled: () => qc.invalidateQueries({ queryKey: modelsKey(dealId) }),
  });
}

export function useCancelDealModel(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => invoke({ action: "cancel", model_id: modelId }),
    onSettled: () => qc.invalidateQueries({ queryKey: modelsKey(dealId) }),
  });
}

// ---------- setup (admin) ----------

export type ModelSetupStatus = {
  ready: boolean;
  up_to_date: boolean;
  run_budget_usd: number;
  probe_started_at: string | null;
};

export type ProbeReport = {
  status: string;
  over: boolean;
  stop_reason: string | null;
  cost_usd: number | null;
  errors: string[];
  messages: string[];
  outputs: string[];
};

const setupKey = ["model_setup_status"];

export function useModelSetupStatus() {
  return useQuery({
    queryKey: setupKey,
    queryFn: () => invoke({ action: "status" }) as Promise<ModelSetupStatus>,
    staleTime: 60_000,
  });
}

export function useSetUpModelAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke({ action: "setup" }) as Promise<ModelSetupStatus & { created: string[] }>,
    onSettled: () => qc.invalidateQueries({ queryKey: setupKey }),
  });
}

export function useStartProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke({ action: "probe" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: setupKey });
      qc.invalidateQueries({ queryKey: ["model_probe"] });
    },
  });
}

/** The container check's report, re-read every 15 s until it ends. */
export function useProbeReport(enabled: boolean) {
  return useQuery({
    queryKey: ["model_probe"],
    enabled,
    queryFn: () => invoke({ action: "probe_check" }) as Promise<ProbeReport>,
    refetchInterval: (q) => ((q.state.data as ProbeReport | undefined)?.over ? false : 15_000),
    refetchIntervalInBackground: true,
  });
}

export async function getDealModelUrl(storagePath: string, fileName: string, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage
    .from(DEAL_MODELS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds, { download: fileName });
  if (error) throw error;
  return data.signedUrl;
}
