/**
 * The internal pipeline tearsheet as a real PDF. Same brand, fonts and layout
 * as the partner tearsheet (it reuses that file's styles and masthead), marked
 * internal in the masthead, a banner under it, and the footer of every page.
 */
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { format } from "date-fns";
import type { Deal } from "@/hooks/useDeals";
import { businessPlanLabel, fmtMoneyM, marketLabel } from "@/lib/partnerPipelineFit";
import {
  s,
  Masthead,
  NAVY,
  LIGHT,
  SLATE,
} from "@/lib/tearsheetPdf";
import {
  INTERNAL_BANNER,
  INTERNAL_FOOTER,
  brokerLabel,
  cfoLabel,
  isOffMarket,
  scoreLabel,
  summaryNote,
  type InternalTotals,
  type StageGroup,
} from "@/lib/internalTearsheet";

const INTERNAL_COLS = {
  prop: "25%",
  units: "6%",
  vintage: "7%",
  plan: "10%",
  cap: "9%",
  equity: "9%",
  cfo: "9%",
  score: "7%",
  broker: "18%",
} as const;

const dash = (v: React.ReactNode) => (v == null || v === "" ? "—" : v);

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={[s.footerText, { color: NAVY, fontWeight: 600 }]}>{INTERNAL_FOOTER}</Text>
      <Text
        style={s.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

export function InternalTearsheetDocument({
  groups,
  totals,
  preparedBy,
}: {
  groups: StageGroup[];
  totals: InternalTotals;
  preparedBy: string;
}) {
  const today = format(new Date(), "MMMM d, yyyy");
  return (
    <Document
      title={`Ansonia — Internal Pipeline — ${format(new Date(), "yyyy-MM-dd")}`}
      author="Ansonia Properties"
      subject="Internal Investment Pipeline"
    >
      <Page size="LETTER" orientation="portrait" style={s.page}>
        <Footer />

        <Masthead
          eyebrow="Internal · Investment Pipeline"
          partnerName="Ansonia Properties"
          meta={`Prepared by ${preparedBy} · ${today}`}
        />

        <View
          style={{
            marginTop: 8,
            backgroundColor: NAVY,
            paddingVertical: 4,
            paddingHorizontal: 8,
          }}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 7,
              fontWeight: 600,
              letterSpacing: 1.6,
              textTransform: "uppercase",
              textAlign: "center",
            }}
          >
            {INTERNAL_BANNER}
          </Text>
        </View>

        <View style={s.strip}>
          {[
            ["Deals", String(totals.count)],
            ["Total units", totals.units ? totals.units.toLocaleString() : "—"],
            ["Total cap.", fmtMoneyM(totals.totalCap || null)],
            ["Equity required", fmtMoneyM(totals.equity || null)],
          ].map(([label, value]) => (
            <View key={label} style={s.stripCell}>
              <Text style={s.stripLabel}>{label}</Text>
              <Text style={s.stripValue}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Up here, not after the table: a trailing note can spill onto a page of its own. */}
        {summaryNote(totals) && (
          <Text style={{ fontSize: 6.5, color: SLATE, marginTop: 5 }}>{summaryNote(totals)}</Text>
        )}

        <View style={s.thead} fixed>
          <Text style={[s.th, { width: INTERNAL_COLS.prop }]}>Property &amp; market</Text>
          <Text style={[s.th, { width: INTERNAL_COLS.units, textAlign: "right" }]}>Units</Text>
          <Text style={[s.th, { width: INTERNAL_COLS.vintage, textAlign: "right" }]}>Vintage</Text>
          <Text style={[s.th, { width: INTERNAL_COLS.plan }]}>Business plan</Text>
          <Text style={[s.th, { width: INTERNAL_COLS.cap, textAlign: "right" }]}>Total cap.</Text>
          <Text style={[s.th, { width: INTERNAL_COLS.equity, textAlign: "right" }]}>Equity req.</Text>
          <Text style={[s.th, { width: INTERNAL_COLS.cfo, textAlign: "right" }]}>CFO</Text>
          <Text style={[s.th, { width: INTERNAL_COLS.score, textAlign: "right" }]}>AI score</Text>
          <Text style={[s.th, { width: INTERNAL_COLS.broker }]}>Broker</Text>
        </View>

        {groups.map(({ stage, deals }) => (
          <View key={stage} wrap>
            <View
              style={[
                s.bandRow,
                { borderBottomWidth: 2, borderBottomColor: LIGHT, borderBottomStyle: "solid" },
              ]}
            >
              <Text style={[s.bandLabel, { color: NAVY }]}>
                {`${stage} — ${deals.length} deal${deals.length === 1 ? "" : "s"}`}
              </Text>
            </View>
            {deals.map((d: Deal) => {
              const market = marketLabel(d);
              const sub = [market !== "—" ? market : null, d.property_address || null]
                .filter(Boolean)
                .join(" · ");
              return (
                <View key={d.id} style={s.tr} wrap={false}>
                  <View style={{ width: INTERNAL_COLS.prop, paddingHorizontal: 5 }}>
                    {/* Separate blocks: inline, react-pdf breaks before the tag
                        and leaves a stray hyphen on the name ("Living-"). */}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline" }}>
                      <Text style={[s.propName, { marginRight: 4 }]}>{d.property_name ?? "—"}</Text>
                      {isOffMarket(d) ? (
                        <Text style={{ fontSize: 6, color: "#B7791F", fontWeight: 600 }}>OFF-MARKET</Text>
                      ) : null}
                    </View>
                    {!!sub && <Text style={s.propSub}>{sub}</Text>}
                  </View>
                  <Text style={[s.tdNum, { width: INTERNAL_COLS.units }]}>{dash(d.unit_count)}</Text>
                  <Text style={[s.tdNum, { width: INTERNAL_COLS.vintage }]}>{dash(d.vintage_year)}</Text>
                  <Text style={[s.td, { width: INTERNAL_COLS.plan }]}>{businessPlanLabel(d)}</Text>
                  <Text style={[s.tdNum, { width: INTERNAL_COLS.cap }]}>{fmtMoneyM(d.asking_price)}</Text>
                  <Text style={[s.tdNum, { width: INTERNAL_COLS.equity }]}>
                    {fmtMoneyM(d.estimated_equity)}
                  </Text>
                  <Text style={[s.tdNum, { width: INTERNAL_COLS.cfo }]}>{cfoLabel(d)}</Text>
                  <Text style={[s.tdNum, { width: INTERNAL_COLS.score }]}>{scoreLabel(d)}</Text>
                  <Text style={[s.td, { width: INTERNAL_COLS.broker, color: SLATE }]}>
                    {brokerLabel(d)}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}

        {!groups.length && (
          <View style={{ paddingVertical: 24 }}>
            <Text style={{ fontSize: 8.5, color: SLATE, textAlign: "center" }}>No deals selected.</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}
