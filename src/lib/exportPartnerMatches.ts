import XLSX from "xlsx-js-style";
import { format } from "date-fns";
import type { Deal } from "@/hooks/useDeals";
import type { PartnerMatch, MatchablePartner } from "@/lib/partnerMatching";

const HEADER_FILL = { fgColor: { rgb: "002752" } };
const HEADER_FONT = { bold: true, color: { rgb: "FFFFFF" } };

const sanitizeSheetName = (name: string) =>
  name.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);

const slugify = (name: string) =>
  name
    .replace(/[\\/?*[\]:]/g, "-")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

function styleSheet(ws: XLSX.WorkSheet, headers: string[], widths: number[]) {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let c = 0; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (!cell) continue;
    cell.s = {
      font: HEADER_FONT,
      fill: HEADER_FILL,
      alignment: { horizontal: "left", vertical: "center" },
    };
  }
  ws["!cols"] = widths.map((w) => ({ wch: w }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r, c: headers.length - 1 } }),
  };
}

const joinList = (v: string[] | null | undefined) => (v ?? []).filter(Boolean).join(", ");

function strategyLabels(p: MatchablePartner) {
  const out: string[] = [];
  if (p.strategy_value_add) out.push("Value-Add");
  if (p.strategy_core_plus) out.push("Core+");
  if (p.strategy_workforce) out.push("Workforce");
  if (p.strategy_affordable) out.push("Affordable");
  return out.join(", ");
}

/**
 * Export the on-screen match results to Excel. Emits the SAME fields the
 * panel shows — score, tier, confidence, coverage, base score, notes
 * adjustment, reasons, misses, and the analyst blurb — plus a second sheet
 * for hard-gated partners so an excluded partner is visible, never absent.
 */
export function exportPartnerMatches({
  deal,
  matches,
  gated = [],
  blurbFor,
  inPipelineFor,
}: {
  deal: Deal;
  matches: PartnerMatch[];
  /** Hard-gated partners (check size / avoid list). Exported on their own sheet. */
  gated?: PartnerMatch[];
  /** Analyst-facing "who is this firm" blurb, matching the on-screen row. */
  blurbFor?: (partner: MatchablePartner) => string;
  inPipelineFor?: (partnerId: string) => boolean;
}) {
  const headers = [
    "Rank", "Firm", "Match Score %", "Tier", "Confidence", "Pillars Covered",
    "Base Score %", "Notes Adj (pts)", "Warmth", "Firm Type", "Investor Type",
    "Min Equity ($M)", "Max Equity ($M)", "Hold Period", "Strategy", "Product Types",
    "Geography", "HQ", "Ansonia POC", "In Pipeline", "Why It Fits", "Gaps", "Profile", "Website",
  ];

  const rows = matches.map((m, i) => {
    const p = m.partner;
    return [
      i + 1,
      p.name ?? "",
      m.confidence === "insufficient" ? "" : m.score,
      m.tier,
      m.confidence,
      `${m.coverage.pillarsCovered}/${m.coverage.pillarsTotal}`,
      m.baseScore,
      m.notesAdjustment,
      p.relationship_strength ?? "",
      p.firm_type ?? "",
      joinList(p.investor_type),
      p.min_equity_m ?? "",
      p.max_equity_m ?? "",
      joinList(p.hold_period),
      strategyLabels(p),
      joinList(p.product_types),
      joinList(p.geography),
      p.headquarters ?? "",
      (p as { ansonia_poc?: string | null }).ansonia_poc ?? "",
      inPipelineFor?.(p.id) ? "Yes" : "No",
      (m.reasons ?? []).join("; "),
      (m.misses ?? []).join("; "),
      blurbFor?.(p) ?? "",
      (p as { website?: string | null }).website ?? "",
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  styleSheet(ws, headers, [
    6, 30, 14, 10, 12, 10, 12, 14, 16, 18, 26, 14, 14, 22, 26, 28, 30, 22, 18, 12, 48, 48, 60, 32,
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName("Partner Matches"));

  // Hard-gated partners get their own sheet — excluded, but never invisible.
  if (gated.length > 0) {
    const gatedHeaders = [
      "Firm", "Gate", "Gate Reason", "Score % (pre-gate)", "Warmth",
      "Min Equity ($M)", "Max Equity ($M)", "Geography", "Avoid List", "Website",
    ];
    const gatedRows = gated.map((m) => {
      const p = m.partner;
      return [
        p.name ?? "",
        m.gateKey === "avoid_list" ? "Avoid list" : "Check size",
        m.gateReason ?? "",
        m.score,
        p.relationship_strength ?? "",
        p.min_equity_m ?? "",
        p.max_equity_m ?? "",
        joinList(p.geography),
        joinList(p.geography_avoid),
        (p as { website?: string | null }).website ?? "",
      ];
    });
    const gws = XLSX.utils.aoa_to_sheet([gatedHeaders, ...gatedRows]);
    styleSheet(gws, gatedHeaders, [30, 12, 48, 16, 16, 14, 14, 30, 30, 32]);
    XLSX.utils.book_append_sheet(wb, gws, sanitizeSheetName("Excluded (Hard Gates)"));
  }

  const dealSlug = slugify(deal.property_name ?? "") || `deal-${String(deal.id).slice(0, 8)}`;
  const filename = `Ansonia-Partner-Matches-${dealSlug}-${format(new Date(), "yyyy-MM-dd")}.xlsx`;
  XLSX.writeFile(wb, filename);
}
