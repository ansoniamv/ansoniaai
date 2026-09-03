import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PartnerSuggestion = {
  id: string;
  partner_id: string | null;
  deal_id: string | null;
  engagement_id: string | null;
  type: "warmth_change" | "partner_field" | "avoided_market_add" | "stage_change" | "contact_add" | "contact_update" | "partner_add" | "deal_add" | "attach_email" | "capital_status_change" | "profile_fact_add" | string;

  field: string | null;
  current_value: any;
  proposed_value: any;
  summary: string;
  rationale: string | null;
  evidence: { message_ids?: string[]; quote?: string; email_date?: string } | null;
  signals: any;
  confidence: number | null;
  deal_confidence: number | null;
  status: "pending" | "approved" | "rejected" | "applied" | "superseded";
  superseded_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

const TABLE = "partner_suggestions" as any;

/**
 * Shared helper for the "create new record" and "attach email" suggestion types.
 * Used by both useApplySuggestion (interactive) and the bulk applyOne path.
 */
async function applyCreateOrAttach(
  suggestion: PartnerSuggestion,
  proposedValue: any,
  reviewer: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const pv: any = proposedValue || {};

  if (suggestion.type === "partner_add") {
    if (!pv.name || typeof pv.name !== "string" || !pv.name.trim()) {
      return { ok: false, message: "partner name required" };
    }
    const row: Record<string, any> = { name: pv.name.trim() };
    const strFields = ["firm_type", "ansonia_poc", "website", "headquarters", "relationship_strength"];
    for (const f of strFields) {
      if (typeof pv[f] === "string" && pv[f].trim()) row[f] = pv[f].trim();
    }
    const arrFields = ["investor_type", "geography", "geography_avoid", "hold_period", "product_types"];
    for (const f of arrFields) {
      if (Array.isArray(pv[f]) && pv[f].length) row[f] = pv[f];
    }
    const { error } = await (supabase as any).from("partners").insert(row);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  if (suggestion.type === "deal_add") {
    const propertyName: string | undefined = pv.property_name || pv.name;
    if (!propertyName || !String(propertyName).trim()) {
      return { ok: false, message: "property_name required" };
    }
    const row: Record<string, any> = {
      property_name: String(propertyName).trim(),
      status: pv.status || "New",
      source: pv.source || "atlas",
    };
    const strFields = ["broker", "city", "state", "msa", "address", "zip", "property_website", "property_phone"];
    for (const f of strFields) {
      if (typeof pv[f] === "string" && pv[f].trim()) row[f] = pv[f].trim();
    }
    if (typeof pv.unit_count === "number") row.unit_count = pv.unit_count;
    if (typeof pv.vintage_year === "number") row.vintage_year = pv.vintage_year;
    const { error } = await (supabase as any).from("deals").insert(row);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  if (suggestion.type === "attach_email") {
    let partnerId: string | null = pv.partner_id || suggestion.partner_id || null;
    let dealId: string | null = pv.deal_id || suggestion.deal_id || null;

    // Fallback: resolve by name (covers directive flow where partner_add/deal_add was approved first).
    if (!partnerId && typeof pv.partner_name === "string" && pv.partner_name.trim()) {
      const { data } = await (supabase as any)
        .from("partners").select("id").ilike("name", pv.partner_name.trim()).is("archived_at", null).limit(1);
      if (data && data[0]) partnerId = data[0].id;
    }
    if (!dealId && typeof pv.deal_name === "string" && pv.deal_name.trim()) {
      const { data } = await (supabase as any)
        .from("deals").select("id").ilike("property_name", pv.deal_name.trim()).limit(1);
      if (data && data[0]) dealId = data[0].id;
    }

    if (!partnerId && !dealId) {
      return { ok: false, message: "Attach requires a partner or deal — approve the create suggestion first, or link one manually." };
    }


    const subject: string = pv.subject || "(no subject)";
    const bodyHtml: string | null = pv.body_html || pv.html || null;
    const bodyText: string | null = pv.body_text || pv.text || null;
    const emailDate: string = pv.email_date || pv.received_at || new Date().toISOString();
    const messageIds: string[] = Array.isArray(pv.message_ids) ? pv.message_ids
      : Array.isArray(suggestion.evidence?.message_ids) ? suggestion.evidence!.message_ids! : [];

    // (a) Note + note_links
    const noteContent = bodyHtml
      ? `<p><strong>${subject}</strong></p>${bodyHtml}`
      : `<p><strong>${subject}</strong></p><p>${(bodyText || "").replace(/\n/g, "<br/>")}</p>`;
    const noteEntityType = partnerId ? "partner" : "deal";
    const noteEntityId = partnerId || dealId!;
    const { data: note, error: noteErr } = await (supabase as any)
      .from("notes")
      .insert({
        entity_type: noteEntityType,
        entity_id: noteEntityId,
        content: noteContent,
        content_format: "html",
        author: reviewer,
      })
      .select("id")
      .single();
    if (noteErr) return { ok: false, message: noteErr.message };

    const links: any[] = [];
    if (partnerId) links.push({ note_id: note.id, linked_type: "partner", linked_id: partnerId });
    if (dealId) links.push({ note_id: note.id, linked_type: "deal", linked_id: dealId });
    if (links.length) {
      const { error: linkErr } = await (supabase as any).from("note_links").insert(links);
      if (linkErr) return { ok: false, message: linkErr.message };
    }

    // (b) partner_interactions row (warmth / last-contact feed)
    if (partnerId) {
      const { error: interErr } = await (supabase as any).from("partner_interactions").insert({
        partner_id: partnerId,
        interaction_type: "email",
        author: reviewer,
        content: subject + (bodyText ? `\n\n${bodyText.slice(0, 2000)}` : ""),
        source: "atlas",
        interaction_date: emailDate,
      });
      if (interErr) return { ok: false, message: interErr.message };
    }

    // (c) outlook_message_deals junction — link each source message to the deal
    if (dealId && messageIds.length) {
      const { data: msgs } = await (supabase as any)
        .from("outlook_messages")
        .select("id, message_id")
        .in("message_id", messageIds);
      const rows = ((msgs || []) as any[]).map((m) => ({ message_id: m.id, deal_id: dealId }));
      if (rows.length) {
        await (supabase as any).from("outlook_message_deals").upsert(rows, {
          onConflict: "message_id,deal_id",
          ignoreDuplicates: true,
        });
      }
    }

    return { ok: true };
  }

  return { ok: false, message: `Unknown create/attach type: ${suggestion.type}` };
}



function categoryFromField(field: string | null, type: string): string {
  if (type === "stage_change") return "Pass Reason";
  if (!field) return "General";
  if (field === "geography" || field === "geography_avoid") return "Market/Geography";
  if (field === "min_equity_m" || field === "max_equity_m") return "Size/Check size";
  if (field.startsWith("strategy_") || field === "hold_period") return "Strategy/Risk";
  if (field === "product_types") return "Product Type";
  return "General";
}

export function usePartnerSuggestions(filters?: { partnerId?: string; status?: string; limit?: number; includeSuperseded?: boolean }) {
  return useQuery({
    queryKey: ["partner_suggestions", filters],
    queryFn: async () => {
      let q = (supabase as any).from(TABLE).select("*").order("created_at", { ascending: false });
      if (filters?.partnerId) q = q.eq("partner_id", filters.partnerId);
      if (filters?.status) q = q.eq("status", filters.status);
      q = q.limit(filters?.limit ?? 500);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PartnerSuggestion[];
    },
  });
}

export function usePendingSuggestionCount() {
  return useQuery({
    queryKey: ["partner_suggestions", "pending_count"],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 60_000,
  });
}

export function useAnalyzePartnerEmails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts?: { partner_id?: string; since_days?: number }) => {
      const { data, error } = await supabase.functions.invoke("analyze-partner-emails", { body: opts || {} });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: boolean; analyzed: number; suggestions: number; threads?: number; partners: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partner_suggestions"] }),
  });
}

