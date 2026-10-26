/**
 * Deal documents (OM, rent roll, T12): what the parser asks for, and the guards
 * between the model's answer and a proposal a person reviews.
 *
 * Lives in _shared, free of Deno APIs, so src/test can unit test it the same
 * way it tests dealFields.
 *
 * The model reads the document and reports figures in the document's own terms
 * (annual dollars, a percentage, a unit count). Everything that converts those
 * into the deals table's conventions happens here, in code:
 *   asking_price  — deals stores MILLIONS ("Asking Price ($M)" on the form)
 *   occupancy_pct — 0-100
 *   expense_ratio — 0-100, opex / effective gross income
 * Asking a model to emit "millions" is how a $31M deal becomes $31,000,000M.
 */

import { normalizeDetail, type DocumentDetail } from "./dealDocumentDetail.ts";

export const DOC_TYPES = ["om", "rent_roll", "t12", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * Columns on public.deals a document may propose. Must match the `allowed`
 * list in apply_deal_document_proposals() — that function interpolates the
 * name into an UPDATE, so its list is the one that actually guards the write.
 */
export const DEAL_DOCUMENT_FIELDS = [
  "unit_count",
  "vintage_year",
  "total_sqft",
  "occupancy_pct",
  "in_place_avg_rent",
  "gross_scheduled_rent",
  "t12_noi",
  "t12_opex",
  "expense_ratio",
  "asking_price",
] as const;
export type DealDocumentField = (typeof DEAL_DOCUMENT_FIELDS)[number];

/**
 * How far each document type is trusted for each field. Higher wins when two
 * documents disagree. 0 means "never propose from this document type": a rent
 * roll has no NOI, and an OM's "occupancy" is a marketing figure the rent roll
 * should overrule.
 */
const RANK: Record<DealDocumentField, Record<DocType, number>> = {
  unit_count:           { rent_roll: 3, om: 2, t12: 0, other: 1 },
  vintage_year:         { om: 3, rent_roll: 0, t12: 0, other: 1 },
  total_sqft:           { rent_roll: 3, om: 2, t12: 0, other: 1 },
  occupancy_pct:        { rent_roll: 3, om: 2, t12: 0, other: 1 },
  in_place_avg_rent:    { rent_roll: 3, om: 2, t12: 0, other: 1 },
  gross_scheduled_rent: { t12: 3, om: 2, rent_roll: 0, other: 1 },
  t12_noi:              { t12: 3, om: 2, rent_roll: 0, other: 1 },
  t12_opex:             { t12: 3, om: 2, rent_roll: 0, other: 1 },
  expense_ratio:        { t12: 3, om: 2, rent_roll: 0, other: 1 },
  asking_price:         { om: 3, rent_roll: 0, t12: 0, other: 1 },
};

export function rankFor(field: DealDocumentField, docType: DocType): number {
  return RANK[field][docType] ?? 0;
}

/** Figures the model is asked to find, named for what the DOCUMENT says. */
export const EXTRACTED_FIGURES = [
  "unit_count",
  "year_built",
  "net_rentable_sqft",
  "occupied_units",
  "occupancy_pct",
  "avg_in_place_rent_monthly",
  "gross_potential_rent_annual",
  "effective_gross_income_annual",
  "total_operating_expenses_annual",
  "noi_annual",
  "asking_price_usd",
] as const;
export type ExtractedFigure = (typeof EXTRACTED_FIGURES)[number];

export type FigureReading = {
  value: number | null;
  evidence: string | null;
  /** Copied from the document, per the model. Checked against the text before it is shown as a quote. */
  quote?: string | null;
  location?: string | null;
};

export type DocumentExtraction = {
  doc_type: DocType;
  property_name: string | null;
  /** The property's street address as the document writes it; null when not stated. */
  property_address: string | null;
  as_of: string | null;
  figures: Record<ExtractedFigure, FigureReading>;
  notes: string;
  /** The full transcription; see dealDocumentDetail.ts. */
  detail: DocumentDetail;
};

/**
 * "Not stated" is an explicit `found: false`, not a null. The API refuses a
 * schema with more than 16 union-typed parameters ("exponential compilation
 * cost"), and a nullable value + nullable quote per figure came to 24 — every
 * call 400'd. With no unions at all, adding figures can never hit that limit.
 */
const figureSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    found: { type: "boolean" },
    value: { type: "number" },
    evidence: { type: "string" },
    quote: { type: "string" },
    location: { type: "string" },
  },
  required: ["found", "value", "evidence", "quote", "location"],
};

