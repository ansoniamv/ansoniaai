// Capital Intelligence: "who are our best Core+ money sources?" answered without
// a deal. One list per strategy, ranked by what the notes say first, then the
// checkbox, warmth and capital status. See src/lib/capitalIntelligence.ts.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";
import { Check, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WarmthBadge } from "@/components/WarmthBadge";
import { usePartners } from "@/hooks/usePartners";
import { useRefreshStrategyReads, useStrategyReads } from "@/hooks/useStrategyReads";
import {
  BOX_POINTS,
  BUCKET_BOX_FIELD,
  BUCKET_LABEL,
  EVIDENCE_POINTS,
  LEVEL_LABEL,
  STRATEGY_BUCKETS,
  evidenceCounts,
  rankBucket,
  type Level,
  type RankedSource,
  type StrategyBucket,
} from "@/lib/capitalIntelligence";
import { bandLabel } from "@/lib/partnerPipelineFit";
import { cn } from "@/lib/utils";

const LEVEL_TONE: Record<Level, string> = {
  dedicated: "bg-primary text-primary-foreground border-primary",
  active: "bg-primary/15 text-primary dark:text-foreground border-primary/30",
  open: "bg-primary/5 text-primary dark:text-foreground border-primary/20",
  none: "bg-transparent text-muted-foreground border-dashed border-border",
  avoids: "bg-destructive/10 text-destructive border-destructive/30",
};

function EvidenceBadge({ level, unread }: { level: Level; unread: boolean }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap text-[10px] font-medium px-2 py-0.5 rounded-full border", LEVEL_TONE[level])}>
      {unread && level === "none" ? "Box only · notes not read" : LEVEL_LABEL[level]}
    </span>
  );
}

function SourceRow({ r, rank, bucket }: { r: RankedSource; rank: number; bucket: StrategyBucket }) {
  const [open, setOpen] = useState(false);
  const level = r.read?.level ?? "none";
  const band = bandLabel(r.partner);
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] sm:grid-cols-[28px_minmax(0,1.4fr)_minmax(0,2fr)_110px_90px_44px] gap-x-3 gap-y-1 items-start py-3 border-b border-hairline last:border-0">
      <div className="text-xs tabular-nums text-muted-foreground pt-0.5">{rank}</div>
      <div className="min-w-0">
        <Link to={`/partners/${r.partner.id}`} className="text-sm font-medium text-foreground hover:underline">
          {r.partner.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
          {band && <span>{band}</span>}
          {r.partner.capital_status && (
            <span className={cn(r.capitalPoints < 0 && "text-amber-700 dark:text-amber-400")}>
              {r.partner.capital_status}
              {r.needsReconfirmation && " · reconfirm"}
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0 col-span-2 sm:col-span-1 col-start-2 sm:col-start-auto row-start-2 sm:row-start-auto">
        <div className="flex flex-wrap items-center gap-1.5">
          <EvidenceBadge level={level} unread={r.unread} />
          {BUCKET_BOX_FIELD[bucket] && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border",
                r.boxChecked ? "border-border text-foreground" : "border-dashed border-border text-muted-foreground",
              )}
              title={r.boxChecked ? `${BUCKET_LABEL[bucket]} box is ticked` : `${BUCKET_LABEL[bucket]} box is not ticked`}
            >
              {r.boxChecked ? <Check className="h-2.5 w-2.5" /> : null}
              {r.boxChecked ? "Box" : "No box"}
            </span>
          )}
        </div>
        {r.read?.reason && <p className="mt-1 text-xs text-foreground/80">{r.read.reason}</p>}
        {r.read?.quote && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-[11px] text-primary hover:underline">
            {open ? "Hide note" : "From the notes"}
          </button>
        )}
        {open && r.read?.quote && (
          <blockquote className="mt-1 border-l-2 border-primary/30 pl-2 text-[11px] text-muted-foreground italic whitespace-pre-wrap">
            {r.read.quote}
          </blockquote>
        )}
      </div>
      <div className="hidden sm:block"><WarmthBadge strength={r.partner.relationship_strength} /></div>
      <div className="hidden sm:block text-[11px] text-muted-foreground tabular-nums" title="Capital status points">
        {r.capitalPoints > 0 ? `+${r.capitalPoints}` : r.capitalPoints < 0 ? r.capitalPoints : ""}
      </div>
      <div className="text-sm font-semibold tabular-nums text-right row-start-1 col-start-3 sm:row-start-auto sm:col-start-auto">{r.score}</div>
    </div>
  );
}