export function useComputePartnerWarmth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts?: { partner_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("compute-partner-warmth", { body: opts || {} });
      if (error) throw error;
      return data as { ok: boolean; partners: number; suggestions: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner_suggestions"] });
      qc.invalidateQueries({ queryKey: ["partner_warmth_signals"] });
    },
  });
}

export function usePartnerWarmthSignals(partnerId?: string) {
  return useQuery({
    queryKey: ["partner_warmth_signals", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("partner_warmth_signals").select("*").eq("partner_id", partnerId).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useRejectSuggestion() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from(TABLE)
        .update({ status: "rejected", reviewed_by: profile?.email || null, reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partner_suggestions"] }),
  });
}

export type ApplyResult =
  | { ok: true }
  | { ok: false; reason: "value_changed"; liveValue: any }
  | { ok: false; reason: "locked_field" }
  | { ok: false; reason: "error"; message: string };

/**
 * Apply engine — runs ONLY when a human approves a suggestion.
 * On approval of criteria/denial-type suggestions, also feeds the learning brain
 * (capital_partner_feedback + learn-from-partner-feedback) when those tables exist.
 */
export function useApplySuggestion() {
  const qc = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({
      suggestion,
      overrideLocked,
      editedValue,
    }: {
      suggestion: PartnerSuggestion;
      overrideLocked?: boolean;
      editedValue?: any;
    }): Promise<ApplyResult> => {
      const proposedValue = editedValue !== undefined ? editedValue : suggestion.proposed_value;
      const reviewer = profile?.email || null;

      // Create/attach types don't require an existing partner — handle before partner lookup.
      if (suggestion.type === "partner_add" || suggestion.type === "deal_add" || suggestion.type === "attach_email") {
        const res = await applyCreateOrAttach(suggestion, proposedValue, reviewer);
        if (!res.ok) return { ok: false, reason: "error", message: res.message || "failed" };
        await (supabase as any).from(TABLE).update({
          status: "applied", applied_at: new Date().toISOString(),
          reviewed_by: reviewer, reviewed_at: new Date().toISOString(),
        }).eq("id", suggestion.id);
        return { ok: true };
      }

      const { data: partner, error: pErr } = await (supabase as any)
        .from("partners").select("*").eq("id", suggestion.partner_id).maybeSingle();
      if (pErr || !partner) return { ok: false, reason: "error", message: pErr?.message || "partner not found" };

      const manualFields: string[] = partner.manual_fields || [];
      const enriched: Record<string, any> = partner.enriched_fields || {};

      const field = suggestion.field;
      const type = suggestion.type;

      if (field && manualFields.includes(field) && !overrideLocked && type !== "stage_change") {
        return { ok: false, reason: "locked_field" };
      }


      const sameValue = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

      let deal: any = null;

      if (type === "warmth_change" || type === "partner_field") {
        if (!field) return { ok: false, reason: "error", message: "field required" };
        const liveValue = partner[field];
        if (!sameValue(liveValue, suggestion.current_value)) {
          return { ok: false, reason: "value_changed", liveValue };
        }
        const nextManual = manualFields.includes(field) ? manualFields : [...manualFields, field];
        const nextEnriched = {
          ...enriched,
          [field]: {
            source: "email",
            as_of: (suggestion.evidence as any)?.email_date ?? suggestion.created_at,
            written_at: new Date().toISOString(),
            set_by: reviewer,
            message_ids: suggestion.evidence?.message_ids || [],
            approved_by: reviewer, approved_at: new Date().toISOString(),
          },
        };
        const { error } = await (supabase as any)
          .from("partners")
          .update({ [field]: proposedValue, manual_fields: nextManual, enriched_fields: nextEnriched })
          .eq("id", suggestion.partner_id);
        if (error) return { ok: false, reason: "error", message: error.message };
      } else if (type === "avoided_market_add") {
        const liveList: string[] = partner.geography_avoid || [];
        const val = typeof proposedValue === "string" ? [proposedValue] : (Array.isArray(proposedValue) ? proposedValue : []);
        const union = Array.from(new Set([...(liveList || []), ...val]));
        const nextManual = manualFields.includes("geography_avoid") ? manualFields : [...manualFields, "geography_avoid"];
        const nextEnriched = {
          ...enriched,
          geography_avoid: {
            source: "email",
            as_of: (suggestion.evidence as any)?.email_date ?? suggestion.created_at,
            written_at: new Date().toISOString(),
            set_by: reviewer,
            message_ids: suggestion.evidence?.message_ids || [],
            approved_by: reviewer, approved_at: new Date().toISOString(),
          },
        };
        const { error } = await (supabase as any)
          .from("partners")
          .update({ geography_avoid: union, manual_fields: nextManual, enriched_fields: nextEnriched })
          .eq("id", suggestion.partner_id);
        if (error) return { ok: false, reason: "error", message: error.message };
      } else if (type === "stage_change") {
        if (!suggestion.engagement_id) return { ok: false, reason: "error", message: "engagement_id required for stage_change" };
        const { data: eng, error: eErr } = await (supabase as any)
          .from("capital_raise_engagements").select("*").eq("id", suggestion.engagement_id).maybeSingle();
        if (eErr || !eng) return { ok: false, reason: "error", message: eErr?.message || "engagement not found" };
        if (!sameValue(eng.stage, suggestion.current_value)) {
          return { ok: false, reason: "value_changed", liveValue: eng.stage };
        }
        const today = new Date();
        const dateOnly = today.toISOString().slice(0, 10);
        const iso = today.toISOString();
        const patch: Record<string, any> = { stage: proposedValue, last_contact_date: dateOnly };
        switch (proposedValue) {
          case "initial_reachout": patch.initial_reachout_date = dateOnly; break;
          case "materials_shared": patch.materials_shared_date = dateOnly; break;
          case "in_discussion": break;
          case "serious_interest": patch.serious_interest = true; break;
          case "passed": patch.passed = true; break;
        }
        const { error } = await (supabase as any)
          .from("capital_raise_engagements").update(patch).eq("id", suggestion.engagement_id);
        if (error) return { ok: false, reason: "error", message: error.message };

        // Fetch deal for learning-brain snapshot
        if (eng.deal_id) {
          const { data: d } = await (supabase as any).from("deals").select("*").eq("id", eng.deal_id).maybeSingle();
          deal = d;
        }
      } else if (type === "contact_add") {
        const pv: any = proposedValue || {};
        if (!pv.name) return { ok: false, reason: "error", message: "name required" };
        const insertRow: any = { partner_id: suggestion.partner_id, name: pv.name };
        for (const f of ["email","phone","role","linkedin_url","firm_location"]) {
          if (typeof pv[f] === "string" && pv[f].trim()) insertRow[f] = pv[f].trim();
        }
        const { error } = await (supabase as any).from("partner_contacts").insert(insertRow);
        if (error) return { ok: false, reason: "error", message: error.message };
      } else if (type === "contact_update") {
        const pv: any = proposedValue || {};
        const contactId: string | undefined = pv.contact_id;
        if (!contactId) return { ok: false, reason: "error", message: "contact_id required" };
        const { data: contact, error: cErr } = await (supabase as any)
          .from("partner_contacts").select("*").eq("id", contactId).maybeSingle();
        if (cErr || !contact) return { ok: false, reason: "error", message: cErr?.message || "contact not found" };
        const patch: Record<string, any> = {};
        // fills — only apply when current is still empty
        for (const [f, v] of Object.entries(pv.fills || {})) {
          const cur = (contact as any)[f];
          const empty = cur === null || cur === undefined || (typeof cur === "string" && cur.trim() === "");
          if (empty) patch[f] = v;
        }
        // changes — only apply when current matches the old value seen at proposal time
        for (const [f, obj] of Object.entries(pv.changes || {})) {
          const o = obj as any;
          if (sameValue((contact as any)[f], o.old)) patch[f] = o.new;
        }
        if (Object.keys(patch).length === 0) {
          return { ok: false, reason: "value_changed", liveValue: contact };
        }
        const { error } = await (supabase as any).from("partner_contacts").update(patch).eq("id", contactId);
        if (error) return { ok: false, reason: "error", message: error.message };
      } else if (type === "capital_status_change") {
        const pv: any = proposedValue || {};
        if (!pv.status) return { ok: false, reason: "error", message: "status required" };
        // Drift check against the value seen at proposal time.
        if (!sameValue(partner.capital_status, (suggestion.current_value as any)?.status ?? null)) {
          return { ok: false, reason: "value_changed", liveValue: partner.capital_status };
        }
        const nextManual = manualFields.includes("capital_status")
          ? manualFields : [...manualFields, "capital_status"];
        const nextEnriched = {
          ...enriched,
          capital_status: {
            source: "email",
            as_of: (suggestion.evidence as any)?.email_date ?? suggestion.created_at,
            written_at: new Date().toISOString(),
            set_by: reviewer,
            message_ids: suggestion.evidence?.message_ids || [],
            approved_by: reviewer, approved_at: new Date().toISOString(),
          },
        };
        const { error } = await (supabase as any).from("partners").update({
          capital_status: pv.status,
          capital_available_from: pv.available_from ?? null,
          capital_status_detail: pv.detail ?? null,
          // as_of is when the PARTNER said it, not when we approved it.
          capital_status_as_of: (suggestion.evidence as any)?.email_date
            ?? suggestion.created_at ?? new Date().toISOString(),
          manual_fields: nextManual,
          enriched_fields: nextEnriched,
        }).eq("id", suggestion.partner_id);
        if (error) return { ok: false, reason: "error", message: error.message };
      } else if (type === "profile_fact_add") {
        const pv: any = proposedValue || {};
        if (!pv.fact) return { ok: false, reason: "error", message: "fact required" };
        const { error } = await (supabase as any).from("partner_interactions").insert({
          partner_id: suggestion.partner_id,
          content: pv.fact,
          interaction_type: "email_fact",
          interaction_date: pv.fact_date ?? new Date().toISOString().slice(0, 10),
          source: "atlas",
          author: reviewer,
          fact_category: pv.category ?? "other",
          source_message_ids: suggestion.evidence?.message_ids || [],
        });
        if (error) return { ok: false, reason: "error", message: error.message };
      } else {
        return { ok: false, reason: "error", message: `Unknown suggestion type: ${type}` };
      }

      // Mark suggestion applied
      await (supabase as any).from(TABLE).update({
        status: "applied", applied_at: new Date().toISOString(),
        reviewed_by: reviewer, reviewed_at: new Date().toISOString(),
      }).eq("id", suggestion.id);

      // Feed learning brain (criteria/denial-shaped approvals)
      const feedsLearning =
        type === "avoided_market_add" ||
        (type === "stage_change" && proposedValue === "passed") ||
        (type === "partner_field" && field && (
          field === "geography" || field === "min_equity_m" || field === "max_equity_m" ||
          field === "hold_period" || field === "product_types" || field.startsWith("strategy_")
        ));
      if (feedsLearning) {
        try {
          const category = categoryFromField(field, type);
          const reasonText = [suggestion.rationale, suggestion.evidence?.quote].filter(Boolean).join(" — ");
          const snapshot: Record<string, any> = {
            partner: {
              name: partner.name, geography: partner.geography, geography_avoid: partner.geography_avoid,
              min_equity_m: partner.min_equity_m, max_equity_m: partner.max_equity_m,
              hold_period: partner.hold_period, product_types: partner.product_types,
            },
            field, proposed_value: proposedValue,
            source_message_ids: suggestion.evidence?.message_ids || [],
          };
          if (deal) snapshot.deal = {
            property_name: deal.property_name, city: deal.city, state: deal.state, msa: deal.msa,
            unit_count: deal.unit_count, vintage_year: deal.vintage_year,
          };
          const { error: fbErr } = await (supabase as any).from("capital_partner_feedback").insert({
            partner_id: suggestion.partner_id,
            deal_id: suggestion.deal_id || (deal?.id ?? null),
            engagement_id: suggestion.engagement_id,
            category, reason_text: reasonText || suggestion.summary,
            snapshot,
          });
          if (!fbErr) {
            // Refresh buy-box note
            supabase.functions.invoke("learn-from-partner-feedback", { body: {} }).catch(() => {});
          }
        } catch (e) {
          console.warn("Learning brain optional path failed:", e);
        }
      }

      return { ok: true };
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["partner_suggestions"] });
      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["partners", vars.suggestion.partner_id] });
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements"] });
      qc.invalidateQueries({ queryKey: ["partner-contacts", vars.suggestion.partner_id] });
      qc.invalidateQueries({ queryKey: ["partner-contacts", "all-counts"] });
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["partner_interactions"] });
      qc.invalidateQueries({ queryKey: ["outlook_message_deals"] });
    },

  });
}

