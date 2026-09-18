/**
 * The partner tearsheet as a real PDF.
 *
 * Reproduces the two sections of PartnerTearsheetPage — the pipeline page and
 * the investor-criteria page — using @react-pdf primitives. A generated PDF
 * carries no browser header/footer chrome and cannot be re-flowed by the
 * recipient, which is the point of having it alongside the print path.
 *
 * ALLOW-LIST, same rule as the HTML sheet: this document goes to an outside
 * capital partner. It renders only what that partner may see. Nothing internal
 * appears — no Ansonia contact name, no "send corrections to your contact"
 * line, no relationship warmth, no AI fit scores or tiers, no internal notes,
 * no broker identity, no underwriting, and no mention of other partners. The
 * `why` sentence on each deal is the client-safe string built from structured
 * pillars by partnerPipelineFit, never from match reasons or misses.
 */
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { format } from "date-fns";
import type { Deal } from "@/hooks/useDeals";
import {
  BAND_TITLES,
  fmtMoneyM,
  businessPlanLabel,
  marketLabel,
  type BandKey,
  type DealFit,
} from "@/lib/partnerPipelineFit";
import { getStatus } from "@/lib/dealStatus";

/**
 * Brand faces, self-hosted as STATIC TTF instances under public/fonts.
 *
 * Three things make this fiddly, and all three are load-bearing:
 *  - react-pdf cannot read woff2, which is what fonts.googleapis.com serves a
 *    modern browser. The @import in index.css does nothing for this document.
 *  - These must be static instances, not the variable TTF. fontkit renders a
 *    variable font at its default instance, so registering "600" against a
 *    variable file silently yields 400.
 *  - They are served from our own origin. A gstatic URL would make every PDF
 *    render depend on a third-party fetch at the moment the user clicks.
 */
Font.register({
  family: "Inter",
  fonts: [
    { src: "/fonts/Inter-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/Inter-SemiBold.ttf", fontWeight: 600 },
  ],
});
Font.register({
  family: "Inter Tight",
  fonts: [{ src: "/fonts/InterTight-Medium.ttf", fontWeight: 500 }],
});
Font.register({
  family: "Source Serif 4",
  fonts: [{ src: "/fonts/SourceSerif4-Regular.ttf", fontWeight: 400 }],
});

/**
 * No hyphenation. The HTML sheet sets `hyphens: none` for the same reason — a
 * broken "UNDER-WRITING" in a stage cell is the defect this whole layout pass
 * was about, and react-pdf hyphenates by default.
 */
Font.registerHyphenationCallback((word) => [word]);

// Exactly the constants the HTML sheet uses.
const NAVY = "#002752";
const LIGHT = "#6AA3D8";
const LIGHT_TINT = "#DCEAF7";
const CALLOUT_TINT = "#F1F7FC";
const INK = "#1A1F2B";
const SLATE = "#5B6472";
const HAIRLINE = "#E4E7EC";
const GRIDLINE = "#EFF1F4";

/** Client-facing stage wording, mirroring the HTML sheet. */
const STAGE_LABEL: Record<string, string> = {
  "New": "New",
  "Screening": "Screening",
  "On Hold/Tracking": "On hold",
  "Underwriting": "Underwriting",
  "B&F": "B&F",
  "Under Contract": "Under contract",
  "Pass": "Passed",
};

/**
 * The same column plan as the HTML table, as flex weights. react-pdf has no
 * colgroup, so the percentages become flexBasis on each cell.
 */
const COLS = {
  prop: "24%",
  units: "5.5%",
  vintage: "7.5%",
  plan: "9%",
  cap: "10%",
  equity: "10%",
  stage: "12%",
  why: "22%",
} as const;

