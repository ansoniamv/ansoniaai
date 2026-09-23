// src/components/PropertyResearchPanel.tsx
//
// Replaces the paused panel. The `const isPaused = true` hardcode is gone —
// availability now comes from property_research_settings.enabled, so the
// feature can be turned on and off without a deploy.

import { useEffect, useState } from "react";
import {
  Loader2, Globe, RefreshCw, ExternalLink, AlertTriangle,
  TrendingDown, TrendingUp, Minus, X,
} from "lucide-react";
import { safeExternalUrl } from "@/lib/safeUrl";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  usePropertyResearch, type PropertySnapshot, type ResearchDepth,
} from "@/hooks/usePropertyResearch";

const VERDICT_STYLES: Record<string, string> = {
  strong: "bg-green-500/15 text-green-400 border-green-500/30",
  possible: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  weak: "bg-red-500/15 text-red-400 border-red-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "text-green-400",
  medium: "text-amber-400",
  low: "text-red-400",
};

const FREQUENCY_STYLES: Record<string, string> = {
  dominant: "bg-red-500/15 text-red-400 border-red-500/30",
  repeated: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  isolated: "bg-muted text-muted-foreground border-border",
};

const SEVERITY_STYLES: Record<string, string> = {
  material: "bg-red-500/15 text-red-400 border-red-500/30",
  notable: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  informational: "bg-muted text-muted-foreground border-border",
};

const IMPACT_STYLES: Record<string, string> = {
  opportunity: "bg-green-500/15 text-green-400 border-green-500/30",
  risk: "bg-red-500/15 text-red-400 border-red-500/30",
  context: "bg-muted text-muted-foreground border-border",
};

const READ_STYLES: Record<string, string> = {
  pass: "text-green-400",
  fail: "text-red-400",
  unknown: "text-muted-foreground",
};

