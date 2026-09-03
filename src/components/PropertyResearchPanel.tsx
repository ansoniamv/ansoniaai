import { useState } from "react";
import { Loader2, Globe, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";
import { safeExternalUrl } from "@/lib/safeUrl";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePropertyResearch, type PropertySnapshot } from "@/hooks/usePropertyResearch";

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

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm mt-0.5">{value?.trim() || "—"}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <p className="text-sm font-semibold">{title}</p>
      {children}
    </div>
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
  const [meta, setMeta] = useState<{ model: string; generated_at: string } | null>(null);

  const run = async () => {
    if (!address && !propertyName) return;
    const result = await research.mutateAsync({
      address: address ?? undefined,
      property_name: propertyName ?? undefined,
      deal_id: dealId,
    });
    setSnapshot(result.snapshot);
    setMeta({ model: result.model, generated_at: result.generated_at });
  };

  const running = research.isPending;

  const isPaused = true;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Globe className="h-4 w-4" /> AI Property Research
          </span>
          <div className="flex items-center gap-3">
            {meta?.generated_at && !isPaused && (
              <span className="text-xs font-normal text-muted-foreground">
                {new Date(meta.generated_at).toLocaleString()}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={run} disabled={isPaused || running || (!address && !propertyName)}>
              {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
              {snapshot ? "Re-run" : "Research with Claude"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPaused && (
          <Alert variant="default" className="border-amber-500/30 bg-amber-500/10 text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <AlertTitle className="text-sm font-semibold text-amber-100">Paused for cost review</AlertTitle>
            <AlertDescription className="text-xs text-amber-200/80">
              AI Property Research is temporarily disabled while per-call API costs are reviewed. Existing snapshots below remain visible.
            </AlertDescription>
          </Alert>
        )}
        {!snapshot && running && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Claude is searching the web… this can take up to a minute.
          </div>
        )}
        {!snapshot && !running && !isPaused && (
          <p className="text-sm text-muted-foreground">
            Pull a public-record + market snapshot (identity, unit mix, current rents, ownership, sentiment) and an
            automatic buybox-fit read. Claude searches the web live — it assembles the public record, not paywalled comps.
          </p>
        )}

        {snapshot && (
          <>
            {/* Header: resolved identity + buybox verdict */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold">{snapshot.resolved.property_name || "—"}</p>
                <p className="text-sm text-muted-foreground">{snapshot.resolved.address || address}</p>
                <p className="text-xs mt-1">
                  Match confidence:{" "}
                  <span className={CONFIDENCE_STYLES[snapshot.resolved.confidence] ?? ""}>
                    {snapshot.resolved.confidence}
                  </span>
                </p>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded border ${VERDICT_STYLES[snapshot.buybox_fit.verdict] ?? VERDICT_STYLES.unknown}`}>
                Buybox: {snapshot.buybox_fit.verdict}
              </span>
            </div>
            {snapshot.resolved.notes?.trim() && (
              <p className="text-xs text-muted-foreground italic">{snapshot.resolved.notes}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Section title="Physical">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Year Built" value={snapshot.physical.year_built} />
                  <Field label="Units" value={snapshot.physical.units} />
                  <Field label="Stories" value={snapshot.physical.stories} />
                  <Field label="Sqft Range" value={snapshot.physical.sqft_range} />
                </div>
                {snapshot.physical.unit_types?.length > 0 && (
                  <Field label="Unit Types" value={snapshot.physical.unit_types.join(", ")} />
                )}
              </Section>

              <Section title="Rents (asking)">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="1BR from" value={snapshot.rents.one_bed_from} />
                  <Field label="2BR from" value={snapshot.rents.two_bed_from} />
                  <Field label="3BR from" value={snapshot.rents.three_bed_from} />
                </div>
                {snapshot.rents.summary?.trim() && <p className="text-sm">{snapshot.rents.summary}</p>}
                {snapshot.rents.below_market_signal?.trim() && (
                  <p className="text-xs text-muted-foreground">{snapshot.rents.below_market_signal}</p>
                )}
              </Section>

              <Section title="Ownership / Management">
                <div className="grid grid-cols-1 gap-2">
                  <Field label="Owner Entity" value={snapshot.ownership.owner_entity} />
                  <Field label="Management" value={snapshot.ownership.management_company} />
                  <Field label="Contact" value={snapshot.ownership.contact} />
                </div>
              </Section>

              <Section title="Resident Sentiment">
                {snapshot.sentiment.summary?.trim() && <p className="text-sm">{snapshot.sentiment.summary}</p>}
                {snapshot.sentiment.positives?.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-green-400">Positives</p>
                    <ul className="list-disc list-inside text-sm text-foreground/80">
                      {snapshot.sentiment.positives.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}
                {snapshot.sentiment.negatives?.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-red-400">Concerns</p>
                    <ul className="list-disc list-inside text-sm text-foreground/80">
                      {snapshot.sentiment.negatives.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                )}
              </Section>
            </div>

            {snapshot.buybox_fit.reasons?.length > 0 && (
              <Section title="Buybox fit reasoning">
                <ul className="list-disc list-inside text-sm text-foreground/80">
                  {snapshot.buybox_fit.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </Section>
            )}

            {snapshot.market_signals?.length > 0 && (
              <Section title="Market signals">
                <ul className="space-y-2">
                  {snapshot.market_signals.map((m, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{m.signal}:</span> {m.detail}{" "}
                      {safeExternalUrl(m.source_url) && (
                        <a href={safeExternalUrl(m.source_url)!} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                          source <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {snapshot.could_not_verify?.length > 0 && (
              <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-4">
                <p className="text-sm font-semibold text-amber-400 mb-2">Not verifiable from public web</p>
                <ul className="list-disc list-inside text-sm text-foreground/80">
                  {snapshot.could_not_verify.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
                <p className="text-xs text-muted-foreground mt-2">
                  These need CoStar/broker materials, a rent roll, or a T-12 — Claude can't source them from the public web.
                </p>
              </div>
            )}

            {snapshot.sources?.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Sources</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {snapshot.sources.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
                      {s.title || hostOf(s.url)} <ExternalLink className="h-3 w-3" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {meta && (
              <p className="text-xs text-muted-foreground">
                Generated by {meta.model} via live web search. Directional — verify anything decision-critical.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
