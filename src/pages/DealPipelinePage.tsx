import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isSameDay, parseISO } from "date-fns";
import { CalendarIcon, ChevronDown, Filter, RefreshCw, Inbox, Mail, ShieldAlert, EyeOff, Search, RotateCcw, Archive, Download } from "lucide-react";
import { exportInboxDay } from "@/lib/exportInboxDay";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TIER_LABEL, TIER_ORDER, tierChip, tierKey, type TierKey } from "@/lib/tier";
import { Check, X, UserCircle2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTeamMembers, useAssignInboxDeal, initialsOf, type TeamMember } from "@/hooks/useTeamMembers";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import DOMPurify from "dompurify";

const DENIAL_CATEGORIES = [
  "Market / Geography",
  "Asset Type",
  "Too Small",
  "Pricing / Returns",
  "Condition / Vintage",
  "Sponsor / Operator",
  "Timing",
  "Other",
] as const;

const VISIBLE_TIERS: TierKey[] = ["strong", "medium"];

type InboxDeal = {
  id: string;
  property_name: string | null;
  address: string | null;
  location_city: string | null;
  location_state: string | null;
  msa: string | null;
  broker_firm: string | null;
  broker_contact_name: string | null;
  broker_contact_email: string | null;
  units: number | null;
  year_built: number | null;
  avg_sf: number | null;
  occupancy_pct: number | null;
  asset_class: string | null;
  strategy: string | null;
  offers_due: string | null;
  fit_tier: string | null;
  fit_score: number | null;
  fit_rationale: string | null;
  email_received_at: string | null;
  reviewed: boolean | null;
  denied: boolean | null;
  accepted_deal_id: string | null;
  email_thread_summary: string | null;
  email_count: number | null;
  gate_status: string | null;
  gate_reason: string | null;
  assigned_to: string | null;
};

const displayTitle = (d: Pick<InboxDeal, "property_name" | "address" | "location_city" | "location_state" | "msa" | "email_thread_summary">): string => {
  const name = d.property_name?.trim();
  const subjectLine = d.email_thread_summary?.split("\n")[0]?.trim();
  if (name && name !== subjectLine) return name;
  if (d.address?.trim()) return d.address.trim();
  const loc = [d.location_city, d.location_state].filter(Boolean).join(", ");
  if (loc) return loc;
  if (d.msa?.trim()) return d.msa.trim();
  if (name) return name;
  if (subjectLine) return subjectLine;
  return "Untitled property";
};



type DealEmail = {
  id: string;
  subject: string | null;
  summary: string | null;
  body: string | null;
  received_at: string | null;
  sender_email: string | null;
};

const TIER_SCORE_COLOR: Record<TierKey, string> = {
  strong: "text-tier-strong-fg",
  medium: "text-tier-medium-fg",
  maybe: "text-tier-maybe-fg",
  skip: "text-tier-skip-fg",
};

const TIER_ACCENT_BAR: Record<TierKey, string> = {
  strong: "bg-tier-strong-fg",
  medium: "bg-tier-medium-fg",
  maybe: "bg-tier-maybe-fg/40",
  skip: "bg-tier-skip-fg/40",
};


const dayKey = (iso: string | null) => {
  if (!iso) return "undated";
  return format(parseISO(iso), "yyyy-MM-dd");
};

const dayHeading = (key: string) => {
  if (key === "undated") return "Undated";
  const d = parseISO(key);
  const today = new Date();
  if (isSameDay(d, today)) return `Today — ${format(d, "EEEE, MMMM d")}`;
  return format(d, "EEEE, MMMM d");
};

