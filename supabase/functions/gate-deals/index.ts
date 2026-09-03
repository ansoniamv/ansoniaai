// Stage 1 qualification gate for inbox_deals.
// Rule-based first, with optional Claude classification for genuinely ambiguous emails.
// Sets gate_status in {passed, review, filtered} + gate_reason.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/logUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Ansonia target geography
const ALLOWED_STATES = new Set([
  "TX","NC","SC","GA","FL","TN","AZ","NV","CO","UT",
  "OH","IN","IL","WI","MO","KY","KS","OK","AL",
]);
const TARGET_MSAS = [
  "chicago","columbus","indianapolis","madison","austin",
  "dallas","fort worth","dallas-fort worth","dfw","denver","salt lake",
];
// Clearly out-of-region states (hard-exclude unless asset type ambiguous)
const EXCLUDED_STATES = new Set([
  "CA","NY","NJ","MA","WA","OR","CT","RI","VT","NH","ME","PA","MD","DE","DC","HI","AK","MN","ND","SD","MT","ID","WY","NE","IA","AR","LA","MS","VA","WV","MI","NM",
]);
// Of these, the truly forbidden Northeast/West-coast set per spec
const HARD_EXCLUDE_STATES = new Set(["CA","NY","NJ","MA","WA","OR","CT","RI","VT","NH","ME"]);

const NON_MF_KEYWORDS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(office\s+building|office\s+tower|class[\s-]?[abc]\s+office)\b/i, label: "office" },
  { re: /\b(retail\s+(center|strip|pad)|shopping\s+center|strip\s+mall|power\s+center)\b/i, label: "retail" },
  { re: /\b(industrial|warehouse|distribution\s+center|logistics\s+(center|park)|flex\s+space)\b/i, label: "industrial" },
  { re: /\b(hotel|hospitality|motel|resort|hospitality\s+asset)\b/i, label: "hotel" },
  { re: /\b(self[\s-]?storage|storage\s+facility)\b/i, label: "self-storage" },
  { re: /\b(net\s*lease|nnn|single[\s-]?tenant|stnl)\b/i, label: "net-lease" },
  { re: /\b(land\s+(only|opportunity|parcel|site)|raw\s+land|development\s+site\s+only)\b/i, label: "land" },
  { re: /\b(medical\s+office|mob|life\s+science)\b/i, label: "medical office" },
];
const MF_KEYWORDS = /\b(multifamily|multi[\s-]?family|apartment|apartments|garden[\s-]?style|mid[\s-]?rise|high[\s-]?rise|units|unit\s+count|class\s+[abc]\s+(apt|apartment|multifamily))\b/i;
const MIXED_USE = /\bmixed[\s-]?use\b/i;
const SOFT_GEO = /\b(sunbelt|southeast(?:ern)?|midwest(?:ern)?|portfolio|various\s+markets|multiple\s+markets|nationwide)\b/i;

type Deal = {
  id: string;
  property_name: string | null;
  location_city: string | null;
  location_state: string | null;
  msa: string | null;
  asset_class: string | null;
  units: number | null;
  email_subject: string | null;
  email_body: string | null;
  gate_status?: string | null;
  gate_content_hash?: string | null;
  email_thread_summary: string | null;
};

function normalizeState(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : null;
}

function msaInTarget(msa: string | null | undefined): boolean {
  if (!msa) return false;
  const m = msa.toLowerCase();
  return TARGET_MSAS.some((k) => m.includes(k));
}

function combinedText(d: Deal): string {
  return [d.email_subject, d.property_name, d.asset_class, d.email_thread_summary, d.email_body]
    .filter(Boolean).join(" \n ").slice(0, 4000);
}

// Narrow scan for non-MF keywords — title/property/asset_class only. Email
// bodies and thread summaries often mention warehouse / NNN / land / flex in
// unrelated footers or comparable references, which incorrectly filters real
// multifamily deals out of the pipeline.
function headerText(d: Deal): string {
  return [d.email_subject, d.property_name, d.asset_class].filter(Boolean).join(" \n ");
}

type Verdict = { status: "passed" | "review" | "filtered"; reason: string | null; needs_ai?: boolean };

