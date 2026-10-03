import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronDown, Filter, RefreshCw, Inbox, Mail, ShieldAlert, EyeOff, RotateCcw, Download } from "lucide-react";
import { exportInboxSection } from "@/lib/exportInboxSection";
import { bucketInboxDeals, inboxSectionFor, INBOX_SECTIONS } from "@/lib/inboxSections";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TIER_LABEL, tierChip, tierKey, type TierKey } from "@/lib/tier";
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
  summary_error: string | null;
  summary_attempted_at: string | null;
  rationale_error: string | null;
  rationale_attempted_at: string | null;
  email_received_at: string | null;
  reviewed: boolean | null;
  reviewed_at: string | null;
  denied: boolean | null;
  denial_category: string | null;
  denial_reason: string | null;
  denied_by: string | null;
  denied_at: string | null;
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


const SECTION_PAGE_SIZE = 50;

export default function DealPipelinePage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [denyTarget, setDenyTarget] = useState<InboxDeal | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<InboxDeal | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [msaFilter, setMsaFilter] = useState<string>("all");
  const [syncing, setSyncing] = useState(false);
  const [regating, setRegating] = useState(false);

  const { data: deals, refetch } = useQuery({
    queryKey: ["inbox_deals_pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_deals")
        .select(
          "id, property_name, address, location_city, location_state, msa, broker_firm, broker_contact_name, broker_contact_email, units, year_built, avg_sf, occupancy_pct, asset_class, strategy, offers_due, fit_tier, fit_score, fit_rationale, summary_error, summary_attempted_at, rationale_error, rationale_attempted_at, email_received_at, reviewed, reviewed_at, denied, denial_category, denial_reason, denied_by, denied_at, accepted_deal_id, email_thread_summary, email_count, gate_status, gate_reason, assigned_to",
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

  const sections = useMemo(
    () =>
      bucketInboxDeals(
        (deals ?? []).filter(
          (d) =>
            (stateFilter === "all" || d.location_state === stateFilter) &&
            (msaFilter === "all" || d.msa === msaFilter),
        ),
      ),
    [deals, stateFilter, msaFilter],
  );

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

    const { error: fbErr } = await (supabase.from("deal_feedback") as any).insert({
      inbox_deal_id: d.id,
      action: "deny",
      category,
      reason_text: reason,
      deal_snapshot: feedbackSnapshot(d),
      created_by: deniedBy,
    });
    if (fbErr) console.error("deal_feedback insert error:", fbErr);

    toast.success("Deal denied");
    setDenyTarget(null);
    refetch();
  };

  // Send a denied deal back to its tier section. deal_feedback is insert-only
  // under RLS, so the original "deny" row stays; the "restore" row (with the
  // analyst's reason) supersedes it in learning — see _shared/feedbackLearning.
  // Deals that were only marked reviewed never had a denial, so they restore
  // without a reason or a feedback row.
  const restoreDeal = async (d: InboxDeal, reason?: string) => {
    const { error } = await (supabase.from("inbox_deals") as any)
      .update({
        denied: false,
        reviewed: false,
        denial_category: null,
        denial_reason: null,
        denied_by: null,
        denied_at: null,
      })
      .eq("id", d.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (d.denied) {
      const { error: fbErr } = await (supabase.from("deal_feedback") as any).insert({
        inbox_deal_id: d.id,
        action: "restore",
        category: d.denial_category,
        reason_text: reason ?? null,
        deal_snapshot: feedbackSnapshot(d),
        created_by: user?.email ?? null,
      });
      if (fbErr) console.error("deal_feedback insert error:", fbErr);
    }
    toast.success("Deal restored");
    setRestoreTarget(null);
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

  const exportSection = (title: string, rows: InboxDeal[]) => {
    try {
      exportInboxSection({ title, deals: rows, teamById });
      toast.success("Exported to Excel");
    } catch (err) {
      console.error(err);
      toast.error("Export failed");
    }
  };

  const totalShown = INBOX_SECTIONS.reduce((n, s) => n + sections[s.key].length, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Section header — matches Dashboard rhythm */}
      <div className="border-b border-hairline pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">Deal Inbox</h1>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-[0.12em] font-medium tabular-nums">
              {sections.strong.length} strong · {sections.medium.length} medium · {sections.other.length} other
              {sections.unscored.length > 0 && <> · {sections.unscored.length} awaiting score</>}
              {" · "}{sections.denied.length} denied
            </p>
          </div>
          <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Tier sections */}
      <div className="space-y-3">
        {totalShown === 0 ? (
          <div className="surface-card border-dashed p-16 text-center">
            <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">No deals match your filters.</p>
          </div>
        ) : INBOX_SECTIONS.map((s) => {
          const rows = sections[s.key];
          // Awaiting Score only exists while something is waiting.
          if (s.key === "unscored" && rows.length === 0) return null;
          return (
            <InboxSection
              key={s.key}
              id={`section-${s.key}`}
              title={s.title}
              subtitle={s.subtitle}
              count={rows.length}
              defaultOpen={s.defaultOpen}
              onExport={() => exportSection(s.title, rows)}
            >
              {(limit) =>
                rows.slice(0, limit).map((d) => (
                  <DealCard
                    key={d.id}
                    deal={d}
                    onAccept={() => acceptDeal(d)}
                    onDeny={() => openDenyDialog(d)}
                    onRestore={() => (d.denied ? setRestoreTarget(d) : restoreDeal(d))}
                    dueSoon={offersDueSoon(d.offers_due)}
                    team={teamMembers ?? []}
                    owner={d.assigned_to ? teamById.get(d.assigned_to) ?? null : null}
                    onAssign={(memberId) => assignDeal(d.id, memberId)}
                  />
                ))
              }
            </InboxSection>
          );
        })}
      </div>
      <DenyDialog
        deal={denyTarget}
        onClose={() => setDenyTarget(null)}
        onSubmit={submitDeny}
      />
      <RestoreDialog
        deal={restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onSubmit={(reason) => (restoreTarget ? restoreDeal(restoreTarget, reason) : Promise.resolve())}
      />
    </div>
  );
}

const feedbackSnapshot = (d: InboxDeal) => ({
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
});

function InboxSection({
  id,
  title,
  subtitle,
  count,
  defaultOpen,
  onExport,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  count: number;
  defaultOpen: boolean;
  onExport: () => void;
  children: (limit: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [limit, setLimit] = useState(SECTION_PAGE_SIZE);
  return (
    <Collapsible open={open} onOpenChange={setOpen} id={id}>
      <div className="w-full flex items-center gap-3 py-3 px-4 surface-card">
        <CollapsibleTrigger asChild>
          <button className="flex flex-1 items-center gap-3 text-left min-w-0">
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
              strokeWidth={1.75}
            />
            <h2 className="font-display text-base font-semibold text-primary">{title}</h2>
            {subtitle && (
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold ml-1 truncate">
                {subtitle}
              </span>
            )}
            <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums bg-muted text-muted-foreground border border-hairline">
              {count}
            </span>
          </button>
        </CollapsibleTrigger>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={count === 0}
                onClick={onExport}
                aria-label={`Export ${title} to Excel`}
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Export to Excel</TooltipContent>
        </Tooltip>
      </div>
      <CollapsibleContent className="pt-2 space-y-2">
        {count === 0 ? (
          <p className="text-xs text-muted-foreground px-4 py-3">Nothing here.</p>
        ) : (
          <>
            {children(limit)}
            {limit < count && (
              <div className="flex justify-center py-2">
                <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + SECTION_PAGE_SIZE)}>
                  Show more · {limit} of {count}
                </Button>
              </div>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
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

function RestoreDialog({
  deal,
  onClose,
  onSubmit,
}: {
  deal: InboxDeal | null;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (deal) { setReason(""); setSaving(false); }
  }, [deal?.id]);

  // Required: the restore reason replaces the denial in what the AI learns from.
  const canSubmit = reason.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try { await onSubmit(reason.trim()); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={deal !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Why are we restoring this deal?</DialogTitle>
          {deal && (
            <DialogDescription className="text-xs">
              {displayTitle(deal)}
              {deal.denial_category && <> · denied for {deal.denial_category}{deal.denial_reason ? ` — ${deal.denial_reason}` : ""}</>}
            </DialogDescription>
          )}
        </DialogHeader>

        <div>
          <Label htmlFor="restore-reason" className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Reason for restoring
          </Label>
          <Textarea
            id="restore-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Seller cut price 10%; submarket is actually in our footprint; denied by mistake…"
            rows={4}
            className="mt-2"
          />
          <p className="text-[11px] text-muted-foreground mt-2">
            This replaces the original denial in what the AI screening learns from.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Saving…" : "Confirm Restore"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}




function DealCard({
  deal: d,
  onAccept,
  onDeny,
  onRestore,
  dueSoon,
  team,
  owner,
  onAssign,
}: {
  deal: InboxDeal;
  onAccept: () => void;
  onDeny: () => void;
  onRestore: () => void;
  dueSoon: boolean;
  team: TeamMember[];
  owner: TeamMember | null;
  onAssign: (memberId: string | null) => void;
}) {
  const t = tierKey(d.fit_tier);
  const inDenied = inboxSectionFor(d) === "denied";
  return (
    <div
      className={cn(
        "surface-card overflow-hidden transition-all",
        inDenied && "opacity-75",
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
                  {d.fit_tier == null && d.gate_status !== "filtered" && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.1em] bg-muted text-muted-foreground border border-hairline">
                      Not yet scored
                    </span>
                  )}
                  {d.gate_status === "filtered" && (
                    <span
                      title={d.gate_reason ?? "Filtered by the buy-box gate"}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.1em] bg-muted text-muted-foreground border border-hairline"
                    >
                      <EyeOff className="h-3 w-3" strokeWidth={2} />
                      Filtered{d.gate_reason ? `: ${d.gate_reason}` : ""}
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
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    <Mail className="h-3 w-3" strokeWidth={1.75} />
                    {d.email_received_at
                      ? `Received ${format(parseISO(d.email_received_at), "EEE, MMM d, yyyy · h:mm a")}`
                      : "Received date unknown"}
                  </span>
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

              {/*
                A failed rationale used to render as nothing at all — the line
                simply vanished, which is indistinguishable from "not generated
                yet" and from "generated, empty".
              */}
              {d.fit_rationale ? (
                <p className="text-xs text-muted-foreground border-t border-hairline pt-2.5 mt-2.5 italic">
                  Buybox: {d.fit_rationale}
                </p>
              ) : d.rationale_error ? (
                <p className="text-xs border-t border-hairline pt-2.5 mt-2.5">
                  <span className="font-medium text-destructive">Buybox rationale failed.</span>{" "}
                  <span className="text-muted-foreground italic">{d.rationale_error}</span>
                </p>
              ) : null}

              {d.denied && (
                <div className="text-xs border-t border-hairline pt-2.5 mt-2.5">
                  <span className="uppercase tracking-[0.1em] text-[10px] font-semibold text-destructive mr-1.5">Denied</span>
                  {d.denial_category && <span className="font-medium text-foreground">{d.denial_category}</span>}
                  {d.denial_reason && <span className="text-muted-foreground"> — {d.denial_reason}</span>}
                  {(d.denied_by || d.denied_at) && (
                    <span className="text-muted-foreground tabular-nums">
                      {" · "}
                      {[d.denied_by, d.denied_at && format(parseISO(d.denied_at), "MMM d, yyyy")].filter(Boolean).join(", ")}
                    </span>
                  )}
                </div>
              )}
              {inDenied && !d.denied && (
                <div className="text-xs border-t border-hairline pt-2.5 mt-2.5">
                  <span className="uppercase tracking-[0.1em] text-[10px] font-semibold text-muted-foreground mr-1.5">Marked reviewed</span>
                  <span className="text-muted-foreground">No denial reason given</span>
                  {d.reviewed_at && (
                    <span className="text-muted-foreground tabular-nums"> · {format(parseISO(d.reviewed_at), "MMM d, yyyy")}</span>
                  )}
                </div>
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
                {inDenied ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] border-hairline"
                    onClick={onRestore}
                  >
                    <RotateCcw className="h-3 w-3" strokeWidth={2.25} />
                    Restore
                  </Button>
                ) : (
                  <>
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
                  </>
                )}
              </div>
              <AssignMenu team={team} owner={owner} onAssign={onAssign} />
            </div>
          </div>

          {(d.email_thread_summary || (d.email_count ?? 0) > 0) && (
            <EmailSummaryBlock
              dealId={d.id}
              summary={d.email_thread_summary}
              summaryError={d.summary_error}
              summaryAttemptedAt={d.summary_attempted_at}
              count={d.email_count ?? 1}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EmailSummaryBlock({
  dealId,
  summary,
  summaryError,
  summaryAttemptedAt,
  count,
}: {
  dealId: string;
  summary: string | null;
  summaryError?: string | null;
  summaryAttemptedAt?: string | null;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const qc = useQueryClient();

  /**
   * Re-runs the summariser for this one deal. Self-contained rather than
   * threaded down from the page: the block already has the deal id, and the two
   * DealCard call sites sit under different parents.
   */
  const retrySummary = async () => {
    setRetrying(true);
    try {
      const { error } = await supabase.functions.invoke("summarize-emails", {
        body: { deal_id: dealId, force: true },
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["inbox_deals_pipeline"] });
    } catch (e) {
      toast.error(`Retry failed: ${(e as Error).message}`);
    } finally {
      setRetrying(false);
    }
  };

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
        {/*
          Three distinct states. "Pending" now means genuinely not yet attempted;
          a recorded failure shows the reason and a retry instead of sitting on
          "pending" indefinitely, which is how a dead model looked like a slow one.
        */}
        {summary ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            title="View full email thread"
            className="block w-full text-left -mx-1 px-1 py-0.5 rounded cursor-pointer hover:bg-muted/60 transition-colors"
          >
            <p className="text-xs text-foreground/80 leading-relaxed">{summary}</p>
          </button>
        ) : summaryError ? (
          <div className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-2 space-y-1.5">
            <p className="text-xs text-foreground/80 leading-relaxed">
              <span className="font-medium text-destructive">Summary failed.</span>{" "}
              <span className="text-muted-foreground">{summaryError}</span>
            </p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); retrySummary(); }}
              disabled={retrying}
              className="text-[11px] font-medium px-2 py-0.5 rounded bg-card border border-hairline hover:bg-muted transition-colors disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : (
          <p className="text-xs leading-relaxed">
            <span className="italic text-muted-foreground">
              {summaryAttemptedAt ? "No summary produced." : "Summary pending…"}
            </span>
          </p>
        )}

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
