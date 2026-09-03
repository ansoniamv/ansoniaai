import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Note } from "@/hooks/useNotes";

/**
 * Fetch all notes with entity_type = 'partner' and group them by partner id.
 * Notes are pre-sorted so pinned notes come first, then newest first.
 */
export function useAllPartnerNotes() {
  return useQuery({
    queryKey: ["notes", "all-partner-notes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("entity_type", "partner")
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      const byPartner: Record<string, Note[]> = {};
      for (const n of (data ?? []) as Note[]) {
        (byPartner[n.entity_id] ||= []).push(n);
      }
      return byPartner;
    },
  });
}
