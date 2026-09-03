import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Check, X, MapPinOff } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { TagInput } from "@/components/TagInput";
import { ManualBadge } from "@/components/ManualBadge";
import { EnrichedBadge, ProvenanceChip, type EnrichedFieldsMap } from "@/components/EnrichedBadge";
import { useUpdatePartner, type Partner } from "@/hooks/usePartners";
import { useAuth } from "@/hooks/useAuth";
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

/**
 * Which keys are "owned" by each summary card. Saving the card unions the
 * fields that actually changed into `manual_fields` and strips the same
 * keys from `enriched_fields` — the enricher then permanently skips them
 * (see enrich-partner-from-notes/index.ts).
 *
 * `geography_avoid` is intentionally NOT in this list for badge/enrichment
 * purposes — it's manual-only and never AI-derived.
 */
const CARD_FIELDS = {
  investment: ["min_equity_m", "max_equity_m", "investor_type", "hold_period"] as const,
  geography: [
    "geography",
    "strategy_value_add",
    "strategy_core_plus",
    "strategy_workforce",
    "strategy_affordable",
    "product_types",
    "urban_infill",
    "suburban",
  ] as const,
};

function arraysEqual(a: any[], b: any[]) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function valueChanged(before: any, after: any) {
  if (Array.isArray(before) || Array.isArray(after)) {
    return !arraysEqual(before ?? [], after ?? []);
  }
  return (before ?? null) !== (after ?? null);
}

