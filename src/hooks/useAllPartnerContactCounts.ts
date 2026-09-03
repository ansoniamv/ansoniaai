import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetch all partner_contacts and return a Record<partnerId, count>.
 * Single query for the full list to avoid N queries on the cards view.
 */
export function useAllPartnerContactCounts() {
  return useQuery({
    queryKey: ["partner-contacts", "all-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_contacts")
        .select("partner_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { partner_id: string }[]) {
        counts[row.partner_id] = (counts[row.partner_id] ?? 0) + 1;
      }
      return counts;
    },
  });
}
