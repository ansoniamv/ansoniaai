/**
 * Internal pipeline tearsheet. The same branded sheet as the capital-partner
 * one (PartnerTearsheetPage), for the team: no partner, deals grouped by stage,
 * internal columns allowed, and marked internal in the masthead, a banner and
 * the footer so a printed copy cannot be mistaken for a client sheet.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useDeals } from "@/hooks/useDeals";
import { businessPlanLabel, fmtMoneyM, marketLabel } from "@/lib/partnerPipelineFit";
import {
  MAX_TEARSHEET_DEALS,
  readTearsheetPayload,
  sweepTearsheetPayloads,
} from "@/lib/tearsheetPayload";
import {
  INTERNAL_BANNER,
  INTERNAL_FOOTER,
  brokerLabel,
  cfoLabel,
  groupByStage,
  internalTotals,
  isOffMarket,
  scoreLabel,
  summaryNote,
} from "@/lib/internalTearsheet";

const NAVY = "#002752";
const LIGHT = "#6AA3D8";
const INK = "#1A1F2B";
const SLATE = "#5B6472";
const HAIRLINE = "#E4E7EC";
const AMBER = "#B7791F";

const COLS: Array<[string, string, boolean]> = [
  ["Property & market", "25%", false],
  ["Units", "6%", true],
  ["Vintage", "7%", true],
  ["Business plan", "10%", false],
  ["Total cap.", "9%", true],
  ["Equity req.", "9%", true],
  ["CFO", "9%", true],
  ["AI score", "7%", true],
  ["Broker", "18%", false],
];

export default function InternalTearsheetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: deals, isLoading } = useDeals();

  const token = params.get("s");
  const payload = useMemo(() => {
    sweepTearsheetPayloads();
    return readTearsheetPayload(token);
  }, [token]);

  const selected = useMemo(() => {
    const ids = new Set((payload?.dealIds ?? []).slice(0, MAX_TEARSHEET_DEALS));
    return (deals ?? []).filter((d) => ids.has(d.id));
  }, [deals, payload]);

  const groups = useMemo(() => groupByStage(selected), [selected]);
  const totals = useMemo(() => internalTotals(selected), [selected]);
  const preparedBy = profile?.full_name || profile?.email || "Ansonia Properties";
  const stamp = format(new Date(), "yyyy-MM-dd");

  // Chrome uses document.title as the default "Save as PDF" filename.
  useEffect(() => {
    const prev = document.title;
    document.title = `Ansonia — INTERNAL Pipeline — ${stamp}`;
    return () => {
      document.title = prev;
    };
  }, [stamp]);

  const [downloading, setDownloading] = useState(false);
  const handleDownloadPdf = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const [{ pdf }, { InternalTearsheetDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/internalTearsheetPdf"),
      ]);
      const blob = await pdf(
        <InternalTearsheetDocument groups={groups} totals={totals} preparedBy={preparedBy} />,
      ).toBlob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `Ansonia — INTERNAL Pipeline — ${stamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      toast.error(`Could not build the PDF: ${(e as Error).message}`);
    } finally {
      setDownloading(false);
    }
  };

  if (!payload) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm rounded-sm border bg-white p-6 text-center" style={{ borderColor: HAIRLINE }}>
          <p className="text-sm" style={{ color: INK }}>This preview link has expired.</p>
          <p className="mt-1 text-xs" style={{ color: SLATE }}>
            Open Export Pipeline again to regenerate the tearsheet.
          </p>
          <Button className="mt-4" size="sm" onClick={() => navigate("/pipeline")}>
            Back to pipeline
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-10 text-sm" style={{ color: SLATE }}>Preparing tearsheet…</div>;
  }

  return (
    <div style={{ background: "#F1F3F6", minHeight: "100vh" }}>
      <div
        className="no-print sticky top-0 z-10 flex items-center gap-2 border-b px-4 py-2"
        style={{ background: "#fff", borderColor: HAIRLINE }}
      >
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={handleDownloadPdf} disabled={downloading}>
          {downloading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          {downloading ? "Building PDF…" : "Download PDF"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> Print / Save as PDF
        </Button>
      </div>

      <div className="tearsheet mx-auto max-w-[8.5in] px-4 py-6 print:p-0">
        <section className="bg-white px-[0.45in] pt-[0.5in] shadow-sm print:shadow-none" style={{ color: INK }}>
          {/* Masthead */}
          <div className="masthead flex items-end justify-between" style={{ gap: 28, paddingBottom: 14 }}>
            <img
              src="/ansonia-logo-preview.png"
              alt="Ansonia"
              className="block h-auto"
              style={{ width: "1.65in" }}
            />
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-[0.18em]" style={{ color: SLATE, fontWeight: 500 }}>
                Internal · Investment Pipeline
              </div>
              <div
                className="font-display"
                style={{ fontSize: 21, color: NAVY, fontWeight: 500, lineHeight: 1.2, letterSpacing: "-0.005em" }}
              >
                Ansonia Properties
              </div>
              <div className="text-[10px] mt-1" style={{ color: SLATE }}>
                Prepared by {preparedBy} · {format(new Date(), "MMMM d, yyyy")}
              </div>
            </div>
          </div>
          <div style={{ borderTop: `2px solid ${NAVY}` }} />

          {/* Internal banner */}
          <div
            className="mt-2 text-center uppercase"
            style={{
              background: NAVY,
              color: "#fff",
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.2em",
              padding: "5px 8px",
            }}
          >
            {INTERNAL_BANNER}
          </div>

          {/* Summary strip */}
          <div className="summary-strip mt-4 grid grid-cols-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            {[
              { label: "Deals", value: String(totals.count) },
              { label: "Total units", value: totals.units ? totals.units.toLocaleString() : "—" },
              { label: "Total cap.", value: fmtMoneyM(totals.totalCap || null) },
              { label: "Equity required", value: fmtMoneyM(totals.equity || null) },
            ].map((s, i) => {
              const m = /^(.*?)([A-Za-z]+)$/.exec(s.value);
              const figure = m ? m[1] : s.value;
              const unit = m ? m[2] : "";
              return (
                <div
                  key={s.label}
                  className="px-3 py-2.5"
                  style={{ borderLeft: i === 0 ? undefined : `1px solid ${HAIRLINE}` }}
                >
                  <div className="text-[8.5px] uppercase tracking-[0.14em]" style={{ color: SLATE }}>
                    {s.label}
                  </div>
                  <div
                    className="font-display tabular-nums"
                    style={{ fontSize: 22, color: NAVY, fontWeight: 500, lineHeight: 1.2 }}
                  >
                    {figure}
                    {unit && <span style={{ fontSize: 9.5, color: SLATE, fontWeight: 500 }}>{unit}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {summaryNote(totals) && (
            <div className="mt-2 text-[8.5px]" style={{ color: SLATE }}>
              {summaryNote(totals)}
            </div>
          )}

          {/* Table */}
          <table className="pipeline mt-5">
            <colgroup>
              {COLS.map(([label, width]) => (
                <col key={label} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {COLS.map(([label, , num]) => (
                  <th key={label} className={num ? "num" : undefined}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ stage, deals: rows }) => (
                <StageRows key={stage} stage={stage} rows={rows} />
              ))}
              {!groups.length && (
                <tr>
                  <td colSpan={COLS.length} className="py-6 text-center text-[11px]" style={{ color: SLATE }}>
                    No deals selected.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-6">
            <div
              className="flex items-center justify-between gap-4 border-t pt-2 text-[8px] uppercase tracking-[0.08em]"
              style={{ borderColor: HAIRLINE, color: SLATE }}
            >
              <span style={{ color: NAVY, fontWeight: 600 }}>{INTERNAL_FOOTER}</span>
              <span>Pipeline</span>
            </div>
            <div className="mt-2 -mx-[0.45in]" style={{ height: 9, background: LIGHT }} />
          </div>
        </section>
      </div>
    </div>
  );
}

function StageRows({ stage, rows }: { stage: string; rows: ReturnType<typeof groupByStage>[number]["deals"] }) {
  return (
    <>
      <tr className="band-group">
        <td
          colSpan={COLS.length}
          className="uppercase"
          style={{
            color: NAVY,
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: "0.15em",
            padding: "15px 8px 6px",
            borderBottom: `2px solid ${LIGHT}`,
          }}
        >
          {stage} — {rows.length} deal{rows.length === 1 ? "" : "s"}
        </td>
      </tr>
      {rows.map((d) => {
        const market = marketLabel(d);
        const sub = [market !== "—" ? market : null, d.property_address || null].filter(Boolean).join(" · ");
        const num = (v: React.ReactNode) => (v == null || v === "" ? "—" : v);
        return (
          <tr key={d.id}>
            <td className="prop">
              {d.property_name ?? "—"}
              {isOffMarket(d) && (
                <span
                  className="ml-1.5 uppercase"
                  style={{ color: AMBER, fontSize: 7.5, fontWeight: 600, letterSpacing: "0.08em", whiteSpace: "nowrap" }}
                >
                  Off-market
                </span>
              )}
              {sub && <small>{sub}</small>}
            </td>
            <td className="num">{num(d.unit_count)}</td>
            <td className="num">{num(d.vintage_year)}</td>
            <td>{businessPlanLabel(d)}</td>
            <td className="num">{fmtMoneyM(d.asking_price)}</td>
            <td className="num">{fmtMoneyM(d.estimated_equity)}</td>
            <td className="num" style={{ whiteSpace: "nowrap" }}>{cfoLabel(d)}</td>
            <td className="num">{scoreLabel(d)}</td>
            <td style={{ color: SLATE }}>{brokerLabel(d)}</td>
          </tr>
        );
      })}
    </>
  );
}
