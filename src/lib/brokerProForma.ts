// The broker's pro forma, read from the OM breakdown that parse-deal-document
// already stores (summary.om.metrics with basis "pro_forma", plus facts).
// Nothing here writes to the deal: these are the broker's numbers, shown
// beside the actuals, never mixed into them.
//
// Brokers label lines their own way ("Pro Forma Net Operating Income",
// "Net Operating Income (Year 1 Proforma)", "Cash Flow Year 1 NOI"), so the
// headline figures are picked by label, and every line is also listed as the
// OM gives it.

export type OmLine = { label: string; value: string; page: number | null };
export type OmMetric = OmLine & { basis: "in_place" | "pro_forma" | "other" };

export type ProFormaSource = {
  id: string;
  file_name: string;
  storage_path: string;
  doc_type: string | null;
  parse_status: string;
  doc_as_of: string | null;
  created_at: string;
  summary?: { om?: { facts?: OmLine[]; metrics?: OmMetric[] } | null } | null;
};

export type PickedFigure = { amount: number; label: string; page: number | null };

export type BrokerProForma = {
  document: { id: string; file_name: string; storage_path: string };
  noi: PickedFigure | null;
  egi: PickedFigure | null;
  expenses: PickedFigure | null;
  gpr: PickedFigure | null;
  /** Renovation cost per unit, $. */
  renoCost: PickedFigure | null;
  /** Renovation rent premium, $ per unit per month. */
  renoPremium: PickedFigure | null;
  /** Every pro forma line in the OM, in the OM's order. */
  lines: OmLine[];
};

/**
 * The first dollar amount in a broker's value text, e.g. "$1,619,439 ($134,953/mo)" → 1619439,
 * "($156,402) / -5.0%" → -156402. Null when the text has no dollar amount (a bare "5.0%" is not money).
 */
export function firstDollars(text: string): number | null {
  const m = /(\(\s*)?-?\$\s?(\d[\d,]*(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const negative = !!m[1] || /-\s?\$/.test(m[0]);
  return negative ? -n : n;
}

type Rule = {
  include: RegExp;
  exclude?: RegExp;
  /** Label patterns that make a line a worse pick (each match adds 1). */
  worse?: RegExp[];
  /** Label patterns that make a line a better pick. */
  better?: RegExp[];
  range?: [number, number];
};

function pick(lines: OmLine[], rule: Rule): PickedFigure | null {
  let best: { f: PickedFigure; score: number; i: number } | null = null;
  lines.forEach((l, i) => {
    if (!rule.include.test(l.label) || rule.exclude?.test(l.label)) return;
    const amount = firstDollars(l.value);
    if (amount === null) return;
    if (rule.range && (Math.abs(amount) < rule.range[0] || Math.abs(amount) > rule.range[1])) return;
    const score =
      (rule.worse ?? []).filter((r) => r.test(l.label)).length - (rule.better ?? []).filter((r) => r.test(l.label)).length;
    if (!best || score < best.score) best = { f: { amount, label: l.label, page: l.page }, score, i };
  });
  return best ? (best as { f: PickedFigure }).f : null;
}

const LATER_YEAR = /\b(year|yr|fy)\s*[2-9]\b/i;
const PER = /per (unit|sf|square)|\bpsf\b|\/\s?(unit|sf)\b/i;

export function brokerProForma(docs: ProFormaSource[]): BrokerProForma | null {
  const oms = docs
    .filter((d) => d.doc_type === "om" && d.parse_status === "parsed")
    .filter((d) => (d.summary?.om?.metrics ?? []).some((m) => m.basis === "pro_forma"))
    .sort((a, b) => (b.doc_as_of ?? "").localeCompare(a.doc_as_of ?? "") || b.created_at.localeCompare(a.created_at));
  const doc = oms[0];
  if (!doc) return null;
  const om = doc.summary!.om!;
  const lines: OmLine[] = (om.metrics ?? [])
    .filter((m) => m.basis === "pro_forma")
    .map(({ label, value, page }) => ({ label, value, page }));
  const everything: OmLine[] = [...(om.facts ?? []), ...(om.metrics ?? [])];

  return {
    document: { id: doc.id, file_name: doc.file_name, storage_path: doc.storage_path },
    noi: pick(lines, {
      include: /net operating income|\bnoi\b/i,
      exclude: new RegExp(`${LATER_YEAR.source}|${PER.source}`, "i"),
      worse: [/after reserves|post.?reserve/i, /cash flow/i, /cash flow/i, /cash flow/i],
    }),
    egi: pick(lines, {
      include: /effective gross income|\begi\b|total (income|revenue)/i,
      exclude: new RegExp(`other income|${LATER_YEAR.source}|${PER.source}`, "i"),
    }),
    expenses: pick(lines, {
      include: /total (operating )?expenses/i,
      exclude: new RegExp(`variable|controllable|${LATER_YEAR.source}|${PER.source}`, "i"),
      worse: [/post.?reserve|after reserves/i],
    }),
    gpr: pick(lines, {
      include: /gross potential (rent|rental income)|\bgpr\b/i,
      exclude: new RegExp(`${LATER_YEAR.source}|${PER.source}`, "i"),
    }),
    renoCost: pick(everything, {
      include: /renovation cost|reno(vation)? .*cost|cost per unit/i,
      range: [1_000, 150_000],
    }),
    renoPremium: pick(everything, {
      include: /premium/i,
      exclude: /month.to.month/i,
      better: [/weighted|blended/i],
      range: [1, 1_500],
    }),
    lines,
  };
}
