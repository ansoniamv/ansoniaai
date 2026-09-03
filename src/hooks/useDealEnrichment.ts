import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useDealEnrichment(dealId: string | undefined) {
  return useQuery({
    queryKey: ["deal_enrichment", dealId],
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_enrichment")
        .select("*")
        .eq("deal_id", dealId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
