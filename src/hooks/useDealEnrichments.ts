import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Row from deal_enrichment_summary view — a handful of numbers instead of the full rings blob. */
export type EnrichmentRow = {
  deal_id: string;
  medhinc_1mi: number | null;
  medhinc_3mi: number | null;
  medhinc_5mi: number | null;
  pop_cy_1mi: number | null;
  pop_fy_1mi: number | null;
  pop_cy_3mi: number | null;
  pop_fy_3mi: number | null;
  pop_cy_5mi: number | null;
  pop_fy_5mi: number | null;
};

export function useDealEnrichments() {
  return useQuery({
    queryKey: ["deal_enrichments_summary"],
    staleTime: 5 * 60 * 1000, // demographics change rarely; cache 5 min
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("deal_enrichment_summary")
        .select(
          "deal_id, medhinc_1mi, medhinc_3mi, medhinc_5mi, pop_cy_1mi, pop_fy_1mi, pop_cy_3mi, pop_fy_3mi, pop_cy_5mi, pop_fy_5mi"
        );
      if (error) throw error;
      const map = new Map<string, EnrichmentRow>();
      (data ?? []).forEach((r: EnrichmentRow) => map.set(r.deal_id, r));
      return map;
    },
  });
}

const fmtK = (v: number | null) => (v == null || isNaN(v) ? null : Math.round(v / 1000).toString());

/** "$AAA, BBB, CCC" (values in $K) across 1/3/5 mi rings. */
export function deriveMedianHHIncome(r: EnrichmentRow | undefined | null): string | null {
  if (!r) return null;
  const vals = [fmtK(r.medhinc_1mi), fmtK(r.medhinc_3mi), fmtK(r.medhinc_5mi)].filter(
    (v): v is string => v != null
  );
  return vals.length ? `$${vals.join(", ")}` : null;
}

const pctAnn = (cy: number | null, fy: number | null) => {
  if (cy == null || fy == null || cy === 0 || isNaN(cy) || isNaN(fy)) return null;
  return (((fy - cy) / cy) * 100) / 5;
};

/** "X.X, Y.Y, Z.Z%" annualized 5-yr population growth across 1/3/5 mi rings. */
export function derivePopGrowth(r: EnrichmentRow | undefined | null): string | null {
  if (!r) return null;
  const vals = [
    pctAnn(r.pop_cy_1mi, r.pop_fy_1mi),
    pctAnn(r.pop_cy_3mi, r.pop_fy_3mi),
    pctAnn(r.pop_cy_5mi, r.pop_fy_5mi),
  ]
    .filter((v): v is number => v != null)
    .map((v) => v.toFixed(1));
  return vals.length ? `${vals.join(", ")}%` : null;
}