function ruleVerdict(d: Deal): Verdict {
  const text = combinedText(d);
  const header = headerText(d);
  const ac = (d.asset_class ?? "").toLowerCase();

  // 1. Hard asset-type exclusion. Only scan title/property/asset_class —
  // scanning the full email body falsely filters real MF deals whose footers
  // or comparable references mention warehouse/NNN/land/flex.
  for (const k of NON_MF_KEYWORDS) {
    if (k.re.test(ac) || k.re.test(header)) {
      // If multifamily also strongly indicated, treat as ambiguous mixed-use
      if (MF_KEYWORDS.test(ac) || MF_KEYWORDS.test(header) || MIXED_USE.test(header)) {
        return { status: "review", reason: `Ambiguous asset type (mentions ${k.label} + multifamily)`, needs_ai: true };
      }
      return { status: "filtered", reason: `Filtered: ${k.label} asset` };
    }
  }

  // 2. Geography
  const state = normalizeState(d.location_state);
  const inMsa = msaInTarget(d.msa);
  const looksAmbiguousType = !MF_KEYWORDS.test(ac) && !MF_KEYWORDS.test(header);

  if (state) {
    if (ALLOWED_STATES.has(state) || inMsa) {
      // passes geo
    } else if (HARD_EXCLUDE_STATES.has(state)) {
      if (looksAmbiguousType) {
        return { status: "review", reason: `Out-of-region state (${state}) + asset type unclear`, needs_ai: true };
      }
      return { status: "filtered", reason: `Filtered: located in ${state}` };
    } else if (EXCLUDED_STATES.has(state)) {
      // Borderline / non-core state — surface for human review rather than
      // silently archiving. Only the HARD_EXCLUDE_STATES set is auto-filtered.
      return { status: "review", reason: `Borderline state (${state}) — outside core region, confirm fit` };
    } else {
      return { status: "review", reason: `Unrecognized state code (${state})` };
    }
  } else {
    // No state. Soft flag — possibly need AI to parse out a state from the email text.
    if (SOFT_GEO.test(text)) {
      return { status: "review", reason: "Geography unspecified (multi-market or regional)", needs_ai: false };
    }
    return { status: "review", reason: "Geography unclear / unspecified", needs_ai: true };
  }

  // 3. Asset type still ambiguous if no MF signal anywhere
  if (looksAmbiguousType) {
    if (MIXED_USE.test(text)) return { status: "review", reason: "Mixed-use — needs manual confirmation", needs_ai: false };
    return { status: "review", reason: "Asset type unclear", needs_ai: true };
  }

  // 4. Soft flag: tiny deals
  if (d.units != null && d.units > 0 && d.units < 50) {
    return { status: "review", reason: `Under 50 units (${d.units})` };
  }

  return { status: "passed", reason: null };
}

async function classifyWithClaude(
  d: Deal,
  learnedStrategy: string,
  examples: Array<{ category: string | null; reason: string | null; deal: any }>,
  ctx?: { supabase: any },
): Promise<{
  asset_type: string | null;
  state: string | null;
  is_multifamily: "true" | "false" | "unknown";
  in_target_region: "true" | "false" | "unknown";
} | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const strategyBlock = learnedStrategy
    ? `\n\nLEARNED ANSONIA PASS PATTERNS (informational — mirror these when classifying):\n${learnedStrategy.slice(0, 4000)}`
    : "";
  const examplesBlock = examples.length
    ? `\n\nRECENT ANSONIA DENIALS (few-shot context):\n${examples
        .slice(0, 5)
        .map((e, i) => `${i + 1}. [${e.category ?? "uncategorized"}] ${e.reason ?? ""}\n   deal: ${JSON.stringify(e.deal)}`)
        .join("\n")}`
    : "";
  const prompt =
    `Based on this broker email, return STRICT JSON only — no prose:\n` +
    `{ "asset_type": string|null, "state": string|null (2-letter US), ` +
    `"is_multifamily": "true"|"false"|"unknown", "in_target_region": "true"|"false"|"unknown" }\n` +
    `Target region = US Sunbelt + Midwest (TX,NC,SC,GA,FL,TN,AZ,NV,CO,UT,OH,IN,IL,WI,MO,KY,KS,OK,AL).${strategyBlock}${examplesBlock}\n\n` +
    `SUBJECT: ${d.email_subject ?? ""}\nPROPERTY: ${d.property_name ?? ""}\n` +
    `LOCATION HINT: ${[d.location_city, d.location_state, d.msa].filter(Boolean).join(", ")}\n` +
    `ASSET CLASS HINT: ${d.asset_class ?? ""}\n\nBODY:\n${(d.email_thread_summary ?? d.email_body ?? "").slice(0, 3000)}`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) { console.error("claude gate err", resp.status, await resp.text()); return null; }
    const j = await resp.json();
    if (ctx?.supabase) await logAiUsage(ctx.supabase, { function_name: "gate-deals", model: "claude-sonnet-4-5", provider: "anthropic", usage: j?.usage, deal_id: d.id });
    const txt = j?.content?.[0]?.text ?? "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch (e) { console.error("claude gate failed", e); return null; }
}