/** Structured-output schema. No unions and no nullable enums (see 5f7f1fb). */
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    doc_type: { type: "string", enum: [...DOC_TYPES] },
    property_name: { type: "string" },
    property_address: { type: "string" },
    as_of: { type: "string" },
    figures: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(EXTRACTED_FIGURES.map((f) => [f, figureSchema])),
      required: [...EXTRACTED_FIGURES],
    },
    notes: { type: "string" },
  },
  required: ["doc_type", "property_name", "property_address", "as_of", "figures", "notes"],
};

/** What the model returns under EXTRACTION_SCHEMA. */
type RawExtraction = {
  doc_type?: string;
  property_name?: string;
  property_address?: string;
  as_of?: string;
  figures?: Partial<
    Record<ExtractedFigure, { found?: boolean; value?: number; evidence?: string; quote?: string; location?: string }>
  >;
  notes?: string;
  detail?: unknown;
};

/**
 * Model output -> DocumentExtraction. `found: false` becomes null whatever
 * `value` says (the schema forces a number there, so a not-found figure still
 * carries one — usually 0, which must never be read as a real zero).
 */
export function normalizeExtraction(raw: RawExtraction): DocumentExtraction {
  const text = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : null);
  const figures = Object.fromEntries(
    EXTRACTED_FIGURES.map((f) => {
      const r = raw.figures?.[f];
      const found = r?.found === true && isNum(r.value);
      return [f, {
        value: found ? r!.value! : null,
        evidence: found ? text(r!.evidence) : null,
        quote: found ? text(r!.quote) : null,
        location: found ? text(r!.location) : null,
      }];
    }),
  ) as Record<ExtractedFigure, FigureReading>;
  return {
    doc_type: (DOC_TYPES as readonly string[]).includes(raw.doc_type ?? "") ? (raw.doc_type as DocType) : "other",
    property_name: text(raw.property_name),
    property_address: text(raw.property_address),
    as_of: text(raw.as_of),
    figures,
    notes: text(raw.notes) ?? "",
    detail: normalizeDetail(raw.detail),
  };
}

export const EXTRACTION_SYSTEM = `You read commercial real estate deal documents for a multifamily investor: offering memorandums (OM), rent rolls, and trailing-12-month operating statements (T12). You report figures exactly as the document states them. You never estimate, infer, or fill a gap with a typical value: a figure the document does not state has found: false (with value 0 and evidence "").

Classify the document:
- "om": a marketing package / offering memorandum / investment summary.
- "rent_roll": a unit-by-unit listing of leases.
- "t12": a monthly or annual income and expense statement (T12, trailing twelve, operating statement, P&L).
- "other": anything else.

For every figure give "evidence": where it came from and the words or numbers it was read from, e.g. "p.14, Financial Summary: 'Net Operating Income $2,431,880'" or "sheet 'Summary', row 'Total Occupied 271'". Keep it under 200 characters. Set found: true only for figures the document actually states.

For every figure also give:
- "quote": the words that state the figure, copied character for character from the document: the label and the number together where they sit side by side, e.g. "Net Operating Income $2,431,880". At most 150 characters. No ellipses, no paraphrase, no words added or reordered, numbers written exactly as the document writes them. From a spreadsheet, copy the row's cells in order. For a figure you computed, quote the total it was computed from. A reader checks the quote against the document, and a quote that is not in it is thrown away.
- "location": where that quote is, e.g. "p.14, Financial Summary" or "sheet 'Summary', row 'Total Occupied'".
Both are "" when found is false.

Figures:
- unit_count: total units at the property.
- year_built: year of original construction (not renovation).
- net_rentable_sqft: total rentable square feet.
- occupied_units: number of occupied units (rent roll summary, or counted when the document lists vacancy status per unit and states no total).
- occupancy_pct: physical occupancy as a percentage 0-100, as stated. Do not compute it yourself.
- avg_in_place_rent_monthly: average monthly in-place (lease/contract) BASE rent per occupied unit. Use a stated average if the document gives one. If it does not, but it totals the base rent charge for current residents (a charge code such as "rent", "RENT" or "Lease Rent"), divide that total by occupied_units and start the evidence with "computed:", naming both numbers and where each came from. Never use a "Market Rent" column or row — rent rolls put market rent and lease charges side by side, and market rent is not in-place rent. Exclude fees (pet, parking, amenity, utility, pest) and concessions. Not found if only market rent is available.
- gross_potential_rent_annual: annual gross potential / gross scheduled rent.
- effective_gross_income_annual: annual total income / effective gross income after vacancy, concessions and bad debt, including other income.
- total_operating_expenses_annual: annual total operating expenses, excluding capital expenditures, reserves and debt service.
- noi_annual: annual net operating income.
- asking_price_usd: the asking / offering price in whole US dollars. Not found when the offering is unpriced or "call for offers".

For an OM, take in-place / trailing figures, never the broker's pro forma, year-1 or "stabilized" projections. For a T12, use the column that totals the twelve months; if the statement covers fewer than twelve months, mark the annual figures not found and say so in notes. Report dollar amounts as plain numbers (2431880, not "2.43M").

property_name: the property the document is about, as written. property_address: its street address with city, state and ZIP where given, as written. as_of: the rent roll date or T12 period as written. Use "" for any of these when the document does not say.
notes: one or two sentences on anything a reviewer should know (partial periods, conflicting figures, pro forma only, unreadable pages). Empty string if nothing.`;

