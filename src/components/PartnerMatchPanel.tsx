import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Plus, TrendingUp, Sparkles, ChevronDown, ChevronRight, AlertTriangle, Settings2, X, Download } from "lucide-react";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { exportPartnerMatches } from "@/lib/exportPartnerMatches";


import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WarmthBadge } from "@/components/WarmthBadge";
import { usePartners } from "@/hooks/usePartners";
import { useAllPartnerContacts } from "@/hooks/useAllPartnerContacts";
import { useEngagementsByDeal } from "@/hooks/useCapitalRaiseEngagements";
import { useQueryClient } from "@tanstack/react-query";
import { useNotes } from "@/hooks/useNotes";
import { supabase } from "@/integrations/supabase/client";
import type { Deal } from "@/hooks/useDeals";
import type { Partner } from "@/hooks/usePartners";
import {
  rankPartnerMatches,
  defaultDealStrategies,
  buildPartnerBlurb,
  STRATEGY_LABEL,
  TIER_THRESHOLDS,
  type PartnerMatch,
  type PartnerContactLite,
  type StrategyKey,
} from "@/lib/partnerMatching";

// Scoring now lives in @/lib/partnerMatching — a pure, testable module.
// This file keeps only the filter row, dialogs, and row rendering.

function StrategyConfirmDialog({
  open,
  onOpenChange,
  initial,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: Set<StrategyKey>;
  onConfirm: (next: Set<StrategyKey>) => void;
}) {
  const [selected, setSelected] = useState<Set<StrategyKey>>(new Set(initial));

  useEffect(() => {
    if (open) setSelected(new Set(initial));
  }, [open, initial]);

  const toggle = (k: StrategyKey) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm deal strategy</DialogTitle>
          <DialogDescription>
            Pre-filled from this deal. Adjust so partner matching only credits real overlap.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {(Object.keys(STRATEGY_LABEL) as StrategyKey[]).map((k) => (
            <label key={k} className="flex items-center gap-3 rounded-md border p-2 hover:bg-muted/40 cursor-pointer">
              <Checkbox checked={selected.has(k)} onCheckedChange={() => toggle(k)} />
              <span className="text-sm">{STRATEGY_LABEL[k]}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => {
              onConfirm(selected);
              onOpenChange(false);
            }}
          >
            Find partners
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter option lists + helpers
// ─────────────────────────────────────────────────────────────────────────────

const INVESTOR_TYPE_OPTIONS = [
  "LP", "GP", "Co-GP", "Passive Co-Invest", "Family Office", "Institutional",
  "HNW", "Sovereign", "Insurance", "Pension", "Endowment",
];
const HOLD_PERIOD_OPTIONS = ["Short (<3 yr)", "Medium (3–7 yr)", "Long (7–10 yr)", "Perpetual"];
const STRATEGY_OPTIONS: { label: string; field: keyof Partner }[] = [
  { label: "Value-Add", field: "strategy_value_add" },
  { label: "Core+", field: "strategy_core_plus" },
  { label: "Workforce", field: "strategy_workforce" },
  { label: "Affordable", field: "strategy_affordable" },
];
const PRODUCT_TYPE_OPTIONS = [
  "Multifamily", "Office", "Industrial", "Retail", "Mixed-Use",
  "Hospitality", "Student Housing", "Senior Living", "Self-Storage",
];
const WARMTH_OPTIONS = ["Existing Partner", "Very Warm", "Warm", "Tepid", "Cold"];

const ci = (s: string) => s.toLowerCase().trim();
function arrayMatches(values: string[] | null | undefined, selected: string[]) {
  if (selected.length === 0) return true;
  const vals = (values ?? []).map(ci);
  if (!vals.length) return false;
  return selected.some((s) => vals.some((v) => v.includes(ci(s)) || ci(s).includes(v)));
}

function toggleIn(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// ─────────────────────────────────────────────────────────────────────────────
// Match row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One partner row. Shows the score, WHY it is that score, and how much of the
 * score rests on real data. All misses render — the previous version truncated
 * negatives to three while showing every positive, which made every card read
 * rosier than the underlying data.
 */
function MatchRow({
  match,
  contacts,
  inPipeline,
  onOpen,
  onComplete,
  onAdd,
}: {
  match: PartnerMatch;
  contacts: PartnerContactLite[];
  inPipeline: boolean;
  onOpen: () => void;
  onComplete: (fields: string[]) => void;
  onAdd: () => void;
}) {
  const {
    partner, score, baseScore, notesAdjustment, tier,
    confidence, coverage, reasons, misses, missingFields,
  } = match;

  const blurb = buildPartnerBlurb(partner, contacts);

  const scoreColor =
    confidence === "insufficient"
      ? "text-muted-foreground"
      : score >= TIER_THRESHOLDS.strong
      ? "text-green-500"
      : score >= TIER_THRESHOLDS.moderate
      ? "text-yellow-500"
      : "text-red-400";

  const coverageLine = `Scored on ${coverage.pillarsCovered} of ${coverage.pillarsTotal} pillars (${Math.round(
    coverage.weightCoveredPct * 100,
  )}% of weight).`;
  const mathLine =
    notesAdjustment !== 0
      ? `${baseScore}% from structured fields, ${notesAdjustment > 0 ? "+" : ""}${notesAdjustment} from notes.`
      : `${baseScore}% from structured fields.`;

  const tierColor =
    tier === "Strong"
      ? "border-green-500/30 bg-green-500/10 text-green-600"
      : tier === "Moderate"
      ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-600"
      : tier === "Weak"
      ? "border-red-400/30 bg-red-400/10 text-red-400"
      : "text-muted-foreground";

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`text-lg font-bold w-12 text-center cursor-help ${scoreColor}`}>
              {confidence === "insufficient" ? "—" : `${score}%`}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs space-y-1">
            <p className="font-medium">
              {confidence === "insufficient"
                ? "Insufficient data to score"
                : `${score}% fit · ${confidence} confidence · ${tier}`}
            </p>
            <p className="text-xs text-muted-foreground">{coverageLine}</p>
            <p className="text-xs text-muted-foreground">{mathLine}</p>
            <p className="text-xs text-muted-foreground">
              Fit only — relationship warmth breaks ties but does not raise the score.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpen}
            className="font-medium text-sm hover:text-primary transition-colors truncate text-left"
          >
            {partner.name}
          </button>
          <Badge variant="outline" className={`text-[10px] ${tierColor}`}>{tier}</Badge>
          <WarmthBadge strength={partner.relationship_strength ?? null} />
          {(() => {
            const cs = (partner as any).capital_status as string | null;
            if (cs !== "Out of Capital" && cs !== "Constrained") return null;
            const from = (partner as any).capital_available_from as string | null;
            const passed = !!from && new Date(`${from}T00:00:00`).getTime() < Date.now();
            return (
              <span className="text-[10px] uppercase tracking-[0.1em] text-amber-700">
                {passed ? "needs re-confirmation" : cs}
              </span>
            );
          })()}
          {missingFields.length > 0 && (
            <button
              onClick={() => onComplete(missingFields)}
              className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 hover:bg-amber-500/20 transition-colors"
              title="Click to complete this partner's profile"
            >
              <AlertTriangle className="h-3 w-3" />
              Incomplete profile ({missingFields.length}) — complete →
            </button>
          )}
        </div>

        {/* Who is this firm again? Reminder line for the analyst. */}
        {blurb && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{blurb}</p>
        )}

        <div className="flex flex-wrap gap-1 mt-1">
          {reasons.map((r, i) => (
            <Badge key={i} variant="secondary" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
              {r}
            </Badge>
          ))}
          {misses.map((m, i) => (
            <Badge key={`m${i}`} variant="outline" className="text-[10px] text-red-400 border-red-400/20">
              {m}
            </Badge>
          ))}
        </div>
      </div>

      {inPipeline ? (
        <Badge variant="outline" className="text-[10px] whitespace-nowrap">In Pipeline</Badge>
      ) : (
        <Button size="sm" variant="outline" onClick={onAdd} className="gap-1 text-xs">
          <Plus className="h-3 w-3" /> Add
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────


export function PartnerMatchPanel({ deal }: { deal: Deal }) {
  const { data: partners } = usePartners();
  const { data: engagements } = useEngagementsByDeal(deal.id);
  const { data: dealNotes } = useNotes("deal", deal.id);
  const { data: contactsByPartner } = useAllPartnerContacts();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showExcluded, setShowExcluded] = useState(false);
  const [minScore, setMinScore] = useState(30);
  const [checkSize, setCheckSize] = useState<string>(
    deal.estimated_equity != null ? String(deal.estimated_equity) : "",
  );
  const [onlyFitting, setOnlyFitting] = useState(false);
  const [geoFilter, setGeoFilter] = useState<string[]>([]);
  const [investorFilter, setInvestorFilter] = useState<string[]>([]);
  const [holdFilter, setHoldFilter] = useState<string[]>([]);
  const [strategyFilter, setStrategyFilter] = useState<string[]>([]);
  const [productFilter, setProductFilter] = useState<string[]>([]);
  const [warmthFilter, setWarmthFilter] = useState<string[]>([]);
  const [equityMin, setEquityMin] = useState("");
  const [equityMax, setEquityMax] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [confirmedStrategies, setConfirmedStrategies] = useState<Set<StrategyKey>>(
    () => defaultDealStrategies(deal),
  );

  const notesText = useMemo(() => {
    const fromNotes = (dealNotes ?? []).map((n) => n.content).join("\n");
    return [deal.notes ?? "", fromNotes].filter(Boolean).join("\n");
  }, [dealNotes, deal.notes]);

  const checkTarget = useMemo(() => {
    const n = Number(checkSize);
    return checkSize.trim() !== "" && Number.isFinite(n) ? n : null;
  }, [checkSize]);

  const geoOptions = useMemo(() => {
    const set = new Set<string>();
    (partners ?? []).forEach((p) => (p.geography ?? []).forEach((g) => g && set.add(g.trim())));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [partners]);

  const eqMinNum = useMemo(() => {
    const n = Number(equityMin);
    return equityMin.trim() !== "" && Number.isFinite(n) ? n : null;
  }, [equityMin]);
  const eqMaxNum = useMemo(() => {
    const n = Number(equityMax);
    return equityMax.trim() !== "" && Number.isFinite(n) ? n : null;
  }, [equityMax]);

  const inPipelineIds = useMemo(
    () => new Set(engagements?.map((e) => e.partner_id) || []),
    [engagements],
  );

  const ranked = useMemo(
    () => rankPartnerMatches(deal, partners ?? [], notesText, confirmedStrategies, { minScore }),
    [partners, deal, minScore, notesText, confirmedStrategies],
  );

  const { matches, gated, belowThreshold } = ranked;

  // The filter row applies AFTER ranking — scoring is unaffected by filters.
  const filteredMatches = useMemo(() => {
    const checkFilterOn = onlyFitting && checkTarget != null;
    return matches
      .filter((m) => {
        if (!checkFilterOn) return true;
        const min = m.partner.min_equity_m;
        const max = m.partner.max_equity_m;
        if (min == null && max == null) return false;
        return (min == null || checkTarget! >= min) && (max == null || checkTarget! <= max);
      })
      // Geography (respecting avoid list)
      .filter((m) => {
        if (geoFilter.length === 0) return true;
        const avoids = (m.partner.geography_avoid ?? []).map(ci);
        if (geoFilter.some((s) => avoids.some((a) => a.includes(ci(s)) || ci(s).includes(a)))) return false;
        return arrayMatches(m.partner.geography, geoFilter);
      })
      // Equity band overlap
      .filter((m) => {
        if (eqMinNum == null && eqMaxNum == null) return true;
        const pMin = m.partner.min_equity_m;
        const pMax = m.partner.max_equity_m;
        return (
          (eqMaxNum == null || pMin == null || pMin <= eqMaxNum) &&
          (eqMinNum == null || pMax == null || pMax >= eqMinNum)
        );
      })
      .filter((m) => arrayMatches(m.partner.investor_type, investorFilter))
      .filter((m) => arrayMatches(m.partner.hold_period, holdFilter))
      .filter((m) => arrayMatches(m.partner.product_types, productFilter))
      .filter((m) => {
        if (strategyFilter.length === 0) return true;
        return STRATEGY_OPTIONS.filter((o) => strategyFilter.includes(o.label)).some(
          (o) => m.partner[o.field] === true,
        );
      })
      .filter((m) => {
        if (warmthFilter.length === 0) return true;
        return warmthFilter.includes(m.partner.relationship_strength ?? "");
      });
  }, [
    matches, onlyFitting, checkTarget,
    geoFilter, eqMinNum, eqMaxNum, investorFilter, holdFilter, productFilter, strategyFilter, warmthFilter,
  ]);

  const activeChips: { key: string; label: string; remove: () => void }[] = [
    ...geoFilter.map((v) => ({ key: `geo-${v}`, label: `Geo: ${v}`, remove: () => setGeoFilter((p) => p.filter((x) => x !== v)) })),
    ...investorFilter.map((v) => ({ key: `inv-${v}`, label: `Type: ${v}`, remove: () => setInvestorFilter((p) => p.filter((x) => x !== v)) })),
    ...holdFilter.map((v) => ({ key: `hold-${v}`, label: `Hold: ${v}`, remove: () => setHoldFilter((p) => p.filter((x) => x !== v)) })),
    ...strategyFilter.map((v) => ({ key: `strat-${v}`, label: `Strategy: ${v}`, remove: () => setStrategyFilter((p) => p.filter((x) => x !== v)) })),
    ...productFilter.map((v) => ({ key: `prod-${v}`, label: `Product: ${v}`, remove: () => setProductFilter((p) => p.filter((x) => x !== v)) })),
    ...warmthFilter.map((v) => ({ key: `warm-${v}`, label: `Warmth: ${v}`, remove: () => setWarmthFilter((p) => p.filter((x) => x !== v)) })),
    ...(eqMinNum != null ? [{ key: "eqmin", label: `Equity ≥ $${eqMinNum}M`, remove: () => setEquityMin("") }] : []),
    ...(eqMaxNum != null ? [{ key: "eqmax", label: `Equity ≤ $${eqMaxNum}M`, remove: () => setEquityMax("") }] : []),
  ];

  const clearAllFilters = () => {
    setGeoFilter([]);
    setInvestorFilter([]);
    setHoldFilter([]);
    setStrategyFilter([]);
    setProductFilter([]);
    setWarmthFilter([]);
    setEquityMin("");
    setEquityMax("");
  };


  const addToPipeline = async (partnerId: string) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await (supabase as any)
        .from("capital_raise_engagements")
        .insert({
          deal_id: deal.id,
          partner_id: partnerId,
          stage: "added_to_pipeline",
          last_contact_date: today,
        });
      if (error) throw error;

      // Adding a partner is live work — always bring the raise back to an
      // active, raising state. This avoids a stale-prop race where the panel's
      // cached `deal` still looks un-archived and the reopen patch is skipped.
      const { error: dealErr } = await (supabase as any)
        .from("deals")
        .update({
          raise_status: "raising",
          raise_archived_at: null,
          raise_archived_by: null,
          raise_archive_note: null,
        })
        .eq("id", deal.id);
      if (dealErr) throw dealErr;

      toast.success(
        (deal as any).raise_archived_at
          ? "Partner added — raise re-opened"
          : "Partner added to pipeline",
      );
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements", "deal", deal.id] });
      qc.invalidateQueries({ queryKey: ["deals", deal.id] });
      qc.invalidateQueries({ queryKey: ["capital-raise-page"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to add partner");
    }
  };


  if (!showPanel) {
    return (
      <>
        <Button
          onClick={() => setStrategyDialogOpen(true)}
          variant="outline"
          className="gap-2"
        >
          <Users className="h-4 w-4" /> Find Partners
        </Button>
        <StrategyConfirmDialog
          open={strategyDialogOpen}
          onOpenChange={setStrategyDialogOpen}
          initial={confirmedStrategies}
          onConfirm={(next) => {
            setConfirmedStrategies(next);
            setShowPanel(true);
          }}
        />
      </>
    );
  }

  const strategyChips = Array.from(confirmedStrategies).map((k) => STRATEGY_LABEL[k]);

  return (
    <Card className="md:col-span-2">
      <CardHeader className="pb-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="w-16" />
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground inline-flex items-center gap-2 justify-center">
            <TrendingUp className="h-4 w-4 text-primary" />
            Partner Matching
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setShowPanel(false)}>Close</Button>
        </div>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Min Score: {minScore}%</span>
          <Slider
            value={[minScore]}
            onValueChange={([v]) => setMinScore(v)}
            min={0}
            max={90}
            step={5}
            className="w-48"
          />
          <div className="flex items-center gap-2">
            <Label htmlFor="match-check-size" className="text-xs text-muted-foreground whitespace-nowrap">
              Check size ($M)
            </Label>
            <Input
              id="match-check-size"
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="e.g. 25"
              value={checkSize}
              onChange={(e) => setCheckSize(e.target.value)}
              className="h-7 w-24 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
            <Checkbox
              checked={onlyFitting}
              onCheckedChange={(c) => setOnlyFitting(c === true)}
              className="h-3.5 w-3.5"
            />
            Only partners who fit this check
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">{filteredMatches.length} matches</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={filteredMatches.length === 0}
            onClick={() => {
              exportPartnerMatches({
                deal,
                matches: filteredMatches,
                gated,
                blurbFor: (p) => buildPartnerBlurb(p, contactsByPartner?.[p.id] ?? []),
                inPipelineFor: (id) => inPipelineIds.has(id),
              });
              toast.success(`Exported ${filteredMatches.length} partners`);
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export to Excel
          </Button>

        </div>

        {/* Institutional filter bar */}
        <div className="border-t pt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectFilter
              label="Geography"
              options={geoOptions}
              selected={geoFilter}
              onToggle={(v) => setGeoFilter((p) => toggleIn(p, v))}
              onClear={() => setGeoFilter([])}
            />
            <div className="flex items-center gap-1.5 rounded-md border px-2 py-1">
              <Label htmlFor="eq-min" className="text-[11px] text-muted-foreground whitespace-nowrap">
                Equity min ($M)
              </Label>
              <Input
                id="eq-min"
                type="number"
                inputMode="decimal"
                min={0}
                value={equityMin}
                onChange={(e) => setEquityMin(e.target.value)}
                className="h-6 w-16 text-xs px-1.5"
              />
              <Label htmlFor="eq-max" className="text-[11px] text-muted-foreground whitespace-nowrap">
                max ($M)
              </Label>
              <Input
                id="eq-max"
                type="number"
                inputMode="decimal"
                min={0}
                value={equityMax}
                onChange={(e) => setEquityMax(e.target.value)}
                className="h-6 w-16 text-xs px-1.5"
              />
            </div>
            {deal.estimated_equity != null && (
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                Deal needs ~${deal.estimated_equity}M equity
              </span>
            )}
            <MultiSelectFilter
              label="Investor Type"
              options={INVESTOR_TYPE_OPTIONS}
              selected={investorFilter}
              onToggle={(v) => setInvestorFilter((p) => toggleIn(p, v))}
              onClear={() => setInvestorFilter([])}
            />
            <MultiSelectFilter
              label="Hold Period"
              options={HOLD_PERIOD_OPTIONS}
              selected={holdFilter}
              onToggle={(v) => setHoldFilter((p) => toggleIn(p, v))}
              onClear={() => setHoldFilter([])}
            />
            <MultiSelectFilter
              label="Strategy"
              options={STRATEGY_OPTIONS.map((o) => o.label)}
              selected={strategyFilter}
              onToggle={(v) => setStrategyFilter((p) => toggleIn(p, v))}
              onClear={() => setStrategyFilter([])}
            />
            <MultiSelectFilter
              label="Product Type"
              options={PRODUCT_TYPE_OPTIONS}
              selected={productFilter}
              onToggle={(v) => setProductFilter((p) => toggleIn(p, v))}
              onClear={() => setProductFilter([])}
            />
            <MultiSelectFilter
              label="Warmth"
              options={WARMTH_OPTIONS}
              selected={warmthFilter}
              onToggle={(v) => setWarmthFilter((p) => toggleIn(p, v))}
              onClear={() => setWarmthFilter([])}
            />
          </div>
          {activeChips.length > 0 && (
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap gap-1">
                {activeChips.map((c) => (
                  <Badge key={c.key} variant="outline" className="text-[10px] gap-1 pr-1 font-normal">
                    {c.label}
                    <button
                      type="button"
                      onClick={c.remove}
                      aria-label={`Remove ${c.label}`}
                      className="rounded hover:bg-muted p-[1px]"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground shrink-0"
                onClick={clearAllFilters}
              >
                Clear all filters
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 flex-wrap text-xs">
          <span className="text-muted-foreground">Deal strategy:</span>
          {strategyChips.length ? (
            strategyChips.map((s) => (
              <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
            ))
          ) : (
            <span className="text-muted-foreground italic">none selected</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={() => setStrategyDialogOpen(true)}
          >
            <Settings2 className="h-3 w-3" /> Adjust
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <LearningBanner />
        {filteredMatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No partners match at this threshold.</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {filteredMatches.map((match) => (
              <MatchRow
                key={match.partner.id}
                match={match}
                contacts={contactsByPartner?.[match.partner.id] ?? []}
                inPipeline={inPipelineIds.has(match.partner.id)}
                onOpen={() => navigate(`/partners/${match.partner.id}`)}
                onComplete={(fields) =>
                  navigate(`/partners/${match.partner.id}?highlight=${fields.join(",")}`)
                }
                onAdd={() => addToPipeline(match.partner.id)}
              />
            ))}
          </div>
        )}

        {/* Never hide exclusions silently — say how many and why. */}
        {(gated.length > 0 || belowThreshold.length > 0) && (
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            {gated.length > 0 && (
              <button
                type="button"
                onClick={() => setShowExcluded((v) => !v)}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                {showExcluded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {gated.length} partner{gated.length === 1 ? "" : "s"} excluded by check size or
                avoid list {showExcluded ? "— hide" : "— show"}
              </button>
            )}
            {belowThreshold.length > 0 && (
              <p>{belowThreshold.length} more scored below the {minScore}% threshold.</p>
            )}
            {showExcluded && (
              <div className="mt-1 space-y-1 rounded-md border border-dashed p-2">
                {gated.map((m) => (
                  <div key={m.partner.id} className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/partners/${m.partner.id}`)}
                      className="font-medium hover:text-primary transition-colors truncate text-left"
                    >
                      {m.partner.name}
                    </button>
                    <span className="text-red-400 text-right">{m.gateReason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <StrategyConfirmDialog
        open={strategyDialogOpen}
        onOpenChange={setStrategyDialogOpen}
        initial={confirmedStrategies}
        onConfirm={(next) => setConfirmedStrategies(next)}
      />
    </Card>
  );
}

function LearningBanner() {
  const [content, setContent] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("learned_partner_strategy")
        .select("content")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setContent((data?.content ?? "").trim());
    })();
  }, []);

  if (!content) return null;

  return (
    <div className="mb-4 rounded-md border border-[#E4E7EC] bg-[#F7F8FA]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5B6472]">
          <Sparkles className="h-3.5 w-3.5 text-[#002752]" />
          What we've learned about capital partners
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-[#5B6472]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#5B6472]" />
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[#E4E7EC]">
          <pre className="text-[12px] leading-[1.6] text-[#1A1F2B] whitespace-pre-wrap font-sans">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