const TREND_ICON = {
  improving: TrendingUp,
  declining: TrendingDown,
  stable: Minus,
  unknown: Minus,
} as const;

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function Field({ label, value }: { label: string; value?: string }) {
  const v = value?.trim();
  if (!v || v.toLowerCase() === "unknown") {
    return (
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm mt-0.5 text-muted-foreground">—</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm mt-0.5">{v}</p>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">{title}</p>
        {count != null && (
          <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Pill({ text, className }: { text: string; className: string }) {
  return (
    <span className={`text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${className}`}>
      {text}
    </span>
  );
}

function SourceLink({ url }: { url?: string }) {
  const safe = url ? safeExternalUrl(url) : null;
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
    >
      {hostOf(url!)}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function PropertyResearchPanel({
  dealId,
  address,
  propertyName,
}: {
  dealId?: string;
  address: string | null;
  propertyName?: string | null;
}) {
  const research = usePropertyResearch();
  const [snapshot, setSnapshot] = useState<PropertySnapshot | null>(null);
  const [meta, setMeta] = useState<{ model: string | null; generated_at: string; cached: boolean; cost_usd: number | null } | null>(null);
  const [depth, setDepth] = useState<ResearchDepth>("standard");
  const [enabled, setEnabled] = useState<boolean | null>(null);

  // Availability + the most recent saved snapshot.
  useEffect(() => {
    let active = true;

    supabase.from("property_research_settings").select("enabled, default_depth").eq("id", 1).maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setEnabled(Boolean(data?.enabled));
        if (data?.default_depth) setDepth(data.default_depth as ResearchDepth);
      });

    if (dealId) {
      supabase.from("property_research")
        .select("snapshot, created_at, model, cost_usd")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
        .then(({ data }) => {
          if (!active || !data) return;
          setSnapshot(data.snapshot as PropertySnapshot);
          setMeta({
            model: data.model, generated_at: data.created_at,
            cached: true, cost_usd: data.cost_usd != null ? Number(data.cost_usd) : null,
          });
        });
    }

    return () => { active = false; };
  }, [dealId]);

  const run = async (force = false) => {
    const result = await research.mutateAsync({
      deal_id: dealId,
      address: address ?? undefined,
      property_name: propertyName ?? undefined,
      depth,
      force,
    });
    setSnapshot(result.snapshot);
    setMeta({
      model: result.model, generated_at: result.generated_at,
      cached: result.cached, cost_usd: result.cost_usd,
    });
  };

  const running = research.isPending;
  const canRun = enabled === true && !running && (!!address || !!propertyName);
  const TrendIcon = TREND_ICON[snapshot?.resident_sentiment?.sentiment_trend ?? "unknown"];

  return (
    <Card className="md:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            AI Property Research
          </CardTitle>

          <div className="flex items-center gap-2">
            {meta?.generated_at && (
              <span className="text-xs text-muted-foreground">
                {new Date(meta.generated_at).toLocaleString()}
                {meta.cost_usd != null && ` · $${meta.cost_usd.toFixed(2)}`}
              </span>
            )}

            <Select value={depth} onValueChange={(v) => setDepth(v as ResearchDepth)} disabled={running}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quick">Quick · ~1 min</SelectItem>
                <SelectItem value="standard">Standard · ~4 min</SelectItem>
                <SelectItem value="deep">Deep · ~10 min</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" onClick={() => run(!!snapshot)} disabled={!canRun}>
              {running
                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              {snapshot ? "Re-run research" : "Research with Claude"}
            </Button>

            {running && (
              <Button variant="ghost" size="sm" onClick={research.cancel} title="Cancel">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {enabled === false && (
          <Alert className="border-amber-500/30 bg-amber-500/10">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <AlertTitle className="text-sm font-semibold">Research is turned off</AlertTitle>
            <AlertDescription className="text-xs">
              An admin can enable it in research settings. Saved snapshots below remain visible.
            </AlertDescription>
          </Alert>
        )}

        {running && (
          <div className="border border-border rounded-md p-4 flex items-start gap-3">
            <Loader2 className="h-4 w-4 animate-spin mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Researching…</p>
              <p className="text-xs text-muted-foreground mt-0.5 break-words">
                {research.progress ?? "Working through public sources."}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">
                This runs in the background — you can navigate away and come back.
              </p>
            </div>
          </div>
        )}

        {!snapshot && !running && enabled !== false && (
          <p className="text-sm text-muted-foreground">
            Run research to pull public reviews, news, records, and submarket signals for this property.
          </p>
        )}

        {snapshot && (
          <div className="space-y-4">
            {/* Identity + verdict */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{snapshot.resolved.property_name}</p>
                <p className="text-xs text-muted-foreground">{snapshot.resolved.address}</p>
                <p className={`text-xs mt-1 ${CONFIDENCE_STYLES[snapshot.resolved.confidence]}`}>
                  {snapshot.resolved.confidence} confidence match
                </p>
                {snapshot.resolved.also_known_as?.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Also known as: {snapshot.resolved.also_known_as.join(", ")}
                  </p>
                )}
              </div>
              <Pill
                text={`Buybox: ${snapshot.buybox_fit.verdict}`}
                className={VERDICT_STYLES[snapshot.buybox_fit.verdict]}
              />
            </div>

            {snapshot.resolved.notes?.trim() && snapshot.resolved.notes !== "unknown" && (
              <Alert className="border-amber-500/30 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <AlertDescription className="text-xs">{snapshot.resolved.notes}</AlertDescription>
              </Alert>
            )}

            {/* Overlooked — the "what did we miss" section leads, because it is
                the only one that cannot be produced from the OM. */}
            {snapshot.overlooked?.length > 0 && (
              <Section title="What we may have missed" count={snapshot.overlooked.length}>
                <div className="space-y-3">
                  {snapshot.overlooked.map((o, i) => (
                    <div key={i} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Pill text={o.impact} className={IMPACT_STYLES[o.impact]} />
                          <p className="text-sm">{o.finding}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{o.why_it_matters}</p>
                      </div>
                      <SourceLink url={o.source_url} />
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Resident sentiment */}
            <Section title="Resident sentiment">
              <div className="flex items-center gap-2">
                <TrendIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground capitalize">
                  {snapshot.resident_sentiment.sentiment_trend} over the last 24 months
                </span>
              </div>
              <p className="text-sm">{snapshot.resident_sentiment.summary}</p>

              {snapshot.resident_sentiment.platforms?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {snapshot.resident_sentiment.platforms.map((p, i) => (
                    <div key={i} className="border border-border rounded px-2.5 py-1.5">
                      <p className="text-xs font-medium">{p.platform}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {p.rating} · {p.review_count} reviews
                      </p>
                      <SourceLink url={p.source_url} />
                    </div>
                  ))}
                </div>
              )}

              {snapshot.resident_sentiment.recurring_complaints?.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Recurring complaints</p>
                  {snapshot.resident_sentiment.recurring_complaints.map((c, i) => (
                    <div key={i} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Pill text={c.frequency} className={FREQUENCY_STYLES[c.frequency]} />
                          <p className="text-sm">{c.theme}</p>
                        </div>
                        {c.capex_implication && c.capex_implication !== "unknown" && (
                          <p className="text-xs text-muted-foreground mt-0.5">{c.capex_implication}</p>
                        )}
                      </div>
                      <SourceLink url={c.source_url} />
                    </div>
                  ))}
                </div>
              )}

              {snapshot.resident_sentiment.recurring_praise?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Praised: {snapshot.resident_sentiment.recurring_praise.join(" · ")}
                </p>
              )}

              <Field label="Management responsiveness" value={snapshot.resident_sentiment.management_responsiveness} />
            </Section>

            {/* Distress */}
            {snapshot.debt_and_distress?.signals?.length > 0 && (
              <Section title="Debt & distress signals" count={snapshot.debt_and_distress.signals.length}>
                <p className="text-sm">{snapshot.debt_and_distress.summary}</p>
                {snapshot.debt_and_distress.signals.map((s, i) => (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Pill text={s.severity} className={SEVERITY_STYLES[s.severity]} />
                        <p className="text-sm">{s.signal}</p>
                        <span className="text-xs text-muted-foreground">{s.date}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.detail}</p>
                    </div>
                    <SourceLink url={s.source_url} />
                  </div>
                ))}
              </Section>
            )}

            {/* Physical + rents */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Section title="Physical">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Year built" value={snapshot.physical.year_built} />
                  <Field label="Renovated" value={snapshot.physical.year_renovated} />
                  <Field label="Units" value={snapshot.physical.units} />
                  <Field label="Stories" value={snapshot.physical.stories} />
                  <Field label="Type" value={snapshot.physical.construction_type} />
                  <Field label="Sq ft" value={snapshot.physical.sqft_range} />
                </div>
              </Section>

              <Section title="Asking rents">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="1BR" value={snapshot.rents.one_bed_from} />
                  <Field label="2BR" value={snapshot.rents.two_bed_from} />
                  <Field label="3BR" value={snapshot.rents.three_bed_from} />
                </div>
                <Field label="Renovated premium" value={snapshot.rents.renovated_premium} />
                <Field label="Concessions" value={snapshot.rents.concessions} />
                <Field label="Vs. market" value={snapshot.rents.below_market_signal} />
              </Section>
            </div>

            {/* Ownership */}
            <Section title="Ownership & management">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Owner entity" value={snapshot.ownership.owner_entity} />
                <Field label="Sponsor" value={snapshot.ownership.parent_sponsor} />
                <Field label="Management" value={snapshot.ownership.management_company} />
                <Field label="Last trade" value={snapshot.ownership.acquired} />
              </div>
              <Field label="Seller signal" value={snapshot.ownership.hold_period_signal} />
              {snapshot.ownership.other_properties?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Same sponsor: {snapshot.ownership.other_properties.join(" · ")}
                </p>
              )}
            </Section>

            {/* News */}
            {snapshot.news_mentions?.length > 0 && (
              <Section title="In the news" count={snapshot.news_mentions.length}>
                {snapshot.news_mentions.map((n, i) => (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Pill text={n.category.replace("_", " ")} className="bg-muted text-muted-foreground border-border" />
                        <p className="text-sm">{n.headline}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {n.publication} · {n.date} — {n.why_it_matters}
                      </p>
                    </div>
                    <SourceLink url={n.source_url} />
                  </div>
                ))}
              </Section>
            )}

            {/* Legal */}
            {snapshot.legal_and_regulatory?.items?.length > 0 && (
              <Section title="Legal & regulatory" count={snapshot.legal_and_regulatory.items.length}>
                <p className="text-sm">{snapshot.legal_and_regulatory.summary}</p>
                {snapshot.legal_and_regulatory.items.map((it, i) => (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm">{it.item}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{it.detail} — {it.status}</p>
                    </div>
                    <SourceLink url={it.source_url} />
                  </div>
                ))}
              </Section>
            )}

            {/* Submarket */}
            <Section title="Submarket">
              <p className="text-sm">{snapshot.submarket.summary}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="New supply" value={snapshot.submarket.new_supply} />
                <Field label="Employment" value={snapshot.submarket.employment_news} />
                <Field label="Infrastructure" value={snapshot.submarket.infrastructure} />
                <Field label="Schools" value={snapshot.submarket.schools} />
              </div>
              {snapshot.submarket.major_employers?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Employers: {snapshot.submarket.major_employers.join(" · ")}
                </p>
              )}
            </Section>

            {/* Comps */}
            {snapshot.competitive_set?.length > 0 && (
              <Section title="Competitive set" count={snapshot.competitive_set.length}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                        <th className="pb-2 pr-3 font-medium">Property</th>
                        <th className="pb-2 pr-3 font-medium">Dist.</th>
                        <th className="pb-2 pr-3 font-medium">Built</th>
                        <th className="pb-2 pr-3 font-medium">Units</th>
                        <th className="pb-2 pr-3 font-medium">Asking</th>
                        <th className="pb-2 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {snapshot.competitive_set.map((c, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-2 pr-3">
                            {c.name}
                            <span className="block text-xs text-muted-foreground">{c.positioning}</span>
                          </td>
                          <td className="py-2 pr-3">{c.distance}</td>
                          <td className="py-2 pr-3">{c.year_built}</td>
                          <td className="py-2 pr-3">{c.units}</td>
                          <td className="py-2 pr-3">{c.asking_rents}</td>
                          <td className="py-2"><SourceLink url={c.source_url} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Buybox detail */}
            <Section title="Buybox read">
              <div className="space-y-2">
                {snapshot.buybox_fit.criterion_reads?.map((c, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className={`text-xs uppercase w-16 shrink-0 ${READ_STYLES[c.read]}`}>{c.read}</span>
                    <div className="min-w-0">
                      <p className="text-sm">{c.criterion}</p>
                      <p className="text-xs text-muted-foreground">{c.evidence}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Ask the broker */}
            {snapshot.diligence_questions?.length > 0 && (
              <Section title="Questions for the broker" count={snapshot.diligence_questions.length}>
                <ul className="list-disc pl-4 space-y-1">
                  {snapshot.diligence_questions.map((q, i) => (
                    <li key={i} className="text-sm">{q}</li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Honest gaps */}
            {snapshot.could_not_verify?.length > 0 && (
              <Section title="Not verifiable from public sources">
                <ul className="list-disc pl-4 space-y-1">
                  {snapshot.could_not_verify.map((c, i) => (
                    <li key={i} className="text-sm text-muted-foreground">{c}</li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Sources */}
            {snapshot.sources?.length > 0 && (
              <Section title="Sources" count={snapshot.sources.length}>
                <div className="space-y-1.5">
                  {snapshot.sources.map((s, i) => {
                    const safe = safeExternalUrl(s.url);
                    if (!safe) return null;
                    return (
                      <div key={i} className="flex items-start justify-between gap-3">
                        <a
                          href={safe}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm hover:underline inline-flex items-center gap-1.5 min-w-0"
                        >
                          <span className="truncate">{s.title}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        <span className="text-xs text-muted-foreground shrink-0">{s.used_for}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            <p className="text-xs text-muted-foreground">
              Public-web research by {meta?.model ?? "Claude"}. Findings are sourced but unaudited —
              verify anything that will be underwritten.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
