import XLSX from "xlsx-js-style";
import { format, parseISO } from "date-fns";
import { TIER_LABEL, tierKey } from "@/lib/tier";
import type { TeamMember } from "@/hooks/useTeamMembers";

type AnyDeal = {
  id: string;
  property_name: string | null;
  address: string | null;
  location_city: string | null;
  location_state: string | null;
  msa: string | null;
  broker_firm: string | null;
  broker_contact_name: string | null;
  broker_contact_email: string | null;
  units: number | null;
  year_built: number | null;
  avg_sf: number | null;
  occupancy_pct: number | null;
  asset_class: string | null;
  strategy: string | null;
  offers_due: string | null;
  fit_tier: string | null;
  fit_score: number | null;
  fit_rationale: string | null;
  email_received_at: string | null;
  reviewed: boolean | null;
  email_count: number | null;
  gate_status: string | null;
  gate_reason: string | null;
  assigned_to: string | null;
  email_thread_summary: string | null;
};

const HEADER_FILL = { fgColor: { rgb: "002752" } };
const HEADER_FONT = { bold: true, color: { rgb: "FFFFFF" } };

const tierLabel = (t: string | null) => {
  if (!t) return "";
  const k = tierKey(t);
  return k ? TIER_LABEL[k] : t;
};

const toDate = (iso: string | null): Date | "" => {
  if (!iso) return "";
  try {
    const d = parseISO(iso);
    return isNaN(d.getTime()) ? "" : d;
  } catch {
    return "";
  }
};

function styleSheet(
  ws: XLSX.WorkSheet,
  headers: string[],
  widths: number[],
) {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  // Header styling
  for (let c = 0; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr];
    if (!cell) continue;
    cell.s = {
      font: HEADER_FONT,
      fill: HEADER_FILL,
      alignment: { horizontal: "left", vertical: "center" },
    };
  }
  ws["!cols"] = widths.map((w) => ({ wch: w }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r, c: headers.length - 1 } }) };
  // Date formatting for any Date cells
  for (let r = 1; r <= range.e.r; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && cell.v instanceof Date) {
        cell.t = "d";
        cell.z = "yyyy-mm-dd";
      }
    }
  }
}

const sanitizeSheetName = (name: string) =>
  name.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);

export function exportInboxDay({
  dayKey,
  deals,
  filtered,
  teamById,
}: {
  dayKey: string;
  deals: AnyDeal[];
  filtered: AnyDeal[];
  teamById: Map<string, TeamMember>;
}) {
  const wb = XLSX.utils.book_new();

  const dealsHeaders = [
    "Property", "Address", "City", "State", "MSA", "Units", "Year Built", "Avg SF", "Occupancy %", "Asset Class",
    "Strategy", "Fit Score", "Fit Tier", "Gate Status", "Gate Reason",
    "Offers Due", "Broker Firm", "Broker Contact", "Broker Email",
    "Email Received", "# Emails", "Assigned To", "Reviewed",
    "Fit Rationale", "Email Thread Summary",
  ];
  const dealsRows = deals.map((d) => [
    d.property_name ?? "",
    d.address ?? "",
    d.location_city ?? "",
    d.location_state ?? "",
    d.msa ?? "",
    d.units ?? "",
    d.year_built ?? "",
    d.avg_sf ?? "",
    d.occupancy_pct ?? "",
    d.asset_class ?? "",
    d.strategy ?? "",
    d.fit_score ?? "",
    tierLabel(d.fit_tier),
    d.gate_status ?? "",
    d.gate_reason ?? "",
    toDate(d.offers_due),
    d.broker_firm ?? "",
    d.broker_contact_name ?? "",
    d.broker_contact_email ?? "",
    toDate(d.email_received_at),
    d.email_count ?? "",
    d.assigned_to ? (teamById.get(d.assigned_to)?.full_name ?? "") : "",
    d.reviewed ? "Yes" : "No",
    d.fit_rationale ?? "",
    d.email_thread_summary ?? "",
  ]);
  const wsDeals = XLSX.utils.aoa_to_sheet([dealsHeaders, ...dealsRows]);
  styleSheet(wsDeals, dealsHeaders, [
    34, 28, 16, 8, 22, 8, 10, 10, 12, 16, 16, 10, 12, 14, 36, 14, 24, 22, 28, 16, 10, 20, 10, 48, 60,
  ]);
  const sheetName = sanitizeSheetName(dayKey === "undated" ? "Undated" : dayKey);
  XLSX.utils.book_append_sheet(wb, wsDeals, sheetName);

  const filtHeaders = [
    "Property", "Address", "City", "State", "Asset Class", "Broker Firm", "Filter Reason", "Email Received",
  ];
  const filtRows = filtered.map((d) => [
    d.property_name ?? "",
    d.address ?? "",
    d.location_city ?? "",
    d.location_state ?? "",
    d.asset_class ?? "",
    d.broker_firm ?? "",
    d.gate_reason ?? "",
    toDate(d.email_received_at),
  ]);
  const wsFilt = XLSX.utils.aoa_to_sheet([filtHeaders, ...filtRows]);
  styleSheet(wsFilt, filtHeaders, [34, 28, 16, 8, 16, 24, 48, 16]);
  XLSX.utils.book_append_sheet(wb, wsFilt, "Filtered (screened out)");

  const datePart = dayKey === "undated" ? "undated" : dayKey;
  const filename = `Ansonia-Deal-Inbox-${datePart === "undated" ? "undated" : format(parseISO(dayKey), "yyyy-MM-dd")}.xlsx`;
  XLSX.writeFile(wb, filename);
}
