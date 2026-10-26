/**
 * Where a figure on a deal came from: deals.field_sources, one entry per column
 * (migration 20261028120000_deal_field_sources.sql). The Key Stats boxes on the
 * deal page open these.
 *
 * Writers put an entry in the same update as the value it describes. The
 * database merges it into what is already there, and drops an entry when its
 * column changes without a new one, so an entry never outlives its value (a
 * hand edit of the unit count loses the OM quote it no longer matches).
 *
 * Free of Deno APIs: the frontend and src/test import it directly.
 */

export type FieldSource = {
  /** "document": read from an uploaded deal document. "api": a data provider. */
  kind: "document" | "api";
  /** "Deal document", "HelloData", "Esri", "BLS". */
  provider: string;
  /** One-line citation: what the figure is, where, for when. */
  label: string;
  /**
   * Words copied from the source. Shown in quotation marks only when
   * quote_verified: a quote the parser wrote but that is not in the document's
   * text is the parser's claim, not the document's.
   */
  quote?: string;
  quote_verified?: boolean;
  /** "p.14, Financial Summary"; "sheet 'Summary', row 'Total Occupied'". */
  location?: string;
  /** The parser's own description, shown when there is no verified quote. */
  note?: string;
  document_id?: string;
  file_name?: string;
  /** The period the source describes, as the source writes it. */
  as_of?: string;
  recorded_at: string;
  /**
   * Written by the launch backfill from what the column's only writer must have
   * been, not recorded when the value was. The exact series is not known.
   */
  backfilled?: boolean;
};

export type FieldSources = Record<string, FieldSource>;

/** One column's entry from a deals.field_sources value as read back (Json). */
export function sourceOf(sources: unknown, column: string): FieldSource | null {
  if (!sources || typeof sources !== "object") return null;
  const s = (sources as FieldSources)[column];
  return s && typeof s === "object" && typeof s.label === "string" ? s : null;
}

/**
 * Text as compared for a quote check. PDF text extraction and the model differ
 * in spacing, curly quotes and dashes, and a spreadsheet arrives as CSV, where a
 * row "Total Occupied,271" is quoted as "Total Occupied 271". None of those
 * differences changes what the words say; a different number or word still
 * fails.
 */
export function normalizeForQuote(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[‐-―−]/g, "-")
    .replace(/[“”„″"]/g, " ")
    .replace(/[\s,|]+/g, " ")
    .trim();
}

/** Shorter than this, a "quote" can match almost any document by chance. */
const QUOTE_MIN_CHARS = 6;

/**
 * Builds a check for quotes against one document's text, normalized once
 * because a document is checked for a dozen figures. With no text (a PDF the
 * model read as pages) nothing can be checked, so nothing passes.
 */
export function quoteChecker(text: string | null): (quote: string | null | undefined) => boolean {
  if (!text) return () => false;
  const haystack = normalizeForQuote(text);
  return (quote) => {
    if (!quote) return false;
    const needle = normalizeForQuote(quote);
    // Every figure is a number, so a quote with no digit in it does not state it.
    if (needle.length < QUOTE_MIN_CHARS || !/\d/.test(needle)) return false;
    return haystack.includes(needle);
  };
}

// ---------------------------------------------------------------- HelloData

/** How in_place_avg_rent was arrived at; see mapHelloDataProperty. */
export type HelloDataRentBasis = { from: "listed_units"; units: number } | { from: "property_average" } | null;

/**
 * Entries for the HelloData figures a write actually carries. `written` is the
 * update after its filters, so a field kept back (fill-if-null, intake-only)
 * gets no entry and keeps the source it had.
 */
export function hellodataFieldSources(
  written: Record<string, unknown>,
  ctx: { at: string; rentBasis?: HelloDataRentBasis },
): FieldSources {
  const has = (k: string) => written[k] !== null && written[k] !== undefined;
  const entry = (label: string): FieldSource => ({ kind: "api", provider: "HelloData", label, recorded_at: ctx.at });
  const out: FieldSources = {};

  if (has("unit_count")) {
    out.unit_count = entry(
      written.unit_count_is_estimated === true
        ? "HelloData's predicted unit count. HelloData has no filed count for this property."
        : "Unit count on HelloData's property record",
    );
  }
  if (has("vintage_year")) {
    out.vintage_year = entry(
      written.vintage_is_estimated === true
        ? "HelloData's predicted year built. HelloData has no filed year for this property."
        : "Year built on HelloData's property record",
    );
  }
  if (has("in_place_avg_rent")) {
    const b = ctx.rentBasis;
    out.in_place_avg_rent = entry(
      b?.from === "listed_units"
        ? `Average asking rent across ${b.units} unit${b.units === 1 ? "" : "s"} HelloData lists as available. Asking rent, not what current residents pay.`
        : "HelloData's property-level average rent (no units were listed as available). Asking rent, not what current residents pay.",
    );
  }
  if (has("median_rent_tract")) out.median_rent_tract = entry("Census-tract median rent, from HelloData's demographics");
  if (has("median_income_tract")) out.median_income_tract = entry("Census-tract median household income, from HelloData's demographics");
  return out;
}
