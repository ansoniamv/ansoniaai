import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { safeExternalUrl } from "@/lib/safeUrl";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  Sparkles,
  Mail,
  Check,
  X,
  ImageOff,
  FileText,
  AlertTriangle,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { NoteContent } from "@/components/NoteContent";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnectorEnabled } from "@/hooks/useConnectorEnabled";

import { DealStatusBadge } from "@/components/DealStatusBadge";
import { getStatus } from "@/lib/dealStatus";
import { DemographicsPanel } from "@/components/DemographicsPanel";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { BuyboxFitCard } from "@/components/BuyboxFitCard";
import { AnalystGradeCard } from "@/components/AnalystGradeCard";


import { CapitalRaiseTab } from "@/components/CapitalRaiseTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DealNotes } from "@/components/DealNotes";
import { DealStatusHistory } from "@/components/DealStatusHistory";
import { ComposeEmailDialog } from "@/components/ComposeEmailDialog";
import { PropertyResearchPanel } from "@/components/PropertyResearchPanel";
import { NoteComposerDialog } from "@/components/NoteComposerDialog";
import { useDeal, useDeleteDeal } from "@/hooks/useDeals";
import { persistDealScore } from "@/lib/persistDealScore";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/* ---------- formatters ---------- */
const isNum = (v: any): v is number => typeof v === "number" && Number.isFinite(v);
const fmtMoney = (v: any, digits = 0) =>
  isNum(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: digits })}` : null;
const fmtMillions = (v: any) => (isNum(v) ? `$${v.toFixed(1)}M` : null);
const fmtPct = (v: any, digits = 1) => {
  if (!isNum(v)) return null;
  const n = v <= 1 ? v * 100 : v;
  return `${n.toFixed(digits)}%`;
};
const fmtInt = (v: any) => (isNum(v) ? v.toLocaleString() : null);
const fmtYears = (v: any) => (isNum(v) ? `${v} yr${v === 1 ? "" : "s"}` : null);
const fmtMultiple = (v: any) => (isNum(v) ? `${v.toFixed(2)}x` : null);

/* ---------- shared atoms ---------- */
function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground font-display">
        {title}
      </h2>
      {right}
    </div>
  );
}

function Stat({
  label,
  value,
  meets,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  meets?: boolean | null;
  hint?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="surface-card border-hairline rounded-md p-3 flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </span>
        {meets === true && <Check className="h-3 w-3 text-emerald-600 shrink-0" />}
        {meets === false && <X className="h-3 w-3 text-destructive shrink-0" />}
      </div>
      <div className="text-lg font-serif-display tabular-nums leading-tight">
        {empty ? <span className="text-muted-foreground/70 text-base">—</span> : value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground tabular-nums">{hint}</div>}
    </div>
  );
}

function KV({
  label,
  value,
  align = "left",
}: {
  label: string;
  value: React.ReactNode;
  align?: "left" | "right";
}) {
  const empty = value === null || value === undefined || value === "";
  if (empty) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-hairline last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm tabular-nums", align === "right" && "text-right")}>{value}</span>
    </div>
  );
}

function CriterionRow({
  label,
  pass,
  actual,
}: {
  label: string;
  pass: boolean | null;
  actual: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 border-b border-hairline last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        {pass === true ? (
          <Check className="h-4 w-4 text-emerald-600 shrink-0" />
        ) : pass === false ? (
          <X className="h-4 w-4 text-destructive shrink-0" />
        ) : (
          <span className="h-4 w-4 inline-block rounded-full border border-muted shrink-0" />
        )}
        <span className="text-sm">{label}</span>
      </div>
      <span className="text-sm tabular-nums text-muted-foreground">
        {actual ?? "—"}
      </span>
    </li>
  );
}

/* ---------- gallery ---------- */
function PhotoGallery({ photos }: { photos: string[] | null }) {
  const [open, setOpen] = useState<number | null>(null);
  const initial = Array.isArray(photos) ? photos.filter((s) => typeof s === "string" && /^https?:\/\//i.test(s)) : [];
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const list = initial.filter((s) => !broken.has(s));
  const markBroken = (src: string) =>
    setBroken((prev) => {
      if (prev.has(src)) return prev;
      const next = new Set(prev);
      next.add(src);
      return next;
    });

  if (list.length === 0) {
    return (
      <div className="aspect-[16/7] w-full rounded-md surface-card border-hairline flex flex-col items-center justify-center text-muted-foreground gap-1.5">
        <ImageOff className="h-6 w-6" />
        <span className="text-xs uppercase tracking-wider">No photos</span>
      </div>
    );
  }

  const hero = list[0];
  const rest = list.slice(1, 9);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2">
        <button
          type="button"
          onClick={() => setOpen(0)}
          className="relative aspect-[16/9] md:aspect-auto overflow-hidden rounded-md border-hairline"
        >
          <img
            src={hero}
            alt="Property"
            loading="lazy"
            onError={() => markBroken(hero)}
            className="w-full h-full object-cover"
          />
        </button>
        {rest.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {rest.map((src, i) => (
              <button
                key={src + i}
                type="button"
                onClick={() => setOpen(i + 1)}
                className="relative aspect-square overflow-hidden rounded-md border-hairline"
              >
                <img
                  src={src}
                  alt={`Property ${i + 2}`}
                  loading="lazy"
                  onError={() => markBroken(src)}
                  className="w-full h-full object-cover"
                />
                {i === rest.length - 1 && list.length > 9 && (
                  <span className="absolute inset-0 bg-black/60 text-white flex items-center justify-center text-sm font-medium">
                    +{list.length - 9}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-5xl p-2 bg-background">
          {open !== null && list[open] && (
            <img
              src={list[open]}
              alt={`Property ${open + 1}`}
              onError={() => markBroken(list[open]!)}
              className="w-full h-auto max-h-[80vh] object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}


/* ---------- map ---------- */
function PropertyMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const delta = 0.01;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  return (
    <Card className="surface-card border-hairline overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground font-display">
          Location
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <iframe
          title={`Map – ${label}`}
          src={src}
          className="w-full h-[260px] border-0"
          loading="lazy"
        />
      </CardContent>
    </Card>
  );
}

/* ---------- fit badge ---------- */
function FitBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  const t = tier.toLowerCase();
  const strong = /strong|tier ?1|excellent/.test(t);
  const partial = /partial|tier ?2|tier ?3|moderate|good/.test(t);
  const label = strong ? "Strong Fit" : partial ? "Partial Fit" : "No Fit";
  const cls = strong
    ? "bg-emerald-600 text-white"
    : partial
    ? "bg-amber-500 text-white"
    : "bg-destructive text-destructive-foreground";
  return (
    <Badge className={cn("font-display uppercase tracking-wider px-3 py-1 text-xs", cls)}>
      {label}
    </Badge>
  );
}

/* ===================================================================== */
export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: deal, isLoading } = useDeal(id);
  const deleteDeal = useDeleteDeal();
  const queryClient = useQueryClient();
  const [enriching, setEnriching] = useState(false);
  const [scoring, setScoring] = useState(false);
  const hellodataEnabled = useConnectorEnabled("hellodata");


  const handleRescore = async () => {
    if (!id) return;
    setScoring(true);
    try {
      const { error } = await supabase.functions.invoke("deal-score", { body: { deal_id: id } });
      if (error) throw error;
      toast.success("Score updated");
      queryClient.invalidateQueries({ queryKey: ["deals", id] });
    } catch (err) {
      toast.error("Scoring failed: " + (err as Error).message);
    } finally {
      setScoring(false);
    }
  };

  const handleDelete = () => {
    if (!id) return;
    deleteDeal.mutate(id, {
      onSuccess: () => {
        toast.success("Deal deleted");
        navigate("/deals");
      },
      onError: (err) => toast.error("Failed to delete: " + err.message),
    });
  };

  const handleRefreshMarketData = async () => {
    if (!id) return;
    setEnriching(true);
    try {
      const { error: resetErr } = await supabase
        .from("deals")
        .update({ hellodata_status: "pending" })
        .eq("id", id);
      if (resetErr) throw resetErr;
      const { data, error } = await supabase.functions.invoke("fetch-hellodata", {
        body: { deal_id: id },
      });
      if (error) throw error;
      if ((data as any)?.status === "failed")
        throw new Error((data as any).error || "HelloData fetch failed");

      // Re-fetch the freshly enriched deal row and re-run the buybox scoring
      // engine so tier/score reflect new rent-lag/occupancy/opex signals.
      const { data: freshDeal, error: reselectErr } = await supabase
        .from("deals")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (reselectErr) throw reselectErr;
      if (freshDeal) {
        try {
          await persistDealScore(freshDeal as any);
        } catch (scoreErr) {
          console.error("[handleRefreshMarketData] rescore failed", scoreErr);
        }
      }

      toast.success("Market data refreshed & rescored");
      queryClient.invalidateQueries({ queryKey: ["deals", id] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    } catch (err) {
      toast.error("Refresh failed: " + (err as Error).message);
    } finally {
      setEnriching(false);
    }
  };

  /* ------- derived ------- */
  const d = deal as any;

  const pricePerUnit = useMemo(() => {
    if (!d?.asking_price || !d?.unit_count) return null;
    return (Number(d.asking_price) * 1_000_000) / Number(d.unit_count);
  }, [d?.asking_price, d?.unit_count]);

  const rentDeltaPct = useMemo(() => {
    if (!isNum(d?.in_place_avg_rent) || !isNum(d?.median_rent_tract) || d.median_rent_tract === 0)
      return null;
    return ((d.in_place_avg_rent - d.median_rent_tract) / d.median_rent_tract) * 100;
  }, [d?.in_place_avg_rent, d?.median_rent_tract]);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="max-w-7xl mx-auto text-center py-12">
        <p className="text-muted-foreground">Deal not found.</p>
        <Button variant="link" onClick={() => navigate("/deals")}>
          Back to pipeline
        </Button>
      </div>
    );
  }

  const title = deal.property_name || deal.property_address || deal.address || "Untitled deal";
  const subTitle =
    [deal.msa, [deal.city, deal.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") ||
    null;
  

  /* buybox criteria evaluation */
  const meetsUnits = isNum(deal.unit_count) ? deal.unit_count >= 150 : null;
  const meetsVintage = isNum(deal.vintage_year)
    ? deal.vintage_year >= 1990 && deal.vintage_year <= 2019
    : null;
  const meetsRentLag = isNum(rentDeltaPct) ? rentDeltaPct <= -10 : null;
  const meetsSupply = isNum(d.new_supply_pct_of_stock) ? d.new_supply_pct_of_stock < 5 : null;
  const meetsPopGrowth = isNum(d.population_growth_pct) ? d.population_growth_pct >= 0.5 : null;
  const meetsJobGrowth = isNum(d.job_growth_pct) ? d.job_growth_pct >= 0.5 : null;
  const incomeForCheck = isNum(d.area_median_income_1mi)
    ? d.area_median_income_1mi
    : isNum(d.median_income_tract)
    ? d.median_income_tract
    : null;
  const meetsIncome = isNum(incomeForCheck) ? incomeForCheck >= 55_000 : null;

  const hasInPlace =
    isNum(d.gross_scheduled_rent) ||
    isNum(d.occupancy_pct) ||
    isNum(d.t12_noi) ||
    isNum(d.in_place_cap_rate) ||
    isNum(d.expense_ratio) ||
    isNum(d.grm);

  const hasProForma =
    isNum(d.stabilized_rent) ||
    isNum(d.renovation_budget_per_unit) ||
    isNum(d.total_capex) ||
    isNum(d.stabilized_noi) ||
    isNum(d.stabilized_cap_rate);

  const hasReturns =
    isNum(d.projected_irr) ||
    isNum(d.equity_multiple) ||
    isNum(d.year1_coc) ||
    isNum(d.dscr) ||
    isNum(d.ltv) ||
    isNum(d.interest_rate) ||
    isNum(d.loan_term_years) ||
    isNum(d.hold_period_years) ||
    isNum(d.exit_cap);

  const rentComps: any[] = Array.isArray(d.rent_comps) ? d.rent_comps : [];
  const salesComps: any[] = Array.isArray(d.sales_comps) ? d.sales_comps : [];
  const documents: any[] = Array.isArray(d.documents) ? d.documents : [];

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      {/* ============ Header ============ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/deals")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex gap-2 flex-wrap justify-end">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={enriching || !hellodataEnabled}>
                          {enriching ? (
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-3 w-3" />
                          )}
                          Refresh Market Data
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Refresh market data?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will use a HelloData API credit. Continue?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleRefreshMarketData}>
                            Use credit & refresh
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </span>
                </TooltipTrigger>
                {!hellodataEnabled && (
                  <TooltipContent>HelloData connector is turned off</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>

            <Button variant="outline" size="sm" onClick={handleRescore} disabled={scoring}>
              {scoring ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-3 w-3" />
              )}
              Re-score
            </Button>
            <ComposeEmailDialog
              trigger={
                <Button variant="outline" size="sm">
                  <Mail className="mr-2 h-3 w-3" /> Email
                </Button>
              }
              defaultSubject={`${title} – Ansonia`}
              defaultBody={`Hi,\n\nWanted to share details on ${title}${
                deal.city ? ` in ${deal.city}` : ""
              }.\n\nBest,\n`}
              dealId={deal.id}
            />
            <NoteComposerDialog
              presetEntity={{ entity_type: "deal", entity_id: deal.id, label: title }}
              trigger={
                <Button variant="outline" size="sm">
                  <StickyNote className="mr-2 h-3 w-3" /> Add note
                </Button>
              }
            />
            <Button variant="outline" size="sm" onClick={() => navigate(`/deals/${id}/edit`)}>
              <Pencil className="mr-2 h-3 w-3" /> Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="mr-2 h-3 w-3" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
                  <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-display tracking-tight truncate">{title}</h1>
            {subTitle && (
              <p className="text-sm text-muted-foreground mt-1 tabular-nums">{subTitle}</p>
            )}
            <div className="flex items-center gap-3 mt-3 flex-wrap text-xs text-muted-foreground">
              {deal.broker && (
                <span>
                  Broker: <span className="text-foreground">{deal.broker}</span>
                </span>
              )}
              {deal.source && (
                <span>
                  Source: <span className="text-foreground">{deal.source}</span>
                </span>
              )}
              {isNum(deal.asking_price) && (
                <span>
                  Asking:{" "}
                  <span className="text-foreground font-serif-display tabular-nums">
                    {fmtMillions(deal.asking_price)}
                  </span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <FitBadge tier={d.deal_tier ?? null} />
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Pipeline Stage
              </span>
              <DealStatusBadge status={getStatus(deal)} />
            </div>
          </div>
        </div>
      </div>

      <Separator />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="capital-raise">Capital Raise</TabsTrigger>
        </TabsList>
        <TabsContent value="capital-raise" className="mt-6">
          <CapitalRaiseTab deal={deal} />
        </TabsContent>
        <TabsContent value="overview" className="mt-6 space-y-8">

      {/* Gallery + Map intentionally removed for performance */}

      {/* ============ Key Stats Row ============ */}
      <section>
        <SectionHeader title="Key Stats" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          <Stat label="Units" value={fmtInt(deal.unit_count)} meets={meetsUnits} />
          <Stat label="Vintage" value={deal.vintage_year} meets={meetsVintage} />
          <Stat
            label="Rent vs Market"
            value={
              isNum(rentDeltaPct) ? (
                <span className={cn(rentDeltaPct <= -10 && "text-emerald-600")}>
                  {rentDeltaPct <= 0
                    ? `${Math.abs(rentDeltaPct).toFixed(1)}% below`
                    : `${rentDeltaPct.toFixed(1)}% above`}
                </span>
              ) : null
            }
            meets={meetsRentLag}
          />
          <Stat
            label="New Supply"
            value={fmtPct(d.new_supply_pct_of_stock)}
            meets={meetsSupply}
          />
          <Stat
            label="Pop Growth"
            value={fmtPct(d.population_growth_pct)}
            meets={meetsPopGrowth}
          />
          <Stat label="Job Growth" value={fmtPct(d.job_growth_pct)} meets={meetsJobGrowth} />
          <Stat label="Median Income" value={fmtMoney(incomeForCheck)} meets={meetsIncome} />
        </div>
      </section>

      {/* ============ Buybox Assessment ============ */}
      <section>
        <SectionHeader title="Buybox Assessment" />
        <Card className="surface-card border-hairline">
          <CardContent className="pt-4">
            <ul>
              <CriterionRow
                label="150+ units"
                pass={meetsUnits}
                actual={fmtInt(deal.unit_count)}
              />
              <CriterionRow
                label="1990s–2010s vintage"
                pass={meetsVintage}
                actual={deal.vintage_year}
              />
              <CriterionRow
                label="Rents 10%+ below market"
                pass={meetsRentLag}
                actual={
                  isNum(rentDeltaPct)
                    ? `${rentDeltaPct >= 0 ? "+" : ""}${rentDeltaPct.toFixed(1)}%`
                    : null
                }
              />
              <CriterionRow
                label="<5% new supply"
                pass={meetsSupply}
                actual={fmtPct(d.new_supply_pct_of_stock)}
              />
              <CriterionRow
                label="Population growth above nat'l avg"
                pass={meetsPopGrowth}
                actual={fmtPct(d.population_growth_pct)}
              />
              <CriterionRow
                label="Job growth above nat'l avg"
                pass={meetsJobGrowth}
                actual={fmtPct(d.job_growth_pct)}
              />
              <CriterionRow
                label="Median income ≥ $55K"
                pass={meetsIncome}
                actual={fmtMoney(incomeForCheck)}
              />
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* ============ AI Score + Buybox Fit ============ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {deal.ai_score != null && (
          <div className="md:col-span-2">
            <ScoreBreakdown data={deal.pillar_scores as any} summary={deal.ai_score_summary} />
          </div>
        )}
        <BuyboxFitCard
          factorScores={d.factor_scores ?? null}
          totalScore={d.total_score ?? null}
          dealTier={d.deal_tier ?? null}
          passesHardFilters={d.passes_hard_filters ?? null}
          hardFilterFailures={d.hard_filter_failures ?? null}
          scoredAt={d.scored_at ?? null}
        />
        <div className="md:col-span-2">
          <AnalystGradeCard dealId={deal.id} value={d.analyst_grade ?? null} />
        </div>
        <PropertyResearchPanel
          dealId={deal.id}
          address={deal.property_address || [deal.property_name, deal.city, deal.state].filter(Boolean).join(", ") || null}
          propertyName={deal.property_name}
        />
      </div>

      {/* ============ Financial Underwriting ============ */}
      {(isNum(deal.asking_price) || hasInPlace || hasProForma || hasReturns) && (
        <section>
          <SectionHeader title="Financial Underwriting" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pricing */}
            {(isNum(deal.asking_price) || isNum(pricePerUnit) || isNum(d.price_per_sqft)) && (
              <Card className="surface-card border-hairline">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display">
                    Pricing
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2">
                  <Stat label="Asking Price" value={fmtMillions(deal.asking_price)} />
                  <Stat label="$ / Unit" value={fmtMoney(pricePerUnit)} />
                  <Stat label="$ / Sq Ft" value={fmtMoney(d.price_per_sqft, 2)} />
                </CardContent>
              </Card>
            )}

            {/* In-Place Performance */}
            {hasInPlace && (
              <Card className="surface-card border-hairline">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display">
                    In-Place Performance
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2">
                  <Stat label="Gross Sched. Rent" value={fmtMoney(d.gross_scheduled_rent)} />
                  <Stat label="Occupancy" value={fmtPct(d.occupancy_pct)} />
                  <Stat label="T-12 NOI" value={fmtMoney(d.t12_noi)} />
                  <Stat label="In-Place Cap" value={fmtPct(d.in_place_cap_rate, 2)} />
                  <Stat label="Expense Ratio" value={fmtPct(d.expense_ratio)} />
                  <Stat label="GRM" value={isNum(d.grm) ? d.grm.toFixed(2) : null} />
                </CardContent>
              </Card>
            )}

            {/* Pro Forma / Value Add */}
            {hasProForma && (
              <Card className="surface-card border-hairline">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display">
                    Value-Add / Pro Forma
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2">
                  <Stat
                    label="Stabilized Rent"
                    value={fmtMoney(d.stabilized_rent)}
                    hint={
                      isNum(d.stabilized_rent) && isNum(d.in_place_avg_rent)
                        ? `+${fmtMoney(d.stabilized_rent - d.in_place_avg_rent)} vs in-place`
                        : undefined
                    }
                  />
                  <Stat label="Reno / Unit" value={fmtMoney(d.renovation_budget_per_unit)} />
                  <Stat label="Total CapEx" value={fmtMoney(d.total_capex)} />
                  <Stat label="Stabilized NOI" value={fmtMoney(d.stabilized_noi)} />
                  <Stat label="Stabilized Cap" value={fmtPct(d.stabilized_cap_rate, 2)} />
                  <Stat label="Value-Add Upside" value={fmtMoney(d.value_add_upside)} />
                </CardContent>
              </Card>
            )}

            {/* Returns & Financing */}
            {hasReturns && (
              <Card className="surface-card border-hairline">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display">
                    Returns & Financing
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2">
                  <Stat label="Projected IRR" value={fmtPct(d.projected_irr)} />
                  <Stat label="Equity Multiple" value={fmtMultiple(d.equity_multiple)} />
                  <Stat label="Yr 1 Cash-on-Cash" value={fmtPct(d.year1_coc)} />
                  <Stat label="DSCR" value={isNum(d.dscr) ? d.dscr.toFixed(2) : null} />
                  <Stat label="LTV" value={fmtPct(d.ltv)} />
                  <Stat label="Interest Rate" value={fmtPct(d.interest_rate, 2)} />
                  <Stat label="Loan Term" value={fmtYears(d.loan_term_years)} />
                  <Stat label="Hold Period" value={fmtYears(d.hold_period_years)} />
                  <Stat label="Exit Cap" value={fmtPct(d.exit_cap, 2)} />
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}

      {/* ============ Comps ============ */}
      {(rentComps.length > 0 || salesComps.length > 0) && (
        <section>
          <SectionHeader title="Comparables" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {rentComps.length > 0 && (
              <Card className="surface-card border-hairline">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display">
                    Rent Comps
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Property</th>
                        <th className="text-left px-3 py-2 font-medium">Unit</th>
                        <th className="text-right px-3 py-2 font-medium">Rent</th>
                        <th className="text-right px-3 py-2 font-medium">$/SF</th>
                        <th className="text-right px-3 py-2 font-medium">Dist.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rentComps.map((c, i) => (
                        <tr key={i} className="border-t border-hairline">
                          <td className="px-3 py-2">{c.property ?? "—"}</td>
                          <td className="px-3 py-2">{c.unit_type ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtMoney(c.rent) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtMoney(c.price_per_sqft, 2) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {isNum(c.distance) ? `${c.distance.toFixed(1)} mi` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
            {salesComps.length > 0 && (
              <Card className="surface-card border-hairline">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display">
                    Sales Comps
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Property</th>
                        <th className="text-right px-3 py-2 font-medium">Price</th>
                        <th className="text-right px-3 py-2 font-medium">$/Unit</th>
                        <th className="text-right px-3 py-2 font-medium">Cap</th>
                        <th className="text-right px-3 py-2 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesComps.map((c, i) => (
                        <tr key={i} className="border-t border-hairline">
                          <td className="px-3 py-2">{c.property ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtMoney(c.price) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtMoney(c.price_per_unit) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtPct(c.cap_rate, 2) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {c.sale_date
                              ? new Date(c.sale_date).toLocaleDateString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}

      {/* ============ HelloData Enrichment ============ */}
      <section>
        <SectionHeader
          title="HelloData Market Intel"
          right={
            deal.hellodata_last_synced_at && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                Synced {new Date(deal.hellodata_last_synced_at).toLocaleString()}
              </span>
            )
          }
        />
        {d.hellodata_error ? (
          <Card className="surface-card border-hairline border-destructive/40">
            <CardContent className="py-3 flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <span>
                Market data unavailable —{" "}
                <span className="text-muted-foreground">{d.hellodata_error}</span>
              </span>
            </CardContent>
          </Card>
        ) : deal.hellodata_last_synced_at ? (
          <Card className="surface-card border-hairline">
            <CardContent className="pt-4 space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="MSA" value={deal.msa} />
                <Stat label="Building Quality" value={
                  isNum(d.building_quality_score) ? `${d.building_quality_score}/100` : null
                } />
                <Stat label="In-Place Avg Rent" value={fmtMoney(d.in_place_avg_rent)} />
                <Stat
                  label="Avg Days on Market"
                  value={isNum(d.avg_time_on_market) ? `${d.avg_time_on_market}d` : null}
                />
                <Stat label="Median Rent (tract)" value={fmtMoney(d.median_rent_tract)} />
                <Stat label="Median Income (tract)" value={fmtMoney(d.median_income_tract)} />
                <Stat label="Vacancy (tract)" value={fmtPct(d.vacancy_rate_tract)} />
                <Stat
                  label="Avg Rating"
                  value={
                    isNum(d.review_avg_rating)
                      ? `${d.review_avg_rating.toFixed(2)} / 5`
                      : null
                  }
                />
              </div>

              {Array.isArray(d.floor_plans) && d.floor_plans.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Floor Plans
                  </h4>
                  <div className="border border-hairline rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-xs">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Beds</th>
                          <th className="text-right px-3 py-2 font-medium">Units</th>
                          <th className="text-right px-3 py-2 font-medium">Avg Rent</th>
                          <th className="text-right px-3 py-2 font-medium">Avg SqFt</th>
                          <th className="text-right px-3 py-2 font-medium">DOM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(d.floor_plans as any[]).map((fp, i) => (
                          <tr key={i} className="border-t border-hairline">
                            <td className="px-3 py-2">{fp.beds}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {fp.unit_count ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {fmtMoney(fp.avg_rent) ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {fp.avg_sqft ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {fp.avg_days_on_market != null ? `${fp.avg_days_on_market}d` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">No HelloData enrichment yet.</p>
        )}
      </section>

      {/* ============ Demographics (Esri) ============ */}
      <DemographicsPanel
        dealId={deal.id}
        address={
          deal.property_address ||
          [deal.property_name, deal.city, deal.state].filter(Boolean).join(", ") ||
          null
        }
      />

      {/* ============ Documents ============ */}
      {documents.length > 0 && (
        <section>
          <SectionHeader title="Documents" />
          <Card className="surface-card border-hairline">
            <CardContent className="pt-4 divide-y divide-hairline">
              {documents.map((doc, i) => (
                <a
                  key={i}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 py-2 text-sm hover:bg-muted/30 px-2 -mx-2 rounded"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{doc.name || doc.url}</span>
                  {doc.type && (
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {doc.type}
                    </Badge>
                  )}
                </a>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ============ Status History ============ */}
      <section>
        <SectionHeader title="Status History" />
        <DealStatusHistory dealId={deal.id} />
      </section>

      {/* ============ Notes & Details ============ */}

      <section>
        <SectionHeader title="Notes & Details" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="surface-card border-hairline">
            <CardContent className="pt-4">
              <KV label="Broker" value={deal.broker} />
              <KV label="Source" value={deal.source} />
              <KV label="Marketed" value={deal.marketed ? "Yes" : "No"} />
              <KV label="Affordable" value={deal.affordable ? "Yes" : "No"} />
              <KV label="Value-Add Potential" value={deal.value_add_potential} />
              <KV label="Address" value={deal.property_address || deal.address} />
              <KV label="ZIP" value={deal.zip} />
              <KV
                label="Phone"
                value={deal.property_phone}
              />
              <KV
                label="Website"
                value={
                  safeExternalUrl(deal.property_website) ? (
                    <a
                      href={safeExternalUrl(deal.property_website)!}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {deal.property_website!.replace(/^https?:\/\//, "")}
                    </a>
                  ) : null
                }
              />
              <KV label="Management Co." value={deal.management_company} />
            </CardContent>
          </Card>
          <DealNotes dealId={deal.id} />
        </div>
        {deal.notes && (
          <Card className="surface-card border-hairline mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display">
                Legacy Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NoteContent content={deal.notes} className="text-muted-foreground" />
            </CardContent>
          </Card>
        )}
      </section>

        </TabsContent>
      </Tabs>
    </div>
  );
}
