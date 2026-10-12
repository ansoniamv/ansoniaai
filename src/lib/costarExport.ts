/**
 * Reads a CoStar "Data Export" workbook (Analytics → Export, multifamily) into
 * rows for costar_series.
 *
 * The export is large: ~70k rows × 74 columns, a 26 MB file whose one sheet is
 * 167 MB of XML. SheetJS would build all of it as cell objects in memory, so
 * this reads the zip directly and streams the sheet through the platform's own
 * DecompressionStream, keeping one row of XML in hand at a time. No
 * dependencies; it runs the same in a Web Worker, the browser, and Node 18+.
 *
 * It refuses rather than guesses: a missing column, a second "As Of" or a
 * period label it can't read throws with the offending values, because a
 * vintage loaded under the wrong date or period would score deals off the
 * wrong year without anyone noticing.
 */

export type PeriodKind = "history" | "ytd" | "estimate" | "forecast";

export type CostarRow = {
  geography_type: string;
  geography_code: string;
  geography_name: string;
  cbsa_code: string | null;
  slice: string;
  period: string;
  period_year: number;
  period_quarter: number;
  period_kind: PeriodKind;
  inventory_units: number | null;
  under_construction_units: number | null;
  construction_starts_units_12mo: number | null;
  net_delivered_units_12mo: number | null;
  absorption_units_12mo: number | null;
  demand_units: number | null;
  occupancy_rate: number | null;
  stabilized_vacancy: number | null;
  asking_rent_unit: number | null;
  effective_rent_unit: number | null;
  effective_rent_growth_12mo: number | null;
  market_cap_rate: number | null;
  sale_price_per_unit: number | null;
  metrics: Record<string, number | string>;
};

export type CostarExport = {
  asOf: string; // '2026 Q4'
  asOfDate: string; // '2026-12-31'
  rows: CostarRow[];
  summary: {
    geographyTypes: string[];
    slices: string[];
    periods: string[];
    geographies: number;
    cbsas: number;
    /** Share of rows carrying each promoted metric, so a thin export is visible before it's loaded. */
    coverage: Record<string, number>;
    warnings: string[];
  };
};

/** Header → costar_series column, for the metrics the signals read. */
export const PROMOTED_METRICS = {
  "Inventory Units": "inventory_units",
  "Under Construction Units": "under_construction_units",
  "Construction Starts Units 12 Mo": "construction_starts_units_12mo",
  "Net Delivered Units 12 Mo": "net_delivered_units_12mo",
  "Absorption Units 12 Mo": "absorption_units_12mo",
  "Demand Units": "demand_units",
  "Occupancy Rate": "occupancy_rate",
  "Stabilized Vacancy": "stabilized_vacancy",
  "Market Asking Rent/Unit": "asking_rent_unit",
  "Market Effective Rent/Unit": "effective_rent_unit",
  "Market Effective Rent Growth 12 Mo": "effective_rent_growth_12mo",
  "Market Cap Rate": "market_cap_rate",
  "Market Sale Price Per Unit": "sale_price_per_unit",
} as const;

const DIMENSIONS = [
  "As Of",
  "Geography Type",
  "Geography Code",
  "Geography Name",
  "Slice",
  "Period",
] as const;

/** Columns that describe the row rather than measure anything. */
const NON_METRIC = new Set([
  ...DIMENSIONS,
  "CBSA Code",
  "Property Class Name",
  "Property Type",
  "Forecast Scenario",
]);

// ------------------------------------------------------------------ zip

type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number };

function readZipDirectory(buf: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not an .xlsx file (no zip directory found).");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt .xlsx (bad zip directory).");
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function entryStream(buf: Uint8Array, e: ZipEntry): ReadableStream<Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nameLen = view.getUint16(e.localOffset + 26, true);
  const extraLen = view.getUint16(e.localOffset + 28, true);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  const raw = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  if (e.method === 0) return raw;
  if (e.method === 8) return raw.pipeThrough(new DecompressionStream("deflate-raw"));
  throw new Error(`Unsupported compression in ${e.name} (method ${e.method}).`);
}

async function entryText(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const reader = entryStream(buf, e).getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    out += decoder.decode(value, { stream: true });
  }
}

// ------------------------------------------------------------------ xml

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, k: string) =>
    k[0] === "#"
      ? String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10))
      : XML_ENTITIES[k],
  );
}

/** Concatenated text of every <t> inside a fragment (rich text has several). */
function textRuns(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += m[1];
  return unescapeXml(out);
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textRuns(m[1]));
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

