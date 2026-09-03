import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DealFieldEvent = {
  id: string;
  deal_id: string;
  field: "status" | "pipeline_stage";
  from_value: string | null;
  to_value: string | null;
  changed_by: string | null;
  source: string;
  reason: string | null;
  created_at: string;
};

/** Append-only audit trail of status / pipeline_stage changes for one deal. */
export function useDealFieldEvents(dealId: string | undefined) {
  return useQuery({
    queryKey: ["deal_field_events", dealId],
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_field_events" as never)
        .select("*")
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DealFieldEvent[];
    },
  });
}
