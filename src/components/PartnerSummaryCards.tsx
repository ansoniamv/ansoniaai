import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MapPinOff, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ManualBadge } from "@/components/ManualBadge";
import { EnrichedBadge, ProvenanceChip, type EnrichedFieldsMap } from "@/components/EnrichedBadge";
import type { Partner } from "@/hooks/usePartners";
import { cn } from "@/lib/utils";

/**
 * Map of highlight tokens (from `?highlight=` on the URL) → which card owns them.
 * Used to pulse/scroll the correct card when a user clicks "Incomplete profile"
 * on the Partner Matching panel.
 */
const HIGHLIGHT_TO_CARD: Record<string, "investment" | "geography"> = {
  equity: "investment",
  geography: "geography",
  product_types: "geography",
  strategy: "geography",
};

type NoteLite = { id: string; content: string; content_format: string; created_at: string };

export function PartnerSummaryCards({
  partner,
  notes,
}: {
  partner: Partner;
  notes: NoteLite[] | undefined;
}) {
  const manualSet = new Set<string>(partner.manual_fields ?? []);
  const enriched = ((partner.enriched_fields ?? {}) as EnrichedFieldsMap);

  const renderBadge = (fieldKey: string | null) => {
    if (!fieldKey) return null;
    const isManual = manualSet.has(fieldKey);
    const meta = enriched[fieldKey];
    const hasSuggestion = !!meta?.suggested;
    const chip = <ProvenanceChip enrichedFields={partner.enriched_fields} fieldKey={fieldKey} notes={notes} />;

    // Manually-locked field with an AI conflict: show manual lock + review popover.
    if (isManual && hasSuggestion) {
      return (
        <>
          <ManualBadge />
          <EnrichedBadge partnerId={partner.id} fieldKey={fieldKey} meta={{ suggested: meta.suggested }} notes={notes} />
          {chip}
        </>
      );
    }
    if (isManual) return <>{<ManualBadge />}{chip}</>;
    if (meta) {
      return (
        <>
          <EnrichedBadge
            partnerId={partner.id}
            fieldKey={fieldKey}
            meta={meta}
            notes={notes}
          />
          {chip}
        </>
      );
    }
    return chip;
  };

  const strategyKey =
    (["strategy_value_add", "strategy_core_plus", "strategy_workforce", "strategy_affordable"] as const)
      .find((k) => manualSet.has(k)) ??
    (["strategy_value_add", "strategy_core_plus", "strategy_workforce", "strategy_affordable"] as const)
      .find((k) => !!enriched[k]) ??
    null;

  const equityKey =
    (manualSet.has("min_equity_m") && "min_equity_m") ||
    (manualSet.has("max_equity_m") && "max_equity_m") ||
    (enriched.min_equity_m && "min_equity_m") ||
    (enriched.max_equity_m && "max_equity_m") ||
    null;

  const locationKey =
    (manualSet.has("urban_infill") && "urban_infill") ||
    (manualSet.has("suburban") && "suburban") ||
    (enriched.urban_infill && "urban_infill") ||
    (enriched.suburban && "suburban") ||
    null;

  // Read `?highlight=field1,field2` — set by the Partner Matching panel when
  // the user clicks "Incomplete profile" so we can pulse the relevant card(s).
  const [searchParams] = useSearchParams();
  const highlightTokens = (searchParams.get("highlight") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const highlightCards = new Set(
    highlightTokens.map((t) => HIGHLIGHT_TO_CARD[t]).filter(Boolean) as Array<"investment" | "geography">,
  );

  // Stacked, full width: each card lays its fields out in columns instead of
  // squeezing two narrow cards side by side. Editing happens in the partner
  // form (Edit partner); these cards only display.
  return (
    <div className="space-y-4">
      <InvestmentParametersCard
        partner={partner}
        renderBadge={renderBadge}
        equityKey={equityKey}
        highlight={highlightCards.has("investment")}
      />
      <GeographyStrategyCard
        partner={partner}
        renderBadge={renderBadge}
        strategyKey={strategyKey}
        locationKey={locationKey}
        highlight={highlightCards.has("geography")}
      />
    </div>
  );
}

/**
 * Adds a pulsing amber ring + auto-scrolls the card into view when `highlight`
 * flips to true. Used to draw attention to cards containing fields the Partner
 * Matching panel flagged as missing.
 */
function useHighlightEffect(highlight: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);
  return ref;
}

type RenderBadge = (k: string | null) => React.ReactNode;