type Cell = string | number | boolean | null;

const CELL_RE = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
const ROW_END_RE = /<\/(?:\w+:)?row>/;

function parseRow(rowXml: string, strings: string[]): Cell[] {
  const cells: Cell[] = [];
  for (const m of rowXml.matchAll(CELL_RE)) {
    const attrs = m[1];
    const inner = m[2] ?? "";
    const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
    const idx = ref ? columnIndex(ref) : cells.length;
    const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? "n";
    if (type === "inlineStr") {
      cells[idx] = textRuns(inner);
      continue;
    }
    const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
    if (v === undefined) continue;
    if (type === "s") cells[idx] = strings[Number(v)] ?? null;
    else if (type === "str" || type === "e") cells[idx] = unescapeXml(v);
    else if (type === "b") cells[idx] = v === "1";
    else cells[idx] = Number(v);
  }
  return cells;
}

async function* sheetRows(stream: ReadableStream<Uint8Array>, strings: string[], onBytes?: (n: number) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      onBytes?.(value.length);
      buf += decoder.decode(value, { stream: true });
    }
    if (done) buf += decoder.decode();
    for (;;) {
      const end = ROW_END_RE.exec(buf);
      if (!end) break;
      const startTag = buf.search(/<(?:\w+:)?row\b/);
      yield parseRow(buf.slice(Math.max(0, startTag), end.index), strings);
      buf = buf.slice(end.index + end[0].length);
    }
    if (done) return;
  }
}

async function firstSheetPath(buf: Uint8Array, entries: Map<string, ZipEntry>): Promise<string> {
  const wb = entries.get("xl/workbook.xml");
  const rels = entries.get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const rid = /<(?:\w+:)?sheet\b[^>]*\br:id="([^"]+)"/.exec(await entryText(buf, wb))?.[1];
    if (rid) {
      const relXml = await entryText(buf, rels);
      for (const m of relXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
        if (new RegExp(`\\bId="${rid}"`).test(m[1])) {
          const target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
          if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
        }
      }
    }
  }
  return "xl/worksheets/sheet1.xml";
}

// ------------------------------------------------------------------ CoStar

const AS_OF_RE = /^(\d{4})\s+Q([1-4])$/;
const PERIOD_RE = /^(\d{4})\s+Q([1-4])(?:\s+(YTD|EST))?$/i;