export function useBulkApproveHighConfidence() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({ partnerId, minConfidence = 0.8 }: { partnerId: string; minConfidence?: number }) => {
      const { data: partner } = await (supabase as any).from("partners").select("manual_fields").eq("id", partnerId).maybeSingle();
      const manualFields: string[] = partner?.manual_fields || [];
      const { data: pending } = await (supabase as any)
        .from(TABLE).select("*").eq("partner_id", partnerId).eq("status", "pending");
      const eligible = ((pending || []) as PartnerSuggestion[]).filter(s =>
        (s.confidence ?? 0) >= minConfidence &&
        // Capital status decides whether the firm gets pitched at all — always read individually.
        s.type !== "capital_status_change" &&
        !(s.field && manualFields.includes(s.field))
      );
      let applied = 0, failed = 0;
      // Re-use apply engine inline (simple sequential)
      for (const s of eligible) {
        try {
          // Directly call apply engine mutation? We re-implement minimal path via re-invoking mutate not possible here.
          // Approximation: mark & delegate via same mutation function inline.
          // Instead, we call a lightweight direct-apply for non-locked fields.
          // For safety we defer to the same logic used in useApplySuggestion by dispatching an event through the qc — simplest is to call the RPC path via a fetch to the function; here we do an inline duplicate.
          const res = await applyOne(s, profile?.email || null);
          if (res.ok) applied++; else failed++;
        } catch { failed++; }
      }
      return { applied, failed, considered: eligible.length };
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["partner_suggestions"] });
      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements"] });
      qc.invalidateQueries({ queryKey: ["partner-contacts", vars.partnerId] });
      qc.invalidateQueries({ queryKey: ["partner-contacts", "all-counts"] });
    },
  });
}

