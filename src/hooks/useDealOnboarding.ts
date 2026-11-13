import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The server-side run that fills a new deal (onboard-deal edge function). The
 * table is newer than the generated types, hence the `as never` casts.
 */

export type OnboardingStepStatus = "ok" | "failed" | "skipped";
export type OnboardingStep = { status: OnboardingStepStatus; detail?: string | null; ms?: number; at?: string };

export type DealOnboarding = {
  deal_id: string;
  status: "queued" | "running" | "done" | "failed";
  steps: Record<string, OnboardingStep>;
  attempts: number;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

/** In run order, with the name a person reads. */
export const ONBOARDING_STEPS: { key: string; label: string }[] = [
  { key: "geocode", label: "Coordinates" },
  { key: "esri", label: "Esri demographics" },
  { key: "schools", label: "Schools" },
  { key: "hellodata", label: "HelloData" },
  { key: "submarket", label: "CoStar submarket" },
  { key: "agents", label: "Documents + CA agent" },
  { key: "deal_score", label: "Market metrics + AI score" },
  { key: "buybox", label: "Buybox score" },
];

const key = (dealId: string) => ["deal_onboarding", dealId];

export function useDealOnboarding(dealId: string | undefined) {
  return useQuery({
    queryKey: key(dealId ?? ""),
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_onboarding" as never)
        .select("*")
        .eq("deal_id", dealId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DealOnboarding | null;
    },
    // Poll only while it is working; a finished run does not change.
    refetchInterval: (q) => {
      const s = (q.state.data as DealOnboarding | null | undefined)?.status;
      return s === "queued" || s === "running" ? 5_000 : false;
    },
  });
}

/** Runs every step again. Each one caches or fills blanks, so finished steps cost nothing. */
export function useRerunOnboarding(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("onboard-deal", { body: { action: "run", deal_id: dealId } });
      if (error) {
        const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context?.json?.().catch(() => null);
        throw new Error(body?.error ?? (error instanceof Error ? error.message : String(error)));
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key(dealId) });
    },
  });
}