export function quarterEnd(year: number, quarter: number): string {
  const month = quarter * 3; // 3, 6, 9, 12
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${day}`;
}

export function classifyPeriod(
  period: string,
  asOfYear: number,
  asOfQuarter: number,
): { year: number; quarter: number; kind: PeriodKind } {
  const m = PERIOD_RE.exec(period.trim());
  if (!m) throw new Error(`Unrecognised period "${period}". Expected e.g. "2027 Q4", "2026 Q4 YTD" or "2026 Q4 EST".`);
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  const suffix = m[3]?.toUpperCase();
  if (suffix === "YTD") return { year, quarter, kind: "ytd" };
  if (suffix === "EST") return { year, quarter, kind: "estimate" };
  if (year < asOfYear || (year === asOfYear && quarter < asOfQuarter)) return { year, quarter, kind: "history" };
  if (year > asOfYear) return { year, quarter, kind: "forecast" };
  // The as-of quarter itself with no YTD/EST label: CoStar's figure for the
  // quarter in progress, which is an estimate until it closes.
  return { year, quarter, kind: "estimate" };
}

/** A number, or null. Strings only pass when they are entirely a number, so "n/a" never becomes 0. */
function toNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?(e[+-]?\d+)?\s*$/i.test(v)) return Number(v);
  return null;
}

export type ParseProgress = { bytesRead: number; rows: number };

export async function parseCostarExport(
  file: Blob,
  onProgress?: (p: ParseProgress) => void,
): Promise<CostarExport> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = readZipDirectory(buf);
  const sst = entries.get("xl/sharedStrings.xml");
  const strings = sst ? parseSharedStrings(await entryText(buf, sst)) : [];
  const sheet = entries.get(await firstSheetPath(buf, entries));
  if (!sheet) throw new Error("The workbook has no worksheet.");

  let header: string[] | null = null;
  let col: Record<string, number> = {};
  let asOf: string | null = null;
  let asOfYear = 0;
  let asOfQuarter = 0;
  const rows: CostarRow[] = [];
  const geographyTypes = new Set<string>();
  const slices = new Set<string>();
  const periods = new Set<string>();
  const codes = new Set<string>();
  const cbsas = new Set<string>();
  const filled: Record<string, number> = {};
  let bytesRead = 0;

  for await (const cells of sheetRows(entryStream(buf, sheet), strings, (n) => (bytesRead += n))) {
    if (!header) {
      header = cells.map((c) => (c == null ? "" : String(c).trim()));
      col = Object.fromEntries(header.map((h, i) => [h, i]));
      const missing = DIMENSIONS.filter((d) => !(d in col));
      if (missing.length)
        throw new Error(
          `This doesn't look like a CoStar data export: missing column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}.`,
        );
      continue;
    }
    const get = (h: string): Cell => cells[col[h]] ?? null;
    const str = (h: string) => {
      const v = get(h);
      return v == null ? "" : String(v).trim();
    };
    const code = str("Geography Code");
    if (!code) continue; // trailing blank / footer row

    const rowAsOf = str("As Of");
    if (asOf === null) {
      const m = AS_OF_RE.exec(rowAsOf);
      if (!m) throw new Error(`Unrecognised "As Of" value "${rowAsOf}". Expected e.g. "2026 Q4".`);
      asOf = rowAsOf;
      asOfYear = Number(m[1]);
      asOfQuarter = Number(m[2]);
    } else if (rowAsOf !== asOf) {
      throw new Error(
        `The file mixes two vintages ("${asOf}" and "${rowAsOf}"). Export one As Of date per file.`,
      );
    }

    const period = str("Period");
    const p = classifyPeriod(period, asOfYear, asOfQuarter);
    const metrics: Record<string, number | string> = {};
    for (const [h, i] of Object.entries(col)) {
      if (NON_METRIC.has(h) || h in PROMOTED_METRICS || !h) continue;
      const v = cells[i];
      if (v == null || v === "") continue;
      metrics[h] = toNumber(v) ?? String(v);
    }
    const promoted = Object.fromEntries(
      Object.entries(PROMOTED_METRICS).map(([h, column]) => {
        const v = h in col ? toNumber(get(h)) : null;
        if (v !== null) filled[h] = (filled[h] ?? 0) + 1;
        return [column, v];
      }),
    ) as Pick<CostarRow, (typeof PROMOTED_METRICS)[keyof typeof PROMOTED_METRICS]>;

    const cbsa = str("CBSA Code") || null;
    const row: CostarRow = {
      geography_type: str("Geography Type"),
      geography_code: code,
      geography_name: str("Geography Name"),
      cbsa_code: cbsa,
      slice: str("Slice") || "All",
      period,
      period_year: p.year,
      period_quarter: p.quarter,
      period_kind: p.kind,
      ...promoted,
      metrics,
    };
    rows.push(row);
    geographyTypes.add(row.geography_type);
    slices.add(row.slice);
    periods.add(period);
    codes.add(code);
    if (cbsa) cbsas.add(cbsa);
    if (rows.length % 2000 === 0) onProgress?.({ bytesRead, rows: rows.length });
  }

  if (!header || !asOf || rows.length === 0) throw new Error("The export has no data rows.");
  onProgress?.({ bytesRead, rows: rows.length });

  const warnings: string[] = [];
  const sliceList = [...slices].sort();
  if (!sliceList.some((s) => /1\s*&\s*2|all/i.test(s)))
    warnings.push(
      `No 1 & 2 Star slice (slices: ${sliceList.join(", ")}). Inventory leaves out Class C stock, so supply as a % of inventory reads high. Re-export with 1 & 2 Star included.`,
    );
  if (!rows.some((r) => r.period_kind === "ytd" && r.under_construction_units !== null))
    warnings.push("No year-to-date under-construction counts; the supply signal will be empty.");
  if (!rows.some((r) => r.period_kind === "forecast"))
    warnings.push("No forecast periods; forward supply and rent forecast will be empty.");
  for (const [h] of Object.entries(PROMOTED_METRICS))
    if (!(h in col)) warnings.push(`Column "${h}" is not in this export.`);

  const coverage = Object.fromEntries(
    Object.keys(PROMOTED_METRICS).map((h) => [h, (filled[h] ?? 0) / rows.length]),
  );

  return {
    asOf,
    asOfDate: quarterEnd(asOfYear, asOfQuarter),
    rows,
    summary: {
      geographyTypes: [...geographyTypes].sort(),
      slices: sliceList,
      periods: [...periods].sort(),
      geographies: codes.size,
      cbsas: cbsas.size,
      coverage,
      warnings,
    },
  };
}
