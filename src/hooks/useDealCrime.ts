import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Esri crime index per deal, read from the enrichment we already paid for.
 *
 * This adds no cost and makes no Esri calls: CRMCYTOTC is already stored in
 * deal_enrichment.rings for every enriched deal. It is a point reading at the
 * property, not area-wide shading — Esri bills per enrichment, so there is no
 * free way to shade a whole map with it.
 *
 * The 1-mile ring is used rather than 3 or 5 because crime is the one metric
 * where the immediate block matters more than the submarket.
 *
 * A reading is only as good as the point it was measured around. 33 deals had
 * their coordinates corrected after the enrichment ran — one by 3,900 miles,
 * from London to Chicago — so their rings describe somewhere the deal is not.
 * Those carry esri_enrichment_stale, and this hook reports them as stale rather
 * than returning the number: a crime index rendered for the wrong neighbourhood
 * is worse than none, because nothing on screen would say it was wrong.
 */
export type DealCrime = {
  /** The stored reading. Null when never enriched, or when the point has moved. */
  index: number | null;
  /** True when the point moved after enrichment, so the reading is for elsewhere. */
  stale: boolean;
  /** Why it went stale, for display. */
  staleReason: string | null;
};

export function useDealCrime() {
  return useQuery({
    queryKey: ["deal_crime_index"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const [enrichment, deals] = await Promise.all([
        supabase.from("deal_enrichment").select("deal_id,rings"),
        supabase.from("deals").select("id,esri_enrichment_stale,esri_enrichment_stale_reason"),
      ]);
      if (enrichment.error) throw enrichment.error;
      if (deals.error) throw deals.error;

      const staleById = new Map<string, string | null>();
      for (const d of (deals.data ?? []) as Array<{
        id: string;
        esri_enrichment_stale: boolean | null;
        esri_enrichment_stale_reason: string | null;
      }>) {
        if (d.esri_enrichment_stale) staleById.set(d.id, d.esri_enrichment_stale_reason);
      }

      const map = new Map<string, DealCrime>();
      for (const row of (enrichment.data ?? []) as Array<{ deal_id: string; rings: unknown }>) {
        const rings = row.rings as Record<string, Record<string, unknown>> | null;
        const raw = rings?.["1mi"]?.["CRMCYTOTC"];
        const n = typeof raw === "number" ? raw : raw != null ? Number(raw) : NaN;
        // A non-numeric reading is left OUT rather than stored as 0. Zero is a
        // legitimate crime index, so a parse failure recorded as 0 would render
        // as "safest area" instead of "no data".
        if (!Number.isFinite(n)) continue;
        const isStale = staleById.has(row.deal_id);
        map.set(row.deal_id, {
          index: isStale ? null : n,
          stale: isStale,
          staleReason: isStale ? staleById.get(row.deal_id) ?? null : null,
        });
      }
      return map;
    },
  });
}
