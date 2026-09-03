import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const RAISE_STAGES = [
  "added_to_pipeline",
  "initial_reachout",
  "materials_shared",
  "in_discussion",
  "serious_interest",
  "committed",
  "passed",
] as const;

export type RaiseStage = (typeof RAISE_STAGES)[number];

export const STAGE_LABEL: Record<RaiseStage, string> = {
  added_to_pipeline: "Added to Pipeline",
  initial_reachout: "Initial Reach Out",
  materials_shared: "Materials Shared",
  in_discussion: "In Discussion",
  serious_interest: "Serious Interest",
  committed: "Committed",
  passed: "Passed",
};

export type Engagement = {
  id: string;
  deal_id: string;
  partner_id: string;
  stage: RaiseStage;
  initial_reachout_date: string | null;
  materials_shared_date: string | null;
  materials_shared_items: string | null;
  discussion_scheduled_date: string | null;
  serious_interest: boolean;
  indicated_amount: number | null;
  committed_amount: number | null;
  passed: boolean;
  pass_price_surmountable: boolean | null;
  pass_feedback: string | null;
  last_contact_date: string | null;
  next_action: string | null;
  next_action_date: string | null;
  owner: string | null;
  notes: string | null;
  stage_locked_manual?: boolean;
  stage_locked_at?: string | null;
  stage_last_auto_reason?: string | null;
  stage_last_auto_at?: string | null;
  created_at: string;
  updated_at: string;
  removed_at?: string | null;
  partner_name?: string;
  partner_contact?: string | null;
};

export function useEngagementsByDeal(dealId: string | undefined, opts?: { includeRemoved?: boolean }) {
  const includeRemoved = !!opts?.includeRemoved;
  return useQuery({
    queryKey: ["capital-raise-engagements", "deal", dealId, includeRemoved ? "all" : "active"],
    enabled: !!dealId,
    queryFn: async () => {
      let query = (supabase as any)
        .from("capital_raise_engagements")
        .select("*, partners(name, ansonia_poc)")
        .eq("deal_id", dealId!);
      if (!includeRemoved) query = query.is("removed_at", null);
      const { data, error } = await query.order("created_at");
      if (error) throw error;
      return (data as any[]).map((e) => ({
        ...e,
        partner_name: e.partners?.name,
        partner_contact: e.partners?.ansonia_poc,
      })) as Engagement[];
    },
  });
}

export function useUpdateEngagement(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Engagement> & { id: string }) => {
      const { data, error } = await (supabase as any)
        .from("capital_raise_engagements")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements", "deal", dealId, "active"] });
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements", "deal", dealId, "all"] });
      qc.invalidateQueries({ queryKey: ["deals", dealId] });
    },
  });
}

/**
 * Soft-deletes an engagement by setting removed_at = now().
 * Use restoreEngagement to undo.
 */
export function useDeleteEngagement(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("capital_raise_engagements")
        .update({ removed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements", "deal", dealId, "active"] });
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements", "deal", dealId, "all"] });
      qc.invalidateQueries({ queryKey: ["deals", dealId] });
    },
  });
}

export function useRestoreEngagement(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("capital_raise_engagements")
        .update({ removed_at: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements", "deal", dealId, "active"] });
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements", "deal", dealId, "all"] });
      qc.invalidateQueries({ queryKey: ["deals", dealId] });
    },
  });
}
