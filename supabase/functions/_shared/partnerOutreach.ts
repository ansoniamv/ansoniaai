// Partner outreach drafting: the prompt and the reading of its answer, shared
// by draft-partner-outreach and the tests. No Deno or network code here, so
// vitest can import it directly.
//
// One draft per deal, not per partner: the model writes the email once with
// {{contact_first_name}} where the name goes, and the Draft Outreach dialog
// fills that in for each recipient. 44 partners cost one call, and every
// partner gets the same reviewed numbers.

/** The token the dialog replaces with each recipient's first name. */
export const FIRST_NAME_TOKEN = "{{contact_first_name}}";

/**
 * Deal fields the email may quote. Ratios are passed as stored, with their
 * column names; the prompt tells the model how to read them.
 */
export const OUTREACH_DEAL_FIELDS = [
  "property_name", "address", "city", "state", "zip", "msa",
  "unit_count", "vintage_year", "total_sqft", "number_stories", "floor_plans",
  "asking_price", "price_per_sqft", "marketed", "cfo_date", "cfo_note",
  "in_place_cap_rate", "stabilized_cap_rate", "projected_irr", "equity_multiple", "year1_coc",
  "hold_period_years", "target_raise", "estimated_equity",
  "renovation_budget_per_unit", "total_capex", "value_add_potential", "value_add_upside",
  "in_place_avg_rent", "occupancy_pct",
  "school_rating", "area_median_income", "area_median_income_1mi", "median_income_tract",
  "nearest_employment_node_min", "building_amenities", "unit_amenities",
  "ai_score_summary", "notes",
] as const;

const LONG_FIELDS: Record<string, number> = { notes: 2500, ai_score_summary: 2000, floor_plans: 1500 };

export function dealFactsBlock(deal: Record<string, unknown>): string {
  return OUTREACH_DEAL_FIELDS
    .filter((k) => deal[k] != null && String(deal[k]).trim() !== "" && !(Array.isArray(deal[k]) && !(deal[k] as unknown[]).length))
    .map((k) => {
      const v = deal[k];
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}: ${s.slice(0, LONG_FIELDS[k] ?? 600)}`;
    })
    .join("\n");
}

export type OutreachTemplate = { title: string; text: string };

export function buildOutreachPrompt(input: {
  templates: OutreachTemplate[];
  dealFacts: string;
  omSummaries: string[];
  companyBrief: string;
  notes?: string;
}): string {
  const templates = input.templates
    .map((t) => `--- ${t.title} ---\n${t.text.slice(0, 20_000)}`)
    .join("\n\n");
  const om = input.omSummaries.length
    ? `\nFROM THE DEAL'S OFFERING MEMORANDUM (parsed):\n${input.omSummaries.join("\n\n").slice(0, 8000)}\n`
    : "";
  const brief = input.companyBrief.trim()
    ? `\nABOUT ANSONIA (the firm's own brief; use it for "what we own nearby" and track record only):\n${input.companyBrief.slice(0, 6000)}\n`
    : "";
  const notes = input.notes?.trim()
    ? `\nNOTES FROM THE PERSON SENDING THIS (take these as true and use them):\n${input.notes.trim().slice(0, 2000)}\n`
    : "";

  return `You write the first email Ansonia Properties sends its capital (JV equity) partners about a new multifamily deal. The same email goes to every partner on the raise; a person reviews it before anything is sent.

Follow the TEMPLATE for structure, subject line, tone, bullet format and signature. The examples in it are other deals: never reuse their names, places or numbers.

Rules:
- Every fact, number, name and date comes from DEAL DATA, the OM, the notes, or the Ansonia brief. Never invent or estimate one.
- When the template calls for something we do not have (a CFO date, HH incomes, a nearby Ansonia property, an IRR), either leave that line out, or, when the email would read wrong without it, write a placeholder in double square brackets saying what goes there, e.g. [[CFO date]] or [[1/3/5-mile avg. HH income]]. Never put a guess inside a placeholder.
- Greeting: "Hey ${FIRST_NAME_TOKEN} –" exactly, with that token; it is filled per recipient.
- Reading the data: ratios such as projected_irr, cap rates, year1_coc and occupancy_pct may be stored as a fraction (0.19) or a percent (19); write them as percents. Round the way the template does (19%+, 2.0x+, ~$17M, mid $40M). marketed = false means off-market. cfo_date is the call for offers.
- Plain text, no markdown other than the template's "*" or "-" bullets.

Also list, in "check", each thing the reviewer should confirm before sending: every placeholder you left, any figure you rounded or derived, and anything in the data that looked inconsistent. Short phrases.

TEMPLATE:
${templates}

DEAL DATA:
${input.dealFacts || "(none)"}
${om}${brief}${notes}`;
}

export const OUTREACH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    check: { type: "array", items: { type: "string" } },
  },
  required: ["subject", "body", "check"],
};

export type OutreachDraft = { subject: string; body: string; check: string[] };

/**
 * The model's answer, tidied: the template writes the greeting as
 * "{first name}", and a model copying it would leave that in the email, so any
 * such spelling becomes the token the dialog fills.
 */
export function normalizeOutreachDraft(raw: any): OutreachDraft {
  const subject = String(raw?.subject ?? "").trim().replace(/^subject:\s*/i, "");
  const body = String(raw?.body ?? "")
    .replace(/\{{1,2}\s*first[ _]?name\s*\}{1,2}|\[{1,2}\s*first[ _]?name\s*\]{1,2}/gi, FIRST_NAME_TOKEN)
    .replace(/\r\n/g, "\n")
    .trim();
  if (!subject || !body) throw new Error("The draft came back empty.");
  const check = Array.isArray(raw?.check)
    ? raw.check.map((c: unknown) => String(c ?? "").trim()).filter(Boolean).slice(0, 20)
    : [];
  return { subject, body, check };
}