/** Card frame. A highlighted card (fields flagged missing) gets a ring and a link into the form. */
function SummaryCard({
  title,
  partnerId,
  section,
  highlight,
  children,
}: {
  title: string;
  partnerId: string;
  section: string;
  highlight: boolean;
  children: React.ReactNode;
}) {
  const highlightRef = useHighlightEffect(highlight);
  return (
    <div ref={highlightRef} className={cn(highlight && "rounded-lg ring-2 ring-amber-500/70 ring-offset-2 ring-offset-background animate-pulse")}>
      <Card className="border-hairline shadow-none">
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</CardTitle>
          {highlight && (
            <Button asChild size="sm" variant="outline" className="h-7 gap-1">
              <Link to={`/partners/${partnerId}/edit#${section}`}><Pencil className="h-3.5 w-3.5" /> Fill in</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 text-sm">
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  badge,
  className,
  children,
}: {
  label: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5 min-w-0", className)}>
      <div className="text-xs text-muted-foreground inline-flex items-center flex-wrap gap-x-1">{label}{badge}</div>
      <div>{children}</div>
    </div>
  );
}

const Dash = () => <span className="text-muted-foreground">—</span>;

function Chips({ values, variant = "outline", className }: { values: string[] | null | undefined; variant?: "outline" | "secondary"; className?: string }) {
  if (!values?.length) return <Dash />;
  return (
    <div className="flex gap-1.5 flex-wrap">
      {values.map((v) => (
        <Badge key={v} variant={variant} className={cn("text-xs font-normal", className)}>{v}</Badge>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Investment Parameters
// ─────────────────────────────────────────────────────────────────────────────

function InvestmentParametersCard({
  partner,
  renderBadge,
  equityKey,
  highlight = false,
}: {
  partner: Partner;
  renderBadge: RenderBadge;
  equityKey: string | null;
  highlight?: boolean;
}) {
  const equityRange =
    partner.min_equity_m != null || partner.max_equity_m != null
      ? `$${partner.min_equity_m ?? "?"}M – $${partner.max_equity_m ?? "?"}M`
      : null;

  return (
    <SummaryCard title="Investment Parameters" partnerId={partner.id} section="equity" highlight={highlight}>
      <Field label="Equity Range" badge={renderBadge(equityKey)}>
        {equityRange ? <span className="text-base font-medium tabular-nums">{equityRange}</span> : <Dash />}
      </Field>
      <Field label="Investor Type" badge={renderBadge("investor_type")}>
        <Chips values={partner.investor_type} />
      </Field>
      <Field label="Investment Type" badge={renderBadge("investment_type")}>
        <Chips values={partner.investment_type} variant="secondary" />
      </Field>
      <Field label="Hold Period" badge={renderBadge("hold_period")}>
        <Chips values={partner.hold_period} />
      </Field>
    </SummaryCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Geography & Strategy
// ─────────────────────────────────────────────────────────────────────────────

function GeographyStrategyCard({
  partner,
  renderBadge,
  strategyKey,
  locationKey,
  highlight = false,
}: {
  partner: Partner;
  renderBadge: RenderBadge;
  strategyKey: string | null;
  locationKey: string | null;
  highlight?: boolean;
}) {
  const strategies: string[] = [];
  if (partner.strategy_value_add) strategies.push("Value Add");
  if (partner.strategy_core_plus) strategies.push("Core Plus");
  if (partner.strategy_workforce) strategies.push("Workforce");
  if (partner.strategy_affordable) strategies.push("Affordable");
  const sites = [partner.urban_infill && "Urban Infill", partner.suburban && "Suburban"].filter(Boolean) as string[];

  return (
    <SummaryCard title="Geography & Strategy" partnerId={partner.id} section="criteria" highlight={highlight}>
      <Field label="Strategy" badge={renderBadge(strategyKey)}>
        <Chips values={strategies} variant="secondary" />
      </Field>
      <Field label="Product Types" badge={renderBadge("product_types")}>
        <Chips values={partner.product_types} />
      </Field>
      <Field label="Site Preference" badge={renderBadge(locationKey)}>
        <Chips values={sites} />
      </Field>
      <Field label="Target Geography" badge={renderBadge("geography")} className="sm:col-span-2">
        <Chips values={partner.geography} />
      </Field>
      <Field
        label={
          <>
            <MapPinOff className="h-3 w-3 text-destructive/70" /> Avoids
            <span className="text-[10px] text-muted-foreground/70">(manual only — never AI-guessed)</span>
          </>
        }
        className="sm:col-span-2"
      >
        <Chips values={partner.geography_avoid} className="border-destructive/60 text-destructive bg-destructive/10" />
      </Field>
    </SummaryCard>
  );
}
