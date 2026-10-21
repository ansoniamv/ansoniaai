/**
 * The full read of one deal document, as computed by summarizeDetail() in
 * supabase/functions/_shared/dealDocumentDetail.ts: unit mix, loss-to-lease,
 * expirations and delinquency for a rent roll; categories with T3 for a T12;
 * facts, metrics and amenities for an OM.
 *
 * Read-only. Only the handful of figures that feed the score go through the
 * review-and-apply table; everything here informs underwriting without
 * touching the deal row.
 */
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type UnitMixRow = {
  beds: number | null;
  units: number;
  occupied: number;
  avg_sqft: number | null;
  avg_market_rent: number | null;
  avg_lease_rent: number | null;
  loss_to_lease_pct: number | null;
};

type RentRollSummary = {
  as_of: string | null;
  units: number;
  occupied: number;
  notice: number;
  vacant_leased: number;
  vacant: number;
  down: number;
  physical_occupancy_pct: number | null;
  leased_pct: number | null;
  avg_sqft: number | null;
  avg_market_rent: number | null;
  avg_lease_rent: number | null;
  loss_to_lease_pct: number | null;
  unit_mix: UnitMixRow[];
  expirations: { month: string; count: number }[];
  expired_or_mtm: number;
  expiring_later: number;
  no_lease_end: number;
  delinquent_units: number;
  delinquent_total: number;
  other_income_monthly: { code: string; monthly_total: number }[];
};

type T12Row = { category: string; annual: number | null; t3_annualized: number | null; lines: string[] };
type T12Summary = {
  period: string | null;
  categories: T12Row[];
  total_income: number | null;
  noi: number | null;
  t3_noi: number | null;
};

type OmSummary = {
  facts: { label: string; value: string; page: number | null }[];
  metrics: { label: string; value: string; basis: "in_place" | "pro_forma" | "other"; page: number | null }[];
  amenities: string[];
};

