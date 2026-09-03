/**
 * Client-safe "criteria on file" rows for the partner pipeline tearsheet.
 *
 * Same field allow-list as the tearsheet: nothing internal (warmth, AI scores,
 * notes, broker, underwriting, other partners) may appear here.
 */
import { format } from "date-fns";
import type { Partner } from "@/hooks/usePartners";
import { STRATEGY_LABEL, PARTNER_STRATEGY_FIELD, type StrategyKey } from "@/lib/partnerMatching";
import { bandLabel } from "@/lib/partnerPipelineFit";

const NOT_ON_FILE = "Not on file — please confirm";
const listOr = (v: string[] | null | undefined) =>
  (v ?? []).filter(Boolean).length ? (v ?? []).filter(Boolean).join(" · ") : NOT_ON_FILE;

export function criteriaRows(partner: Partner): Array<[string, string]> {
  const strategies = (Object.keys(PARTNER_STRATEGY_FIELD) as StrategyKey[])
    .filter((k) => (partner as unknown as Record<string, unknown>)[PARTNER_STRATEGY_FIELD[k]] === true)
    .map((k) => STRATEGY_LABEL[k]);

  const submarket = [partner.urban_infill ? "Urban infill" : null, partner.suburban ? "Suburban" : null]
    .filter(Boolean)
    .join(" · ");

  const rows: Array<[string, string]> = [
    ["Check size", bandLabel(partner) ?? NOT_ON_FILE],
    ["Target markets", listOr(partner.geography)],
    ["Markets not currently pursued", listOr(partner.geography_avoid)],
    ["Strategies", strategies.length ? strategies.join(" · ") : NOT_ON_FILE],
    ["Product types", listOr(partner.product_types)],
    ["Hold period", listOr(partner.hold_period)],
    ["Firm type", partner.firm_type || NOT_ON_FILE],
    ["Investor type", listOr(partner.investor_type)],
    ["Headquarters", partner.headquarters || NOT_ON_FILE],
    ["Sub-market preference", submarket || NOT_ON_FILE],
  ];

  if (partner.capital_status) {
    const asOf = partner.capital_status_as_of
      ? ` (as of ${format(new Date(partner.capital_status_as_of), "MMM d, yyyy")})`
      : "";
    rows.push([
      "Capital status",
      `${partner.capital_status}${partner.capital_status_detail ? ` — ${partner.capital_status_detail}` : ""}${asOf}`,
    ]);
  }
  return rows;
}
