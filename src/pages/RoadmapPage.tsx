import { useMemo, useState } from "react";
import { Map as MapIcon, CheckCircle2, Circle, Loader2, Lightbulb, Plus, X, Pencil, Zap, Activity, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useRoadmap, type RoadmapItem, type RoadmapStatus as Status, type RoadmapPriority as Priority } from "@/hooks/useRoadmap";

type Item = RoadmapItem;

type CompletionRule = { check: string; min?: number };

const RULE_EXPLAIN: Record<string, (min: number) => string> = {
  inbox_has_deals: () => "Auto-completes when any deals appear in the acquisitions inbox.",
  deals_gated: (min) => `Auto-completes when ${min}+ inbox deals have been screened by the gate.`,
  fields_extracted: (min) => `Auto-completes when ${min}+ inbox deals have units or year-built extracted.`,
  deals_scored: (min) => `Auto-completes when ${min}+ inbox deals have a fit score.`,
  sync_recent: () => "Auto-completes when broker emails have arrived in the last 24 hours.",
  partners_exist: () => "Auto-completes when capital partners exist in the CRM.",
};

function explainRule(rule: CompletionRule | null | undefined): string {
  if (!rule?.check) return "Auto-completes from a live data signal.";
  const fn = RULE_EXPLAIN[rule.check];
  return fn ? fn(typeof rule.min === "number" ? rule.min : 1) : "Auto-completes from a live data signal.";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}


const PHASES = [
  "Acquisition Inbox",
  "Deal Scoring Engine",
  "Capital Partner Matching",
  "Data Quality & Validation",
  "Deal Pipeline",
  "Capital Partners",
  "Notes & Tagging",
  "Dashboard & Export",
];

const STRATEGIC_PRIORITIES: { phase: string; thesis: string }[] = [
  { phase: "Deal Scoring Engine", thesis: "A score we trust — explicit thesis, real data, calibrated to outcomes." },
  { phase: "Capital Partner Matching", thesis: "Right deal, right partner, at scale — without losing the personal touch." },
  { phase: "Data Quality & Validation", thesis: "Trust the inputs so we can trust everything built on top." },
];

const STATUS_META: Record<Status, { label: string; icon: typeof CheckCircle2; chip: string; headerSurface: string; dot: string }> = {
  shipped: {
    label: "Shipped",
    icon: CheckCircle2,
    chip: "bg-tier-strong-bg text-tier-strong-fg border-tier-strong-fg/25",
    headerSurface: "bg-tier-strong-bg/60 text-tier-strong-fg border-tier-strong-fg/20",
    dot: "bg-tier-strong-fg",
  },
  in_progress: {
    label: "In Progress",
    icon: Loader2,
    chip: "bg-primary/10 text-primary border-primary/25",
    headerSurface: "bg-primary/5 text-primary border-primary/20",
    dot: "bg-primary",
  },
  planned: {
    label: "Planned",
    icon: Circle,
    chip: "bg-tier-medium-bg text-[hsl(28_85%_26%)] border-tier-medium-fg/40",
    headerSurface: "bg-tier-medium-bg/60 text-[hsl(28_85%_26%)] border-tier-medium-fg/30",
    dot: "bg-tier-medium-fg",
  },
  idea: {
    label: "Idea",
    icon: Lightbulb,
    chip: "bg-muted text-foreground border-hairline",
    headerSurface: "bg-muted/40 text-foreground border-hairline",
    dot: "bg-muted-foreground",
  },
};

const PRIORITY_META: Record<Priority, string> = {
  P0: "bg-destructive text-destructive-foreground border-destructive",
  P1: "bg-primary/10 text-primary border-primary/25",
  P2: "bg-muted text-foreground border-hairline",
  P3: "bg-transparent text-foreground border-hairline",
};

const STATUS_ORDER: Status[] = ["shipped", "in_progress", "planned", "idea"];
const PRIORITY_ORDER: Priority[] = ["P0", "P1", "P2", "P3"];

const PRIORITY_INFO: Record<Priority, { label: string; description: string }> = {
  P0: { label: "Critical", description: "Must ship immediately — blocks other work if not done." },
  P1: { label: "High", description: "Ship soon — important for near-term milestones." },
  P2: { label: "Medium", description: "Nice to have — improves the product meaningfully." },
  P3: { label: "Low", description: "Backlog / someday — worth tracking but not urgent." },
};
type Draft = {
  title: string;
  description: string;
  phase: string;
  status: Status;
  priority: Priority;
};

