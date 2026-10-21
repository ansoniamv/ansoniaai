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

/** The deal documents the email's financials come from, newest first per type. */
export const OUTREACH_DOC_TYPES = ["om", "rent_roll", "t12"] as const;
const DOC_LABEL: Record<string, string> = { om: "OFFERING MEMORANDUM", rent_roll: "RENT ROLL", t12: "T12" };

export type OutreachDocument = {
  doc_type: string | null;
  file_name: string;
  doc_as_of: string | null;
  /** extraction->figures: the headline figures as the document states them. */
  figures: Record<string, { value: number | null; evidence?: string | null }> | null;
  /** deal_documents.summary: the computed read (see summarizeDetail). */
  summary: { rent_roll?: any; t12?: any; om?: any } | null;
};

/**
 * One parsed document as prompt text: the stated figures, then the part of the
 * computed summary that matches its type. Lease expirations by month and the
 * T12's line names are left out: no outreach email quotes them, and the T12
 * category totals and unit mix are what it does quote.
 */
export function documentFactsBlock(doc: OutreachDocument): string {
  const lines: string[] = [];
  for (const [k, f] of Object.entries(doc.figures ?? {})) {
    if (f?.value == null) continue;
    lines.push(`${k}: ${f.value}${f.evidence ? ` ("${String(f.evidence).slice(0, 120)}")` : ""}`);
  }
  const s = doc.summary ?? {};
  if (doc.doc_type === "om" && s.om) {
    for (const f of s.om.facts ?? []) lines.push(`${f.label}: ${f.value}`);
    for (const m of s.om.metrics ?? []) lines.push(`${m.label}: ${m.value}${m.basis ? ` (${m.basis})` : ""}`);
    if (s.om.amenities?.length) lines.push(`Amenities: ${s.om.amenities.join(", ")}`);
  }
  if (doc.doc_type === "rent_roll" && s.rent_roll) {
    const { expirations: _e, other_income_monthly: _o, ...rr } = s.rent_roll;
    lines.push(`Rent roll summary: ${JSON.stringify(rr)}`);
  }
  if (doc.doc_type === "t12" && s.t12) {
    const t = s.t12;
    lines.push(
      `T12 period: ${t.period ?? "?"}; total income ${t.total_income}; total expenses ${t.total_expenses}; NOI ${t.noi}; ` +
        `T3 annualized income ${t.t3_total_income}, expenses ${t.t3_total_expenses}, NOI ${t.t3_noi}`,
    );
    for (const c of t.categories ?? []) lines.push(`${c.category}: ${c.annual} (T3 annualized ${c.t3_annualized})`);
  }
  if (!lines.length) return "";
  const head = `${DOC_LABEL[doc.doc_type ?? ""] ?? "DOCUMENT"} — ${doc.file_name}${doc.doc_as_of ? `, as of ${doc.doc_as_of}` : ""}`;
  return `${head}\n${lines.join("\n")}`.slice(0, 8000);
}

export type OutreachTemplate = { title: string; text: string };

export function buildOutreachPrompt(input: {
  templates: OutreachTemplate[];
  dealFacts: string;
  documents: string[];
  companyBrief: string;
  notes?: string;
}): string {
  const templates = input.templates
    .map((t) => `--- ${t.title} ---\n${t.text.slice(0, 20_000)}`)
    .join("\n\n");
  const docs = input.documents.length
    ? `\nTHE DEAL'S UPLOADED DOCUMENTS (parsed OM, rent roll, T12):\n${input.documents.join("\n\n")}\n`
    : "\nTHE DEAL'S UPLOADED DOCUMENTS: none parsed yet.\n";
  const brief = input.companyBrief.trim()
    ? `\nABOUT ANSONIA (the firm's own brief; use it for "what we own nearby" and track record only):\n${input.companyBrief.slice(0, 6000)}\n`
    : "";
  const notes = input.notes?.trim()
    ? `\nNOTES FROM THE PERSON SENDING THIS (take these as true and use them):\n${input.notes.trim().slice(0, 2000)}\n`
    : "";

  return `You write the first email Ansonia Properties sends its capital (JV equity) partners about a new multifamily deal. The same email goes to every partner on the raise; a person reviews it before anything is sent.

Follow the TEMPLATE for structure, subject line, tone, bullet format and signature. Its blanks, written ___ or [label], are what you fill for this deal. The examples in it are other deals with their figures blanked: copy their style, never their names or places. Pick the example closest to this deal's situation (marketed with an OM in hand, or off-market and still underwriting) and follow that one's shape and length rather than blending them.

Rules:
- Every fact, number, name and date comes from the UPLOADED DOCUMENTS, DEAL DATA, the notes, or the Ansonia brief. Never invent or estimate one.
- The financials (price, $/unit, going-in cap, NOI, occupancy, in-place vs. market rents, loss-to-lease, unit mix and sizes) come from the documents first: the OM for price, returns and the story; the rent roll for occupancy, rents, loss-to-lease and unit mix; the T12 for income, expenses and NOI. DEAL DATA fills what the documents lack. When two sources disagree, use the document and add the disagreement to "check".
- You may derive a figure by plain arithmetic from stated ones (price / units = $/unit; T12 NOI / price = going-in cap), and must name each derived figure in "check". Do not compute returns (IRR, equity multiple, yield-on-cost, cash yield): use them only when a source states them.
- When the template calls for something we do not have (a CFO date, HH incomes, a nearby Ansonia property, an IRR), either leave that line out, or, when the email would read wrong without it, write a placeholder in double square brackets saying what goes there, e.g. [[CFO date]] or [[1/3/5-mile avg. HH income]]. Never put a guess inside a placeholder.
- Greeting: "Hey ${FIRST_NAME_TOKEN} –" exactly, with that token; it is filled per recipient.
- Reading the data: ratios such as projected_irr, cap rates, year1_coc and occupancy_pct may be stored as a fraction (0.19) or a percent (19); write them as percents. Round the way the template does (19%+, 2.0x+, ~$17M, mid $40M). marketed = false means off-market. cfo_date is the call for offers.
- Plain text, no markdown other than the template's "*" or "-" bullets.

Also list, in "check", each thing the reviewer should confirm before sending: every placeholder you left, any figure you rounded or derived, and anything in the data that looked inconsistent. Short phrases.

TEMPLATE:
${templates}

${docs}
DEAL DATA (the platform's record of the deal):
${input.dealFacts || "(none)"}
${brief}${notes}`;
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
