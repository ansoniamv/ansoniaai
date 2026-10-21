import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { persistDealScore } from "@/lib/persistDealScore";

/**
 * Sets or clears a deal's CoStar submarket. Shared by the Overview's Submarket
 * Signals panel and the AI Score tab so both save, rescore and refresh the same way.
 */
export function useAssignSubmarket(dealId: string) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const assign = async (next: string | null) => {
    setSaving(true);
    try {
      const { data: fresh, error } = await supabase
        .from("deals")
        // Clearing is a decision too: assign-submarket never fills a manual blank.
        .update({ costar_submarket_code: next, costar_submarket_source: "manual", costar_submarket_note: null })
        .eq("id", dealId)
        .select("*")
        .single();
      if (error) throw error;
      // Supply feeds the buybox score, so rescore on the new figure.
      try {
        await persistDealScore(fresh);
      } catch (e) {
        console.error("[useAssignSubmarket] rescore failed", e);
      }
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      // The cyclical leg reads the submarket, so the rent-growth scores are stale too.
      queryClient.invalidateQueries({ queryKey: ["rent_growth_scores"] });
      toast.success(next ? "Submarket set; supply now from CoStar" : "Submarket cleared");
    } catch (e) {
      toast.error("Couldn't save submarket: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return { assign, saving };
}