// Standalone apply-one helper used by bulk approve — mirrors useApplySuggestion's logic (no override, no edit).
async function applyOne(suggestion: PartnerSuggestion, reviewer: string | null): Promise<{ ok: boolean; message?: string }> {
  if (suggestion.type === "partner_add" || suggestion.type === "deal_add" || suggestion.type === "attach_email") {
    const res = await applyCreateOrAttach(suggestion, suggestion.proposed_value, reviewer);
    if (res.ok) {
      await (supabase as any).from(TABLE).update({ status: "applied", applied_at: new Date().toISOString(), reviewed_by: reviewer, reviewed_at: new Date().toISOString() }).eq("id", suggestion.id);
    }
    return res;
  }
  const { data: partner } = await (supabase as any).from("partners").select("*").eq("id", suggestion.partner_id).maybeSingle();
  if (!partner) return { ok: false, message: "partner not found" };

  const manualFields: string[] = partner.manual_fields || [];
  const enriched: Record<string, any> = partner.enriched_fields || {};
  const field = suggestion.field; const type = suggestion.type;
  if (field && manualFields.includes(field)) return { ok: false, message: "locked" };
  const sameValue = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const proposedValue = suggestion.proposed_value;

  if (type === "warmth_change" || type === "partner_field") {
    if (!field) return { ok: false };
    if (!sameValue(partner[field], suggestion.current_value)) return { ok: false, message: "drift" };
    const nextManual = manualFields.includes(field) ? manualFields : [...manualFields, field];
    const nextEnriched = {
      ...enriched,
      [field]: {
        source: "email",
        as_of: (suggestion.evidence as any)?.email_date ?? suggestion.created_at,
        written_at: new Date().toISOString(),
        set_by: reviewer,
        message_ids: suggestion.evidence?.message_ids || [],
        approved_by: reviewer, approved_at: new Date().toISOString(),
      },
    };
    const { error } = await (supabase as any).from("partners").update({ [field]: proposedValue, manual_fields: nextManual, enriched_fields: nextEnriched }).eq("id", suggestion.partner_id);
    if (error) return { ok: false, message: error.message };
  } else if (type === "avoided_market_add") {
    const liveList: string[] = partner.geography_avoid || [];
    const val = typeof proposedValue === "string" ? [proposedValue] : (Array.isArray(proposedValue) ? proposedValue : []);
    const union = Array.from(new Set([...(liveList || []), ...val]));
    const { error } = await (supabase as any).from("partners").update({ geography_avoid: union }).eq("id", suggestion.partner_id);
    if (error) return { ok: false, message: error.message };
  } else if (type === "stage_change") {
    if (!suggestion.engagement_id) return { ok: false };
    const { data: eng } = await (supabase as any).from("capital_raise_engagements").select("*").eq("id", suggestion.engagement_id).maybeSingle();
    if (!eng || !sameValue(eng.stage, suggestion.current_value)) return { ok: false, message: "drift" };
    const patch: Record<string, any> = { stage: proposedValue, last_contact_date: new Date().toISOString().slice(0,10) };
    const { error } = await (supabase as any).from("capital_raise_engagements").update(patch).eq("id", suggestion.engagement_id);
    if (error) return { ok: false, message: error.message };
  } else if (type === "contact_add") {
    const pv: any = proposedValue || {};
    if (!pv.name) return { ok: false, message: "name required" };
    const row: any = { partner_id: suggestion.partner_id, name: pv.name };
    for (const f of ["email","phone","role","linkedin_url","firm_location"]) {
      if (typeof pv[f] === "string" && pv[f].trim()) row[f] = pv[f].trim();
    }
    const { error } = await (supabase as any).from("partner_contacts").insert(row);
    if (error) return { ok: false, message: error.message };
  } else if (type === "contact_update") {
    const pv: any = proposedValue || {};
    if (!pv.contact_id) return { ok: false, message: "contact_id required" };
    const { data: contact } = await (supabase as any).from("partner_contacts").select("*").eq("id", pv.contact_id).maybeSingle();
    if (!contact) return { ok: false, message: "contact not found" };
    const patch: Record<string, any> = {};
    for (const [f, v] of Object.entries(pv.fills || {})) {
      const cur = (contact as any)[f];
      const empty = cur === null || cur === undefined || (typeof cur === "string" && cur.trim() === "");
      if (empty) patch[f] = v;
    }
    for (const [f, obj] of Object.entries(pv.changes || {})) {
      const o = obj as any;
      if (sameValue((contact as any)[f], o.old)) patch[f] = o.new;
    }
    if (Object.keys(patch).length === 0) return { ok: false, message: "drift" };
    const { error } = await (supabase as any).from("partner_contacts").update(patch).eq("id", pv.contact_id);
    if (error) return { ok: false, message: error.message };
  } else if (type === "profile_fact_add") {
    const pv: any = proposedValue || {};
    if (!pv.fact) return { ok: false, message: "fact required" };
    const { error } = await (supabase as any).from("partner_interactions").insert({
      partner_id: suggestion.partner_id,
      content: pv.fact,
      interaction_type: "email_fact",
      interaction_date: pv.fact_date ?? new Date().toISOString().slice(0, 10),
      source: "atlas",
      author: reviewer,
      fact_category: pv.category ?? "other",
      source_message_ids: suggestion.evidence?.message_ids || [],
    });
    if (error) return { ok: false, message: error.message };
  }
  await (supabase as any).from(TABLE).update({ status: "applied", applied_at: new Date().toISOString(), reviewed_by: reviewer, reviewed_at: new Date().toISOString() }).eq("id", suggestion.id);
  return { ok: true };
}