export type DocumentSummary = {
  rent_roll: RentRollSummary | null;
  t12: T12Summary | null;
  om: OmSummary | null;
  checks: string[];
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const money = (v: number | null | undefined) =>
  isNum(v) ? `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString()}` : "—";
const pct = (v: number | null | undefined) => (isNum(v) ? `${v.toFixed(1)}%` : "—");
const int = (v: number | null | undefined) => (isNum(v) ? Math.round(v).toLocaleString() : "—");
const bedsLabel = (b: number | null) => (b === null ? "Unknown" : b === 0 ? "Studio" : `${b} BR`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y.slice(2)}`;
};

const CATEGORY_LABEL: Record<string, string> = {
  gross_potential_rent: "Gross potential rent",
  loss_to_lease: "Loss to lease",
  vacancy_loss: "Vacancy loss",
  concessions: "Concessions",
  bad_debt: "Bad debt",
  non_revenue_units: "Non-revenue units",
  other_income: "Other income",
  total_income: "Total income",
  taxes: "Real estate taxes",
  insurance: "Insurance",
  payroll: "Payroll",
  repairs_maintenance: "Repairs & maintenance",
  turnover: "Turnover",
  contract_services: "Contract services",
  utilities: "Utilities",
  management_fee: "Management fee",
  admin_marketing: "Admin & marketing",
  other_expense: "Other expense",
  total_expenses: "Total operating expenses",
  noi: "Net operating income",
  below_noi: "Below NOI (capex, debt)",
};
const TOTAL_ROWS = new Set(["total_income", "total_expenses", "noi"]);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-hairline px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-3 mb-1">{children}</p>;
}

export function DealDocumentSummary({ summary, unitCount }: { summary: DocumentSummary; unitCount: number | null }) {
  const empty = !summary.rent_roll && !summary.t12 && !summary.om;
  return (
    <div className="mt-2 space-y-1">
      {summary.checks.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-0.5">
          <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Doesn't add up — check against the document
          </p>
          {summary.checks.map((c, i) => (
            <p key={i} className="text-muted-foreground">{c}</p>
          ))}
        </div>
      )}
      {summary.rent_roll && <RentRollView s={summary.rent_roll} />}
      {summary.t12 && <T12View s={summary.t12} unitCount={unitCount} />}
      {summary.om && <OmView s={summary.om} />}
      {empty && <p className="text-xs text-muted-foreground">No detail could be read from this document.</p>}
    </div>
  );
}

function RentRollView({ s }: { s: RentRollSummary }) {
  const occupied = s.occupied + s.notice;
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        <Kpi label="Units" value={int(s.units)} hint={`${occupied} occ · ${s.vacant + s.vacant_leased} vacant`} />
        <Kpi label="Physical occ." value={pct(s.physical_occupancy_pct)} hint={`${pct(s.leased_pct)} leased`} />
        <Kpi label="Avg market rent" value={money(s.avg_market_rent)} />
        <Kpi label="Avg in-place rent" value={money(s.avg_lease_rent)} hint="base rent, occupied" />
        <Kpi label="Loss to lease" value={pct(s.loss_to_lease_pct)} />
        <Kpi label="Avg unit size" value={isNum(s.avg_sqft) ? `${int(s.avg_sqft)} sf` : "—"} />
        <Kpi label="On notice" value={int(s.notice)} />
        <Kpi
          label="Delinquent"
          value={money(s.delinquent_total)}
          hint={`${s.delinquent_units} unit${s.delinquent_units === 1 ? "" : "s"}`}
        />
      </div>

      {s.unit_mix.length > 0 && (
        <>
          <SubHeading>Unit mix</SubHeading>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Occ.</TableHead>
                  <TableHead className="text-right">Avg SF</TableHead>
                  <TableHead className="text-right">Market</TableHead>
                  <TableHead className="text-right">In-place</TableHead>
                  <TableHead className="text-right">LTL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.unit_mix.map((r) => (
                  <TableRow key={String(r.beds)} className="text-xs tabular-nums">
                    <TableCell>{bedsLabel(r.beds)}</TableCell>
                    <TableCell className="text-right">{r.units}</TableCell>
                    <TableCell className="text-right">{r.occupied}</TableCell>
                    <TableCell className="text-right">{int(r.avg_sqft)}</TableCell>
                    <TableCell className="text-right">{money(r.avg_market_rent)}</TableCell>
                    <TableCell className="text-right">{money(r.avg_lease_rent)}</TableCell>
                    <TableCell className="text-right">{pct(r.loss_to_lease_pct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {s.expirations.some((e) => e.count > 0) || s.expired_or_mtm > 0 ? (
        <>
          <SubHeading>Lease expirations{s.as_of ? ` from ${s.as_of}` : ""}</SubHeading>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 text-xs tabular-nums">
            <div className="rounded border border-hairline px-1.5 py-1">
              <div className="text-[10px] text-muted-foreground">Expired / MTM</div>
              <div className={cn(s.expired_or_mtm > 0 && "text-amber-700 dark:text-amber-400 font-medium")}>{s.expired_or_mtm}</div>
            </div>
            {s.expirations.map((e) => (
              <div key={e.month} className="rounded border border-hairline px-1.5 py-1">
                <div className="text-[10px] text-muted-foreground">{monthLabel(e.month)}</div>
                <div>{e.count}</div>
              </div>
            ))}
            <div className="rounded border border-hairline px-1.5 py-1">
              <div className="text-[10px] text-muted-foreground">Later</div>
              <div>{s.expiring_later}</div>
            </div>
          </div>
          {s.no_lease_end > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">{s.no_lease_end} occupied units show no lease end date.</p>
          )}
        </>
      ) : null}

      {s.other_income_monthly.length > 0 && (
        <>
          <SubHeading>Other income (monthly, by charge code)</SubHeading>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {s.other_income_monthly.map((c) => (
              <span key={c.code} className="rounded border border-hairline px-2 py-0.5 tabular-nums">
                {c.code} <span className="text-muted-foreground">{money(c.monthly_total)}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function T12View({ s, unitCount }: { s: T12Summary; unitCount: number | null }) {
  const income = s.total_income;
  const order = (c: string) => Object.keys(CATEGORY_LABEL).indexOf(c);
  const rows = [...s.categories].sort((a, b) => order(a.category) - order(b.category));
  const hasT3 = rows.some((r) => isNum(r.t3_annualized));
  return (
    <div>
      {s.period && <p className="text-xs text-muted-foreground">Period: {s.period}</p>}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">T12</TableHead>
              {hasT3 && <TableHead className="text-right">T3 annualized</TableHead>}
              {unitCount ? <TableHead className="text-right">Per unit</TableHead> : null}
              <TableHead className="text-right">% of income</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.category}
                title={r.lines.join(", ")}
                className={cn(
                  "text-xs tabular-nums",
                  TOTAL_ROWS.has(r.category) && "font-semibold",
                  r.category === "below_noi" && "text-muted-foreground",
                )}
              >
                <TableCell>{CATEGORY_LABEL[r.category] ?? r.category}</TableCell>
                <TableCell className="text-right">{money(r.annual)}</TableCell>
                {hasT3 && (
                  <TableCell className="text-right">
                    {money(r.t3_annualized)}
                    <T3Delta annual={r.annual} t3={r.t3_annualized} />
                  </TableCell>
                )}
                {unitCount ? (
                  <TableCell className="text-right">{isNum(r.annual) ? money(r.annual / unitCount) : "—"}</TableCell>
                ) : null}
                <TableCell className="text-right">
                  {isNum(r.annual) && isNum(income) && income !== 0 && r.category !== "total_income"
                    ? pct((Math.abs(r.annual) / income) * 100)
                    : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {hasT3 && isNum(s.noi) && isNum(s.t3_noi) && (
        <p className="text-[11px] text-muted-foreground mt-1">
          T3 annualized = the last three months × 4: the current run rate, which the twelve-month total smooths over.
        </p>
      )}
    </div>
  );
}

/** Show the T3 run rate's direction against the T12 when it moves more than 3%. */
function T3Delta({ annual, t3 }: { annual: number | null; t3: number | null }) {
  // Only on positive lines: a percentage change in a negative (vacancy, concessions) reads backwards.
  if (!isNum(annual) || !isNum(t3) || annual <= 0) return null;
  const d = ((t3 - annual) / Math.abs(annual)) * 100;
  if (Math.abs(d) < 3) return null;
  return <span className="ml-1 text-[10px] text-muted-foreground">{d > 0 ? "+" : ""}{d.toFixed(0)}%</span>;
}

function OmView({ s }: { s: OmSummary }) {
  return (
    <div>
      {s.facts.length > 0 && (
        <>
          <SubHeading>Property facts</SubHeading>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
            {s.facts.map((f, i) => (
              <div key={i} className="flex gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">{f.label}</dt>
                <dd className="truncate" title={f.value}>
                  {f.value}
                  {f.page !== null && <span className="text-muted-foreground"> · p.{f.page}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {s.metrics.length > 0 && (
        <>
          <SubHeading>Financials in the OM</SubHeading>
          <div className="overflow-x-auto">
            <Table>
              <TableBody>
                {s.metrics.map((m, i) => (
                  <TableRow key={i} className="text-xs">
                    <TableCell>{m.label}</TableCell>
                    <TableCell className="tabular-nums">{m.value}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          m.basis === "pro_forma" && "border-amber-500/50 text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {m.basis === "in_place" ? "In-place" : m.basis === "pro_forma" ? "Broker pro forma" : "Other"}
                      </Badge>
                      {m.page !== null && <span className="ml-1.5 text-muted-foreground">p.{m.page}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {s.amenities.length > 0 && (
        <>
          <SubHeading>Amenities</SubHeading>
          <div className="flex flex-wrap gap-1">
            {s.amenities.map((a, i) => (
              <span key={i} className="rounded border border-hairline px-1.5 py-0.5 text-[11px]">{a}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
