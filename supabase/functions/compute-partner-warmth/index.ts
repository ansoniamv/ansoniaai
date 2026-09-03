// Compute partner warmth signals from outlook_messages + engagements.
// Upserts partner_warmth_signals and proposes warmth_change when the computed
// level differs from partners.relationship_strength.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WARMTH_VALUES = ["Existing Partner","Very Warm","Warm","Tepid","Cold"] as const;
const INTERNAL_DOMAIN = "@ansoniaproperties.com";

function computeLevel(sig: {
  inbound_90d: number; outbound_90d: number;
  avg_response_hours: number | null;
  meetings_scheduled: number;
  last_inbound_at: string | null;
  deals_engaged: number;
  has_committed_history: boolean;
}): { level: string; rationale: string[] } {
  const rat: string[] = [];
  const now = Date.now();
  const daysSinceInbound = sig.last_inbound_at
    ? Math.floor((now - new Date(sig.last_inbound_at).getTime()) / 86400000) : null;

  if (sig.has_committed_history) {
    rat.push("Prior committed engagement");
    return { level: "Existing Partner", rationale: rat };
  }
  if (sig.inbound_90d >= 3 && sig.outbound_90d >= 3 && (sig.avg_response_hours ?? 999) <= 24 && sig.meetings_scheduled >= 1) {
    rat.push(`Frequent 2-way (${sig.inbound_90d} in / ${sig.outbound_90d} out in 90d)`);
    rat.push(`Fast response (~${Math.round(sig.avg_response_hours ?? 0)}h)`);
    rat.push(`${sig.meetings_scheduled} meeting(s) scheduled`);
    return { level: "Very Warm", rationale: rat };
  }
  if (sig.inbound_90d >= 1 && sig.outbound_90d >= 1) {
    rat.push(`Periodic 2-way (${sig.inbound_90d} in / ${sig.outbound_90d} out in 90d)`);
    if (sig.avg_response_hours != null) rat.push(`Avg response ~${Math.round(sig.avg_response_hours)}h`);
    return { level: "Warm", rationale: rat };
  }
  if (sig.outbound_90d > 0 && sig.inbound_90d === 0 && daysSinceInbound != null && daysSinceInbound >= 60 && daysSinceInbound < 120) {
    rat.push(`One-sided: ${sig.outbound_90d} out, no inbound in ${daysSinceInbound}d`);
    return { level: "Tepid", rationale: rat };
  }
  if (daysSinceInbound == null || daysSinceInbound >= 120) {
    rat.push(daysSinceInbound == null ? "No recorded inbound" : `${daysSinceInbound}d since last inbound`);
    return { level: "Cold", rationale: rat };
  }
  rat.push("Sparse activity");
  return { level: "Tepid", rationale: rat };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const partnerFilter: string | undefined = body.partner_id;

    let pQ = supabase.from("partners").select("id,name,relationship_strength,manual_fields");
    if (partnerFilter) pQ = pQ.eq("id", partnerFilter);
    const { data: partners, error: pErr } = await pQ;
    if (pErr) throw pErr;
    if (!partners) return new Response(JSON.stringify({ ok: true, count: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const sinceIso = new Date(Date.now() - 90 * 86400000).toISOString();
    let updated = 0; let suggestionsCreated = 0;

    for (const p of partners) {
      const [msgRes, engRes, rejRes, pendRes] = await Promise.all([
        supabase.from("outlook_messages")
          .select("from_email,to_recipients,received_at,sent_at")
          .eq("partner_id", p.id)
          .gte("received_at", sinceIso)
          .order("received_at", { ascending: true }),
        supabase.from("capital_raise_engagements")
          .select("deal_id,stage,committed_amount,discussion_scheduled_date")
          .eq("partner_id", p.id),
        supabase.from("partner_suggestions")
          .select("proposed_value")
          .eq("partner_id", p.id).eq("type", "warmth_change").eq("status", "rejected")
          .gte("reviewed_at", new Date(Date.now() - 60 * 86400000).toISOString()),
        supabase.from("partner_suggestions")
          .select("id,proposed_value")
          .eq("partner_id", p.id).eq("type", "warmth_change").eq("status", "pending"),
      ]);
      const messages = msgRes.data || [];
      const engagements = engRes.data || [];

      let inbound90 = 0, outbound90 = 0;
      let lastInbound: string | null = null, lastOutbound: string | null = null;
      const outboundTimes: string[] = [];
      const inboundTimes: string[] = [];
      for (const m of messages) {
        const from = (m as any).from_email as string | null;
        const isInternal = from && from.toLowerCase().endsWith(INTERNAL_DOMAIN);
        const ts = (m as any).received_at || (m as any).sent_at;
        if (!ts) continue;
        if (isInternal) {
          outbound90++; outboundTimes.push(ts);
          if (!lastOutbound || ts > lastOutbound) lastOutbound = ts;
        } else {
          inbound90++; inboundTimes.push(ts);
          if (!lastInbound || ts > lastInbound) lastInbound = ts;
        }
      }
      // Avg response time: our outbound -> next inbound
      let respTotal = 0, respCount = 0;
      for (const out of outboundTimes) {
        const nextIn = inboundTimes.find(t => t > out);
        if (nextIn) {
          const hrs = (new Date(nextIn).getTime() - new Date(out).getTime()) / 3600000;
          if (hrs > 0 && hrs < 24 * 30) { respTotal += hrs; respCount++; }
        }
      }
      const avgResp = respCount > 0 ? respTotal / respCount : null;
      const meetings = engagements.filter((e: any) => e.discussion_scheduled_date).length;
      const dealsEngaged = new Set(engagements.map((e: any) => e.deal_id).filter(Boolean)).size;
      const hasCommitted = engagements.some((e: any) => e.stage === "committed" || (e.committed_amount && e.committed_amount > 0));

      const { level, rationale } = computeLevel({
        inbound_90d: inbound90, outbound_90d: outbound90,
        avg_response_hours: avgResp, meetings_scheduled: meetings,
        last_inbound_at: lastInbound, deals_engaged: dealsEngaged,
        has_committed_history: hasCommitted,
      });

      const signals = {
        inbound_90d: inbound90, outbound_90d: outbound90,
        avg_response_hours: avgResp != null ? Math.round(avgResp * 10) / 10 : null,
        meetings_scheduled: meetings, deals_engaged: dealsEngaged,
        last_inbound_at: lastInbound, last_outbound_at: lastOutbound,
        rationale,
      };

      await supabase.from("partner_warmth_signals").upsert({
        partner_id: p.id,
        last_inbound_at: lastInbound, last_outbound_at: lastOutbound,
        inbound_90d: inbound90, outbound_90d: outbound90,
        avg_response_hours: avgResp,
        meetings_scheduled: meetings, deals_engaged: dealsEngaged,
        computed_level: level, computed_at: new Date().toISOString(),
      }, { onConflict: "partner_id" });
      updated++;

      // Propose only if different + clear margin + not rejected recently + not already pending same value
      const current = (p as any).relationship_strength;
      if (current === level) continue;
      // Skip if user rejected same proposal recently
      const recentlyRejected = (rejRes.data || []).some((r: any) => r.proposed_value === level);
      if (recentlyRejected) continue;

      // Supersede existing pending warmth_change
      const existingPending = (pendRes.data || [])[0];

      const manual: string[] = (p as any).manual_fields || [];
      const locked = manual.includes("relationship_strength");
      // For warmth, use the standard gates. Locked needs near-certainty; signals here map to ~0.75 baseline.
      const confidence = hasCommitted && level === "Existing Partner" ? 0.95
        : level === "Very Warm" ? 0.8
        : level === "Cold" && lastInbound == null ? 0.85
        : 0.7;
      if (locked && confidence < 0.8) continue;
      if (!locked && confidence < 0.6) continue;

      const summary = `Warmth: ${current || "unset"} → ${level}`;
      const rationaleText = rationale.join("; ");
      const { data: inserted } = await supabase.from("partner_suggestions").insert({
        partner_id: p.id, type: "warmth_change", field: "relationship_strength",
        current_value: current, proposed_value: level,
        summary, rationale: rationaleText,
        evidence: null, signals, confidence, status: "pending",
      }).select("id").maybeSingle();
      if (inserted && existingPending) {
        await supabase.from("partner_suggestions")
          .update({ status: "superseded", superseded_by: inserted.id, reviewed_at: new Date().toISOString() })
          .eq("id", existingPending.id);
      }
      if (inserted) suggestionsCreated++;
    }

    return new Response(JSON.stringify({ ok: true, partners: updated, suggestions: suggestionsCreated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