export function useAssignMessagePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, partnerId }: { id: string; partnerId: string | null }) => {
      const { error } = await supabase
        .from("outlook_messages")
        .update({ partner_id: partnerId, analyzed_at: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outlook_messages"] });
      qc.invalidateQueries({ queryKey: ["unattributed_atlas"] });
    },
  });
}

export function useUnattributedAtlasMessages() {
  return useQuery({
    queryKey: ["unattributed_atlas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("outlook_messages")
        .select("id,message_id,subject,preview,from_email,from_name,to_recipients,received_at,web_link")
        .eq("source", "atlas")
        .is("partner_id", null)
        .order("received_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useAtlasAutomation() {
  return useQuery({
    queryKey: ["atlas_automation"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("connectors").select("enabled, config").eq("key", "atlas_automation").maybeSingle();
      if (error) throw error;
      return data as { enabled: boolean; config: any };
    },
  });
}

export function useUpdateAtlasAutomation() {
  const qc = useQueryClient();
  return useMutation({
    // Cadence lives in pg_cron and cannot be changed from the app — only `enabled` is writable.
    mutationFn: async ({ enabled }: { enabled?: boolean }) => {
      const patch: any = {};
      if (enabled !== undefined) patch.enabled = enabled;
      const { error } = await (supabase as any).from("connectors").update(patch).eq("key", "atlas_automation");
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["atlas_automation"] }),
  });
}

export type EvidenceMessage = {
  id: string;
  message_id: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  received_at: string | null;
  body_text: string | null;
  body_html: string | null;
  preview: string | null;
  web_link: string | null;
};

/**
 * Fetch the source emails behind a suggestion. Lazy — only enabled when the
 * reviewer actually expands the evidence panel, so the queue stays cheap to render.
 */
export function useSuggestionEvidence(messageIds: string[] | undefined, enabled: boolean) {
  const ids = (messageIds || []).filter(Boolean);
  return useQuery({
    queryKey: ["suggestion_evidence", ids],
    enabled: enabled && ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("outlook_messages")
        .select("id,message_id,subject,from_name,from_email,received_at,body_text,body_html,preview,web_link")
        .in("message_id", ids)
        .order("received_at", { ascending: true });
      if (error) throw error;
      return (data || []) as EvidenceMessage[];
    },
  });
}