function aiVerdict(c: NonNullable<Awaited<ReturnType<typeof classifyWithClaude>>>): Verdict {
  if (c.is_multifamily === "false") {
    return { status: "filtered", reason: `Filtered: ${c.asset_type ?? "non-multifamily"} asset (AI)` };
  }
  const st = normalizeState(c.state);
  if (st && HARD_EXCLUDE_STATES.has(st) && c.is_multifamily !== "unknown") {
    return { status: "filtered", reason: `Filtered: located in ${st}` };
  }
  if (st && EXCLUDED_STATES.has(st) && !ALLOWED_STATES.has(st)) {
    return { status: "filtered", reason: `Filtered: located in ${st} (outside target region)` };
  }
  if (st && (ALLOWED_STATES.has(st) || msaInTarget(c.asset_type)) && c.is_multifamily === "true") {
    return { status: "passed", reason: null };
  }
  if (c.in_target_region === "false") {
    return { status: "filtered", reason: "Filtered: outside target region (AI)" };
  }
  // Still unsure — leave for human review
  return { status: "review", reason: "Needs geo/type confirmation" };
}

/** Fingerprint of every field the gate verdict reads. */
async function contentHash(d: Deal): Promise<string> {
  const src = [
    d.property_name, d.location_city, d.location_state, d.msa,
    d.asset_class, d.units, d.email_subject, d.email_thread_summary, d.email_body,
  ].map((v) => (v ?? "")).join("\u0000");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    let body: { deal_ids?: string[]; limit?: number; force?: boolean } = {};
    try { body = await req.json(); } catch { /* ignore */ }

    let q = supabase
      .from("inbox_deals")
      .select("id, property_name, location_city, location_state, msa, asset_class, units, email_subject, email_body, email_thread_summary, gate_status, gate_content_hash")
      .order("email_received_at", { ascending: false })
      .limit(body.limit ?? 500);
    if (Array.isArray(body.deal_ids) && body.deal_ids.length) q = q.in("id", body.deal_ids);
    else if (!body.force) q = q.eq("gate_status", "pending");

    const { data: deals, error } = await q;
    if (error) throw error;

    // Pull learned strategy + recent denial examples once per invocation
    const [{ data: ls }, { data: fb }] = await Promise.all([
      supabase.from("learned_strategy").select("content").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("deal_feedback").select("category, reason_text, deal_snapshot").eq("action", "deny").order("created_at", { ascending: false }).limit(5),
    ]);
    const learnedStrategy: string = ls?.content ?? "";
    const examples = (fb ?? []).map((f: any) => ({ category: f.category, reason: f.reason_text, deal: f.deal_snapshot }));

    let passed = 0, review = 0, filtered = 0, skipped = 0;
    const passedIds: string[] = [];

    for (const raw of deals ?? []) {
      const d = raw as unknown as Deal;

      // Content-change-driven gating: fingerprint the inputs the verdict depends on.
      // Unchanged + already-gated deals are skipped (no AI call, no write), but a deal
      // whose data arrives late gets a new hash and is gated on the next pass.
      const hash = await contentHash(d);
      if (!body.force && d.gate_status !== "pending" && d.gate_content_hash === hash) {
        skipped++;
        continue;
      }
      let v = ruleVerdict(d);
      if (v.needs_ai) {
        const cls = await classifyWithClaude(d, learnedStrategy, examples, { supabase });
        if (cls) v = aiVerdict(cls);
      }
      await supabase.from("inbox_deals").update({
        gate_status: v.status,
        gate_reason: v.reason,
        gate_checked_at: new Date().toISOString(),
        gate_content_hash: hash,
      }).eq("id", d.id);
      if (v.status === "passed") { passed++; passedIds.push(d.id); }
      else if (v.status === "review") { review++; passedIds.push(d.id); }
      else filtered++;
    }

    // Kick off scoring for deals that survived the gate (passed + review)
    if (passedIds.length) {
      supabase.functions.invoke("score-deals", { body: { deal_ids: passedIds } })
        .catch((e) => console.error("score-deals invoke failed", e));
    }

    return new Response(JSON.stringify({ ok: true, gated: (deals?.length ?? 0) - skipped, skipped, passed, review, filtered }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
