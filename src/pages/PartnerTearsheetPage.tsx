/**
 * Client-facing pipeline tearsheet. Renders OUTSIDE AppLayout — no sidebar,
 * no topbar. Print-first: Ctrl+P produces a clean 2-page letter PDF.
 *
 * Field allow-list only. Nothing internal (warmth, AI scores, notes, broker,
 * underwriting, other partners) may be rendered here.
 */
import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useDeals } from "@/hooks/useDeals";
import { useAllDealNotes } from "@/hooks/useAllDealNotes";
import { usePartner, usePartnerContacts } from "@/hooks/usePartners";
import { useLogPipelineExport } from "@/hooks/usePipelineExports";
import { getStatus } from "@/lib/dealStatus";
import { criteriaRows } from "@/lib/partnerCriteria";
import {
  MAX_TEARSHEET_DEALS,
  readTearsheetPayload,
  sweepTearsheetPayloads,
} from "@/lib/tearsheetPayload";

import {
  BAND_TITLES,
  businessPlanLabel,
  fmtMoneyM,
  marketLabel,
  rankDealsForPartner,
  type BandKey,
  type DealFit,
} from "@/lib/partnerPipelineFit";

const NAVY = "#002752";
const LIGHT = "#6AA3D8";
const LIGHT_TINT = "#DCEAF7";
const CALLOUT_TINT = "#F1F7FC";
const INK = "#1A1F2B";
const SLATE = "#5B6472";
const HAIRLINE = "#E4E7EC";
const GRIDLINE = "#EFF1F4";
const QUIET = "#F4F5F7";
const WRITE_IN = "#FCFCFD";

const NOT_ON_FILE = "Not on file";

const BAND_ORDER: BandKey[] = ["strong", "moderate", "unrated", "outside"];

/** Linear lockup: symbol + ANSONIA wordmark. NOT the .asset.json icon, which is symbol-only. */
function Lockup() {
  return (
    <img
      src="/ansonia-logo-preview.png"
      alt="Ansonia"
      className="block h-auto"
      style={{ width: "1.65in" }}
    />
  );
}

/** Short band label for the Fit column — the full sentence lives in the Why column. */
const FIT_CHIP_LABEL: Record<BandKey, string> = {
  strong: "Strong",
  moderate: "Worth a look",
  weak: "Worth a look",
  outside: "Outside",
  unrated: "Not yet sized",
};

function chipStyle(band: BandKey): React.CSSProperties {
  if (band === "strong") return { background: NAVY, color: "#FFFFFF" };
  if (band === "moderate") return { background: LIGHT_TINT, color: NAVY };
  return { background: QUIET, color: SLATE };
}

function bandHeaderLabel(band: BandKey, n: number) {
  return `${BAND_TITLES[band]} — ${n} deal${n === 1 ? "" : "s"}`;
}

function FooterBar({ partnerName, page }: { partnerName: string; page: number }) {
  return (
    <div className="mt-6">
      <div
        className="flex items-center justify-between gap-4 border-t pt-2 text-[8px] uppercase tracking-[0.08em]"
        style={{ borderColor: HAIRLINE, color: SLATE }}
      >
        <span>Ansonia Properties · Confidential — prepared for {partnerName}</span>
        <span>Not an offer to sell securities · Page {page} of 2</span>
      </div>
      <div className="mt-2 -mx-[0.55in]" style={{ height: 9, background: LIGHT }} />
    </div>
  );
}