export function PartnerSummaryCards({
  partner,
  notes,
}: {
  partner: Partner;
  notes: NoteLite[] | undefined;
}) {
  const update = useUpdatePartner();
  const { profile } = useAuth();
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

  const saveCard = async (
    cardFields: readonly string[],
    draft: Partial<Partner>,
    extraChangedKeys: string[] = [],
  ) => {
    // Which of THIS card's fields actually changed vs. stored partner?
    const changed: string[] = [];
    for (const key of cardFields) {
      if (valueChanged((partner as any)[key], (draft as any)[key])) changed.push(key);
    }
    for (const k of extraChangedKeys) if (!changed.includes(k)) changed.push(k);

    // Build manual_fields (union of existing + card's editable keys except
    // geography_avoid, which is manual-only by nature and doesn't need a
    // lock entry — the enricher never touches it either way).
    const lockable = cardFields.filter((k) => k !== "geography_avoid");
    const nextManual = Array.from(new Set([...(partner.manual_fields ?? []), ...lockable]));

    // Stamp manual provenance on keys this save changed; drop stale claims on the rest.
    const now = new Date().toISOString();
    const nextEnriched: Record<string, any> = { ...(partner.enriched_fields ?? {}) };
    for (const k of lockable) {
      if (changed.includes(k)) {
        nextEnriched[k] = { source: "manual", as_of: now, written_at: now, set_by: profile?.email ?? null };
      } else {
        delete nextEnriched[k]; // locked but untouched by this save — no claim to make
      }
    }

    const payload: any = {
      id: partner.id,
      ...draft,
      manual_fields: nextManual,
      enriched_fields: nextEnriched,
    };

    return new Promise<void>((resolve, reject) => {
      update.mutate(payload, {
        onSuccess: () => {
          toast.success(
            changed.length
              ? `Saved ${changed.length} field${changed.length === 1 ? "" : "s"} — locked from AI enrichment`
              : "Saved",
          );
          resolve();
        },
        onError: (err: any) => {
          toast.error("Save failed: " + (err?.message ?? err));
          reject(err);
        },
      });
    });
  };

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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">

      <InvestmentParametersCard
        partner={partner}
        renderBadge={renderBadge}
        equityKey={equityKey}
        onSave={(draft) => saveCard(CARD_FIELDS.investment, draft)}
        saving={update.isPending}
        highlight={highlightCards.has("investment")}
      />
      <GeographyStrategyCard
        partner={partner}
        renderBadge={renderBadge}
        strategyKey={strategyKey}
        locationKey={locationKey}
        onSave={(draft, extra) => saveCard(CARD_FIELDS.geography, draft, extra)}
        saving={update.isPending}
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

// ─────────────────────────────────────────────────────────────────────────────
// Investment Parameters
// ─────────────────────────────────────────────────────────────────────────────

function InvestmentParametersCard({
  partner,
  renderBadge,
  equityKey,
  onSave,
  saving,
  highlight = false,
}: {
  partner: Partner;
  renderBadge: (k: string | null) => React.ReactNode;
  equityKey: string | null;
  onSave: (draft: Partial<Partner>) => Promise<void>;
  saving: boolean;
  highlight?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [minEq, setMinEq] = useState<string>(partner.min_equity_m?.toString() ?? "");
  const [maxEq, setMaxEq] = useState<string>(partner.max_equity_m?.toString() ?? "");
  const [investorType, setInvestorType] = useState<string[]>(partner.investor_type ?? []);
  const [holdPeriod, setHoldPeriod] = useState<string[]>(partner.hold_period ?? []);
  const highlightRef = useHighlightEffect(highlight);

  const enterEdit = () => {
    setMinEq(partner.min_equity_m?.toString() ?? "");
    setMaxEq(partner.max_equity_m?.toString() ?? "");
    setInvestorType(partner.investor_type ?? []);
    setHoldPeriod(partner.hold_period ?? []);
    setEditing(true);
  };

  const cancel = () => setEditing(false);

  const save = async () => {
    const parsedMin = minEq === "" ? null : Number(minEq);
    const parsedMax = maxEq === "" ? null : Number(maxEq);
    if ((parsedMin !== null && isNaN(parsedMin)) || (parsedMax !== null && isNaN(parsedMax))) {
      toast.error("Equity values must be numbers");
      return;
    }
    try {
      await onSave({
        min_equity_m: parsedMin,
        max_equity_m: parsedMax,
        investor_type: investorType,
        hold_period: holdPeriod,
      });
      setEditing(false);
    } catch {
      /* toast already fired */
    }
  };

  const equityRange =
    partner.min_equity_m != null || partner.max_equity_m != null
      ? `$${partner.min_equity_m ?? "?"}M – $${partner.max_equity_m ?? "?"}M`
      : "Not specified";

  return (
    <div ref={highlightRef} className={cn("h-full", highlight && "rounded-lg ring-2 ring-amber-500/70 ring-offset-2 ring-offset-background animate-pulse")}>
    <Card className="h-full flex flex-col">


      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
          Investment Parameters
        </CardTitle>
        {editing ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={cancel} className="h-7 px-2">
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="h-7 px-2">
              <Check className="h-3.5 w-3.5 mr-1" /> Save
            </Button>
          </div>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            onClick={enterEdit}
            className="h-7 w-7"
            aria-label="Edit investment parameters"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Equity */}
        <div className="flex justify-between items-center gap-2">
          <span className="text-muted-foreground">
            Equity Range
            {renderBadge(equityKey)}
          </span>
          {editing ? (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="any"
                value={minEq}
                onChange={(e) => setMinEq(e.target.value)}
                placeholder="Min $M"
                className="h-7 w-20 text-xs"
              />
              <span className="text-muted-foreground text-xs">–</span>
              <Input
                type="number"
                step="any"
                value={maxEq}
                onChange={(e) => setMaxEq(e.target.value)}
                placeholder="Max $M"
                className="h-7 w-20 text-xs"
              />
            </div>
          ) : (
            <span className="font-mono">{equityRange}</span>
          )}
        </div>
        <Separator />

        {/* Investor Type */}
        <div className={editing ? "space-y-1" : "flex justify-between"}>
          <span className="text-muted-foreground">
            Investor Type
            {renderBadge("investor_type")}
          </span>
          {editing ? (
            <TagInput
              value={investorType}
              onChange={setInvestorType}
              placeholder="e.g. Family Office, HNW"
            />
          ) : (
            <div className="flex gap-1 flex-wrap justify-end">
              {partner.investor_type?.length ? (
                partner.investor_type.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">
                    {t}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          )}
        </div>
        <Separator />

        {/* Hold Period */}
        <div className={editing ? "space-y-1" : "flex justify-between"}>
          <span className="text-muted-foreground">
            Hold Period
            {renderBadge("hold_period")}
          </span>
          {editing ? (
            <TagInput
              value={holdPeriod}
              onChange={setHoldPeriod}
              placeholder="e.g. 5-7 yr"
            />
          ) : (
            <div className="flex gap-1 flex-wrap justify-end">
              {partner.hold_period?.length ? (
                partner.hold_period.map((h) => (
                  <Badge key={h} variant="outline" className="text-[10px]">
                    {h}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
    </div>
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
  onSave,
  saving,
  highlight = false,
}: {
  partner: Partner;
  renderBadge: (k: string | null) => React.ReactNode;
  strategyKey: string | null;
  locationKey: string | null;
  onSave: (draft: Partial<Partner>, extraChangedKeys?: string[]) => Promise<void>;
  saving: boolean;
  highlight?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [geography, setGeography] = useState<string[]>(partner.geography ?? []);
  const [geographyAvoid, setGeographyAvoid] = useState<string[]>(partner.geography_avoid ?? []);
  const [va, setVA] = useState(partner.strategy_value_add);
  const [cp, setCP] = useState(partner.strategy_core_plus);
  const [wf, setWF] = useState(partner.strategy_workforce);
  const [aff, setAff] = useState(partner.strategy_affordable);
  const [productTypes, setProductTypes] = useState<string[]>(partner.product_types ?? []);
  const [urban, setUrban] = useState(partner.urban_infill);
  const [suburban, setSuburban] = useState(partner.suburban);
  const highlightRef = useHighlightEffect(highlight);

  const enterEdit = () => {
    setGeography(partner.geography ?? []);
    setGeographyAvoid(partner.geography_avoid ?? []);
    setVA(partner.strategy_value_add);
    setCP(partner.strategy_core_plus);
    setWF(partner.strategy_workforce);
    setAff(partner.strategy_affordable);
    setProductTypes(partner.product_types ?? []);
    setUrban(partner.urban_infill);
    setSuburban(partner.suburban);
    setEditing(true);
  };

  const cancel = () => setEditing(false);

  const save = async () => {
    try {
      await onSave(
        {
          geography,
          geography_avoid: geographyAvoid,
          strategy_value_add: va,
          strategy_core_plus: cp,
          strategy_workforce: wf,
          strategy_affordable: aff,
          product_types: productTypes,
          urban_infill: urban,
          suburban,
        },
        // geography_avoid is tracked as a change but excluded from manual_fields
        // (it's manual-only by design; enricher never touches it).
        ["geography_avoid"],
      );
      setEditing(false);
    } catch {
      /* toast already fired */
    }
  };

  const strategies: string[] = [];
  if (partner.strategy_value_add) strategies.push("Value Add");
  if (partner.strategy_core_plus) strategies.push("Core Plus");
  if (partner.strategy_workforce) strategies.push("Workforce");
  if (partner.strategy_affordable) strategies.push("Affordable");

  return (
    <div ref={highlightRef} className={cn("h-full", highlight && "rounded-lg ring-2 ring-amber-500/70 ring-offset-2 ring-offset-background animate-pulse")}>
    <Card className="h-full flex flex-col">

      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
          Geography & Strategy
        </CardTitle>
        {editing ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={cancel} className="h-7 px-2">
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="h-7 px-2">
              <Check className="h-3.5 w-3.5 mr-1" /> Save
            </Button>
          </div>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            onClick={enterEdit}
            className="h-7 w-7"
            aria-label="Edit geography and strategy"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Geography */}
        <div>
          <span className="text-muted-foreground text-xs">
            Geography
            {renderBadge("geography")}
          </span>
          {editing ? (
            <div className="mt-1">
              <TagInput value={geography} onChange={setGeography} placeholder="e.g. Southeast US" />
            </div>
          ) : (
            <div className="flex gap-1 flex-wrap mt-1">
              {partner.geography?.length ? (
                partner.geography.map((g) => (
                  <Badge key={g} variant="outline" className="text-[10px]">
                    {g}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </div>
          )}
        </div>

        {/* Avoided Markets */}
        <div>
          <span className="text-muted-foreground text-xs inline-flex items-center gap-1">
            <MapPinOff className="h-3 w-3 text-destructive/70" />
            Avoids
            <span className="text-[10px] text-muted-foreground/70 font-normal">
              (manual only — never AI-guessed)
            </span>
          </span>
          {editing ? (
            <div className="mt-1">
              <TagInput
                value={geographyAvoid}
                onChange={setGeographyAvoid}
                placeholder="e.g. California, San Francisco"
                chipVariant="destructive"
              />
            </div>
          ) : (
            <div className="flex gap-1 flex-wrap mt-1">
              {partner.geography_avoid?.length ? (
                partner.geography_avoid.map((g) => (
                  <Badge
                    key={g}
                    variant="outline"
                    className="text-[10px] border-destructive/60 text-destructive bg-destructive/10"
                  >
                    {g}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </div>
          )}
        </div>
        <Separator />

        {/* Strategy */}
        <div>
          <span className="text-muted-foreground text-xs">
            Strategy
            {renderBadge(strategyKey)}
          </span>
          {editing ? (
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { label: "Value Add", val: va, set: setVA },
                { label: "Core Plus", val: cp, set: setCP },
                { label: "Workforce", val: wf, set: setWF },
                { label: "Affordable", val: aff, set: setAff },
              ].map((s) => (
                <label key={s.label} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={s.val} onCheckedChange={(v) => s.set(!!v)} />
                  {s.label}
                </label>
              ))}
            </div>
          ) : (
            <div className="flex gap-1 flex-wrap mt-1">
              {strategies.length ? (
                strategies.map((s) => (
                  <Badge key={s} variant="secondary" className="text-[10px]">
                    {s}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </div>
          )}
        </div>
        <Separator />

        {/* Product Types */}
        <div>
          <span className="text-muted-foreground text-xs">
            Product Types
            {renderBadge("product_types")}
          </span>
          {editing ? (
            <div className="mt-1">
              <TagInput
                value={productTypes}
                onChange={setProductTypes}
                placeholder="e.g. multifamily, BTR"
              />
            </div>
          ) : (
            <div className="flex gap-1 flex-wrap mt-1">
              {partner.product_types?.length ? (
                partner.product_types.map((pt) => (
                  <Badge key={pt} variant="outline" className="text-[10px]">
                    {pt}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </div>
          )}
        </div>

        {/* Urban / Suburban */}
        <div className="flex gap-4 mt-2 items-center flex-wrap">
          <span className="text-xs inline-flex items-center gap-2">
            <span className="text-muted-foreground">Urban Infill:</span>
            {editing ? (
              <Switch checked={urban} onCheckedChange={setUrban} />
            ) : (
              <span className={partner.urban_infill ? "text-primary" : "text-muted-foreground"}>
                {partner.urban_infill ? "Yes" : "No"}
              </span>
            )}
          </span>
          <span className="text-xs inline-flex items-center gap-2">
            <span className="text-muted-foreground">Suburban:</span>
            {editing ? (
              <Switch checked={suburban} onCheckedChange={setSuburban} />
            ) : (
              <span className={partner.suburban ? "text-primary" : "text-muted-foreground"}>
                {partner.suburban ? "Yes" : "No"}
              </span>
            )}
          </span>
          {renderBadge(locationKey)}
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