export type Proposal = {
  field: DealDocumentField;
  value: number;
  evidence: string;
  /** From the figure the value was read from; null for a value computed across figures. */
  quote: string | null;
  location: string | null;
  rank: number;
};

export type ProposalRejection = { figure: string; value: unknown; reason: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const UNITS_MIN = 1;
const UNITS_MAX = 5000;

/**
 * Turn an extraction into proposals in the deals table's units, dropping
 * anything that fails its sanity check. A rejected figure is reported, not
 * proposed: the review panel should only ever offer numbers that could be true.
 */
export function proposalsFromExtraction(
  ex: DocumentExtraction,
  now: Date = new Date(),
): { proposals: Proposal[]; rejected: ProposalRejection[] } {
  const proposals: Proposal[] = [];
  const rejected: ProposalRejection[] = [];
  const fig = (k: ExtractedFigure): FigureReading => ex.figures?.[k] ?? { value: null, evidence: null };
  const evidence = (k: ExtractedFigure) => (fig(k).evidence ?? "").trim() || "(no quote given)";

  const propose = (field: DealDocumentField, value: number, ev: string, from: ExtractedFigure | null) => {
    const rank = rankFor(field, ex.doc_type);
    const src = from ? fig(from) : null;
    if (rank > 0) {
      proposals.push({
        field, value, evidence: ev.slice(0, 500), rank,
        quote: src?.quote?.slice(0, 300) ?? null,
        location: src?.location?.slice(0, 200) ?? null,
      });
    }
  };
  const reject = (figure: string, value: unknown, reason: string) => rejected.push({ figure, value, reason });

  // unit_count
  const units = fig("unit_count").value;
  let goodUnits: number | null = null;
  if (isNum(units)) {
    const n = Math.round(units);
    if (n < UNITS_MIN || n > UNITS_MAX) reject("unit_count", units, `outside ${UNITS_MIN}-${UNITS_MAX}`);
    else { goodUnits = n; propose("unit_count", n, evidence("unit_count"), "unit_count"); }
  }

  // vintage_year
  const yb = fig("year_built").value;
  if (isNum(yb)) {
    const y = Math.round(yb);
    if (y < 1850 || y > now.getFullYear() + 3) reject("year_built", yb, "not a plausible construction year");
    else propose("vintage_year", y, evidence("year_built"), "year_built");
  }

  // total_sqft
  const sf = fig("net_rentable_sqft").value;
  if (isNum(sf)) {
    const n = Math.round(sf);
    const perUnit = goodUnits ? n / goodUnits : null;
    if (n <= 0 || n > 10_000_000) reject("net_rentable_sqft", sf, "outside 1-10,000,000");
    else if (perUnit !== null && (perUnit < 200 || perUnit > 5000)) {
      reject("net_rentable_sqft", sf, `${Math.round(perUnit)} sf per unit is not plausible`);
    } else propose("total_sqft", n, evidence("net_rentable_sqft"), "net_rentable_sqft");
  }

  // occupancy_pct — stated first, else occupied / total from the same document.
  const occ = fig("occupancy_pct").value;
  const occupied = fig("occupied_units").value;
  if (isNum(occ)) {
    // A stated 0.94 is a fraction; nobody publishes a rent roll at 0.94% occupied.
    const pct = occ > 0 && occ <= 1 ? occ * 100 : occ;
    if (pct < 0 || pct > 100) reject("occupancy_pct", occ, "outside 0-100");
    else propose("occupancy_pct", round(pct, 1), evidence("occupancy_pct"), "occupancy_pct");
  } else if (isNum(occupied) && goodUnits) {
    if (occupied < 0 || occupied > goodUnits) reject("occupied_units", occupied, `more than ${goodUnits} units`);
    else {
      propose(
        "occupancy_pct",
        round((occupied / goodUnits) * 100, 1),
        `computed: ${occupied} occupied / ${goodUnits} units. ${evidence("occupied_units")}`,
        "occupied_units",
      );
    }
  }

  // in_place_avg_rent — monthly per unit.
  const rent = fig("avg_in_place_rent_monthly").value;
  if (isNum(rent)) {
    if (rent < 100 || rent > 20_000) reject("avg_in_place_rent_monthly", rent, "outside $100-$20,000 a month");
    else propose("in_place_avg_rent", round(rent, 0), evidence("avg_in_place_rent_monthly"), "avg_in_place_rent_monthly");
  }

  // Annual income and expense lines.
  const gpr = annual(fig("gross_potential_rent_annual").value, "gross_potential_rent_annual", reject);
  const egi = annual(fig("effective_gross_income_annual").value, "effective_gross_income_annual", reject);
  const opex = annual(fig("total_operating_expenses_annual").value, "total_operating_expenses_annual", reject);
  const noiRaw = fig("noi_annual").value;
  // NOI may legitimately be negative on a distressed asset; only its size is checked.
  const noi = isNum(noiRaw) && Math.abs(noiRaw) <= 1_000_000_000 ? Math.round(noiRaw) : null;
  if (isNum(noiRaw) && noi === null) reject("noi_annual", noiRaw, "implausibly large");

  // GPR that works out to under $100 or over $20,000 per unit a month is a
  // monthly figure or a misread line, not an annual rent.
  if (gpr !== null && goodUnits) {
    const perUnitMonth = gpr / goodUnits / 12;
    if (perUnitMonth < 100 || perUnitMonth > 20_000) {
      reject("gross_potential_rent_annual", gpr, `$${Math.round(perUnitMonth)} per unit a month is not plausible`);
    } else propose("gross_scheduled_rent", gpr, evidence("gross_potential_rent_annual"), "gross_potential_rent_annual");
  } else if (gpr !== null) {
    propose("gross_scheduled_rent", gpr, evidence("gross_potential_rent_annual"), "gross_potential_rent_annual");
  }

  // The three T12 totals have to agree with each other before any is offered:
  // opex above income, or NOI above income, means a line was misread.
  const t12Consistent =
    egi === null ||
    ((opex === null || opex < egi) && (noi === null || noi <= egi));
  if (!t12Consistent) {
    reject("noi_annual", { egi, opex, noi }, "operating expenses or NOI exceed total income");
  } else {
    if (noi !== null) propose("t12_noi", noi, evidence("noi_annual"), "noi_annual");
    if (opex !== null) propose("t12_opex", opex, evidence("total_operating_expenses_annual"), "total_operating_expenses_annual");
    if (opex !== null && egi !== null && egi > 0) {
      const ratio = round((opex / egi) * 100, 1);
      if (ratio < 10 || ratio > 90) reject("expense_ratio", ratio, "outside 10-90%");
      else propose("expense_ratio", ratio, `computed: opex ${fmt(opex)} / total income ${fmt(egi)}`, null);
    }
  }

  // asking_price — dollars in, millions out.
  const price = fig("asking_price_usd").value;
  if (isNum(price)) {
    const millions = price / 1_000_000;
    if (millions < 0.5 || millions > 3000) reject("asking_price_usd", price, "outside $0.5M-$3B");
    else propose("asking_price", round(millions, 2), evidence("asking_price_usd"), "asking_price_usd");
  }

  return { proposals, rejected };
}

function annual(
  v: number | null,
  figure: string,
  reject: (figure: string, value: unknown, reason: string) => void,
): number | null {
  if (!isNum(v)) return null;
  if (v <= 0 || v > 1_000_000_000) {
    reject(figure, v, "outside $1-$1B");
    return null;
  }
  return Math.round(v);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Longest document text sent to the model, in characters (~60-90k tokens). */
export const MAX_DOCUMENT_CHARS = 250_000;

/** Below this many characters per page a PDF is treated as scanned images. */
export const SCANNED_CHARS_PER_PAGE = 150;

export type DocumentKind = "pdf" | "spreadsheet" | "text" | "unsupported";

export function documentKind(fileName: string, contentType: string | null): DocumentKind {
  const name = fileName.toLowerCase();
  const type = (contentType ?? "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (/\.(xlsx|xlsm|xls|xlsb|ods)$/.test(name) || type.includes("spreadsheet") || type.includes("ms-excel")) {
    return "spreadsheet";
  }
  if (/\.(csv|tsv|txt)$/.test(name) || type.startsWith("text/")) return "text";
  return "unsupported";
}

/**
 * Cut text to the model budget, keeping both ends and marking the cut. The end
 * matters as much as the start: a rent roll's totals block and a T12's NOI line
 * are at the bottom, and a head-only cut drops exactly those.
 */
export function clampDocumentText(text: string, max = MAX_DOCUMENT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return {
    text:
      `${text.slice(0, head)}\n\n[... ${text.length - max} characters omitted from the middle of the document ...]\n\n` +
      text.slice(text.length - tail),
    truncated: true,
  };
}
