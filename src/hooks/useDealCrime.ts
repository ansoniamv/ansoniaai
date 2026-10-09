import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Esri crime index per deal, read from the enrichment we already paid for.
 *
 * This adds no cost: CRMCYTOTC is already stored in deal_enrichment.rings for
 * every enriched deal (145 rows, all populated). It is a point reading at the
 * property, not area-wide shading — Esri bills per enrichment, so there is no
 * free way to shade a whole map with it.
 *
 * The 1-mile ring is used rather than 3 or 5 because crime is the one metric
 * where the immediate block matters more than the submarket.
 */
export type DealCrime = { dealId: string; index: number | null };

export function useDealCrime() {
  return useQuery({
    queryKey: ["deal_crime_index"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_enrichment")
        .select("deal_id,rings");
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of (data ?? []) as Array<{ deal_id: string; rings: unknown }>) {
        const rings = row.rings as Record<string, Record<string, unknown>> | null;
        const raw = rings?.["1mi"]?.["CRMCYTOTC"];
        const n = typeof raw === "number" ? raw : raw != null ? Number(raw) : NaN;
        // A non-numeric reading is left OUT of the map rather than stored as 0.
        // Zero is a legitimate crime index, so a parse failure recorded as 0
        // would render as "safest area" instead of "no data".
        if (Number.isFinite(n)) map.set(row.deal_id, n);
      }
      return map;
    },
  });
}
