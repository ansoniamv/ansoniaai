import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { persistDealScore } from "@/lib/persistDealScore";

/**
 * Asks assign-submarket to pick a new deal's CoStar submarket, then rescores.
 *
 * Fire-and-forget from every place a deal is created. The buybox score is
 * computed here in the browser, not by the function, so when a pick lands the
 * deal is re-read and rescored the same way useAssignSubmarket does for a
 * manual pick: the supply figure the score reads has just changed underneath it.
 */
export function autoAssignSubmarket(dealId: string, queryClient?: QueryClient): void {
  void (async () => {
    const { data, error } = await supabase.functions.invoke("assign-submarket", { body: { deal_id: dealId } });
    if (error) {
      console.error("assign-submarket error:", error);
      return;
    }
    const assigned = (data?.results ?? []).some((r: { status: string }) => r.status === "assigned");
    if (assigned) {
      const { data: fresh, error: readErr } = await supabase.from("deals").select("*").eq("id", dealId).single();
      if (readErr) {
        console.error("[autoAssignSubmarket] re-read failed", readErr);
      } else {
        try {
          await persistDealScore(fresh);
        } catch (e) {
          console.error("[autoAssignSubmarket] rescore failed", e);
        }
      }
      queryClient?.invalidateQueries({ queryKey: ["rent_growth_scores"] });
    }
    // A decline still writes a note the deal page shows.
    queryClient?.invalidateQueries({ queryKey: ["deals"] });
  })();
}
