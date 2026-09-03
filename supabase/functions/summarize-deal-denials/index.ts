import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

async function callLLM(prompt: string, maxTokens = 800): Promise<string> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gateway ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { deal_id } = await req.json();
    if (!deal_id) throw new Error("deal_id required");

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: deal, error: dErr } = await sb
      .from("deals")
      .select("id, property_name, city, state, msa, unit_count")
      .eq("id", deal_id)
      .single();
    if (dErr) throw dErr;

    const { data: passed, error: eErr } = await sb
      .from("capital_raise_engagements")
      .select("id, pass_feedback, pass_price_surmountable, partners(name)")
      .eq("deal_id", deal_id)
      .eq("passed", true);
    if (eErr) throw eErr;

    const passedRows = passed ?? [];
    if (passedRows.length === 0) {
      const now = new Date().toISOString();
      await sb
        .from("deals")
        .update({
          denial_overview: null,
          denial_overview_at: now,
          denial_themes: null,
          denial_themes_at: now,
        })
        .eq("id", deal_id);
      return new Response(JSON.stringify({ overview: null, themes: [], count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const priceSurmountable = passedRows.filter((r: any) => r.pass_price_surmountable).length;

    // Give each passed row a stable index so we can map the model's tagged output back to real engagements.
    const indexedRows = passedRows.map((r: any, i: number) => ({
      idx: i + 1,
      engagement_id: r.id,
      partner_name: r.partners?.name ?? "Unknown partner",
      feedback: (r.pass_feedback ?? "").trim(),
      price_surmountable: !!r.pass_price_surmountable,
    }));

    const lines = indexedRows
      .map((r) => `${r.idx}. ${r.partner_name}${r.price_surmountable ? " [price surmountable]" : ""}: ${r.feedback || "(no feedback)"}`)
      .join("\n");

    const overviewPrompt = `You are analyzing why capital partners passed on a real-estate deal.

Deal: ${deal.property_name}
Market: ${[deal.city, deal.state].filter(Boolean).join(", ")}${deal.msa ? ` (${deal.msa} MSA)` : ""}
Units: ${deal.unit_count ?? "unknown"}

Passed partners (${passedRows.length}, ${priceSurmountable} flagged pricing as surmountable):
${lines}

Write a 4-6 sentence institutional-style summary of the COMMON THEMES for why they passed. Categorize by: size, market, strategy, price, timing, relationship. Lead with the most frequent theme. Explicitly note how many flagged price as surmountable (${priceSurmountable} of ${passedRows.length}). Be specific — reference concrete objections. Do not invent. Plain prose, no bullets, no headings.`;

    const themesPrompt = `You are categorizing why capital partners passed on a real-estate deal into a fixed taxonomy.

Passed partners (numbered):
${lines}

Taxonomy (use these exact labels):
- "Market / Geography" — market, submarket, or region concerns
- "Deal size" — check size too large or too small
- "Return profile" — IRR, yield, cash-on-cash, or risk/return mismatch
- "Strategy fit" — value-add / core-plus / workforce / affordable mismatch
- "Asset class" — product type (multifamily class, SFR, mixed-use, etc.)
- "Timing / Pipeline" — timing, capacity, or already committed elsewhere
- "Price / Basis" — price too high, basis, cap rate, or pricing surmountable
- "Relationship / Process" — sponsor familiarity, process, or diligence issues
- "Other" — only when none of the above clearly apply

For EACH numbered partner, output one JSON object with:
  { "idx": <number>, "theme": <one of the exact labels above>, "reason": "<<=15 word paraphrase of their objection>" }

Return ONLY a JSON array (no prose, no code fences). If feedback is empty/unclear, use theme "Other" and reason "No reason given".`;

    const [overview, themesRaw] = await Promise.all([
      callLLM(overviewPrompt, 900),
      callLLM(themesPrompt, Math.min(8000, 600 + indexedRows.length * 120)),
    ]);

    // Parse themes
    console.log("themesRaw head:", themesRaw.slice(0, 200), "len:", themesRaw.length);
    let assignments: Array<{ idx: number; theme: string; reason: string }> = [];
    try {
      const jsonMatch = themesRaw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          assignments = parsed
            .map((p: any) => ({
              idx: Number(p?.idx),
              theme: typeof p?.theme === "string" ? p.theme : "Other",
              reason: typeof p?.reason === "string" ? p.reason : "",
            }))
            .filter((p) => Number.isFinite(p.idx));
        }
      }
    } catch (_e) {
      assignments = [];
    }

    // Deterministic fallback so themes never collapse into a single "Other" bucket.
    const keywordTheme = (text: string): string => {
      const t = text.toLowerCase();
      if (!t.trim()) return "Other";
      if (/\bcheck size|too (large|small|big)|equity check|\$\d+\s*[–-]\s*\$?\d*\s*m|deal size/.test(t)) return "Deal size";
      if (/market|geograph|submarket|region|state|madison|midwest|msa/.test(t)) return "Market / Geography";
      if (/cap rate|price|pricing|basis|too expensive|yield|irr|return|thin/.test(t)) return "Price / Basis";
      if (/value-add|core|affordab|workforce|strategy|mandate|focus|industrial|retail|thesis/.test(t)) return "Strategy fit";
      if (/timing|bandwidth|capacity|out of equity|deployed|fund|committed elsewhere|raise|wait/.test(t)) return "Timing / Pipeline";
      if (/sponsor|relationship|process|diligence|familiar/.test(t)) return "Relationship / Process";
      if (/class a|class b|sfr|mixed-use|product type|asset class/.test(t)) return "Asset class";
      return "Other";
    };


    // Group into themes with per-partner items
    const themeMap = new Map<string, Array<{ engagement_id: string; partner_name: string; reason: string; feedback: string; price_surmountable: boolean }>>();
    for (const row of indexedRows) {
      const a = assignments.find((x) => x.idx === row.idx);
      const aiTheme = a?.theme?.trim();
      const theme = aiTheme && aiTheme !== "Other" ? aiTheme : keywordTheme(row.feedback);
      const reason = a?.reason?.trim() || (row.feedback ? row.feedback.slice(0, 140) : "No reason given");
      if (!themeMap.has(theme)) themeMap.set(theme, []);
      themeMap.get(theme)!.push({
        engagement_id: row.engagement_id,
        partner_name: row.partner_name,
        reason,
        feedback: row.feedback,
        price_surmountable: row.price_surmountable,
      });
    }
    const themes = Array.from(themeMap.entries())
      .map(([theme, items]) => ({ theme, count: items.length, items }))
      .sort((a, b) => b.count - a.count);

    const now = new Date().toISOString();
    const { error: uErr } = await sb
      .from("deals")
      .update({
        denial_overview: overview,
        denial_overview_at: now,
        denial_themes: themes,
        denial_themes_at: now,
      })
      .eq("id", deal_id);
    if (uErr) throw uErr;

    return new Response(
      JSON.stringify({
        overview,
        themes,
        count: passedRows.length,
        price_surmountable_count: priceSurmountable,
        denial_overview_at: now,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
