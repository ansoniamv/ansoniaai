import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PartnerContact } from "@/hooks/usePartners";

/** All partner contacts in one query, keyed by partner_id. */
export function useAllPartnerContacts() {
  return useQuery({
    queryKey: ["partner-contacts", "all"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_contacts")
        .select("id, partner_id, name, role, ansonia_poc")
        .order("name", { ascending: true });
      if (error) throw error;
      const grouped: Record<string, PartnerContact[]> = {};
      for (const row of (data ?? []) as PartnerContact[]) {
        if (!grouped[row.partner_id]) grouped[row.partner_id] = [];
        grouped[row.partner_id].push(row);
      }
      return grouped;
    },
  });
}