export default function PartnerTearsheetPage() {
  const { partnerId } = useParams<{ partnerId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const { data: partner, isLoading: partnerLoading } = usePartner(partnerId);
  const { data: deals, isLoading: dealsLoading } = useDeals();
  const { data: notesByDeal } = useAllDealNotes();
  const { data: contacts } = usePartnerContacts(partnerId);
  const logExport = useLogPipelineExport();

  // Selection travels via localStorage token — never in the URL (edge URL-length limits).
  const token = params.get("s");
  const payload = useMemo(() => {
    sweepTearsheetPayloads();
    return readTearsheetPayload(token);
  }, [token]);
  const expired = !payload;

  const includeScore = !!payload?.showScore;
  const includeOutside = payload?.includeOutside !== false;
  const dealIds = useMemo(
    () => (payload?.dealIds ?? []).slice(0, MAX_TEARSHEET_DEALS),
    [payload],
  );


  const selectedDeals = useMemo(() => {
    const all = deals ?? [];
    if (!dealIds.length) return [];
    const set = new Set(dealIds);
    return all.filter((d) => set.has(d.id));
  }, [deals, dealIds]);

  const pipeline = useMemo(() => {
    if (!partner) return null;
    return rankDealsForPartner(partner as any, selectedDeals, (notesByDeal as any) ?? {});
  }, [partner, selectedDeals, notesByDeal]);

  const bands = useMemo(
    () =>
      BAND_ORDER.filter((b) => (b === "outside" ? includeOutside : true))
        .map((b) => ({
          band: b,
          // "Lower priority" is not its own band on a client sheet — it rides with "Worth a look".
          fits: b === "moderate"
            ? [...(pipeline?.moderate ?? []), ...(pipeline?.weak ?? [])]
            : pipeline?.[b] ?? [],
        }))
        .filter((g) => g.fits.length > 0),
    [pipeline, includeOutside],
  );

  const shown = useMemo(() => bands.flatMap((g) => g.fits), [bands]);

  const totals = useMemo(() => {
    const units = shown.reduce((s, f) => s + ((f.deal.unit_count as number | null) ?? 0), 0);
    const priced = shown.filter((f) => typeof f.deal.estimated_equity === "number");
    const equity = priced.reduce((s, f) => s + (f.deal.estimated_equity as number), 0);
    return {
      count: shown.length,
      strong: pipeline?.strong.length ?? 0,
      units,
      equity,
      unsized: shown.length - priced.length,
    };
  }, [shown, pipeline]);

  // Log the share exactly once per opened tearsheet.
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current || expired || !partnerId || !shown.length) return;
    logged.current = true;
    logExport.mutate({
      partner_id: partnerId,
      deal_ids: shown.map((f) => f.deal.id),
      
      included_outside: includeOutside,
      included_score: includeScore,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, shown.length, expired]);

  if (expired) {
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

  if (partnerLoading || dealsLoading) {
    return <div className="p-10 text-sm" style={{ color: SLATE }}>Preparing tearsheet…</div>;
  }

  if (!partner || !pipeline) {
    return <div className="p-10 text-sm" style={{ color: SLATE }}>Partner not found.</div>;
  }

  const preparedBy = profile?.full_name || profile?.email || "Ansonia Properties";


  const criteria = criteriaRows(partner);

  const Cell = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
    <td
      className={`px-2 py-[7px] align-top ${right ? "text-right tabular-nums" : ""}`}
      style={{ borderBottom: `1px solid ${GRIDLINE}`, color: INK }}
    >
      {children}
    </td>
  );

  return (
    <div style={{ background: "#F1F3F6", minHeight: "100vh" }}>
      {/* Action bar — screen only */}
      <div
        className="no-print sticky top-0 z-10 flex items-center gap-2 border-b px-4 py-2"
        style={{ background: "#fff", borderColor: HAIRLINE }}
      >
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> Print / Save as PDF
        </Button>
      </div>

      <div className="tearsheet mx-auto max-w-[8.5in] px-4 py-6 print:p-0">
        {/* ───────────────────────── Page 1 ───────────────────────── */}
        <section
          className="bg-white px-[0.55in] pt-[0.5in] shadow-sm print:shadow-none"
          style={{ color: INK }}
        >
          {/* Masthead */}
          <div className="flex items-end justify-between" style={{ gap: 28, paddingBottom: 14 }}>
            <Lockup />
            <div className="text-right">
              <div
                className="text-[9px] uppercase tracking-[0.18em]"
                style={{ color: SLATE, fontWeight: 500 }}
              >
                Investment Pipeline
              </div>
              <div
                className="font-display"
                style={{ fontSize: 21, color: NAVY, fontWeight: 500, lineHeight: 1.2, letterSpacing: "-0.005em" }}
              >
                {partner.name}
              </div>
              <div className="text-[10px] mt-1" style={{ color: SLATE }}>
                Prepared by {preparedBy} · {format(new Date(), "MMMM d, yyyy")}
              </div>
            </div>
          </div>
          <div style={{ borderTop: `2px solid ${NAVY}` }} />

          {/* Summary strip */}
          <div
            className="mt-4 grid grid-cols-4"
            style={{ borderBottom: `1px solid ${HAIRLINE}` }}
          >
            {[
              { label: "Deals shared", value: String(totals.count) },
              { label: "Strong fit for you", value: String(totals.strong) },
              { label: "Total units", value: totals.units ? totals.units.toLocaleString() : "—" },
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
                    {unit && (
                      <span style={{ fontSize: 9.5, color: SLATE, fontWeight: 500 }}>{unit}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>




          {/* Table */}
          <table className="pipeline mt-5">
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "6.5%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "8.5%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                {[
                  ["Property & market", false],
                  ["Units", true],
                  ["Vintage", true],
                  ["Business plan", false],
                  ["Total cap.", true],
                  ["Equity req.", true],
                  ["Stage", false],
                  ["Fit", false],
                  ["Why this fits you", false],
                ].map(([label, num]) => (
                  <th key={label as string} className={num ? "num" : undefined}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {bands.map(({ band, fits }) => (
                <BandGroup
                  key={band}
                  band={band}
                  fits={fits}
                  includeScore={includeScore}
                />
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-[11px]" style={{ color: SLATE }}>
                    No deals selected.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {totals.unsized > 0 && (
            <div className="mt-2 text-[8.5px]" style={{ color: SLATE }}>
              Equity total excludes {totals.unsized} deal{totals.unsized === 1 ? "" : "s"} we have
              not yet sized.
            </div>
          )}
          <div className="mt-1 text-[8.5px]" style={{ color: SLATE }}>
            Where a criterion is missing from your profile, it is flagged on page 2.
          </div>


          <FooterBar partnerName={partner.name} page={1} />
        </section>

        {/* ───────────────────────── Page 2 ───────────────────────── */}
        <section
          className="page-break mt-6 bg-white px-[0.55in] pt-[0.5in] shadow-sm print:mt-0 print:shadow-none"
          style={{ color: INK }}
        >
          <div className="flex items-end justify-between" style={{ gap: 28, paddingBottom: 14 }}>
            <Lockup />
            <div className="text-right">
              <div
                className="text-[9px] uppercase tracking-[0.18em]"
                style={{ color: SLATE, fontWeight: 500 }}
              >
                Investor criteria on file
              </div>
              <div
                className="font-display"
                style={{ fontSize: 21, color: NAVY, fontWeight: 500, lineHeight: 1.2, letterSpacing: "-0.005em" }}
              >
                {partner.name}
              </div>
              <div className="text-[10px] mt-1" style={{ color: SLATE }}>
                Last updated{" "}
                {partner.last_edited_at
                  ? format(new Date(partner.last_edited_at), "MMMM d, yyyy")
                  : format(new Date(), "MMMM d, yyyy")}
              </div>
            </div>
          </div>
          <div style={{ borderTop: `2px solid ${NAVY}` }} />

          <h2
            className="font-display mt-5"
            style={{ fontSize: 16, color: NAVY, fontWeight: 500 }}
          >
            Your investment criteria — as we have it on file
          </h2>
          <p
            className="mt-2"
            style={{
              fontFamily: '"Source Serif 4", Georgia, serif',
              fontSize: 11.5,
              padding: "11px 14px",
              background: CALLOUT_TINT,
              borderLeft: `3px solid ${LIGHT}`,
              color: INK,
            }}
          >
            Please mark up anything that is wrong or out of date and send it back — we use this to
            decide which deals reach you.
          </p>

          <table
            className="mt-4 w-full"
            style={{ fontSize: 10.5, borderCollapse: "collapse", tableLayout: "fixed" }}
          >
            <thead>
              <tr style={{ color: SLATE }}>
                {[
                  ["Field", "27%"],
                  ["As we have it on file", "46%"],
                  ["Correct? / update", "27%"],
                ].map(([label, width]) => (
                  <th
                    key={label}
                    style={{
                      width,
                      textAlign: "left",
                      padding: "0 8px 5px",
                      fontSize: 8,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      borderBottom: `1px solid ${NAVY}`,
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {criteria.map(([label, value]) => {
                const missing = value.startsWith(NOT_ON_FILE);
                return (
                  <tr key={label}>
                    <td
                      className="px-2 py-[7px] align-top uppercase"
                      style={{
                        borderBottom: `1px solid ${GRIDLINE}`,
                        color: SLATE,
                        fontSize: 8.5,
                        letterSpacing: "0.1em",
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </td>
                    <td
                      className="px-2 py-[7px] align-top"
                      style={{ borderBottom: `1px solid ${GRIDLINE}`, fontSize: 10.5, color: INK }}
                    >
                      {missing ? (
                        <span
                          className="inline-flex items-center gap-1.5"
                          style={{
                            background: LIGHT,
                            color: NAVY,
                            fontWeight: 700,
                            fontSize: 9.5,
                            padding: "2px 7px",
                            borderRadius: 2,
                          }}
                        >
                          {NOT_ON_FILE}
                          <span
                            className="tracking-[0.12em]"
                            style={{ background: NAVY, color: "#fff", fontSize: 8, padding: "0 4px", borderRadius: 2 }}
                          >
                            ASK
                          </span>
                        </span>
                      ) : (
                        value
                      )}
                    </td>
                    <td
                      style={{
                        borderBottom: `1px solid ${GRIDLINE}`,
                        borderLeft: `1px solid ${HAIRLINE}`,
                        background: WRITE_IN,
                      }}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3
            className="font-display mt-6"
            style={{ fontSize: 13, color: NAVY, fontWeight: 500 }}
          >
            Contacts on file
          </h3>
          <table
            className="mt-2 w-full"
            style={{ fontSize: 10, borderCollapse: "collapse", tableLayout: "fixed" }}
          >
            <thead>
              <tr style={{ color: SLATE }}>
                {[
                  ["Name", "17%"],
                  ["Role", "20%"],
                  ["Email", "25%"],
                  ["Phone", "15%"],
                  ["Correct?", "23%"],
                ].map(([h, width]) => (
                  <th
                    key={h}
                    style={{
                      width,
                      textAlign: "left",
                      padding: "0 8px 5px",
                      fontSize: 8,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      borderBottom: `1px solid ${NAVY}`,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(contacts ?? []).map((c) => (
                <tr key={c.id}>
                  <Cell>{c.name}</Cell>
                  <Cell>{c.role || "—"}</Cell>
                  <Cell>{c.email || "—"}</Cell>
                  <td
                    className="px-2 py-[7px] align-top tabular-nums"
                    style={{ borderBottom: `1px solid ${GRIDLINE}`, color: INK, whiteSpace: "nowrap" }}
                  >
                    {c.phone || "—"}
                  </td>
                  <td
                    style={{
                      borderBottom: `1px solid ${GRIDLINE}`,
                      borderLeft: `1px solid ${HAIRLINE}`,
                      background: WRITE_IN,
                    }}
                  />
                </tr>
              ))}
              {!(contacts ?? []).length && (
                <tr>
                  <td colSpan={5} className="px-2 py-3">
                    <span
                      style={{
                        background: LIGHT,
                        color: NAVY,
                        fontWeight: 700,
                        fontSize: 9.5,
                        padding: "2px 7px",
                        borderRadius: 2,
                      }}
                    >
                      {NOT_ON_FILE} — please add the right people
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div
            className="mt-6 pt-3 text-[10.5px]"
            style={{ color: INK, borderTop: `1px solid ${HAIRLINE}` }}
          >
            Your Ansonia contact: {partner.ansonia_poc || "—"}
          </div>
          <div className="mt-1 text-[9.5px]" style={{ color: SLATE }}>
            Send corrections to your Ansonia contact and we will update our records the same day.
          </div>

          <FooterBar partnerName={partner.name} page={2} />
        </section>
      </div>
    </div>
  );
}

function BandGroup({
  band,
  fits,
  includeScore,
}: {
  band: BandKey;
  fits: DealFit[];
  includeScore: boolean;
}) {
  const quiet = band === "unrated" || band === "outside";
  return (
    <>
      <tr className="band-group">
        <td
          colSpan={9}
          className="uppercase"
          style={{
            color: quiet ? SLATE : NAVY,
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: "0.15em",
            padding: "15px 8px 6px",
            borderBottom: quiet ? `1px solid ${HAIRLINE}` : `2px solid ${LIGHT}`,
          }}
        >
          {bandHeaderLabel(band, fits.length)}
        </td>
      </tr>
      {fits.map((f) => {
        const d = f.deal;
        const why = f.why ?? "";
        const i = why.search(/[;.]/);
        const head = i === -1 ? why : why.slice(0, i + 1);
        const tail = i === -1 ? "" : why.slice(i + 1);
        const market = marketLabel(d);
        const address = (d as { property_address?: string | null }).property_address;
        const sub = [market !== "—" ? market : null, address || null].filter(Boolean).join(" · ");
        const num = (v: React.ReactNode) => (v == null || v === "" ? "—" : v);
        return (
          <tr key={d.id}>
            <td className="prop">
              {d.property_name ?? "—"}
              {sub && <small>{sub}</small>}
            </td>
            <td className="num">{num((d.unit_count as number | null) ?? null)}</td>
            <td className="num">{num((d.vintage_year as number | null) ?? null)}</td>
            <td>{businessPlanLabel(d)}</td>
            <td className="num">{fmtMoneyM(d.asking_price as number | null)}</td>
            <td className="num">{fmtMoneyM(d.estimated_equity as number | null)}</td>
            <td
              className="uppercase"
              style={{ color: SLATE, fontSize: 8.5, letterSpacing: "0.08em" }}
            >
              {getStatus(d)}
            </td>
            <td>
              <span
                className="chip"
                style={{
                  ...chipStyle(band),
                  fontSize: 8.5,
                  fontWeight: 600,
                  padding: "2px 5px",
                  borderRadius: 2,
                }}
              >
                {FIT_CHIP_LABEL[band]}
                {includeScore ? ` ${f.score}` : ""}
              </span>
            </td>
            <td className="why">
              <b>{head}</b>
              {tail}
            </td>
          </tr>
        );
      })}
    </>
  );
}