export default function CapitalIntelligencePage() {
  const [bucket, setBucket] = useState<StrategyBucket>("core_plus");
  const [query, setQuery] = useState("");
  const [showBoxOnly, setShowBoxOnly] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);

  const { data: partners = [], isLoading: pLoading, error: pError } = usePartners();
  const { data: reads, isLoading: rLoading, error: rError } = useStrategyReads();
  const refresh = useRefreshStrategyReads(setProgress);

  const readsById = useMemo(() => reads ?? new Map(), [reads]);
  const ranked = useMemo(
    () => Object.fromEntries(STRATEGY_BUCKETS.map((b) => [b, rankBucket(b, partners, readsById)])) as Record<StrategyBucket, RankedSource[]>,
    [partners, readsById],
  );

  const active = partners.filter((p) => !p.archived_at && !p.blacklisted_at);
  const readCount = active.filter((p) => readsById.has(p.id)).length;
  const lastRead = useMemo(() => {
    let max = 0;
    for (const r of readsById.values()) if (r) max = Math.max(max, new Date(r.read_at).getTime());
    return max ? new Date(max) : null;
  }, [readsById]);

  const rows = ranked[bucket];
  const counts = evidenceCounts(rows);
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (showBoxOnly || r.read) && (!q || r.partner.name.toLowerCase().includes(q)),
  );

  const onRefresh = () => {
    setProgress(0);
    refresh.mutate(undefined, {
      onSuccess: (res) => {
        if (res.halted) toast.error(res.halted);
        else if (res.failed) toast.warning(`Read ${res.processed} partners; ${res.failed} failed. Refresh again to retry them.`);
        else if (res.processed) toast.success(`Read ${res.processed} partners' notes`);
        else toast.success("Every partner's notes are already read");
      },
      onError: (e) => toast.error(`Couldn't read notes: ${(e as Error).message}`),
      onSettled: () => setProgress(null),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap border-b border-hairline pb-5">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">Capital Formation</div>
          <h1 className="mt-1 text-3xl font-display font-semibold tracking-tight text-foreground">Capital Intelligence</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Our best sources of capital for each strategy, from what the notes say they actually have, the strategy boxes, and how warm the relationship is.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={refresh.isPending}>
            {refresh.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {refresh.isPending ? `Reading notes${progress ? ` (${progress})` : "…"}` : "Read new notes"}
          </Button>
          <div className="text-[11px] text-muted-foreground">
            Notes read for {readCount} of {active.length} partners{lastRead ? ` · last ${format(lastRead, "MMM d, h:mm a")}` : ""}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STRATEGY_BUCKETS.map((b) => {
          const strong = ranked[b].filter((r) => r.read?.level === "dedicated" || r.read?.level === "active").length;
          return (
            <button
              key={b}
              type="button"
              onClick={() => setBucket(b)}
              className={cn(
                "h-9 rounded-md border px-3.5 text-sm inline-flex items-center gap-2 transition-colors",
                bucket === b ? "border-primary bg-primary text-primary-foreground" : "border-hairline text-foreground hover:bg-foreground/[0.04]",
              )}
            >
              {BUCKET_LABEL[b]}
              <span className={cn("text-xs tabular-nums", bucket === b ? "text-primary-foreground/80" : "text-muted-foreground")} title="Dedicated or active per the notes">
                {strong}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a partner" className="h-9 pl-8 text-sm" />
            </div>
            {BUCKET_BOX_FIELD[bucket] && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={showBoxOnly} onCheckedChange={setShowBoxOnly} />
                Include box-only partners ({counts.none})
              </label>
            )}
          </div>

          <div className="rounded-lg border border-hairline bg-card px-4">
            <div className="hidden sm:grid grid-cols-[28px_minmax(0,1.4fr)_minmax(0,2fr)_110px_90px_44px] gap-x-3 py-2 border-b border-hairline text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
              <div>#</div><div>Partner</div><div>What we know</div><div>Warmth</div><div>Capital</div><div className="text-right">Score</div>
            </div>
            {pLoading || rLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : pError || rError ? (
              <p className="text-sm text-destructive text-center py-8">Couldn't load: {((pError || rError) as Error).message}</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                {rows.length === 0 ? `No partners have the ${BUCKET_LABEL[bucket]} box ticked or ${BUCKET_LABEL[bucket]} in their notes yet.` : "Nothing matches."}
              </p>
            ) : (
              shown.map((r) => <SourceRow key={r.partner.id} r={r} rank={rows.indexOf(r) + 1} bucket={bucket} />)
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-hairline bg-card p-4">
            <h2 className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">{BUCKET_LABEL[bucket]} depth</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              {(["dedicated", "active", "open", "none", "avoids"] as Level[]).map((l) => (
                <div key={l} className="flex items-center justify-between">
                  <dt><EvidenceBadge level={l} unread={false} /></dt>
                  <dd className="tabular-nums">{counts[l]}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-lg border border-hairline bg-card p-4 text-xs text-muted-foreground space-y-2">
            <h2 className="text-[11px] uppercase tracking-[0.14em] font-semibold">How it's ranked</h2>
            <p>
              <span className="text-foreground font-medium">The notes lead.</span> A dedicated fund or vehicle for the strategy scores {EVIDENCE_POINTS.dedicated}, actively investing in it {EVIDENCE_POINTS.active}, open to it {EVIDENCE_POINTS.open}. Notes that say they don't do it score {EVIDENCE_POINTS.avoids}.
            </p>
            <p>
              The strategy box adds {BOX_POINTS}: it's ticked generously so nobody is left out of a deal search, so on its own it says little.
            </p>
            <p>Warmth adds up to 25 (Existing Partner 25 → Cold 0). Capital status moves it: Actively Deploying +5, Selective −5, Constrained −15, Out of Capital −30.</p>
            <p>Opportunistic has no box, so only the notes put a partner on that list. Notes are read by AI, which must quote the line it relied on; click "From the notes" to see it.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