export default function DealPipelinePage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [denyTarget, setDenyTarget] = useState<InboxDeal | null>(null);
  const [tierFilter, setTierFilter] = useState<Record<TierKey, boolean>>({
    strong: true, medium: true, maybe: false, skip: false,
  });
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [msaFilter, setMsaFilter] = useState<string>("all");
  const [showReviewed, setShowReviewed] = useState(false);
  const [showFiltered, setShowFiltered] = useState(false);
  const [jumpDate, setJumpDate] = useState<Date | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [regating, setRegating] = useState(false);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  const { data: deals, refetch } = useQuery({
    queryKey: ["inbox_deals_pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_deals")
        .select(
          "id, property_name, address, location_city, location_state, msa, broker_firm, broker_contact_name, broker_contact_email, units, year_built, avg_sf, occupancy_pct, asset_class, strategy, offers_due, fit_tier, fit_score, fit_rationale, email_received_at, reviewed, denied, accepted_deal_id, email_thread_summary, email_count, gate_status, gate_reason, assigned_to",
        )
        .order("email_received_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as InboxDeal[];
    },
  });

  const { data: teamMembers } = useTeamMembers();
  const teamById = useMemo(() => {
    const m = new Map<string, TeamMember>();
    (teamMembers ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [teamMembers]);
  const assignMutation = useAssignInboxDeal();
  const assignDeal = (id: string, assigned_to: string | null) =>
    assignMutation.mutate(
      { id, assigned_to },
      {
        onSuccess: () => toast.success(assigned_to ? "Deal assigned" : "Owner cleared"),
        onError: (e: any) => toast.error(e?.message ?? "Could not assign"),
      },
    );

  useEffect(() => {
    const channel = supabase
      .channel("daily-digest")
      .on("broadcast", { event: "digest" }, () => {
        queryClient.invalidateQueries({ queryKey: ["inbox_deals_pipeline"] });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inbox_deals" },
        () => queryClient.invalidateQueries({ queryKey: ["inbox_deals_pipeline"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const states = useMemo(() => {
    const s = new Set<string>();
    for (const d of deals ?? []) if (d.location_state) s.add(d.location_state);
    return Array.from(s).sort();
  }, [deals]);

  const msas = useMemo(() => {
    const s = new Set<string>();
    for (const d of deals ?? []) if (d.msa) s.add(d.msa);
    return Array.from(s).sort();
  }, [deals]);

  // Common per-deal filters (not gate-related)
  const passesCommonFilters = (d: InboxDeal) => {
    if (d.denied) return false;
    if (d.accepted_deal_id) return false;
    if (stateFilter !== "all" && d.location_state !== stateFilter) return false;
    if (msaFilter !== "all" && d.msa !== msaFilter) return false;
    if (!showReviewed && d.reviewed) return false;
    return true;
  };

  // Bucket deals so nothing is silently dropped:
  //   visible    = strong/medium or unscored (null tier) — main board
  //   lowerFit   = maybe/skip scored — shown in a collapsible "Lower fit" section
  //   filteredOut= gate_status === "filtered" — Filtered Archive
  const { visible, lowerFit, filteredOut, funnel } = useMemo(() => {
    const visible: InboxDeal[] = [];
    const lowerFit: InboxDeal[] = [];
    const filteredOut: InboxDeal[] = [];
    let received = 0, passed = 0, review = 0, filteredCount = 0, lowerFitCount = 0;
    for (const d of deals ?? []) {
      if (!d.denied && !d.accepted_deal_id) {
        received++;
        if (d.gate_status === "passed") passed++;
        else if (d.gate_status === "review") review++;
        else if (d.gate_status === "filtered") filteredCount++;
        if (d.fit_tier != null) {
          const t = tierKey(d.fit_tier);
          if (t === "maybe" || t === "skip") lowerFitCount++;
        }
      }
      if (!passesCommonFilters(d)) continue;
      if (d.gate_status === "filtered") {
        filteredOut.push(d);
        continue;
      }
      if (d.fit_tier != null) {
        const t = tierKey(d.fit_tier);
        if (t === "maybe" || t === "skip") {
          lowerFit.push(d);
          continue;
        }
        if (!tierFilter[t]) continue;
      }
      visible.push(d);
    }
    return {
      visible,
      lowerFit,
      filteredOut,
      funnel: { received, passed, review, filtered: filteredCount, lowerFit: lowerFitCount },
    };
  }, [deals, tierFilter, stateFilter, msaFilter, showReviewed]);


  // Group by day for both buckets
  const grouped = useMemo(() => {
    const visMap = new Map<string, InboxDeal[]>();
    const filtMap = new Map<string, InboxDeal[]>();
    for (const d of visible) {
      const k = dayKey(d.email_received_at);
      if (!visMap.has(k)) visMap.set(k, []);
      visMap.get(k)!.push(d);
    }
    for (const d of filteredOut) {
      const k = dayKey(d.email_received_at);
      if (!filtMap.has(k)) filtMap.set(k, []);
      filtMap.get(k)!.push(d);
    }
    for (const arr of visMap.values()) {
      arr.sort((a, b) => {
        const ta = TIER_ORDER[tierKey(a.fit_tier)];
        const tb = TIER_ORDER[tierKey(b.fit_tier)];
        if (ta !== tb) return ta - tb;
        return (b.fit_score ?? -1) - (a.fit_score ?? -1);
      });
    }
    const allKeys = new Set<string>([...visMap.keys(), ...filtMap.keys()]);
    const keys = Array.from(allKeys).sort((a, b) => {
      if (a === "undated") return 1;
      if (b === "undated") return -1;
      return b.localeCompare(a);
    });
    return keys.map((k) => ({
      key: k,
      deals: visMap.get(k) ?? [],
      filtered: filtMap.get(k) ?? [],
    }));
  }, [visible, filteredOut]);

  // ---- Pagination: render 100 deal cards at a time, scroll-to-load ----
  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [tierFilter, stateFilter, msaFilter, showReviewed]);

  const { pagedGroups, totalVisibleDeals } = useMemo(() => {
    let budget = visibleCount;
    const out: typeof grouped = [];
    for (const g of grouped) {
      if (budget <= 0) break;
      const slice = g.deals.slice(0, budget);
      budget -= slice.length;
      out.push({ ...g, deals: slice });
    }
    return { pagedGroups: out, totalVisibleDeals: grouped.reduce((n, g) => n + g.deals.length, 0) };
  }, [grouped, visibleCount]);

  const hasMore = visibleCount < totalVisibleDeals;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleCount((c) => c + PAGE_SIZE);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visibleCount]);

  const todayK = format(new Date(), "yyyy-MM-dd");
  const isDayOpen = (key: string) => {
    if (key in openDays) return openDays[key];
    return key === todayK;
  };
  const toggleDay = (key: string, v: boolean) => setOpenDays((p) => ({ ...p, [key]: v }));

  const onJumpDate = (d: Date | undefined) => {
    setJumpDate(d);
    if (!d) return;
    const k = format(d, "yyyy-MM-dd");
    setOpenDays((p) => ({ ...p, [k]: true }));
    setTimeout(() => {
      document.getElementById(`day-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };


  const markReviewed = async (id: string, reviewed: boolean) => {
    const { error } = await supabase.from("inbox_deals").update({ reviewed }).eq("id", id);
    if (error) toast.error(error.message);
    else refetch();
  };

  const openDenyDialog = (d: InboxDeal) => setDenyTarget(d);

  const submitDeny = async (category: string, reason: string) => {
    if (!denyTarget) return;
    const d = denyTarget;
    const deniedBy = user?.email ?? null;
    const nowIso = new Date().toISOString();

    const { error } = await (supabase.from("inbox_deals") as any)
      .update({
        denied: true,
        reviewed: true,
        denial_category: category,
        denial_reason: reason,
        denied_by: deniedBy,
        denied_at: nowIso,
      })
      .eq("id", d.id);
    if (error) {
      toast.error(error.message);
      return;
    }

    const snapshot = {
      property_name: d.property_name,
      location_city: d.location_city,
      location_state: d.location_state,
      msa: d.msa,
      asset_class: d.asset_class,
      strategy: d.strategy,
      units: d.units,
      year_built: d.year_built,
      fit_score: d.fit_score,
      fit_tier: d.fit_tier,
    };
    const { error: fbErr } = await (supabase.from("deal_feedback") as any).insert({
      inbox_deal_id: d.id,
      action: "deny",
      category,
      reason_text: reason,
      deal_snapshot: snapshot,
      created_by: deniedBy,
    });
    if (fbErr) console.error("deal_feedback insert error:", fbErr);

    toast.success("Deal denied");
    setDenyTarget(null);
    refetch();
  };


  const acceptDeal = async (d: InboxDeal) => {
    const { data: newDealId, error } = await supabase.rpc("accept_inbox_deal", {
      _inbox_deal_id: d.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Added to Pipeline");

    // Stage 2 enrichment for the newly accepted deal (inbox itself is never enriched)
    if (newDealId) {
      const address = [d.location_city, d.location_state].filter(Boolean).join(", ");
      if (address) {
        supabase.functions.invoke("esri-enrich", { body: { deal_id: newDealId, address } })
          .then(({ error: enrichErr }) => {
            if (enrichErr) {
              console.error("esri-enrich error:", enrichErr);
              return;
            }
            // Schools need lat/lon from esri-enrich; fire-and-forget after it resolves.
            supabase.functions.invoke("schools-enrich", { body: { deal_id: newDealId } })
              .then(({ error: schErr }) => {
                if (schErr) console.error("schools-enrich error:", schErr);
              });
          });
      } else {
        console.warn(`esri-enrich skipped for deal ${newDealId}: no city/state on inbox deal ${d.id}`);
      }
      // Kick an immediate score so the card surfaces with low-confidence number
      supabase.functions.invoke("deal-score", { body: { deal_id: newDealId } })
        .then(({ error: scoreErr }) => {
          if (scoreErr) console.error("deal-score error:", scoreErr);
        });
    }

    queryClient.invalidateQueries({ queryKey: ["deals"] });
    refetch();
  };



  const handleRegate = async () => {
    setRegating(true);
    try {
      // force: true bypasses the content-hash skip, so this always re-evaluates.
      const { error } = await supabase.functions.invoke("gate-deals", { body: { force: true } });
      if (error) throw error;
      toast.success("Re-gating started");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Re-gate failed");
    } finally {
      setRegating(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("sync-acquisitions-inbox");
      if (error) throw error;
      toast.success("Inbox synced");
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const offersDueSoon = (offers_due: string | null) => {
    if (!offers_due) return false;
    const due = parseISO(offers_due);
    const diff = (due.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff >= -1 && diff <= 7;
  };

  const tierCounts = (arr: InboxDeal[]) => {
    const c: Record<TierKey, number> = { strong: 0, medium: 0, maybe: 0, skip: 0 };
    for (const d of arr) c[tierKey(d.fit_tier)]++;
    return c;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Section header — matches Dashboard rhythm */}
      <div className="border-b border-hairline pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">Deal Inbox</h1>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-[0.12em] font-medium tabular-nums">
              {funnel.received} received · {visible.length} strong/medium · {funnel.lowerFit} lower fit · {funnel.filtered} filtered
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
              {visible.length} visible · {grouped.length} day{grouped.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 border-hairline">
                  <CalendarIcon className="h-3.5 w-3.5 mr-2 text-muted-foreground" strokeWidth={1.75} />
                  <span className="text-xs">{jumpDate ? format(jumpDate, "MMM d, yyyy") : "Jump to date"}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="single" selected={jumpDate} onSelect={onJumpDate} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <Button onClick={handleRegate} disabled={regating} size="sm" variant="outline" className="h-9">
              <ShieldAlert className={cn("h-3.5 w-3.5 mr-2", regating && "animate-pulse")} strokeWidth={1.75} />
              <span className="text-xs">Re-gate all</span>
            </Button>
            <Button onClick={handleSync} disabled={syncing} size="sm" className="h-9 bg-primary hover:bg-primary/90">
              <RefreshCw className={cn("h-3.5 w-3.5 mr-2", syncing && "animate-spin")} strokeWidth={1.75} />
              <span className="text-xs">Sync inbox</span>
            </Button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold mr-1">Tiers</span>
          {VISIBLE_TIERS.map((t) => {
            const active = tierFilter[t];
            return (
              <button
                key={t}
                onClick={() => setTierFilter((p) => ({ ...p, [t]: !p[t] }))}
                className={cn(
                  "transition-colors",
                  active ? tierChip(t) : "chip-tier bg-card text-muted-foreground border-hairline hover:bg-muted",
                )}
              >
                {TIER_LABEL[t]}
              </button>
            );
          })}

          <div className="w-px h-5 bg-hairline mx-2" />

          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-8 w-[120px] text-xs border-hairline"><SelectValue placeholder="State" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={msaFilter} onValueChange={setMsaFilter}>
            <SelectTrigger className="h-8 w-[160px] text-xs border-hairline"><SelectValue placeholder="MSA" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All MSAs</SelectItem>
              {msas.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-4 ml-auto">
            <div className="flex items-center gap-2">
              <Label htmlFor="show-filtered" className="text-xs text-muted-foreground flex items-center gap-1">
                <EyeOff className="h-3 w-3" strokeWidth={1.75} /> Show filtered
                {filteredOut.length > 0 && (
                  <span className="ml-1 tabular-nums font-semibold text-foreground">({filteredOut.length})</span>
                )}
              </Label>
              <Switch id="show-filtered" checked={showFiltered} onCheckedChange={setShowFiltered} />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="show-reviewed" className="text-xs text-muted-foreground">Show reviewed</Label>
              <Switch id="show-reviewed" checked={showReviewed} onCheckedChange={setShowReviewed} />
            </div>
          </div>
        </div>
      </div>

      {/* Day sections */}
      <div className="space-y-3">
        {grouped.length === 0 && lowerFit.length === 0 && filteredOut.length === 0 ? (
          <div className="surface-card border-dashed p-16 text-center">
            <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">No deals match your filters.</p>
          </div>
        ) : pagedGroups.map(({ key, deals, filtered }) => {
          const counts = tierCounts(deals);
          const open = isDayOpen(key);
          return (
            <Collapsible key={key} open={open} onOpenChange={(v) => toggleDay(key, v)} id={`day-${key}`}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center gap-3 py-3 px-4 surface-card hover:bg-muted/40 transition-colors text-left">
                  <ChevronDown
                    className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
                    strokeWidth={1.75}
                  />
                  <h2 className="font-display text-base font-semibold text-primary">
                    {dayHeading(key)}
                  </h2>
                  <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                    {VISIBLE_TIERS.map((t) => counts[t] > 0 && (
                      <span key={t} className={tierChip(t)}>
                        <span className="tabular-nums font-semibold">{counts[t]}</span> {TIER_LABEL[t]}
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground tabular-nums ml-1">
                      {deals.length} total
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={deals.length === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              try {
                                exportInboxDay({ dayKey: key, deals, filtered, teamById });
                                toast.success("Exported to Excel");
                              } catch (err) {
                                console.error(err);
                                toast.error("Export failed");
                              }
                            }}
                            aria-label="Export to Excel"
                          >
                            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Export to Excel</TooltipContent>
                    </Tooltip>
                  </div>

                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-2">
                {deals.map((d) => (
                  <DealCard
                    key={d.id}
                    deal={d}
                    onReview={markReviewed}
                    onAccept={() => acceptDeal(d)}
                    onDeny={() => openDenyDialog(d)}
                    dueSoon={offersDueSoon(d.offers_due)}
                    team={teamMembers ?? []}
                    owner={d.assigned_to ? teamById.get(d.assigned_to) ?? null : null}
                    onAssign={(memberId) => assignDeal(d.id, memberId)}
                    hiddenReason={d.reviewed ? "reviewed" : null}
                  />

                ))}
              </CollapsibleContent>
            </Collapsible>
          );
        })}

        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-6">
            <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
              Load more · showing {Math.min(visibleCount, totalVisibleDeals)} of {totalVisibleDeals}
            </Button>
          </div>
        )}

        {lowerFit.length > 0 && (
          <LowerFitSection
            deals={lowerFit}
            onReview={markReviewed}
            onAccept={acceptDeal}
            onDeny={(id) => { const d = lowerFit.find((x) => x.id === id); if (d) openDenyDialog(d); }}
            dueSoon={offersDueSoon}
            team={teamMembers ?? []}
            teamById={teamById}
            onAssign={assignDeal}
          />
        )}

        {showFiltered && filteredOut.length > 0 && (
          <FilteredArchive deals={filteredOut} onRestored={() => refetch()} />
        )}
      </div>
      <DenyDialog
        deal={denyTarget}
        onClose={() => setDenyTarget(null)}
        onSubmit={submitDeny}
      />
    </div>
  );
}

function DenyDialog({
  deal,
  onClose,
  onSubmit,
}: {
  deal: InboxDeal | null;
  onClose: () => void;
  onSubmit: (category: string, reason: string) => Promise<void>;
}) {
  const [category, setCategory] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (deal) { setCategory(""); setReason(""); setSaving(false); }
  }, [deal?.id]);

  const open = deal !== null;
  const canSubmit = !!category && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try { await onSubmit(category, reason.trim()); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Why are we passing on this deal?</DialogTitle>
          {deal && (
            <DialogDescription className="text-xs">
              {displayTitle(deal)}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Category</Label>
            <RadioGroup
              value={category}
              onValueChange={setCategory}
              className="mt-2 grid grid-cols-2 gap-2"
            >
              {DENIAL_CATEGORIES.map((c) => (
                <label
                  key={c}
                  htmlFor={`deny-cat-${c}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-sm cursor-pointer hover:bg-muted/50",
                    category === c && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem id={`deny-cat-${c}`} value={c} />
                  <span>{c}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div>
            <Label className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Reasoning (what specifically?) <span className="text-muted-foreground/70">(optional)</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Tertiary market we don't cover; vintage too old for our value-add profile; pricing implies sub-5% going-in cap…"
              rows={4}
              className="mt-2"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Saving…" : "Confirm Deny"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}




/* --------------------------- Filtered Archive --------------------------- */

const STATE_LABEL = (key: string) => key ?? "Unknown State";

const STATE_META = (key: string, deals: InboxDeal[]) => {
  if (!key || key === "Unknown State") return "No state listed";
  const cities = Array.from(new Set(deals.map((d) => d.location_city).filter(Boolean))).sort();
  if (cities.length === 0) return "";
  if (cities.length <= 3) return cities.join(", ");
  return `${cities.slice(0, 3).join(", ")} +${cities.length - 3} more`;
};

function reasonBucket(reason: string | null | undefined): string {
  if (!reason) return "Unspecified";
  const r = reason.toLowerCase();
  if (r.includes("office")) return "Office asset";
  if (r.includes("retail")) return "Retail asset";
  if (r.includes("industrial")) return "Industrial asset";
  if (r.includes("land")) return "Land only";
  if (r.includes("self storage") || r.includes("storage")) return "Self storage";
  if (r.includes("hotel") || r.includes("hospitality")) return "Hospitality";
  if (r.includes("region") || r.includes("located") || r.includes("out of")) return reason;
  return reason;
}

function FilteredArchive({
  deals,
  onRestored,
}: {
  deals: InboxDeal[];
  onRestored: () => void;
}) {
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [jumpState, setJumpState] = useState<string>("");
  const [openStates, setOpenStates] = useState<Record<string, boolean>>({});

  const reasonOptions = useMemo(() => {
    const set = new Map<string, number>();
    for (const d of deals) {
      const r = reasonBucket(d.gate_reason);
      set.set(r, (set.get(r) ?? 0) + 1);
    }
    return Array.from(set.entries()).sort((a, b) => b[1] - a[1]);
  }, [deals]);

  const filteredDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals.filter((d) => {
      if (reasonFilter !== "all" && reasonBucket(d.gate_reason) !== reasonFilter) return false;
      if (!q) return true;
      const hay = [d.property_name, d.broker_firm, d.broker_contact_name, d.location_city, d.location_state]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [deals, search, reasonFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, InboxDeal[]>();
    for (const d of filteredDeals) {
      const key = d.location_state?.trim() || "Unknown State";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "Unknown State") return 1;
      if (b === "Unknown State") return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({
      key: k,
      label: STATE_LABEL(k),
      deals: map.get(k)!.sort((a, b) =>
        (b.email_received_at ?? "").localeCompare(a.email_received_at ?? ""),
      ),
    }));
  }, [filteredDeals]);

  const topReason = reasonOptions[0]?.[0] ?? "—";
  const allStates = groups.length;
  const newestKey = groups[0]?.key;

  const isStateOpen = (k: string) => (k in openStates ? openStates[k] : k === newestKey);
  const toggleState = (k: string, v: boolean) => setOpenStates((p) => ({ ...p, [k]: v }));

  const onJump = (k: string) => {
    setJumpState(k);
    setOpenStates((p) => ({ ...p, [k]: true }));
    setTimeout(
      () => document.getElementById(`fstate-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
  };

  const restore = async (id: string) => {
    const { error } = await supabase.from("inbox_deals").update({ gate_status: "review" }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Restored to pipeline for review");
      onRestored();
    }
  };

  return (
    <section className="mt-6 space-y-3" aria-label="Filtered archive">
      <div className="surface-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
          <h2 className="font-display text-[15px] font-semibold text-foreground">Filtered Archive</h2>
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold ml-1">
            Mandate gate · {deals.length} screened
          </span>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          <span className="font-medium text-foreground">{deals.length}</span> deals filtered across{" "}
          <span className="font-medium text-foreground">{allStates}</span> state{allStates === 1 ? "" : "s"} ·{" "}
          Most common reason: <span className="font-medium text-foreground">{topReason}</span>
        </p>
        {reasonOptions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {reasonOptions.slice(0, 6).map(([r, n]) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-[0.1em] font-semibold bg-[#FBEEEE] text-[#8C3A3A] border border-[#F0D5D5]"
              >
                {r} <span className="tabular-nums text-[#8C3A3A]/80">{n}</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search property or broker"
              className="h-8 pl-8 text-xs border-hairline"
            />
          </div>
          <Select value={reasonFilter} onValueChange={setReasonFilter}>
            <SelectTrigger className="h-8 w-[200px] text-xs border-hairline">
              <SelectValue placeholder="Filter reason" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              {reasonOptions.map(([r, n]) => (
                <SelectItem key={r} value={r}>
                  {r} ({n})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={jumpState} onValueChange={onJump}>
            <SelectTrigger className="h-8 w-[180px] text-xs border-hairline">
              <SelectValue placeholder="Jump to state" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.key} value={g.key}>
                  {g.label} ({g.deals.length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="surface-card border-dashed p-8 text-center text-xs text-muted-foreground">
          No filtered deals match your filters.
        </div>
      ) : (
        groups.map((g) => (
          <FilteredStateTable
            key={g.key}
            id={`fstate-${g.key}`}
            label={g.label}
            range={STATE_META(g.key, g.deals)}
            deals={g.deals}
            open={isStateOpen(g.key)}
            onOpenChange={(v) => toggleState(g.key, v)}
            onRestore={restore}
          />
        ))
      )}
    </section>
  );
}

function FilteredStateTable({
  id,
  label,
  range,
  deals,
  open,
  onOpenChange,
  onRestore,
}: {
  id: string;
  label: string;
  range: string;
  deals: InboxDeal[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRestore: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} id={id}>
      <div className="surface-card overflow-hidden opacity-90">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 py-3 px-4 hover:bg-muted/40 transition-colors text-left">
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
              strokeWidth={1.75}
            />
            <h3 className="font-display text-base font-semibold text-primary">{label}</h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums bg-muted text-muted-foreground border border-hairline">
              {deals.length} filtered
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">{range}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-hairline">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="border-hairline hover:bg-transparent">
                  <TableHead className="w-[90px] text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                    Date
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                    Property
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                    Location
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold w-[120px]">
                    Asset
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                    Broker
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                    Filter Reason
                  </TableHead>
                  <TableHead className="w-[110px] text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deals.map((d) => {
                  const isExpanded = !!expanded[d.id];
                  return (
                    <FilteredRow
                      key={d.id}
                      d={d}
                      expanded={isExpanded}
                      onToggle={() => setExpanded((p) => ({ ...p, [d.id]: !p[d.id] }))}
                      onRestore={() => onRestore(d.id)}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function FilteredRow({
  d,
  expanded,
  onToggle,
  onRestore,
}: {
  d: InboxDeal;
  expanded: boolean;
  onToggle: () => void;
  onRestore: () => void;
}) {
  return (
    <>
      <TableRow className="border-hairline cursor-pointer hover:bg-muted/30" onClick={onToggle}>
        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
          {d.email_received_at ? format(parseISO(d.email_received_at), "MMM d") : "—"}
        </TableCell>
        <TableCell className="text-sm font-semibold text-[#1A1F2B]">
          {displayTitle(d)}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {[d.location_city, d.location_state].filter(Boolean).join(", ") || d.msa || "—"}
        </TableCell>
        <TableCell>
          {d.asset_class ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-hairline">
              {d.asset_class}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-xs text-foreground/90 truncate max-w-[180px]">
          {d.broker_firm ?? "—"}
        </TableCell>
        <TableCell>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase tracking-[0.1em] font-semibold bg-[#FBEEEE] text-[#8C3A3A] border border-[#F0D5D5] max-w-[260px] truncate">
            {reasonBucket(d.gate_reason)}
          </span>
        </TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] border-hairline text-muted-foreground hover:text-primary hover:border-primary/40"
            onClick={onRestore}
          >
            <RotateCcw className="h-3 w-3 mr-1" strokeWidth={2} />
            Restore
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="border-hairline bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={7} className="py-3 px-4">
            <div className="text-xs space-y-1.5">
              <div>
                <span className="uppercase tracking-[0.12em] text-[10px] font-semibold text-muted-foreground mr-2">
                  Email Subject
                </span>
                <span className="text-foreground">
                  {d.email_thread_summary?.split("\n")[0] ?? "—"}
                </span>
              </div>
              <div>
                <span className="uppercase tracking-[0.12em] text-[10px] font-semibold text-muted-foreground mr-2">
                  Received
                </span>
                <span className="tabular-nums text-foreground">
                  {d.email_received_at ? format(parseISO(d.email_received_at), "PPp") : "—"}
                </span>
              </div>
              <div>
                <span className="uppercase tracking-[0.12em] text-[10px] font-semibold text-muted-foreground mr-2">
                  Full Filter Reason
                </span>
                <span className="text-foreground italic">{d.gate_reason ?? "Unspecified"}</span>
              </div>
              {d.broker_contact_name && (
                <div>
                  <span className="uppercase tracking-[0.12em] text-[10px] font-semibold text-muted-foreground mr-2">
                    Broker Contact
                  </span>
                  <span className="text-foreground">
                    {d.broker_contact_name}
                    {d.broker_contact_email && ` · ${d.broker_contact_email}`}
                  </span>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}



function DealCard({
  deal: d,
  onReview,
  onAccept,
  onDeny,
  dueSoon,
  team,
  owner,
  onAssign,
  hiddenReason,
}: {
  deal: InboxDeal;
  onReview: (id: string, reviewed: boolean) => void;
  onAccept: () => void;
  onDeny: () => void;
  dueSoon: boolean;
  team: TeamMember[];
  owner: TeamMember | null;
  onAssign: (memberId: string | null) => void;
  hiddenReason?: string | null;
}) {
  const t = tierKey(d.fit_tier);
  return (
    <div
      className={cn(
        "surface-card overflow-hidden transition-all",
        d.reviewed && "opacity-55",
      )}
    >
      <div className="flex">
        {/* Left accent bar */}
        <div className={cn("w-0.5 shrink-0", TIER_ACCENT_BAR[t])} />
        <div className="flex-1 p-5">
          <div className="flex items-start gap-5">
            <div className="flex-1 min-w-0 space-y-2.5">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-semibold text-[15px] text-foreground truncate">
                    {displayTitle(d)}
                  </h3>
                  {hiddenReason && (
                    <span
                      title={`Why hidden: ${hiddenReason}`}
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.1em] bg-muted text-muted-foreground border border-hairline"
                    >
                      {hiddenReason}
                    </span>
                  )}
                  {d.gate_status === "review" && (
                    <span
                      title={d.gate_reason ?? "Needs human review"}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.1em] bg-amber-50 text-amber-700 border border-amber-200"
                    >
                      <ShieldAlert className="h-3 w-3" strokeWidth={2} />
                      {d.gate_reason ?? "Needs geo/type confirmation"}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {d.address
                    ? `${d.address}${[d.location_city, d.location_state].filter(Boolean).length ? ` · ${[d.location_city, d.location_state].filter(Boolean).join(", ")}` : ""}`
                    : ([d.location_city, d.location_state].filter(Boolean).join(", ") || d.msa || "—")}
                </p>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground tabular-nums">
                <span><span className="font-semibold text-foreground">{d.units ?? "—"}</span> units</span>
                <span>Built <span className="font-semibold text-foreground">{d.year_built ?? "—"}</span></span>
                {d.avg_sf != null && <span><span className="font-semibold text-foreground">{d.avg_sf.toLocaleString()}</span> avg SF</span>}
                {d.occupancy_pct != null && <span><span className="font-semibold text-foreground">{Number(d.occupancy_pct)}%</span> occupied</span>}
                {d.asset_class && <span>{d.asset_class}</span>}
                {d.strategy && <span>{d.strategy}</span>}
              </div>

              {(d.broker_firm || d.broker_contact_name) && (
                <div className="text-xs text-muted-foreground">
                  <span className="uppercase tracking-[0.1em] text-[10px] font-semibold mr-1.5">Broker</span>
                  <span className="font-medium text-foreground">{d.broker_firm ?? "—"}</span>
                  {d.broker_contact_name && <span> · {d.broker_contact_name}</span>}
                  {d.broker_contact_email && <span> · {d.broker_contact_email}</span>}
                </div>
              )}

              {d.offers_due && (
                <div className={cn(
                  "text-xs font-medium tabular-nums inline-flex items-center gap-2",
                  dueSoon ? "text-destructive" : "text-muted-foreground",
                )}>
                  <span className="uppercase tracking-[0.1em] text-[10px] font-semibold">Offers due</span>
                  <span>{format(parseISO(d.offers_due), "MMM d, yyyy")}</span>
                  {dueSoon && <span className="chip-tier bg-destructive/10 text-destructive border-destructive/20">Urgent</span>}
                </div>
              )}

              {d.fit_rationale && (
                <p className="text-xs text-muted-foreground border-t border-hairline pt-2.5 mt-2.5 italic">
                  Buybox: {d.fit_rationale}
                </p>
              )}
            </div>

            {/* Fit rating block */}
            <div className="flex flex-col items-center text-center w-[130px] shrink-0 pl-5 border-l border-hairline">
              {d.fit_score != null && (
                <div className="flex items-baseline gap-0.5">
                  <span className={cn("font-serif-display text-[40px] leading-none font-medium tabular-nums", TIER_SCORE_COLOR[t])}>
                    {d.fit_score}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">/100</span>
                </div>
              )}
              {d.fit_tier != null && (
                <span className={cn(d.fit_score != null && "mt-2", tierChip(t))}>{TIER_LABEL[t]}</span>
              )}
              <div className="mt-3 flex flex-col gap-1.5 w-full">
                <Button
                  size="sm"
                  className="h-7 text-[11px] bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={onAccept}
                  disabled={!!d.accepted_deal_id}
                >
                  <Check className="h-3 w-3" strokeWidth={2.25} />
                  Add to Pipeline
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-hairline text-muted-foreground hover:text-destructive hover:border-destructive/40"
                  onClick={onDeny}
                >
                  <X className="h-3 w-3" strokeWidth={2.25} />
                  Deny
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 text-[11px] h-7 px-2 text-muted-foreground hover:text-foreground"
                onClick={() => onReview(d.id, !d.reviewed)}
              >
                {d.reviewed ? "Unmark" : "Mark Reviewed"}
              </Button>
              <AssignMenu team={team} owner={owner} onAssign={onAssign} />
            </div>
          </div>

          {(d.email_thread_summary || (d.email_count ?? 0) > 0) && (
            <EmailSummaryBlock dealId={d.id} summary={d.email_thread_summary} count={d.email_count ?? 1} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmailSummaryBlock({
  dealId,
  summary,
  count,
}: {
  dealId: string;
  summary: string | null;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: threadEmails } = useQuery({
    queryKey: ["deal_emails_thread", dealId],
    enabled: open && count > 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_emails")
        .select("id, subject, summary, body, received_at, sender_email")
        .eq("deal_id", dealId)
        .order("received_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DealEmail[];
    },
  });

  const { data: fullEmails, isLoading: fullLoading } = useQuery({
    queryKey: ["deal_emails_full", dealId],
    enabled: sheetOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_emails")
        .select("id, subject, summary, body, received_at, sender_email")
        .eq("deal_id", dealId)
        .order("received_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DealEmail[];
    },
  });

  return (
    <>
      <div className="mt-4 rounded-md bg-muted/40 border border-hairline p-3.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Mail className="h-3 w-3" strokeWidth={1.75} />
            Email Thread
          </div>
          {count > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
              className="text-[11px] font-medium px-2 py-0.5 rounded bg-card border border-hairline text-foreground hover:bg-muted tabular-nums transition-colors"
            >
              {count} emails {open ? "▾" : "▸"}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          title="View full email thread"
          className="block w-full text-left -mx-1 px-1 py-0.5 rounded cursor-pointer hover:bg-muted/60 transition-colors"
        >
          <p className="text-xs text-foreground/80 leading-relaxed">
            {summary ?? <span className="italic text-muted-foreground">Summary pending…</span>}
          </p>
        </button>

        {open && count > 1 && (
          <Accordion type="multiple" className="bg-card rounded border border-hairline">
            {(threadEmails ?? []).map((e) => (
              <AccordionItem key={e.id} value={e.id} className="border-b border-hairline last:border-b-0 px-3">
                <AccordionTrigger className="py-2 text-xs hover:no-underline">
                  <span className="text-left flex-1 truncate pr-2">
                    <span className="text-muted-foreground mr-2 tabular-nums">
                      {e.received_at ? format(parseISO(e.received_at), "MMM d") : "—"}
                    </span>
                    <span className="font-medium text-foreground">{e.subject ?? "(no subject)"}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-xs text-muted-foreground pb-3">
                  {e.summary ?? <span className="italic">Summary pending…</span>}
                  {e.sender_email && (
                    <div className="mt-1 text-[11px] text-muted-foreground/70">from {e.sender_email}</div>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-4xl overflow-hidden flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-hairline shrink-0">
            <SheetTitle>Email Thread</SheetTitle>
            <SheetDescription>
              {fullEmails ? `${fullEmails.length} email${fullEmails.length === 1 ? "" : "s"}` : "Loading…"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-6 min-w-0">
              {fullLoading && (
                <div className="text-sm text-muted-foreground italic">Loading emails…</div>
              )}
              {!fullLoading && (fullEmails ?? []).length === 0 && (
                <div className="text-sm text-muted-foreground italic">No emails found.</div>
              )}
              {(fullEmails ?? []).map((e) => (
                <EmailFullView key={e.id} email={e} />
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function EmailFullView({ email }: { email: DealEmail }) {
  const body = email.body ?? "";
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(body);
  return (
    <article className="rounded-md border border-hairline bg-card p-4">
      <header className="mb-3 space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{email.subject ?? "(no subject)"}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {email.sender_email && <span>From: <span className="text-foreground/80">{email.sender_email}</span></span>}
          {email.received_at && (
            <span className="tabular-nums">{format(parseISO(email.received_at), "MMM d, yyyy · h:mm a")}</span>
          )}
        </div>
      </header>
      {body ? (
        looksLikeHtml ? (
          <div
            className="prose prose-sm max-w-none text-sm text-foreground/90 [&_a]:text-primary break-words"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(body) }}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground/90 leading-relaxed">
            {body}
          </pre>
        )
      ) : (
        <div className="text-sm italic text-muted-foreground">No body content.</div>
      )}
    </article>
  );
}



function AssignMenu({
  team,
  owner,
  onAssign,
}: {
  team: TeamMember[];
  owner: TeamMember | null;
  onAssign: (memberId: string | null) => void;
}) {
  const active = team.filter((t) => t.active);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[11px] h-7 px-2 rounded border border-hairline text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title={owner ? `Owner: ${owner.full_name}` : "Assign owner"}
        >
          {owner ? (
            <>
              <Avatar className="h-4 w-4 border border-hairline">
                {owner.avatar_url && <AvatarImage src={owner.avatar_url} alt={owner.full_name} />}
                <AvatarFallback className="bg-primary/10 text-primary text-[8px] font-semibold">
                  {initialsOf(owner.full_name)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate max-w-[68px] text-foreground">{owner.full_name.split(" ")[0]}</span>
            </>
          ) : (
            <>
              <UserCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              Assign
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {active.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            No team members — add some on the Dashboard
          </DropdownMenuItem>
        ) : (
          active.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onAssign(m.id)}
              className="text-xs gap-2"
            >
              <Avatar className="h-5 w-5 border border-hairline">
                {m.avatar_url && <AvatarImage src={m.avatar_url} alt={m.full_name} />}
                <AvatarFallback className="bg-primary/10 text-primary text-[9px] font-semibold">
                  {initialsOf(m.full_name)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate">{m.full_name}</span>
              {owner?.id === m.id && <Check className="h-3 w-3 text-primary" strokeWidth={2.25} />}
            </DropdownMenuItem>
          ))
        )}
        {owner && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAssign(null)} className="text-xs text-muted-foreground">
              Clear owner
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ----------------------------- Lower Fit ----------------------------- */

function LowerFitSection({
  deals,
  onReview,
  onAccept,
  onDeny,
  dueSoon,
  team,
  teamById,
  onAssign,
}: {
  deals: InboxDeal[];
  onReview: (id: string, reviewed: boolean) => void;
  onAccept: (d: InboxDeal) => void;
  onDeny: (id: string) => void;
  dueSoon: (offers_due: string | null) => boolean;
  team: TeamMember[];
  teamById: Map<string, TeamMember>;
  onAssign: (id: string, memberId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(
    () => [...deals].sort((a, b) => {
      const ta = TIER_ORDER[tierKey(a.fit_tier)];
      const tb = TIER_ORDER[tierKey(b.fit_tier)];
      if (ta !== tb) return ta - tb;
      return (b.email_received_at ?? "").localeCompare(a.email_received_at ?? "");
    }),
    [deals],
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-3 py-3 px-4 surface-card hover:bg-muted/40 transition-colors text-left">
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
            strokeWidth={1.75}
          />
          <h2 className="font-display text-base font-semibold text-primary">Lower fit</h2>
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold ml-1">
            Maybe / skip — kept for audit
          </span>
          <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums bg-muted text-muted-foreground border border-hairline">
            {deals.length}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-2">
        {sorted.map((d) => (
          <DealCard
            key={d.id}
            deal={d}
            onReview={onReview}
            onAccept={() => onAccept(d)}
            onDeny={() => onDeny(d.id)}
            dueSoon={dueSoon(d.offers_due)}
            team={team}
            owner={d.assigned_to ? teamById.get(d.assigned_to) ?? null : null}
            onAssign={(memberId) => onAssign(d.id, memberId)}
            hiddenReason={tierKey(d.fit_tier) === "skip" ? "skip" : "maybe"}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
