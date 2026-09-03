import { useState, useEffect } from "react";
import { useBuyBoxPillars, type Signal } from "@/hooks/useBuyBoxPillars";
import { useBuyBoxThesis } from "@/hooks/useBuyBoxThesis";
import { Save, Trash2, Plus, ChevronDown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { CalibrationPanel } from "@/components/CalibrationPanel";
import { LearnedStrategyPanel } from "@/components/LearnedStrategyPanel";
import { PartnerLearningPanel } from "@/components/PartnerLearningPanel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ───────────── Design tokens (institutional PE palette) ─────────────
   NAVY   #002752     SLATE  #5B6472     INK    #1A1F2B
   LINE   #E4E7EC     CANVAS #F7F8FA     CHIP   #F0F2F5
   GREEN  #2E7D5B     AMBER  #B7791F     INFO   #2B5A8A
   ──────────────────────────────────────────────────────────────────── */

const methodChip: Record<string, string> = {
  higher_better: "bg-[#E6F1EB] text-[#2E7D5B]",
  lower_better: "bg-[#FBF1DD] text-[#8A5A12]",
  range_optimal: "bg-[#E4ECF6] text-[#2B5A8A]",
  boolean: "bg-[#E9ECF1] text-[#5B6472]",
};
const methodLabel: Record<string, string> = {
  higher_better: "Higher · better",
  lower_better: "Lower · better",
  range_optimal: "Range · optimal",
  boolean: "Boolean",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5B6472]">
      {children}
    </span>
  );
}