const EMPTY_DRAFT: Draft = {
  title: "",
  description: "",
  phase: "Acquisition Inbox",
  status: "idea",
  priority: "P2",
};

export default function RoadmapPage() {
  const { items, events, createItem, updateItem, deleteItem } = useRoadmap();
  const [view, setView] = useState<"board" | "phase" | "priority">("board");
  const [filterPhase, setFilterPhase] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT, phase: PHASES[0] });
  const [editDraft, setEditDraft] = useState<Draft>({ ...EMPTY_DRAFT, phase: PHASES[0] });

  const filtered = useMemo(
    () => (filterPhase === "all" ? items : items.filter(i => i.phase === filterPhase)),
    [items, filterPhase]
  );

  const counts = useMemo(() => {
    const c: Record<Status, number> = { shipped: 0, in_progress: 0, planned: 0, idea: 0 };
    items.forEach(i => { c[i.status]++; });
    return c;
  }, [items]);

  const progress = items.length ? Math.round((counts.shipped / items.length) * 100) : 0;

  const updateStatus = (item: Item, status: Status) => {
    if (status === item.status) return;
    updateItem.mutate({ id: item.id, prev: item, patch: { status } });
  };

  const updatePriority = (item: Item, priority: Priority) => {
    if (priority === item.priority) return;
    updateItem.mutate({ id: item.id, prev: item, patch: { priority } });
  };

  const removeItem = (id: string) => deleteItem.mutate(id);

  const addItem = () => {
    if (!draft.title.trim()) return;
    createItem.mutate(
      {
        title: draft.title,
        description: draft.description,
        phase: draft.phase,
        status: draft.status,
        priority: draft.priority,
        sort_order: items.length + 1,
      },
      {
        onSuccess: () => {
          setDraft({ ...EMPTY_DRAFT, phase: PHASES[0] });
          setOpen(false);
        },
      }
    );
  };

  const openEdit = (item: Item) => {
    setEditingId(item.id);
    setEditDraft({
      title: item.title,
      description: item.description ?? "",
      phase: item.phase,
      status: item.status,
      priority: item.priority,
    });
    setEditOpen(true);
  };

  const saveEdit = () => {
    if (!editingId || !editDraft.title.trim()) return;
    const prev = items.find(i => i.id === editingId);
    if (!prev) return;
    updateItem.mutate(
      {
        id: editingId,
        prev,
        patch: {
          title: editDraft.title,
          description: editDraft.description,
          phase: editDraft.phase,
          status: editDraft.status,
          priority: editDraft.priority,
        },
      },
      {
        onSuccess: () => {
          setEditOpen(false);
          setEditingId(null);
        },
      }
    );
  };


  const markShipped = (item: Item) => {
    updateItem.mutate({ id: item.id, prev: item, patch: { status: "shipped" } });
  };

  const ItemCard = ({ item }: { item: Item }) => {
    const meta = STATUS_META[item.status];
    const rule = (item.completion_rule as CompletionRule | null) ?? null;
    const isShipped = item.status === "shipped";
    return (
      <div className="surface-card p-3 group transition-shadow">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              <span className={`chip-tier ${PRIORITY_META[item.priority]}`}>{item.priority}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-[0.12em]">{item.phase}</span>
              {rule && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="chip-tier bg-primary/10 text-primary border-primary/25 inline-flex items-center gap-0.5 cursor-help">
                        <Zap className="h-2.5 w-2.5" /> Auto
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px] text-xs">
                      {explainRule(rule)}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="font-display font-semibold text-sm leading-snug text-foreground">{item.title}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.description}</div>
            {isShipped && item.completed_at && (
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-2 tabular-nums flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-tier-strong-fg" />
                {item.auto_completed ? "Auto-completed" : "Shipped"} {fmtDate(item.completed_at)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => openEdit(item)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              aria-label="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => removeItem(item.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              aria-label="Delete"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-hairline flex-wrap">
          <Select value={item.status} onValueChange={(v) => updateStatus(item, v as Status)}>
            <SelectTrigger className={`h-6 text-[11px] px-2 border w-auto gap-1 uppercase tracking-[0.06em] font-medium ${meta.chip}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={item.priority} onValueChange={(v) => updatePriority(item, v as Priority)}>
            <SelectTrigger className={`h-6 text-[11px] px-2 border w-auto gap-1 uppercase tracking-[0.06em] font-medium ${PRIORITY_META[item.priority]}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["P0","P1","P2","P3"] as Priority[]).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          {!isShipped && (
            <button
              onClick={() => markShipped(item)}
              className="h-6 px-2 ml-auto border border-tier-strong-fg/30 bg-tier-strong-bg/60 text-tier-strong-fg rounded text-[10px] uppercase tracking-[0.08em] font-medium inline-flex items-center gap-1 hover:bg-tier-strong-bg transition-colors"
              title="Mark this item as shipped"
            >
              <Check className="h-3 w-3" /> Mark shipped
            </button>
          )}
        </div>
      </div>
    );
  };

  const ActivityPanel = () => {
    const itemById = new Map(items.map(i => [i.id, i]));
    const recent = events.slice(0, 12);
    return (
      <div className="surface-card p-4">
        <div className="flex items-end justify-between mb-3 pb-2 border-b border-hairline">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-semibold text-foreground">Activity</h2>
          </div>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Most recent</span>
        </div>
        {recent.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No activity yet.</div>
        ) : (
          <ul className="divide-y divide-hairline">
            {recent.map((ev: any) => {
              const item = itemById.get(ev.item_id);
              const title = item?.title ?? "(removed item)";
              const isShipped = ev.to_status === "shipped";
              const verb =
                ev.event_type === "auto_completed" ? "auto-completed"
                : ev.event_type === "marked_shipped" ? `marked shipped by ${ev.actor ?? "unknown"}`
                : `${ev.from_status ?? "—"} → ${ev.to_status ?? "—"}${ev.actor ? ` by ${ev.actor}` : ""}`;
              return (
                <li key={ev.id} className="flex items-baseline gap-2 py-1.5 text-xs">
                  <span className={isShipped ? "text-tier-strong-fg" : "text-muted-foreground"}>
                    {isShipped ? "✓" : "•"}
                  </span>
                  <span className="font-display font-medium text-foreground truncate flex-1 min-w-0">{title}</span>
                  <span className="text-muted-foreground truncate">— {verb}</span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums whitespace-nowrap">
                    {fmtDate(ev.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };



  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <div className="flex items-end justify-between border-b border-hairline pb-4 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <MapIcon className="h-5 w-5 text-primary" />
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Product Roadmap</h1>
          </div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            What we're building · where each piece stands · what's next
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add idea</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add roadmap item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
              <Textarea placeholder="Description" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
              <div className="grid grid-cols-3 gap-2">
                <Select value={draft.phase} onValueChange={v => setDraft({ ...draft, phase: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PHASES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v as Status })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={draft.priority} onValueChange={v => setDraft({ ...draft, priority: v as Priority })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(["P0","P1","P2","P3"] as Priority[]).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={addItem}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit roadmap item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Title" value={editDraft.title} onChange={e => setEditDraft({ ...editDraft, title: e.target.value })} />
              <Textarea placeholder="Description" value={editDraft.description} onChange={e => setEditDraft({ ...editDraft, description: e.target.value })} />
              <div className="grid grid-cols-3 gap-2">
                <Select value={editDraft.phase} onValueChange={v => setEditDraft({ ...editDraft, phase: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PHASES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={editDraft.status} onValueChange={v => setEditDraft({ ...editDraft, status: v as Status })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={editDraft.priority} onValueChange={v => setEditDraft({ ...editDraft, priority: v as Priority })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(["P0","P1","P2","P3"] as Priority[]).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={saveEdit}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Strategic Priorities */}
      <div>
        <div className="flex items-end justify-between border-b border-hairline pb-2 mb-3">
          <h2 className="font-display text-base font-semibold text-foreground">Strategic Priorities</h2>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">The big bets</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {STRATEGIC_PRIORITIES.map(sp => {
            const phaseItems = items.filter(i => i.phase === sp.phase);
            const rollup = STATUS_ORDER
              .map(s => ({ s, n: phaseItems.filter(i => i.status === s).length }))
              .filter(x => x.n > 0)
              .map(x => `${x.n} ${STATUS_META[x.s].label.toLowerCase()}`)
              .join(" · ");
            return (
              <div key={sp.phase} className="surface-card p-4 border-l-2 border-l-primary">
                <div className="font-display text-[13px] font-semibold text-primary uppercase tracking-[0.08em]">{sp.phase}</div>
                <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{sp.thesis}</div>
                <div className="text-[10px] uppercase tracking-[0.12em] mt-3 pt-2 border-t border-hairline text-foreground/70 tabular-nums">{rollup || "no items"}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress + counts */}
      <div className="surface-card p-4">
        <div className="flex items-end justify-between mb-3 pb-2 border-b border-hairline">
          <h2 className="font-display text-base font-semibold text-foreground">Overall Progress</h2>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
            <span className="font-serif-display text-foreground text-sm mr-1">{counts.shipped}</span>
            of <span className="font-serif-display text-foreground text-sm mx-1">{items.length}</span> shipped · {progress}%
          </div>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="grid grid-cols-4 gap-3 mt-4">
          {STATUS_ORDER.map(s => {
            const meta = STATUS_META[s];
            const Icon = meta.icon;
            return (
              <div key={s} className={`rounded border px-3 py-2.5 ${meta.headerSurface}`}>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-medium">
                  <Icon className="h-3 w-3" />
                  <span>{meta.label}</span>
                </div>
                <div className="font-serif-display text-[26px] font-medium leading-none tabular-nums mt-2 text-foreground">{counts[s]}</div>
              </div>
            );
          })}
        </div>
      </div>

      <ActivityPanel />



      {/* Priority legend */}
      <div className="surface-card p-4">
        <div className="flex items-end justify-between mb-3 pb-2 border-b border-hairline">
          <h2 className="font-display text-base font-semibold text-foreground">Priority Guide</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PRIORITY_ORDER.map(p => {
            const info = PRIORITY_INFO[p];
            return (
              <div key={p} className={`rounded border px-3 py-2 ${PRIORITY_META[p]}`}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]">
                  <span className="tabular-nums">{p}</span>
                  <span className="opacity-75">— {info.label}</span>
                </div>
                <div className="text-[11px] mt-1 leading-snug opacity-90">{info.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <div className="inline-flex rounded border border-hairline p-0.5 bg-card">
          <button
            onClick={() => setView("board")}
            className={`px-3 py-1 text-[11px] uppercase tracking-[0.08em] font-medium rounded ${view === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >By Status</button>
          <button
            onClick={() => setView("phase")}
            className={`px-3 py-1 text-[11px] uppercase tracking-[0.08em] font-medium rounded ${view === "phase" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >By Phase</button>
          <button
            onClick={() => setView("priority")}
            className={`px-3 py-1 text-[11px] uppercase tracking-[0.08em] font-medium rounded ${view === "priority" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >By Priority</button>
        </div>
        <Select value={filterPhase} onValueChange={setFilterPhase}>
          <SelectTrigger className="h-8 text-xs w-[220px] border-hairline"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All phases</SelectItem>
            {PHASES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {view === "board" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {STATUS_ORDER.map(s => {
            const meta = STATUS_META[s];
            const Icon = meta.icon;
            const colItems = filtered.filter(i => i.status === s);
            return (
              <div key={s} className="space-y-2.5">
                <div className={`flex items-center justify-between rounded border px-3 py-2 ${meta.headerSurface}`}>
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] font-semibold">
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </div>
                  <span className="font-serif-display text-[15px] font-medium tabular-nums">{colItems.length}</span>
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {colItems.map(item => <ItemCard key={item.id} item={item} />)}
                </div>

              </div>
            );
          })}
        </div>
      ) : view === "phase" ? (
        <div className="space-y-6">
          {PHASES.filter(p => filterPhase === "all" || p === filterPhase).map(phase => {
            const phaseItems = filtered.filter(i => i.phase === phase);
            if (phaseItems.length === 0) return null;
            const shipped = phaseItems.filter(i => i.status === "shipped").length;
            const pct = Math.round((shipped / phaseItems.length) * 100);
            return (
              <div key={phase}>
                <div className="flex items-end justify-between mb-2 pb-1.5 border-b border-hairline">
                  <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-foreground">{phase}</h2>
                  <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                    <span className="font-serif-display text-foreground text-sm mr-0.5">{shipped}</span>/<span className="font-serif-display text-foreground text-sm mx-0.5">{phaseItems.length}</span> shipped · {pct}%
                  </span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {phaseItems.map(item => <ItemCard key={item.id} item={item} />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PRIORITY_ORDER.map(p => {
            const info = PRIORITY_INFO[p];
            const colItems = filtered.filter(i => i.priority === p);
            return (
              <div key={p} className="space-y-2.5">
                <div className={`flex items-center justify-between rounded border px-3 py-2 ${PRIORITY_META[p]}`}>
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] font-semibold">
                    <span className="tabular-nums">{p}</span>
                    <span className="opacity-75">— {info.label}</span>
                  </div>
                  <span className="font-serif-display text-[15px] font-medium tabular-nums">{colItems.length}</span>
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {colItems.map(item => <ItemCard key={item.id} item={item} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
