import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Note } from "@/hooks/useNotes";

/**
 * Fetch all notes with entity_type = 'deal' and group them by deal id.
 * Used to power hover tooltips on the pipeline and deal-level matching context.
 */
export function useAllDealNotes() {
  return useQuery({
    queryKey: ["notes", "all-deal-notes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("entity_type", "deal")
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      const byDeal: Record<string, Note[]> = {};
      for (const n of (data ?? []) as Note[]) {
        (byDeal[n.entity_id] ||= []).push(n);
      }
      return byDeal;
    },
  });
}