function SignalRow({ s, onUpdate, onDelete }: {
  s: Signal;
  onUpdate: (id: string, updates: Partial<Signal>) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s);
  useEffect(() => setDraft(s), [s]);

  const save = () => {
    onUpdate(s.id, {
      name: draft.name,
      description: draft.description,
      field_source: draft.field_source,
      scoring_method: draft.scoring_method,
      min_value: draft.min_value,
      max_value: draft.max_value,
      optimal_min: draft.optimal_min,
      optimal_max: draft.optimal_max,
      weight_within_pillar: draft.weight_within_pillar,
    });
    setEditing(false);
  };

  // Range bar viz (only for numeric methods)
  const hasRange = s.scoring_method !== "boolean" && (s.min_value != null || s.max_value != null);
  const min = Number(s.min_value ?? 0);
  const max = Number(s.max_value ?? 100);
  const span = Math.max(1, max - min);
  const optStart = s.optimal_min != null ? ((Number(s.optimal_min) - min) / span) * 100 : null;
  const optEnd = s.optimal_max != null ? ((Number(s.optimal_max) - min) / span) * 100 : null;

  return (
    <div
      className={cn(
        "rounded-[12px] border border-[#E4E7EC] bg-white px-4 py-4 transition-shadow",
        !s.is_active && "opacity-60",
        s.is_active && "hover:shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
      )}
    >
      <div className="flex items-start gap-3">
        <Switch
          checked={s.is_active}
          onCheckedChange={(v) => onUpdate(s.id, { is_active: v })}
          className="mt-0.5 data-[state=checked]:bg-[#002752]"
        />
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Signal name" />
              <Input value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description" />
              <div className="grid grid-cols-2 gap-2">
                <Input value={draft.field_source} onChange={(e) => setDraft({ ...draft, field_source: e.target.value })} placeholder="Field source" className="font-mono text-xs" />
                <Select value={draft.scoring_method} onValueChange={(v: any) => setDraft({ ...draft, scoring_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="higher_better">Higher is better</SelectItem>
                    <SelectItem value="lower_better">Lower is better</SelectItem>
                    <SelectItem value="range_optimal">Range optimal</SelectItem>
                    <SelectItem value="boolean">Boolean (presence)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-5 gap-2 items-end">
                <div><Label className="text-xs">Min</Label><Input type="number" value={draft.min_value ?? ""} onChange={(e) => setDraft({ ...draft, min_value: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Max</Label><Input type="number" value={draft.max_value ?? ""} onChange={(e) => setDraft({ ...draft, max_value: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Opt Min</Label><Input type="number" value={draft.optimal_min ?? ""} onChange={(e) => setDraft({ ...draft, optimal_min: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Opt Max</Label><Input type="number" value={draft.optimal_max ?? ""} onChange={(e) => setDraft({ ...draft, optimal_max: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Weight %</Label><Input type="number" value={draft.weight_within_pillar} onChange={(e) => setDraft({ ...draft, weight_within_pillar: Number(e.target.value) })} /></div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={save} className="bg-[#002752] hover:bg-[#001a38] text-white">
                  <Save className="h-3 w-3 mr-1" />Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(s); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="cursor-pointer space-y-2" onClick={() => setEditing(true)}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[#1A1F2B]">{s.name}</span>
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded",
                  methodChip[s.scoring_method] ?? "bg-[#F0F2F5] text-[#5B6472]",
                )}>
                  {methodLabel[s.scoring_method] ?? s.scoring_method}
                </span>
              </div>
              {s.description && <p className="text-[12px] leading-snug text-[#5B6472]">{s.description}</p>}
              <code className="inline-block text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F0F2F5] text-[#1A1F2B] max-w-full truncate">
                {s.field_source}
              </code>

              {hasRange && (
                <div className="pt-1.5">
                  <div className="relative h-[6px] rounded-full bg-[#F0F2F5] overflow-hidden">
                    {optStart != null && optEnd != null && (
                      <div
                        className="absolute inset-y-0 bg-[#2E7D5B]/70"
                        style={{ left: `${Math.max(0, optStart)}%`, width: `${Math.min(100, optEnd) - Math.max(0, optStart)}%` }}
                      />
                    )}
                    <div className="absolute inset-y-0 left-0 right-0 ring-1 ring-inset ring-[#E4E7EC] rounded-full" />
                  </div>
                  <div className="flex justify-between text-[10px] tabular-nums text-[#5B6472] mt-1">
                    <span>{s.min_value ?? "—"}</span>
                    {s.optimal_min != null && (
                      <span className="text-[#2E7D5B] font-semibold">
                        optimal {s.optimal_min}–{s.optimal_max ?? "?"}
                      </span>
                    )}
                    <span>{s.max_value ?? "—"}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[#5B6472]">Weight</div>
            <div className="text-sm font-semibold tabular-nums text-[#1A1F2B]">{s.weight_within_pillar}%</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[#5B6472] hover:text-[#B42318] hover:bg-[#FEF3F2]"
            onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* Sleek allocation bar: each pillar gets a slice of a navy→slate gradient. */
function PillarAllocationBar({
  pillars,
  weights,
}: {
  pillars: { id: string; name: string }[];
  weights: Record<string, number>;
}) {
  const total = Object.values(weights).reduce((s, w) => s + (Number(w) || 0), 0);
  if (total <= 0) return null;
  // Generate evenly-spaced shades between navy and slate
  const navy = [0, 39, 82]; // 002752 (Ansonia brand dark blue)
  const slate = [91, 100, 114]; // 5B6472
  const shade = (i: number) => {
    const t = pillars.length <= 1 ? 0 : i / (pillars.length - 1);
    const c = navy.map((n, k) => Math.round(n + (slate[k] - n) * t));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  };

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex h-[10px] w-full overflow-hidden rounded-full ring-1 ring-inset ring-[#E4E7EC]">
        {pillars.map((p, i) => {
          const w = Number(weights[p.id] ?? 0);
          const pct = (w / total) * 100;
          if (pct <= 0) return null;
          return (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <div
                  className="h-full transition-[width] duration-200 hover:opacity-90"
                  style={{ width: `${pct}%`, background: shade(i) }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-[#1A1F2B] text-white border-0 text-xs">
                <span className="font-semibold">{p.name}</span> · {w}%
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

export default function BuyBoxPage() {
  const { pillars, signals, isLoading, updatePillar, updateSignal, addSignal, deleteSignal } = useBuyBoxPillars();
  const thesisQ = useBuyBoxThesis();

  const [thesisDraft, setThesisDraft] = useState("");
  const [pillarWeights, setPillarWeights] = useState<Record<string, number>>({});
  const [openPillars, setOpenPillars] = useState<Record<string, boolean>>({});
  const [rescoring, setRescoring] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [thesisFocused, setThesisFocused] = useState(false);
  const [calibrationKey, setCalibrationKey] = useState(0);
  const bumpCalibration = () => setCalibrationKey((k) => k + 1);

  useEffect(() => {
    if (thesisQ.data?.content !== undefined) setThesisDraft(thesisQ.data.content);
  }, [thesisQ.data?.content]);

  useEffect(() => {
    if (pillars.length) {
      setPillarWeights(Object.fromEntries(pillars.map((p) => [p.id, p.weight])));
    }
  }, [pillars]);

  if (isLoading) return <div className="p-8 text-center text-[#5B6472]">Loading buy box…</div>;

  // Per-pillar weight bounds (integers, 0-60 each — no single pillar may dominate)
  const WEIGHT_MIN = 0;
  const WEIGHT_MAX = 60;

  const weightErrors: Record<string, string> = {};
  for (const p of pillars) {
    const raw = pillarWeights[p.id];
    if (raw === undefined || raw === null || Number.isNaN(Number(raw))) {
      weightErrors[p.id] = "Required";
    } else if (!Number.isInteger(Number(raw))) {
      weightErrors[p.id] = "Whole number";
    } else if (Number(raw) < WEIGHT_MIN || Number(raw) > WEIGHT_MAX) {
      weightErrors[p.id] = `Must be ${WEIGHT_MIN}–${WEIGHT_MAX}`;
    }
  }
  const hasFieldErrors = Object.keys(weightErrors).length > 0;
  const totalWeight = Object.values(pillarWeights).reduce((s, w) => s + (Number(w) || 0), 0);
  const totalOk = totalWeight === 100;
  const weightsOk = totalOk && !hasFieldErrors;
  const weightsDirty = pillars.some((p) => p.weight !== pillarWeights[p.id]);


  const triggerBackgroundRescore = () => {
    supabase.functions.invoke("score-deals", { body: { since_days: 30 } })
      .then(({ error }) => {
        if (error) console.error("Background rescore failed", error);
        else {
          toast.success("Re-scored recent deals against new buy box");
          bumpCalibration();
        }
      })
      .catch((e) => console.error("Background rescore error", e));
  };

  const saveWeights = () => {
    if (!weightsOk) return toast.error(`Weights must sum to 100% (currently ${totalWeight}%)`);
    pillars.forEach((p) => {
      if (p.weight !== pillarWeights[p.id]) {
        updatePillar.mutate({ id: p.id, updates: { weight: pillarWeights[p.id] } });
      }
    });
    toast.success("Pillar weights saved — re-scoring last 30 days in background");
    triggerBackgroundRescore();
  };

  const saveThesis = () => {
    if (!thesisQ.data?.id) return;
    thesisQ.update.mutate({ id: thesisQ.data.id, content: thesisDraft });
  };

  const handleSignalUpdate = (id: string, updates: Partial<Signal>) => {
    updateSignal.mutate({ id, updates }, { onSuccess: () => triggerBackgroundRescore() });
  };
  const handleSignalDelete = (id: string) => {
    deleteSignal.mutate(id, { onSuccess: () => triggerBackgroundRescore() });
  };
  const handleSignalAdd = (s: Omit<Signal, "id">) => {
    addSignal.mutate(s, { onSuccess: () => triggerBackgroundRescore() });
  };

  const rescoreAll = async () => {
    setRescoring(true);
    setProgress({ done: 0, total: 0 });
    try {
      const { data: deals, error } = await supabase
        .from("inbox_deals")
        .select("id")
        .order("email_received_at", { ascending: false });
      if (error) throw error;
      if (!deals?.length) { toast.info("No deals to score"); return; }
      const total = deals.length;
      setProgress({ done: 0, total });
      toast.info(`Re-scoring ${total} deals…`);
      const BATCH = 8;
      let done = 0;
      for (let i = 0; i < deals.length; i += BATCH) {
        const slice = deals.slice(i, i + BATCH).map((d) => d.id);
        const { error: invErr } = await supabase.functions.invoke("score-deals", { body: { deal_ids: slice } });
        if (invErr) console.error(invErr);
        done += slice.length;
        setProgress({ done, total });
      }
      toast.success(`Scored ${done} of ${total} deals`);
      bumpCalibration();
    } catch (e: any) {
      toast.error(e?.message ?? "Re-score failed");
    } finally {
      setRescoring(false);
    }
  };

  const toggle = (id: string) => setOpenPillars((p) => ({ ...p, [id]: !(p[id] ?? true) }));

  const totalChipLabel = hasFieldErrors
    ? "Invalid weights"
    : `Total ${totalWeight}%${totalOk ? " ✓" : ` (need 100%)`}`;
  const TotalChip = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        weightsOk ? "bg-[#2E7D5B] text-white" : "bg-[#B42318] text-white",
      )}
    >
      {totalChipLabel}
    </span>
  );


  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* ───── Page header ───── */}
      <div className="flex items-end justify-between gap-6 pt-2">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#002752] leading-tight">
            Buy Box
          </h1>
          <p className="mt-1.5 text-[14px] text-[#5B6472]">
            Investment thesis, weighted scoring pillars, and signals.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {rescoring && progress.total > 0 && (
            <div className="flex items-center gap-2">
              <Progress
                value={(progress.done / progress.total) * 100}
                className="h-1.5 w-32 bg-[#E4E7EC] [&>div]:bg-[#002752]"
              />
              <span className="text-[11px] text-[#5B6472] tabular-nums">{progress.done}/{progress.total}</span>
            </div>
          )}
          <Button
            size="sm"
            onClick={rescoreAll}
            disabled={rescoring}
            className="bg-[#002752] hover:bg-[#001a38] text-white h-9 px-4 shadow-none"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", rescoring && "animate-spin")} />
            Re-score all deals
          </Button>
        </div>
      </div>
      <hr className="mt-4 border-[#E4E7EC]" />

      <div className="mt-8 space-y-8">
        {/* ───── Learned Strategy (from analyst denial feedback) ───── */}
        <LearnedStrategyPanel />

        {/* ───── Capital Partner Learning (from partner passes) ───── */}
        <PartnerLearningPanel />

        {/* ───── Score Calibration ───── */}
        <CalibrationPanel refreshKey={calibrationKey} />


        {/* ───── Investment Thesis ───── */}
        <section className="rounded-[8px] border border-[#E4E7EC] bg-white p-6">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Investment Thesis</SectionLabel>
            <span className="text-[11px] text-[#5B6472]">Nudges each score ±10 and writes the rationale.</span>
          </div>
          <Textarea
            value={thesisDraft}
            onChange={(e) => setThesisDraft(e.target.value)}
            onFocus={() => setThesisFocused(true)}
            onBlur={() => setThesisFocused(false)}
            rows={7}
            placeholder="What kind of deals do we want? Edge cases, deal-breakers, target markets, sweet-spot vintage…"
            className={cn(
              "text-[14px] leading-[1.6] bg-[#F7F8FA] resize-none transition-colors",
              "border focus-visible:ring-0 focus-visible:ring-offset-0",
              thesisFocused ? "border-[#002752]" : "border-transparent",
            )}
          />
          <div className="flex justify-end mt-4">
            <Button
              size="sm"
              variant="outline"
              onClick={saveThesis}
              disabled={thesisDraft === thesisQ.data?.content}
              className="h-9 px-4 border-[#002752] text-[#002752] hover:bg-[#002752] hover:text-white shadow-none"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />Save thesis
            </Button>
          </div>
        </section>

        {/* ───── Pillar Weights ───── */}
        <section className="rounded-[8px] border border-[#E4E7EC] bg-white p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="h-4 w-[3px] rounded-full bg-[#002752]" />
              <h2 className="text-[16px] font-semibold text-[#002752]">Pillar Weights</h2>
            </div>
            {TotalChip}
          </div>

          <div className="divide-y divide-[#E4E7EC]">
            {pillars.map((p) => {
              const err = weightErrors[p.id];
              return (
                <div key={p.id} className="flex items-center gap-4 py-3.5 first:pt-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-[#1A1F2B]">{p.name}</div>
                    {p.description && (
                      <div className="text-[12px] text-[#5B6472] mt-0.5">{p.description}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end">
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={WEIGHT_MIN}
                        max={WEIGHT_MAX}
                        step={1}
                        aria-invalid={!!err}
                        value={pillarWeights[p.id] ?? 0}
                        onChange={(e) =>
                          setPillarWeights({
                            ...pillarWeights,
                            [p.id]: e.target.value === "" ? (NaN as unknown as number) : Number(e.target.value),
                          })
                        }
                        className={cn(
                          "w-[64px] h-9 text-right tabular-nums focus-visible:ring-1 focus-visible:ring-offset-0",
                          err
                            ? "border-[#B42318] focus-visible:ring-[#B42318] focus-visible:border-[#B42318]"
                            : "border-[#E4E7EC] focus-visible:ring-[#002752] focus-visible:border-[#002752]",
                        )}
                      />
                      <span className="text-[13px] text-[#5B6472] w-3">%</span>
                    </div>
                    {err && (
                      <span className="mt-1 text-[11px] font-medium text-[#B42318]">{err}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Allocation visualization */}
          <div className="mt-5 space-y-2">
            <SectionLabel>Allocation</SectionLabel>
            <PillarAllocationBar pillars={pillars} weights={pillarWeights} />
          </div>

          <div className="flex items-center justify-between mt-6 gap-4">
            <p className={cn(
              "text-[12px]",
              weightsOk ? "text-[#5B6472]" : "text-[#B42318]",
            )}>
              {hasFieldErrors
                ? `Fix invalid weight${Object.keys(weightErrors).length > 1 ? "s" : ""} to continue.`
                : totalOk
                  ? `Each pillar ${WEIGHT_MIN}–${WEIGHT_MAX}%, total must equal 100%.`
                  : `Total is ${totalWeight}% — must equal 100% to save (off by ${Math.abs(100 - totalWeight)}%).`}
            </p>
            <Button
              size="sm"
              onClick={saveWeights}
              disabled={!weightsDirty || !weightsOk}
              className="bg-[#002752] hover:bg-[#001a38] text-white h-9 px-4 shadow-none disabled:bg-[#E4E7EC] disabled:text-[#5B6472]"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />Save weights
            </Button>
          </div>
        </section>


        {/* ───── Scoring Signals ───── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2.5 px-1">
            <div className="h-4 w-[3px] rounded-full bg-[#002752]" />
            <h2 className="text-[16px] font-semibold text-[#002752]">Scoring Signals</h2>
          </div>

          {pillars.map((pillar) => {
            const pSignals = signals.filter((s) => s.pillar_id === pillar.id).sort((a, b) => a.sort_order - b.sort_order);
            const sigTotal = pSignals.filter((s) => s.is_active).reduce((s, x) => s + x.weight_within_pillar, 0);
            const isOpen = openPillars[pillar.id] ?? true;
            return (
              <Collapsible
                key={pillar.id}
                open={isOpen}
                onOpenChange={() => toggle(pillar.id)}
                className="rounded-[8px] border border-[#E4E7EC] bg-white overflow-hidden"
              >
                <CollapsibleTrigger className="flex items-center gap-3 w-full px-5 py-4 text-left hover:bg-[#F7F8FA] transition-colors">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-[#5B6472] transition-transform duration-150",
                      !isOpen && "-rotate-90",
                    )}
                  />
                  <span className="text-[14px] font-semibold text-[#1A1F2B]">{pillar.name}</span>
                  <span className="text-[12px] text-[#5B6472]">({pillar.weight}% of total)</span>
                  <span
                    className={cn(
                      "ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      sigTotal === 100 ? "bg-[#2E7D5B] text-white" : "bg-[#FBF1DD] text-[#8A5A12]",
                    )}
                  >
                    Signal weights {sigTotal}%
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1 duration-150">
                  <div className="px-5 pb-5 pt-1 space-y-2.5 border-t border-[#E4E7EC]">
                    <div className="pt-3" />
                    {pSignals.map((s) => (
                      <SignalRow
                        key={s.id}
                        s={s}
                        onUpdate={handleSignalUpdate}
                        onDelete={handleSignalDelete}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => handleSignalAdd({
                        pillar_id: pillar.id,
                        name: "New signal",
                        description: "",
                        field_source: "deals.",
                        scoring_method: "higher_better",
                        min_value: 0,
                        max_value: 100,
                        optimal_min: null,
                        optimal_max: null,
                        weight_within_pillar: 10,
                        is_active: true,
                        sort_order: pSignals.length,
                      })}
                      className="w-full rounded-[12px] border border-dashed border-[#CDD3DC] text-[#5B6472] hover:text-[#002752] hover:border-[#002752] py-2.5 text-[13px] font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add signal
                    </button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </section>
      </div>
    </div>
  );
}
