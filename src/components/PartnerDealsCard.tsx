// Deals a capital partner is tagged on — the partner side of
// capital_raise_engagements, the same rows the deal's Capital Raise tab shows.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/RichTextEditor";
import { NoteContent } from "@/components/NoteContent";
import { RecordSection } from "@/components/PartnerRecordPanels";
import {
  PASS_CATEGORIES,
  RAISE_STAGES,
  STAGE_LABEL,
  stageStampFields,
  useEngagementsByPartner,
  useTaggableDeals,
  useTagPartnerOnDeal,
  useUpdatePartnerEngagement,
  type EngagementDeal,
  type PartnerEngagement,
  type RaiseStage,
} from "@/hooks/useCapitalRaiseEngagements";
import type { Partner } from "@/hooks/usePartners";
import { cn } from "@/lib/utils";

export const STAGE_TONE: Record<RaiseStage, string> = {
  added_to_pipeline: "bg-muted text-muted-foreground border-border",
  initial_reachout: "bg-muted text-foreground border-border",
  materials_shared: "bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950 dark:text-sky-100 dark:border-sky-800",
  in_discussion: "bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-800",
  serious_interest: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800",
  committed: "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800",
  passed: "bg-red-50 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-100 dark:border-red-800",
};

export function dealMeta(d: EngagementDeal | null): string {
  if (!d) return "";
  const place = [d.city, d.state].filter(Boolean).join(", ");
  return [place, d.unit_count ? `${d.unit_count} units` : null].filter(Boolean).join(" · ");
}

