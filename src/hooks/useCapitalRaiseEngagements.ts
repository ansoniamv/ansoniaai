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
      return (data as any[])
        // Ansonia's own record is not an outside capital source, so it can never
        // be an engagement on our own raise. partner_id is NOT NULL on this
        // table, so this drops exactly the internal-partner rows and nothing else.
        .map((e) => ({
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

// ─────────────────────────────────────────────────────────────────────────────
// Partner side of the same join: which deals a partner is tagged on.
// ─────────────────────────────────────────────────────────────────────────────

export const PASS_CATEGORIES = [
  "Size / Check size",
  "Market / Geography",
  "Strategy / Risk",
  "Pricing / Returns",
  "Timing / Capital availability",
  "Relationship / Fit",
  "Other",
] as const;

export type EngagementDeal = {
  id: string;
  property_name: string;
  city: string | null;
  state: string | null;
  msa: string | null;
  unit_count: number | null;
  asking_price: number | null;
  estimated_equity: number | null;
  status: string | null;
  pipeline_stage: string | null;
  raise_archived_at: string | null;
};

export type PartnerEngagement = Engagement & { pass_category?: string | null; deal: EngagementDeal | null };

const ENGAGEMENT_DEAL_COLUMNS =
  "id,property_name,city,state,msa,unit_count,asking_price,estimated_equity,status,pipeline_stage,raise_archived_at";

export function useEngagementsByPartner(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["capital-raise-engagements", "partner", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("capital_raise_engagements")
        .select(`*, deal:deals(${ENGAGEMENT_DEAL_COLUMNS})`)
        .eq("partner_id", partnerId!)
        .is("removed_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PartnerEngagement[];
    },
  });
}

/** Deals available to tag — a lean column list, since `deals` is very wide. */
export function useTaggableDeals(enabled: boolean) {
  return useQuery({
    queryKey: ["deals", "taggable"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("deals")
        .select(ENGAGEMENT_DEAL_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as EngagementDeal[];
    },
  });
}

/** Any engagement write shows up on both the partner page and the deal's Capital Raise tab. */
function invalidateEngagements(qc: ReturnType<typeof useQueryClient>, dealId?: string) {
  qc.invalidateQueries({ queryKey: ["capital-raise-engagements"] });
  qc.invalidateQueries({ queryKey: ["partner_currency"] });
  if (dealId) qc.invalidateQueries({ queryKey: ["deals", dealId] });
}

export function useTagPartnerOnDeal(partnerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dealId: string) => {
      const today = new Date().toISOString().slice(0, 10);
      // A previously removed tag comes back rather than colliding with the
      // (deal_id, partner_id) unique key.
      const { data: existing, error: findErr } = await (supabase as any)
        .from("capital_raise_engagements")
        .select("id")
        .eq("deal_id", dealId)
        .eq("partner_id", partnerId)
        .maybeSingle();
      if (findErr) throw findErr;
      if (existing) {
        const { error } = await (supabase as any)
          .from("capital_raise_engagements")
          .update({ removed_at: null })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        // Same defaults as adding a partner from the deal's Capital Raise tab.
        const { error } = await (supabase as any).from("capital_raise_engagements").insert({
          deal_id: dealId,
          partner_id: partnerId,
          stage: "initial_reachout",
          initial_reachout_date: today,
          last_contact_date: today,
        });
        if (error) throw error;
      }
      // Adding a partner is live raise work — reopen the raise, as the deal tab does.
      const { error: dealErr } = await (supabase as any)
        .from("deals")
        .update({ raise_status: "raising", raise_archived_at: null, raise_archived_by: null, raise_archive_note: null })
        .eq("id", dealId);
      if (dealErr) throw dealErr;
      return dealId;
    },
    onSuccess: (dealId) => {
      invalidateEngagements(qc, dealId);
      qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useUpdatePartnerEngagement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PartnerEngagement> & { id: string }) => {
      const { data, error } = await (supabase as any)
        .from("capital_raise_engagements")
        .update(updates)
        .eq("id", id)
        .select("deal_id")
        .single();
      if (error) throw error;
      return data as { deal_id: string };
    },
    onSuccess: (data) => invalidateEngagements(qc, data?.deal_id),
  });
}

/** Fields a manual stage move writes. Shared by the deal's Capital Raise tab and the partner page. */
export function stageStampFields(stage: RaiseStage): Partial<Engagement> {
  const today = new Date();
  const dateOnly = today.toISOString().slice(0, 10);
  const iso = today.toISOString();
  // Any explicit stage change from the UI is manual — lock the row so
  // automations (email replies, commits, denials) don't overwrite it.
  const patch: Partial<Engagement> = {
    stage,
    last_contact_date: dateOnly,
    stage_locked_manual: true,
    stage_locked_at: iso,
  } as Partial<Engagement>;
  switch (stage) {
    case "initial_reachout":
      patch.initial_reachout_date = dateOnly;
      break;
    case "materials_shared":
      patch.materials_shared_date = dateOnly;
      break;
    case "in_discussion":
      break;
    case "added_to_pipeline":
      break;
    case "serious_interest":
      patch.serious_interest = true;
      break;
    case "committed":
      break;
    case "passed":
      patch.passed = true;
      break;
  }
  return patch;
}

/** Names for a set of deal ids — used to label deal chips on activity items. */
export function useDealNames(ids: string[]) {
  const sorted = Array.from(new Set(ids)).sort();
  return useQuery({
    queryKey: ["deals", "names", sorted],
    enabled: sorted.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("deals")
        .select("id,property_name")
        .in("id", sorted);
      if (error) throw error;
      return Object.fromEntries(((data ?? []) as { id: string; property_name: string }[]).map((d) => [d.id, d.property_name])) as Record<string, string>;
    },
  });
}
