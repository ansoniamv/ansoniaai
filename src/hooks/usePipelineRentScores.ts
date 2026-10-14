import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ACTIVE_STATUSES } from "@/lib/dealStatus";
import type { SubmarketSignals } from "@/lib/marketData";
import { scorePipeline, type PipelineEntry, type Rings, type ScoreInputs } from "@/lib/rentGrowthScore";

const DEAL_COLUMNS = [
  "id", "property_name", "city", "state", "msa", "status", "unit_count", "vintage_year",
  "in_place_avg_rent", "median_rent_tract", "median_income_tract", "area_median_income_1mi",
  "population_growth_pct", "job_growth_pct", "rent_trend_12mo_pct", "costar_submarket_code",
].join(",");

const CHUNK = 100;

async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetch(ids.slice(i, i + CHUNK))));
  return out;
}

/**
 * Every live deal scored on the three rent-growth legs. Structural and micro
 * rank each deal against the others, so one deal's score needs the whole
 * pipeline loaded. `currentId` is always included even if it isn't active, so a
 * passed deal still gets scored against the live ones.
 *
 * Reads only the columns scoring needs: deals is very wide, and rings is the one
 * enrichment column used (raw_response is large and not needed).
 */
export function usePipelineRentScores(currentId: string | undefined) {
  return useQuery({
    queryKey: ["rent_growth_scores", currentId],
    enabled: !!currentId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: active, error } = await supabase
        .from("deals")
        .select(DEAL_COLUMNS)
        .in("status", [...ACTIVE_STATUSES]);
      if (error) throw error;
      const deals = (active ?? []) as unknown as Array<ScoreInputs & { status: string }>;
      let currentIsActive = true;
      if (currentId && !deals.some((d) => d.id === currentId)) {
        currentIsActive = false;
        const { data: cur, error: curErr } = await supabase
          .from("deals")
          .select(DEAL_COLUMNS)
          .eq("id", currentId)
          .maybeSingle();
        if (curErr) throw curErr;
        if (cur) deals.push(cur as unknown as ScoreInputs & { status: string });
      }

      const ids = deals.map((d) => d.id);
      const rings = await inChunks(ids, async (chunk) => {
        const { data, error: e } = await supabase.from("deal_enrichment").select("deal_id, rings").in("deal_id", chunk);
        if (e) throw e;
        return data ?? [];
      });
      const ringsBy = new Map(rings.map((r) => [r.deal_id, (r.rings as Rings | null) ?? null]));

      const codes = [...new Set(deals.map((d) => d.costar_submarket_code).filter((c): c is string => !!c))];
      const signals = await inChunks(codes, async (chunk) => {
        const { data, error: e } = await supabase.from("costar_submarket_signals_v").select("*").in("geography_code", chunk);
        if (e) throw e;
        return data ?? [];
      });
      const sigBy = new Map<string, SubmarketSignals[]>();
      for (const s of signals) if (s.geography_code) sigBy.set(s.geography_code, [...(sigBy.get(s.geography_code) ?? []), s]);

      // Rank only against live deals; a passed current deal is scored but isn't a peer.
      const entries: PipelineEntry[] = deals.map((d) => ({
        deal: d,
        rings: ringsBy.get(d.id) ?? null,
        signals: d.costar_submarket_code ? sigBy.get(d.costar_submarket_code) ?? [] : [],
      }));
      const peers = currentIsActive ? entries : entries.filter((e) => e.deal.id !== currentId);
      const scores = scorePipeline(peers);
      if (!currentIsActive) {
        const self = entries.find((e) => e.deal.id === currentId);
        if (self) {
          const withSelf = scorePipeline([...peers, self]);
          scores.set(currentId!, withSelf.get(currentId!)!);
        }
      }
      return { deals, entries, scores, livePeers: peers.length, currentIsActive };
    },
  });
}