export function PartnerDealsCard({ partner }: { partner: Partner }) {
  const { data: engagements, isLoading } = useEngagementsByPartner(partner.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: deals } = useTaggableDeals(pickerOpen);
  const tag = useTagPartnerOnDeal(partner.id);
  const update = useUpdatePartnerEngagement();
  const [passing, setPassing] = useState<PartnerEngagement | null>(null);

  const taggedIds = useMemo(() => new Set((engagements ?? []).map((e) => e.deal_id)), [engagements]);
  const untagged = (deals ?? []).filter((d) => !taggedIds.has(d.id));

  const addTag = (d: EngagementDeal) => {
    setPickerOpen(false);
    tag.mutate(d.id, {
      onSuccess: () => toast.success(`Tagged on ${d.property_name}`),
      onError: (e: any) => toast.error("Tag failed: " + (e?.message ?? e)),
    });
  };

  const moveStage = (e: PartnerEngagement, stage: RaiseStage) => {
    if (stage === e.stage) return;
    if (stage === "passed") {
      setPassing(e);
      return;
    }
    update.mutate(
      { id: e.id, ...stageStampFields(stage) } as any,
      {
        onSuccess: () => toast.success(`${e.deal?.property_name ?? "Deal"} → ${STAGE_LABEL[stage]}`),
        onError: (err: any) => toast.error(err?.message ?? "Update failed"),
      },
    );
  };

  const untag = (e: PartnerEngagement) => {
    update.mutate(
      { id: e.id, removed_at: new Date().toISOString() } as any,
      {
        onSuccess: () =>
          toast.success(`Removed from ${e.deal?.property_name ?? "deal"}`, {
            action: {
              label: "Undo",
              onClick: () => update.mutate({ id: e.id, removed_at: null } as any),
            },
          }),
        onError: (err: any) => toast.error(err?.message ?? "Remove failed"),
      },
    );
  };

  return (
    <RecordSection
      title={`Deals (${engagements?.length ?? 0})`}
      actions={
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-primary" disabled={tag.isPending}>
              {tag.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Tag deal
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <Command>
              <CommandInput placeholder="Search pipeline deals…" />
              <CommandList>
                <CommandEmpty>{deals ? "No matching deals." : "Loading deals…"}</CommandEmpty>
                {untagged.map((d) => (
                  <CommandItem
                    key={d.id}
                    value={`${d.property_name} ${d.city ?? ""} ${d.state ?? ""} ${d.msa ?? ""}`}
                    onSelect={() => addTag(d)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="text-sm font-medium">{d.property_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[dealMeta(d), d.status].filter(Boolean).join(" · ")}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
      ) : engagements && engagements.length > 0 ? (
        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {engagements.map((e) => (
            <div key={e.id} className="rounded-md border p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/deals/${e.deal_id}`} className="text-sm font-semibold text-primary hover:underline min-w-0 break-words">
                  {e.deal?.property_name ?? "Unknown deal"}
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 -mr-1 shrink-0 text-muted-foreground"
                  onClick={() => untag(e)}
                  aria-label={`Remove tag from ${e.deal?.property_name ?? "deal"}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {dealMeta(e.deal) && <div className="text-xs text-muted-foreground">{dealMeta(e.deal)}</div>}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground truncate">
                  {e.deal?.pipeline_stage ? `Deal: ${e.deal.pipeline_stage}` : ""}
                </span>
                <Select value={e.stage} onValueChange={(v) => moveStage(e, v as RaiseStage)}>
                  <SelectTrigger
                    aria-label="Partner status on this deal"
                    className={cn("h-7 w-auto gap-1 rounded-full border px-2.5 text-xs font-semibold", STAGE_TONE[e.stage] ?? STAGE_TONE.initial_reachout)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {RAISE_STAGES.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs">{STAGE_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {e.stage === "passed" && (e.pass_feedback || e.pass_category) && (
                <div className="rounded bg-red-50 dark:bg-red-950/40 px-2 py-1.5 text-xs text-red-900 dark:text-red-100 space-y-0.5">
                  {e.pass_category && <div className="font-semibold">{e.pass_category}</div>}
                  {e.pass_feedback && <NoteContent content={e.pass_feedback} className="text-xs" />}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">Not tagged on any deals yet.</p>
      )}

      <PassDialog partner={partner} engagement={passing} onClose={() => setPassing(null)} />
    </RecordSection>
  );
}

/**
 * Marking a partner Passed from their own page captures the same feedback the
 * deal's Capital Raise tab does, so the partner-learning loop sees it either way.
 */
function PassDialog({
  partner,
  engagement,
  onClose,
}: {
  partner: Partner;
  engagement: PartnerEngagement | null;
  onClose: () => void;
}) {
  const update = useUpdatePartnerEngagement();
  const [category, setCategory] = useState("");
  const [feedback, setFeedback] = useState("");
  const [surmountable, setSurmountable] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);

  // Seed the form whenever a different engagement opens the dialog.
  if (engagement && engagement.id !== lastId) {
    setLastId(engagement.id);
    setCategory(engagement.pass_category ?? "");
    setFeedback(engagement.pass_feedback ?? "");
    setSurmountable(!!engagement.pass_price_surmountable);
  }

  const confirm = () => {
    if (!engagement) return;
    if (!category) return toast.error("Reason category is required");
    if (!feedback.trim()) return toast.error("Pass feedback is required");
    const d = engagement.deal;
    const snapshot = {
      deal: {
        state: d?.state ?? null,
        market: d?.msa ?? null,
        unit_count: d?.unit_count ?? null,
        asset_class: null,
        price: d?.asking_price ?? null,
        estimated_equity: d?.estimated_equity ?? null,
        value_add_potential: null,
      },
      partner: {
        firm_type: partner.firm_type ?? null,
        investor_type: partner.investor_type ?? null,
        geography: partner.geography ?? null,
        min_equity_m: partner.min_equity_m ?? null,
        max_equity_m: partner.max_equity_m ?? null,
        strategy_value_add: partner.strategy_value_add ?? null,
        strategy_core_plus: partner.strategy_core_plus ?? null,
        strategy_workforce: partner.strategy_workforce ?? null,
        strategy_affordable: partner.strategy_affordable ?? null,
        product_types: partner.product_types ?? null,
      },
    };
    update.mutate(
      {
        id: engagement.id,
        ...stageStampFields("passed"),
        pass_feedback: feedback.trim(),
        pass_price_surmountable: surmountable,
        pass_category: category,
      } as any,
      {
        onSuccess: async () => {
          const { error } = await (supabase as any).from("capital_partner_feedback").insert({
            partner_id: partner.id,
            deal_id: engagement.deal_id,
            engagement_id: engagement.id,
            category,
            reason_text: feedback.trim(),
            price_surmountable: surmountable,
            snapshot,
          });
          if (error) console.error("capital_partner_feedback insert failed", error);
          toast.success(`${engagement.deal?.property_name ?? "Deal"} → Passed`);
          setLastId(null);
          onClose();
        },
        onError: (err: any) => toast.error(err?.message ?? "Update failed"),
      },
    );
  };

  return (
    <Dialog open={!!engagement} onOpenChange={(o) => { if (!o) { setLastId(null); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Why did {partner.name} pass?</DialogTitle>
          <DialogDescription>
            On {engagement?.deal?.property_name ?? "this deal"}. This feeds the partner-learning model.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="partner-pass-category">Reason category <span className="text-destructive">*</span></Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="partner-pass-category"><SelectValue placeholder="Select a reason category" /></SelectTrigger>
              <SelectContent>
                {PASS_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Pass feedback <span className="text-destructive">*</span></Label>
            <RichTextEditor value={feedback} onChange={setFeedback} placeholder="What did they say?" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={surmountable} onCheckedChange={(v) => setSurmountable(v === true)} />
            Price was the issue and could be surmountable
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setLastId(null); onClose(); }}>Cancel</Button>
          <Button onClick={confirm} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-1" /> Mark passed</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