const s = StyleSheet.create({
  page: {
    paddingTop: "0.5in",
    paddingHorizontal: "0.45in",
    paddingBottom: "0.4in",
    fontSize: 8.5,
    color: INK,
    fontFamily: "Inter",
  },

  masthead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingBottom: 14 },
  logo: { width: "1.65in" },
  mastRight: { textAlign: "right" },
  // The HTML sheet asks for 500 here, but only 400 and 600 are registered for
  // Inter. Naming 600 beats writing 500 and letting react-pdf pick for us.
  eyebrow: { fontSize: 6.5, color: SLATE, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 600 },
  partnerName: { fontSize: 15.75, color: NAVY, marginTop: 3, fontFamily: "Inter Tight", fontWeight: 500 },
  mastMeta: { fontSize: 7.5, color: SLATE, marginTop: 3 },
  navyRule: { borderTopWidth: 2, borderTopColor: NAVY, borderTopStyle: "solid" },

  strip: { flexDirection: "row", marginTop: 12, borderBottomWidth: 1, borderBottomColor: HAIRLINE, borderBottomStyle: "solid" },
  stripCell: { flex: 1, paddingHorizontal: 8, paddingVertical: 6 },
  stripLabel: { fontSize: 6, color: SLATE, letterSpacing: 1, textTransform: "uppercase" },
  stripValue: { fontSize: 16.5, color: NAVY, marginTop: 2, fontFamily: "Inter Tight", fontWeight: 500 },

  intro: { fontSize: 8, color: SLATE, marginTop: 10, lineHeight: 1.45 },

  thead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    borderBottomStyle: "solid",
    marginTop: 14,
    paddingTop: 10,
    paddingBottom: 7,
  },
  th: { fontSize: 6, color: SLATE, letterSpacing: 0.9, textTransform: "uppercase", paddingHorizontal: 5, fontWeight: 600 },

  bandRow: { paddingTop: 13, paddingBottom: 5, paddingHorizontal: 5 },
  bandLabel: { fontSize: 6.5, letterSpacing: 1.6, textTransform: "uppercase", fontWeight: 600 },

  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: GRIDLINE,
    borderBottomStyle: "solid",
    paddingVertical: 7,
  },
  td: { paddingHorizontal: 5, fontSize: 8 },
  tdNum: { paddingHorizontal: 5, fontSize: 8, textAlign: "right" },
  propName: { fontSize: 8.5, color: INK },
  propSub: { fontSize: 6.5, color: SLATE, marginTop: 1.5 },
  stage: { fontSize: 6.5, color: SLATE, letterSpacing: 0.35, textTransform: "uppercase", paddingHorizontal: 5 },
  whyHead: { fontSize: 7.5, fontWeight: 600 },

  h2: { fontSize: 12, color: NAVY, marginTop: 14, fontFamily: "Inter Tight", fontWeight: 500 },
  callout: {
    marginTop: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: CALLOUT_TINT,
    borderLeftWidth: 3,
    borderLeftColor: LIGHT,
    borderLeftStyle: "solid",
    fontSize: 9,
    lineHeight: 1.4,
    // The one serif on the sheet, and the reason Source Serif 4 is registered.
    fontFamily: "Source Serif 4",
  },

  critHead: { flexDirection: "row", marginTop: 14, borderBottomWidth: 1, borderBottomColor: NAVY, borderBottomStyle: "solid", paddingBottom: 5 },
  critRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: GRIDLINE, borderBottomStyle: "solid", paddingVertical: 7 },
  critLabel: { width: "27%", paddingHorizontal: 8, fontSize: 8, color: SLATE, fontWeight: 600 },
  critValue: { width: "46%", paddingHorizontal: 8, fontSize: 8.5 },
  critBlank: { width: "27%", paddingHorizontal: 8 },
  blankRule: { borderBottomWidth: 1, borderBottomColor: HAIRLINE, borderBottomStyle: "dashed", height: 9 },
  missing: { color: SLATE, fontSize: 8 },

  contactHead: { fontSize: 6, color: SLATE, letterSpacing: 1, textTransform: "uppercase", marginTop: 16, fontWeight: 600 },
  contactRow: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: GRIDLINE, borderBottomStyle: "solid" },

  footer: {
    position: "absolute",
    bottom: "0.22in",
    left: "0.45in",
    right: "0.45in",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    borderTopStyle: "solid",
    paddingTop: 5,
  },
  footerText: { fontSize: 6, color: SLATE, letterSpacing: 0.7, textTransform: "uppercase" },
});

export type TearsheetTotals = {
  count: number;
  strong: number;
  units: number;
  equity: number;
  unsized: number;
};

export type TearsheetContact = {
  id: string;
  name: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type TearsheetBand = { band: BandKey; fits: DealFit[] };

/**
 * The footer is `fixed`, so it repeats on every page, and the page numbers come
 * from the render callback — the real total, not a hardcoded "of 2" that goes
 * wrong the moment the table spills onto a third sheet.
 */
function Footer({ partnerName }: { partnerName: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>
        Ansonia Properties · Confidential — prepared for {partnerName}
      </Text>
      <Text
        style={s.footerText}
        render={({ pageNumber, totalPages }) =>
          `Not an offer to sell securities · Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}

function Masthead({
  eyebrow,
  partnerName,
  meta,
}: {
  eyebrow: string;
  partnerName: string;
  meta: string;
}) {
  return (
    <>
      <View style={s.masthead}>
        {/* The lockup is used unmodified, at the same 1.65in as the HTML sheet. */}
        <Image src="/ansonia-logo-preview.png" style={s.logo} />
        <View style={s.mastRight}>
          <Text style={s.eyebrow}>{eyebrow}</Text>
          <Text style={s.partnerName}>{partnerName}</Text>
          <Text style={s.mastMeta}>{meta}</Text>
        </View>
      </View>
      <View style={s.navyRule} />
    </>
  );
}

const dash = (v: React.ReactNode) => (v == null || v === "" ? "—" : v);

export function TearsheetDocument({
  partner,
  bands,
  criteria,
  contacts,
  totals,
  preparedBy,
  includeOutside,
}: {
  partner: { name: string; last_edited_at?: string | null };
  bands: TearsheetBand[];
  criteria: Array<[string, string | null]>;
  contacts: TearsheetContact[];
  totals: TearsheetTotals;
  preparedBy: string;
  includeOutside: boolean;
}) {
  const today = format(new Date(), "MMMM d, yyyy");
  const shownBands = bands.filter((b) => (b.band === "outside" ? includeOutside : true));
  const anyDeals = shownBands.some((b) => b.fits.length > 0);

  return (
    <Document
      title={`Ansonia — ${partner.name} — Investment Pipeline — ${format(new Date(), "yyyy-MM-dd")}`}
      author="Ansonia Properties"
      subject="Investment Pipeline"
    >
      {/* ---- Page 1: the pipeline ---- */}
      <Page size="LETTER" orientation="portrait" style={s.page}>
        <Footer partnerName={partner.name} />

        <Masthead
          eyebrow="Investment Pipeline"
          partnerName={partner.name}
          meta={`Prepared by ${preparedBy} · ${today}`}
        />

        <View style={s.strip}>
          {[
            ["Deals shared", String(totals.count)],
            ["Strong fit for you", String(totals.strong)],
            ["Total units", totals.units ? totals.units.toLocaleString() : "—"],
            ["Equity required", fmtMoneyM(totals.equity || null)],
          ].map(([label, value]) => (
            <View key={label} style={s.stripCell}>
              <Text style={s.stripLabel}>{label}</Text>
              <Text style={s.stripValue}>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={s.intro}>
          The deals below are the ones in our current pipeline that fit the criteria we hold for
          you. Where a criterion is missing from your profile, it is flagged on the investor
          criteria page.
        </Text>

        {/* fixed: the header row repeats on every page the table spills onto. */}
        <View style={s.thead} fixed>
          <Text style={[s.th, { width: COLS.prop }]}>Property &amp; market</Text>
          <Text style={[s.th, { width: COLS.units, textAlign: "right" }]}>Units</Text>
          <Text style={[s.th, { width: COLS.vintage, textAlign: "right" }]}>Vintage</Text>
          <Text style={[s.th, { width: COLS.plan }]}>Business plan</Text>
          <Text style={[s.th, { width: COLS.cap, textAlign: "right" }]}>Total cap.</Text>
          <Text style={[s.th, { width: COLS.equity, textAlign: "right" }]}>Equity req.</Text>
          <Text style={[s.th, { width: COLS.stage }]}>Stage</Text>
          <Text style={[s.th, { width: COLS.why }]}>Why this fits you</Text>
        </View>

        {shownBands.map(({ band, fits }) => {
          if (!fits.length) return null;
          const quiet = band === "unrated" || band === "outside";
          return (
            <View key={band} wrap>
              <View
                style={[
                  s.bandRow,
                  {
                    borderBottomWidth: quiet ? 1 : 2,
                    borderBottomColor: quiet ? HAIRLINE : LIGHT,
                    borderBottomStyle: "solid",
                  },
                ]}
              >
                <Text style={[s.bandLabel, { color: quiet ? SLATE : NAVY }]}>
                  {`${BAND_TITLES[band]} — ${fits.length} deal${fits.length === 1 ? "" : "s"}`}
                </Text>
              </View>

              {fits.map((f) => {
                const d: Deal = f.deal;
                const why = f.why ?? "";
                const i = why.search(/[;.]/);
                const head = i === -1 ? why : why.slice(0, i + 1);
                const tail = i === -1 ? "" : why.slice(i + 1);
                const market = marketLabel(d);
                const address = (d as { property_address?: string | null }).property_address;
                const sub = [market !== "—" ? market : null, address || null]
                  .filter(Boolean)
                  .join(" · ");
                const status = getStatus(d);
                return (
                  <View key={d.id} style={s.tr} wrap={false}>
                    <View style={{ width: COLS.prop, paddingHorizontal: 5 }}>
                      <Text style={s.propName}>{d.property_name ?? "—"}</Text>
                      {!!sub && <Text style={s.propSub}>{sub}</Text>}
                    </View>
                    <Text style={[s.tdNum, { width: COLS.units }]}>
                      {dash((d.unit_count as number | null) ?? null)}
                    </Text>
                    <Text style={[s.tdNum, { width: COLS.vintage }]}>
                      {dash((d.vintage_year as number | null) ?? null)}
                    </Text>
                    <Text style={[s.td, { width: COLS.plan }]}>{businessPlanLabel(d)}</Text>
                    <Text style={[s.tdNum, { width: COLS.cap }]}>
                      {fmtMoneyM(d.asking_price as number | null)}
                    </Text>
                    <Text style={[s.tdNum, { width: COLS.equity }]}>
                      {fmtMoneyM(d.estimated_equity as number | null)}
                    </Text>
                    <Text style={[s.stage, { width: COLS.stage }]}>
                      {STAGE_LABEL[status] ?? status}
                    </Text>
                    <Text style={[s.td, { width: COLS.why }]}>
                      <Text style={s.whyHead}>{head}</Text>
                      {tail}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })}

        {!anyDeals && (
          <View style={{ paddingVertical: 24 }}>
            <Text style={{ fontSize: 8.5, color: SLATE, textAlign: "center" }}>
              No deals selected.
            </Text>
          </View>
        )}

        {totals.unsized > 0 && (
          <Text style={{ fontSize: 6.5, color: SLATE, marginTop: 6 }}>
            Equity total excludes {totals.unsized} deal
            {totals.unsized === 1 ? "" : "s"} we have not yet sized.
          </Text>
        )}
      </Page>

      {/* ---- Page 2: investor criteria on file ---- */}
      <Page size="LETTER" orientation="portrait" style={s.page}>
        <Footer partnerName={partner.name} />

        <Masthead
          eyebrow="Investor criteria on file"
          partnerName={partner.name}
          meta={`Last updated ${
            partner.last_edited_at
              ? format(new Date(partner.last_edited_at), "MMMM d, yyyy")
              : today
          }`}
        />

        <Text style={s.h2}>Your investment criteria — as we have it on file</Text>

        <Text style={s.callout}>
          Please mark up anything that is wrong or out of date and send it back — we use this to
          decide which deals reach you.
        </Text>

        <View style={s.critHead}>
          <Text style={[s.th, { width: "27%", paddingHorizontal: 8 }]}>Field</Text>
          <Text style={[s.th, { width: "46%", paddingHorizontal: 8 }]}>As we have it on file</Text>
          <Text style={[s.th, { width: "27%", paddingHorizontal: 8 }]}>Correct? / update</Text>
        </View>

        {criteria.map(([label, value]) => (
          <View key={label} style={s.critRow} wrap={false}>
            <Text style={s.critLabel}>{label}</Text>
            <Text style={s.critValue}>
              {value ? value : <Text style={s.missing}>Not on file — please add</Text>}
            </Text>
            <View style={s.critBlank}>
              <View style={s.blankRule} />
            </View>
          </View>
        ))}

        {contacts.length > 0 && (
          <>
            <Text style={s.contactHead}>Your team, as we have it</Text>
            {contacts.map((c) => (
              <View key={c.id} style={s.contactRow} wrap={false}>
                <Text style={{ width: "34%", paddingHorizontal: 8, fontSize: 8.5 }}>
                  {c.name ?? "—"}
                </Text>
                <Text style={{ width: "24%", paddingHorizontal: 8, fontSize: 8, color: SLATE }}>
                  {c.role ?? "—"}
                </Text>
                <Text style={{ width: "42%", paddingHorizontal: 8, fontSize: 8, color: SLATE }}>
                  {[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                </Text>
              </View>
            ))}
          </>
        )}
      </Page>
    </Document>
  );
}
