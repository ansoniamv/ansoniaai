import { useMemo, useState, useEffect, createContext, useContext, type DragEvent } from "react";
import { LayoutGrid, Table as TableIcon, Plus, Check, RefreshCw, Sparkles, ExternalLink, Pencil, X, Trash2, MailPlus, Undo2, Eye, RotateCcw, Archive, Info } from "lucide-react";
import { DraftOutreachDialog } from "@/components/DraftOutreachDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/RichTextEditor";
import { NoteContent } from "@/components/NoteContent";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useEngagementsByDeal,
  useUpdateEngagement,
  useDeleteEngagement,
  useRestoreEngagement,
  RAISE_STAGES,
  STAGE_LABEL,
  type Engagement,
  type RaiseStage,
} from "@/hooks/useCapitalRaiseEngagements";
import { supabase } from "@/integrations/supabase/client";
import { usePartners } from "@/hooks/usePartners";
import { useLatestPartnerEmails, type LatestPartnerEmail } from "@/hooks/useOutlook";
import { Mail, MailWarning } from "lucide-react";
import { WarmthBadge } from "@/components/WarmthBadge";
import { PartnerMatchPanel } from "@/components/PartnerMatchPanel";
import type { Deal } from "@/hooks/useDeals";
import { useArchiveRaise, useRestoreRaise } from "@/hooks/useCapitalRaise";

/**
 * An archived raise is read-only: every row, amount and note stays visible,
 * but nothing can be written. Nested pieces (summary, table, cells) read this
 * rather than threading a prop through six levels.
 */
const RaiseArchivedContext = createContext(false);
const useRaiseArchived = () => useContext(RaiseArchivedContext);
const READONLY_TITLE = "Re-open this raise to make changes";

const fmtCurrency = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
};

const daysSince = (d: string | null | undefined) => {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
};

const agingColor = (d: string | null | undefined) => {
  const days = daysSince(d);
  if (days == null) return "#9ca3af";
  if (days < 7) return "#9ca3af";
  if (days <= 21) return "#c19a2b";
  return "#a13c2f";
};

const agingLabel = (d: string | null | undefined) => {
  const days = daysSince(d);
  if (days == null) return "No contact yet";
  return `${days}d since last contact`;
};

function stageStampFields(stage: RaiseStage): Partial<Engagement> {
  const today = new Date();
  const dateOnly = today.toISOString().slice(0, 10);
  const iso = today.toISOString();
  // Any explicit stage change from the UI is manual — lock the row so
  // automations (email replies, commits, denials) don't overwrite it.
  const patch: Partial<Engagement> = {
    stage,
    last_contact_date: dateOnly,
    stage_locked_manual: true,
    stage_locked_at: iso,
  } as Partial<Engagement>;
  switch (stage) {
    case "initial_reachout":
      patch.initial_reachout_date = dateOnly;
      break;
    case "materials_shared":
      patch.materials_shared_date = dateOnly;
      break;
    case "in_discussion":
      break;
    case "added_to_pipeline":
      break;
    case "serious_interest":
      patch.serious_interest = true;
      break;
    case "committed":
      break;
    case "passed":
      patch.passed = true;
      break;
  }
  return patch;
}

// Fields captured to make a stage move reversible.
const STAGE_STAMP_FIELD_KEYS = [
  "stage",
  "stage_locked_manual",
  "stage_locked_at",
  "last_contact_date",
  "initial_reachout_date",
  "materials_shared_date",
  "discussion_scheduled_date",
  "serious_interest",
  "passed",
] as const;

type StageUndoSnapshot = {
  id: string;
  partnerName: string;
  fromStage: RaiseStage;
  toStage: RaiseStage;
  previous: Partial<Engagement>;
};

function captureStageSnapshot(row: Engagement): Partial<Engagement> {
  const snap: Record<string, any> = {};
  for (const k of STAGE_STAMP_FIELD_KEYS) snap[k] = (row as any)[k] ?? null;
  return snap;
}

export function CapitalRaiseTab({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const { data: engagements, isLoading } = useEngagementsByDeal(deal.id);
  const { data: partnerLookup } = usePartners();
  const updateEng = useUpdateEngagement(deal.id);
  const deleteEng = useDeleteEngagement(deal.id);
  const restoreEng = useRestoreEngagement(deal.id);
  const archived = !!(deal as any).raise_archived_at;
  const archiveRaise = useArchiveRaise();
  const restoreRaise = useRestoreRaise();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [dragId, setDragId] = useState<string | null>(null);
  const [passModal, setPassModal] = useState<{ id: string; partner: string } | null>(null);
  const [passFeedback, setPassFeedback] = useState("");
  const [passSurmountable, setPassSurmountable] = useState(false);
  const [passCategory, setPassCategory] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [editEng, setEditEng] = useState<Engagement | null>(null);
  const [removeEng, setRemoveEng] = useState<Engagement | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [lastMove, setLastMove] = useState<StageUndoSnapshot | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const { data: allEngagements } = useEngagementsByDeal(deal.id, { includeRemoved: true });
  const removedRows = useMemo(
    () => (allEngagements ?? []).filter((e: any) => e.removed_at),
    [allEngagements],
  );


  const rows = engagements ?? [];
  const partnerIds = useMemo(() => rows.map((r) => r.partner_id), [rows]);
  const { data: latestEmails } = useLatestPartnerEmails(partnerIds);



  const byStage = useMemo(() => {
    const grouped: Record<RaiseStage, Engagement[]> = {
      added_to_pipeline: [],
      initial_reachout: [],
      materials_shared: [],
      in_discussion: [],
      serious_interest: [],
      committed: [],
      passed: [],
    };
    for (const e of rows) {
      const s = (RAISE_STAGES as readonly string[]).includes(e.stage) ? e.stage : "initial_reachout";
      grouped[s as RaiseStage].push(e);
    }
    return grouped;
  }, [rows]);

  const undoStageMove = (snap: StageUndoSnapshot) => {
    if (archived) return;
    updateEng.mutate(
      { id: snap.id, ...snap.previous } as any,
      {
        onSuccess: () => {
          toast.success(`Reverted ${snap.partnerName} to ${STAGE_LABEL[snap.fromStage]}`);
          setLastMove((cur) => (cur && cur.id === snap.id ? null : cur));
        },
        onError: (e: any) => toast.error(e.message ?? "Undo failed"),
      },
    );
  };

  const moveStage = (id: string, newStage: RaiseStage) => {
    if (archived) return;
    const row = rows.find((r) => r.id === id);
    if (!row || row.stage === newStage) return;
    if (newStage === "passed") {
      setPassFeedback(row.pass_feedback ?? "");
      setPassSurmountable(!!row.pass_price_surmountable);
      setPassCategory((row as any).pass_category ?? "");
      setPassModal({ id, partner: row.partner_name ?? "this partner" });
      return;
    }
    const snap: StageUndoSnapshot = {
      id,
      partnerName: row.partner_name ?? "partner",
      fromStage: row.stage,
      toStage: newStage,
      previous: captureStageSnapshot(row),
    };
    updateEng.mutate(
      { id, ...stageStampFields(newStage) } as any,
      {
        onSuccess: () => {
          setLastMove(snap);
          toast.success(`${snap.partnerName} → ${STAGE_LABEL[newStage]}`, {
            action: { label: "Undo", onClick: () => undoStageMove(snap) },
          });
        },
        onError: (e: any) => toast.error(e.message),
      },
    );
  };


  const confirmPass = () => {
    if (archived) return;
    if (!passModal) return;
    if (!passFeedback.trim()) {
      toast.error("Pass feedback is required");
      return;
    }
    if (!passCategory) {
      toast.error("Reason category is required");
      return;
    }
    const engagementId = passModal.id;
    const row = rows.find((r) => r.id === engagementId);
    const partner = (partnerLookup?.find((p) => p.id === row?.partner_id)) ?? null;
    const snapshot = {
      deal: {
        state: (deal as any).state ?? null,
        market: (deal as any).msa ?? (deal as any).market ?? null,
        unit_count: (deal as any).unit_count ?? null,
        asset_class: (deal as any).asset_class ?? null,
        price: (deal as any).asking_price ?? (deal as any).price ?? null,
        estimated_equity: (deal as any).estimated_equity ?? null,
        value_add_potential: (deal as any).value_add_potential ?? null,
      },
      partner: partner
        ? {
            firm_type: (partner as any).firm_type ?? null,
            investor_type: (partner as any).investor_type ?? null,
            geography: (partner as any).geography ?? null,
            min_equity_m: (partner as any).min_equity_m ?? null,
            max_equity_m: (partner as any).max_equity_m ?? null,
            strategy_value_add: (partner as any).strategy_value_add ?? null,
            strategy_core_plus: (partner as any).strategy_core_plus ?? null,
            strategy_workforce: (partner as any).strategy_workforce ?? null,
            strategy_affordable: (partner as any).strategy_affordable ?? null,
            product_types: (partner as any).product_types ?? null,
          }
        : null,
    };
    updateEng.mutate(
      {
        id: engagementId,
        ...stageStampFields("passed"),
        pass_feedback: passFeedback.trim(),
        pass_price_surmountable: passSurmountable,
        pass_category: passCategory,
      } as any,
      {
        onSuccess: async () => {
          try {
            await (supabase as any).from("capital_partner_feedback").insert({
              partner_id: row?.partner_id ?? null,
              deal_id: deal.id,
              engagement_id: engagementId,
              category: passCategory,
              reason_text: passFeedback.trim(),
              price_surmountable: passSurmountable,
              snapshot,
            });
          } catch (err) {
            console.error("capital_partner_feedback insert failed", err);
          }
          setPassModal(null);
          setPassFeedback("");
          setPassSurmountable(false);
          setPassCategory("");
        },
        onError: (e: any) => toast.error(e.message),
      },
    );
  };

  const onDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (e: DragEvent<HTMLDivElement>, stage: RaiseStage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    if (id) moveStage(id, stage);
  };

  const gotoPartner = (partnerId: string) => (ev: React.MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    navigate(`/partners/${partnerId}`);
  };

  const committedTotal = rows.reduce((sum, e) => sum + (Number(e.committed_amount) || 0), 0);
  const targetRaise = Number((deal as any).target_raise) || 0;
  const coveragePct = targetRaise > 0 ? Math.round((committedTotal / targetRaise) * 100) : null;

  return (
    <RaiseArchivedContext.Provider value={archived}>
    <div className="space-y-4">
      {archived && (
        <div className="rounded-sm border bg-muted/40 px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 text-sm">
            <div className="font-medium text-foreground flex items-center gap-1.5">
              <Archive className="h-3.5 w-3.5" /> Raise archived{" "}
              {new Date((deal as any).raise_archived_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
              {(deal as any).raise_archived_by ? ` by ${(deal as any).raise_archived_by}` : ""}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Read-only. Everything below is preserved — re-open the raise to make changes.
            </div>
            {(deal as any).raise_archive_note && (
              <div className="text-xs italic text-muted-foreground mt-1">
                “{(deal as any).raise_archive_note}”
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs shrink-0"
            disabled={restoreRaise.isPending}
            onClick={() => restoreRaise.mutate({ dealId: deal.id })}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Re-open Raise
          </Button>
        </div>
      )}

      {/* ============ Raise summary ============ */}
      <RaiseSummary deal={deal} engagements={rows} />

      {/* ============ Stage summary ============ */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {RAISE_STAGES.map((s) => (
          <div
            key={s}
            className="flex items-center justify-between gap-2 rounded-sm border bg-muted/30 px-2.5 py-1.5 min-w-0"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
              {STAGE_LABEL[s]}
            </span>
            <span className="text-xs font-semibold tabular-nums shrink-0">{byStage[s].length}</span>
          </div>
        ))}
      </div>

      {/* ============ Toolbar ============ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {rows.length} partner{rows.length === 1 ? "" : "s"} engaged
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastMove && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={() => undoStageMove(lastMove)}
              title={`Undo: ${lastMove.partnerName} back to ${STAGE_LABEL[lastMove.fromStage]}`}
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo last move
            </Button>
          )}
          <Button
            size="sm"
            variant={showRemoved ? "secondary" : "outline"}
            className="h-7 gap-1 text-xs"
            onClick={() => setShowRemoved((v) => !v)}
          >
            <Eye className="h-3.5 w-3.5" />
            {showRemoved ? "Hide removed" : `Show removed${removedRows.length ? ` (${removedRows.length})` : ""}`}
          </Button>

          <div className="flex items-center gap-1 border rounded-sm p-0.5">
            <Button
              variant={view === "kanban" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1 rounded-sm text-xs"
              onClick={() => setView("kanban")}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </Button>
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1 rounded-sm text-xs"
              onClick={() => setView("table")}
            >
              <TableIcon className="h-3.5 w-3.5" /> Table
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => setDraftOpen(true)}
            disabled={rows.length === 0 || archived}
            title={archived ? READONLY_TITLE : undefined}
          >
            <MailPlus className="h-3.5 w-3.5" /> Draft Outreach Email
          </Button>
          {!archived && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={() => setArchiveOpen(true)}
            >
              <Archive className="h-3.5 w-3.5" /> Archive Raise
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setAddOpen(true)}
            disabled={archived}
            title={archived ? READONLY_TITLE : undefined}
          >
            <Plus className="h-3.5 w-3.5" /> Add Partner
          </Button>
        </div>
      </div>

      {/* ============ Content ============ */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading engagements…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No capital partners engaged yet. Click “+ Add Partner” to add some.
          </CardContent>
        </Card>
      ) : view === "kanban" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          {RAISE_STAGES.map((stage) => (
            <div
              key={stage}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, stage)}
              className="rounded-sm border border-border/70 bg-muted/20 min-h-[220px] flex flex-col min-w-0"
            >
              <div className="px-2.5 py-1.5 border-b border-border/60 flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium truncate">
                  {STAGE_LABEL[stage]}
                </div>
                <div className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                  {byStage[stage].length}
                </div>
              </div>
              <div className="p-1.5 space-y-1.5 flex-1">
                {byStage[stage].map((e) => (
                  <div
                    key={e.id}
                    draggable={!archived}
                    onDragStart={archived ? undefined : (ev) => onDragStart(ev, e.id)}
                    className={`rounded-sm border border-border bg-background p-2 transition-colors ${archived ? "" : "cursor-grab active:cursor-grabbing hover:border-foreground/30"}`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <button
                        type="button"
                        draggable={false}
                        onMouseDown={(ev) => ev.stopPropagation()}
                        onClick={gotoPartner(e.partner_id)}
                        className="text-[12px] font-medium leading-snug text-left hover:text-primary hover:underline break-words min-w-0 flex-1"
                      >
                        {e.partner_name || "Unknown partner"}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          title={agingLabel(e.last_contact_date)}
                          className="mt-1 inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: agingColor(e.last_contact_date) }}
                        />
                        {!archived && (
                          <>
                            <button
                              type="button"
                              draggable={false}
                              onMouseDown={(ev) => ev.stopPropagation()}
                              onClick={(ev) => { ev.stopPropagation(); setEditEng(e); }}
                              title="Edit"
                              className="p-0.5 text-muted-foreground hover:text-foreground rounded"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              draggable={false}
                              onMouseDown={(ev) => ev.stopPropagation()}
                              onClick={(ev) => { ev.stopPropagation(); setRemoveEng(e); }}
                              title="Remove from raise"
                              className="p-0.5 text-muted-foreground hover:text-destructive rounded"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {e.partner_contact && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground break-words leading-snug">
                        {e.partner_contact}
                      </div>
                    )}
                    <CardEmailStatus
                      partnerId={e.partner_id}
                      latest={latestEmails?.get(e.partner_id)}
                    />
                    {e.stage_last_auto_reason && (
                      <div
                        className="mt-1 text-[10px] text-primary/80 italic"
                        title={
                          e.stage_last_auto_at
                            ? `Auto-moved ${new Date(e.stage_last_auto_at).toLocaleString()}`
                            : undefined
                        }
                      >
                        · Auto: {autoReasonLabel(e.stage_last_auto_reason)}
                      </div>
                    )}
                    {(e.indicated_amount != null || e.committed_amount != null || e.owner) && (
                      <div className="mt-1.5 pt-1.5 border-t border-border/60 text-[10px] text-muted-foreground space-y-0.5 tabular-nums">
                        {e.indicated_amount != null && (
                          <div className="flex justify-between gap-2">
                            <span>Indicated</span>
                            <span className="text-foreground">{fmtCurrency(e.indicated_amount)}</span>
                          </div>
                        )}
                        {e.committed_amount != null && (
                          <div className="flex justify-between gap-2">
                            <span>Committed</span>
                            <span className="text-foreground">{fmtCurrency(e.committed_amount)}</span>
                          </div>
                        )}
                        {e.owner && (
                          <div className="flex justify-between gap-2">
                            <span>Owner</span>
                            <span className="text-foreground truncate">{e.owner}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {byStage[stage].length === 0 && (
                  <div className="text-[10px] text-muted-foreground/50 italic text-center py-6">
                    Drop here
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <TableView rows={rows} dealId={deal.id} onMove={moveStage} onPartnerClick={(id) => navigate(`/partners/${id}`)} />
      )}

      {/* ============ Removed engagements ============ */}
      {showRemoved && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Removed partners
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Soft-removed from this raise. Restore to bring the card back to its previous stage.
                </div>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">{removedRows.length}</span>
            </div>
            {removedRows.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-2">No removed partners.</div>
            ) : (
              <div className="rounded-sm border divide-y">
                {removedRows.map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.partner_name ?? "Unknown partner"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        Was in {STAGE_LABEL[e.stage as RaiseStage] ?? e.stage}
                        {e.removed_at ? ` · removed ${new Date(e.removed_at).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      title={archived ? READONLY_TITLE : undefined}
                      onClick={() =>
                        archived ? undefined : restoreEng.mutate(e.id, {
                          onSuccess: () => toast.success(`Restored ${e.partner_name ?? "partner"}`),
                          onError: (err: any) => toast.error(err.message ?? "Restore failed"),
                        })
                      }
                      disabled={restoreEng.isPending || archived}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}


      {/* ============ Why partners passed ============ */}
      <WhyPassedCard deal={deal} engagements={rows} />

      {/* ============ Partner matching ============ */}
      <PartnerMatchPanel deal={deal} />



      {/* ============ Pass modal ============ */}
      <Dialog
        open={!!passModal}
        onOpenChange={(o) => {
          if (!o) {
            setPassModal(null);
            setPassFeedback("");
            setPassSurmountable(false);
            setPassCategory("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {passModal?.partner} as passed</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pass_category">Reason category <span className="text-destructive">*</span></Label>
              <Select value={passCategory} onValueChange={setPassCategory}>
                <SelectTrigger id="pass_category">
                  <SelectValue placeholder="Select a reason category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Size / Check size">Size / Check size</SelectItem>
                  <SelectItem value="Market / Geography">Market / Geography</SelectItem>
                  <SelectItem value="Strategy / Risk">Strategy / Risk</SelectItem>
                  <SelectItem value="Pricing / Returns">Pricing / Returns</SelectItem>
                  <SelectItem value="Timing / Capital availability">Timing / Capital availability</SelectItem>
                  <SelectItem value="Relationship / Fit">Relationship / Fit</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pass_feedback">Pass feedback <span className="text-destructive">*</span></Label>
              <RichTextEditor
                value={passFeedback}
                onChange={setPassFeedback}
                placeholder="Why did they pass? What did they say?"
              />
            </div>
            <div className="flex items-center justify-between rounded-sm border p-3">
              <div>
                <Label htmlFor="pass_price" className="text-sm">Pass due to price / surmountable objection?</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Toggle on if a better price or terms could turn this around.
                </p>
              </div>
              <Switch
                id="pass_price"
                checked={passSurmountable}
                onCheckedChange={setPassSurmountable}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPassModal(null)}>Cancel</Button>
            <Button onClick={confirmPass} disabled={updateEng.isPending}>
              Confirm pass
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ Add-partner dialog ============ */}
      <AddPartnerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        deal={deal}
        engagedIds={new Set(rows.map((r) => r.partner_id))}
      />

      {/* ============ Draft outreach dialog ============ */}
      <DraftOutreachDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
        deal={deal}
        engagements={rows}
      />


      {/* ============ Edit engagement dialog ============ */}
      <EditEngagementDialog
        engagement={editEng}
        onOpenChange={(o) => { if (!o) setEditEng(null); }}
        onSave={(patch) => {
          if (!editEng || archived) return;
          updateEng.mutate(
            { id: editEng.id, ...patch } as any,
            {
              onSuccess: () => { toast.success("Engagement updated"); setEditEng(null); },
              onError: (err: any) => toast.error(err.message ?? "Update failed"),
            },
          );
        }}
        onRemove={() => {
          if (!editEng) return;
          setRemoveEng(editEng);
          setEditEng(null);
        }}
        saving={updateEng.isPending}
      />

      {/* ============ Remove confirm ============ */}
      <AlertDialog
        open={!!removeEng}
        onOpenChange={(o) => { if (!o) setRemoveEng(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeEng?.partner_name || "partner"} from this raise?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the card from this raise. You can restore it from “Show removed” or the Undo toast — the partner record itself is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!removeEng || archived) return;
                const removed = removeEng;
                deleteEng.mutate(removed.id, {
                  onSuccess: () => {
                    setRemoveEng(null);
                    toast.success(`Removed ${removed.partner_name ?? "partner"} from raise`, {
                      action: {
                        label: "Undo",
                        onClick: () =>
                          restoreEng.mutate(removed.id, {
                            onSuccess: () => toast.success(`Restored ${removed.partner_name ?? "partner"}`),
                            onError: (err: any) => toast.error(err.message ?? "Restore failed"),
                          }),
                      },
                    });
                  },
                  onError: (err: any) => toast.error(err.message ?? "Remove failed"),
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ============ Archive raise dialog ============ */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <ArchiveRaiseDialogBody
          dealId={deal.id}
          engagedCount={rows.length}
          committed={committedTotal}
          coveragePct={coveragePct}
          defaultStatus={committedTotal >= targetRaise && targetRaise > 0 ? "fully_committed" : "closed"}
          saving={archiveRaise.isPending}
          onConfirm={(finalStatus, note) =>
            archiveRaise.mutate(
              { dealId: deal.id, note, finalStatus },
              { onSuccess: () => setArchiveOpen(false) },
            )
          }
        />
      </Dialog>
    </div>
    </RaiseArchivedContext.Provider>
  );
}

function ArchiveRaiseDialogBody({
  engagedCount,
  committed,
  coveragePct,
  defaultStatus,
  saving,
  onConfirm,
}: {
  dealId: string;
  engagedCount: number;
  committed: number;
  coveragePct: number | null;
  defaultStatus: "fully_committed" | "closed";
  saving: boolean;
  onConfirm: (finalStatus: "raising" | "fully_committed" | "closed", note: string) => void;
}) {
  const [status, setStatus] = useState<"raising" | "fully_committed" | "closed">(defaultStatus);
  const [note, setNote] = useState("");
  useEffect(() => setStatus(defaultStatus), [defaultStatus]);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Archive this raise?</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The raise moves off the active list and becomes read-only. Every partner, amount, pass reason
          and note is kept — you can re-open it any time from Capital Raise → Archived.
        </p>
        <div className="rounded-sm border bg-muted/30 px-3 py-2 text-xs text-muted-foreground tabular-nums">
          {engagedCount} partner{engagedCount === 1 ? "" : "s"} engaged · {fmtCurrency(committed)} committed
          {coveragePct != null ? ` · ${coveragePct}% covered` : ""}
        </div>
        <div className="space-y-1.5">
          <Label>Final status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="fully_committed">Fully Committed</SelectItem>
              <SelectItem value="raising">Still Raising (just archive)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="archive_note">Note (optional)</Label>
          <Textarea
            id="archive_note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Closed 8/14 — Blackstone took the full $12M"
            rows={3}
          />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => onConfirm(status, note)} disabled={saving}>
          Archive Raise
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* -------- raise summary ---------- */

function RaiseSummary({ deal, engagements }: { deal: Deal; engagements: Engagement[] }) {
  const qc = useQueryClient();
  const archived = useRaiseArchived();
  const target = (deal as any).target_raise as number | null;
  const committed = Number((deal as any).total_committed ?? 0) || 0;
  const remaining = target != null ? Math.max(0, target - committed) : null;
  const pct = target && target > 0 ? Math.min(100, Math.round((committed / target) * 100)) : null;
  const lpCount = engagements.filter((e) => (e.committed_amount ?? 0) > 0).length;
  const indicatedCount = engagements.filter((e) => (e.indicated_amount ?? 0) > 0 && !(e.committed_amount ?? 0)).length;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(target != null ? String(target) : "");
  const [saving, setSaving] = useState(false);

  const barColor = pct == null ? "bg-muted" : pct < 25 ? "bg-red-500" : pct < 75 ? "bg-amber-500" : "bg-green-600";

  const saveTarget = async () => {
    if (archived) return;
    const cleaned = draft.replace(/[$,\s]/g, "");
    const num = cleaned === "" ? null : Number(cleaned);
    if (num != null && (!Number.isFinite(num) || num < 0)) {
      toast.error("Enter a valid non-negative number");
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any)
      .from("deals")
      .update({ target_raise: num })
      .eq("id", (deal as any).id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Raise target updated");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["deals"] });
    qc.invalidateQueries({ queryKey: ["deal", (deal as any).id] });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-start">
          <div className="min-w-0 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center justify-center gap-1">
              Raise Target
              {!editing && !archived && (
                <button
                  type="button"
                  onClick={() => { setDraft(target != null ? String(target) : ""); setEditing(true); }}
                  className="text-muted-foreground/70 hover:text-foreground transition-colors"
                  aria-label="Edit raise target"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
            {editing && !archived ? (
              <div className="mt-1 flex items-center justify-center gap-1">
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTarget();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  placeholder="e.g. 55000000"
                  className="h-8 text-sm text-center tabular-nums w-32"
                />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveTarget} disabled={saving} aria-label="Save">
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)} disabled={saving} aria-label="Cancel">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="text-lg font-semibold tabular-nums text-foreground">{fmtCurrency(target)}</div>
            )}
          </div>
          <SumStat label="Committed" value={fmtCurrency(committed)} accent />
          <SumStat label="Remaining" value={remaining == null ? "—" : fmtCurrency(remaining)} />
          <SumStat label="% Raised" value={pct == null ? "—" : `${pct}%`} />
          <SumStat label="LPs Committed" value={String(lpCount)} sub={indicatedCount ? `${indicatedCount} indicated` : undefined} />
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SumStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="min-w-0 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

/* -------- add partner dialog ---------- */

function AddPartnerDialog({
  open,
  onOpenChange,
  deal,
  engagedIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  deal: Deal;
  engagedIds: Set<string>;
}) {
  const qc = useQueryClient();
  const { data: partners, isLoading } = usePartners();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    if (!partners) return [];
    const q = query.trim().toLowerCase();
    return partners
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [partners, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addable = Array.from(selected).filter((id) => !engagedIds.has(id));

  const submit = async () => {
    if (addable.length === 0) return;
    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const rows = addable.map((partner_id) => ({
        deal_id: deal.id,
        partner_id,
        stage: "initial_reachout",
        initial_reachout_date: today,
        last_contact_date: today,
      }));
      const { error } = await (supabase as any)
        .from("capital_raise_engagements")
        .insert(rows);
      if (error) throw error;

      // Adding partners is live work — always bring the raise back to an active,
      // raising state so a stale `deal` prop cannot skip the reopen.
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
          ? `Added ${addable.length} partner${addable.length === 1 ? "" : "s"} — raise re-opened`
          : `Added ${addable.length} partner${addable.length === 1 ? "" : "s"} to raise`,
      );
      setSelected(new Set());
      setQuery("");
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements", "deal", deal.id] });
      qc.invalidateQueries({ queryKey: ["capital-raise-engagements", deal.id] });
      qc.invalidateQueries({ queryKey: ["deals", deal.id] });
      qc.invalidateQueries({ queryKey: ["deals"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to add partners");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add capital partners to raise</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Search partners…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 text-sm"
        />
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading partners…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No partners found.</p>
        ) : (
          <div className="space-y-1 max-h-[420px] overflow-y-auto">
            {filtered.map((p) => {
              const already = engagedIds.has(p.id);
              const isSelected = selected.has(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 p-2 rounded-md border transition-colors cursor-pointer ${
                    already
                      ? "bg-muted/40 opacity-70 cursor-not-allowed"
                      : isSelected
                      ? "bg-primary/5 border-primary/40"
                      : "hover:bg-muted/40"
                  }`}
                >
                  <Checkbox
                    checked={already || isSelected}
                    disabled={already}
                    onCheckedChange={() => !already && toggle(p.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{p.name}</span>
                      <WarmthBadge strength={p.relationship_strength} />
                      {p.firm_type && (
                        <Badge variant="outline" className="text-[10px]">{p.firm_type}</Badge>
                      )}
                    </div>
                    {(p.min_equity_m != null || p.max_equity_m != null) && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Equity: ${p.min_equity_m ?? "?"}M – ${p.max_equity_m ?? "?"}M
                      </p>
                    )}
                  </div>
                  {already && (
                    <Badge variant="outline" className="text-[10px] gap-1 whitespace-nowrap">
                      <Check className="h-3 w-3" /> In Raise
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={addable.length === 0 || saving} className="gap-1">
            <Plus className="h-4 w-4" />
            Add {addable.length > 0 ? `(${addable.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------- table view ---------- */

function TableView({
  rows,
  dealId,
  onMove,
  onPartnerClick,
}: {
  rows: Engagement[];
  dealId: string;
  onMove: (id: string, stage: RaiseStage) => void;
  onPartnerClick: (partnerId: string) => void;
}) {
  const updateEng = useUpdateEngagement(dealId);
  const archived = useRaiseArchived();

  const commit = (id: string, field: keyof Engagement, value: any) => {
    if (archived) return;
    updateEng.mutate({ id, [field]: value } as any, {
      onError: (e: any) => toast.error(e.message),
    });
  };

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">Partner</th>
              <th className="text-left px-3 py-2 font-medium">Stage</th>
              <th className="text-right px-3 py-2 font-medium">Indicated</th>
              <th className="text-right px-3 py-2 font-medium">Committed</th>
              <th className="text-left px-3 py-2 font-medium">Owner</th>
              <th className="text-left px-3 py-2 font-medium">Last Contact</th>
              <th className="text-left px-3 py-2 font-medium">Next Action</th>
              <th className="text-left px-3 py-2 font-medium">Next Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b hover:bg-muted/20">
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: agingColor(e.last_contact_date) }}
                    />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onPartnerClick(e.partner_id)}
                        className="font-medium truncate text-left hover:text-primary hover:underline"
                      >
                        {e.partner_name || "—"}
                      </button>
                      {e.partner_contact && (
                        <div className="text-[11px] text-muted-foreground truncate">{e.partner_contact}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    className="h-7 rounded-sm border bg-background px-2 text-xs disabled:opacity-100 disabled:text-muted-foreground"
                    value={e.stage}
                    disabled={archived}
                    title={archived ? READONLY_TITLE : undefined}
                    onChange={(ev) => onMove(e.id, ev.target.value as RaiseStage)}
                  >
                    {RAISE_STAGES.map((s) => (
                      <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <NumberCell
                    value={e.indicated_amount}
                    onCommit={(v) => commit(e.id, "indicated_amount", v)}
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <NumberCell
                    value={e.committed_amount}
                    onCommit={(v) => commit(e.id, "committed_amount", v)}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <TextCell
                    value={e.owner ?? ""}
                    onCommit={(v) => commit(e.id, "owner", v || null)}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <DateCell
                    value={e.last_contact_date}
                    onCommit={(v) => commit(e.id, "last_contact_date", v)}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <TextCell
                    value={e.next_action ?? ""}
                    onCommit={(v) => commit(e.id, "next_action", v || null)}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <DateCell
                    value={e.next_action_date}
                    onCommit={(v) => commit(e.id, "next_action_date", v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function NumberCell({
  value,
  onCommit,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
}) {
  const [v, setV] = useState<string>(value == null ? "" : String(value));
  if (useRaiseArchived()) {
    return <span className="text-xs tabular-nums">{fmtCurrency(value)}</span>;
  }
  return (
    <Input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const parsed = v.trim() === "" ? null : Number(v.replace(/[$,]/g, ""));
        if (parsed !== null && Number.isNaN(parsed)) return;
        onCommit(parsed);
      }}
      className="h-7 text-xs text-right tabular-nums w-32 ml-auto"
      placeholder="—"
      inputMode="decimal"
    />
  );
}

function TextCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  if (useRaiseArchived()) {
    return <span className="text-xs">{value || "—"}</span>;
  }
  return (
    <Input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      className="h-7 text-xs w-40"
      placeholder="—"
    />
  );
}

function DateCell({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
}) {
  const iso = value ? new Date(value).toISOString().slice(0, 10) : "";
  if (useRaiseArchived()) {
    return <span className="text-xs tabular-nums">{iso || "—"}</span>;
  }
  return (
    <input
      type="date"
      value={iso}
      onChange={(e) => onCommit(e.target.value || null)}
      className="h-7 rounded-sm border bg-background px-2 text-xs tabular-nums w-36"
    />
  );
}

/* -------- Why partners passed card ---------- */

type DenialThemeItem = {
  engagement_id: string;
  partner_name: string;
  reason: string;
  feedback?: string;
  price_surmountable?: boolean;
};
type DenialTheme = { theme: string; count: number; items: DenialThemeItem[] };

/** Surface the edge function's real `{ error }` body instead of the generic supabase-js message. */
async function throwFnError(error: unknown): Promise<never> {
  let detail = (error as any)?.message ?? "Request failed";
  try {
    const body = await (error as any)?.context?.json?.();
    if (body?.error) detail = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
  } catch { /* fall back to the generic message */ }
  throw new Error(detail);
}

function WhyPassedCard({ deal, engagements }: { deal: Deal; engagements: Engagement[] }) {
  const qc = useQueryClient();
  const updateEng = useUpdateEngagement(deal.id);
  const passed = useMemo(() => engagements.filter((e) => e.passed), [engagements]);
  const totalApproached = engagements.length;
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null);

  if (passed.length === 0) return null;

  const overview = (deal as any).denial_overview as string | null | undefined;
  const overviewAt = (deal as any).denial_overview_at as string | null | undefined;
  const themesRaw = (deal as any).denial_themes as DenialTheme[] | null | undefined;
  const themes: DenialTheme[] = Array.isArray(themesRaw) ? themesRaw : [];

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("summarize-deal-denials", {
        body: { deal_id: deal.id },
      });
      if (error) await throwFnError(error);
      qc.invalidateQueries({ queryKey: ["deals", deal.id] });
      qc.invalidateQueries({ queryKey: ["deals"] });
      toast.success("Summary refreshed");
    } catch (e: any) {
      toast.error(e.message || "Failed to refresh summary");
    } finally {
      setRefreshing(false);
    }
  };

  const updatePartner = async (engagementId: string, partnerName: string) => {
    setUpdatingId(engagementId);
    try {
      const { data, error } = await supabase.functions.invoke("update-partner-from-denial", {
        body: { engagement_id: engagementId },
      });
      if (error) await throwFnError(error);
      const changed: string[] = data?.changed_fields ?? [];
      const partnerId: string | undefined = data?.partner_id;
      const summary =
        changed.length > 0
          ? `${changed[0]}${changed.length > 1 ? ` (+${changed.length - 1} more)` : ""} + logged a note for ${partnerName}`
          : `Logged a denial note for ${partnerName}`;
      if (changed.length > 0) {
        toast.success(summary, {
          action: partnerId
            ? { label: "View partner", onClick: () => window.open(`/partners/${partnerId}`, "_self") }
            : undefined,
        });
      } else {
        toast.info(`No durable preferences inferred — logged a note for ${partnerName}`);
      }
      qc.invalidateQueries({ queryKey: ["partners", partnerId] });
      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["partner-interactions", partnerId] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to update partner");
    } finally {
      setUpdatingId(null);
    }
  };

  const lowVolume = passed.length < 3 || themes.length === 0;

  return (
    <Card className="mt-2">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Why investors passed
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {passed.length} of {totalApproached} approached declined
              {overviewAt ? ` · updated ${new Date(overviewAt).toLocaleDateString()}` : ""}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {overview || themes.length ? "Refresh summary" : "Generate summary"}
          </Button>
        </div>

        {/* Ranked themes */}
        {!lowVolume ? (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Top themes
            </div>
            <div className="rounded-sm border divide-y">
              {themes.map((t) => {
                const isOpen = expandedTheme === t.theme;
                return (
                  <div key={t.theme}>
                    <button
                      type="button"
                      onClick={() => setExpandedTheme(isOpen ? null : t.theme)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left"
                    >
                      <span className="font-medium truncate">{t.theme}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className="h-5 text-[11px]">
                          {t.count} investor{t.count === 1 ? "" : "s"}
                        </Badge>
                        <span className="text-muted-foreground text-xs">{isOpen ? "−" : "+"}</span>
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 space-y-1.5 bg-muted/20">
                        {t.items.map((it) => (
                          <div key={it.engagement_id} className="text-xs">
                            <span className="font-medium">{it.partner_name}</span>
                            <span className="text-muted-foreground"> — {it.reason}</span>
                            {it.feedback && it.feedback !== it.reason ? (
                              <div className="text-[11px] text-muted-foreground/80 italic mt-0.5 pl-2 border-l">
                                “{it.feedback}”
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : passed.length > 0 && themes.length === 0 ? (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Reasons
            </div>
            <div className="rounded-sm border divide-y">
              {passed.map((e) => (
                <div key={e.id} className="px-3 py-2 text-xs">
                  <div className="font-medium">{e.partner_name ?? "Partner"}</div>
                  <div className="text-muted-foreground">
                    {(e.pass_feedback ?? "").trim()
                      ? <NoteContent content={e.pass_feedback as string} className="text-xs" />
                      : "No reason given"}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground italic">
              Too few denials for theme grouping — showing individual reasons.
            </div>
          </div>
        ) : null}

        {overview ? (
          <div className="rounded-sm border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap">
            {overview}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed p-3 text-xs text-muted-foreground italic">
            No summary yet. Click “Generate summary” to synthesize common themes.
          </div>
        )}

        <div className="space-y-3">
          {passed.map((e) => (
            <PassedRow
              key={e.id}
              engagement={e}
              updating={updatingId === e.id}
              onUpdatePartner={() => updatePartner(e.id, e.partner_name ?? "partner")}
              onSaveFeedback={(text) =>
                updateEng.mutate(
                  { id: e.id, pass_feedback: text } as any,
                  { onError: (err: any) => toast.error(err.message) },
                )
              }
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}


function PassedRow({
  engagement,
  updating,
  onUpdatePartner,
  onSaveFeedback,
}: {
  engagement: Engagement;
  updating: boolean;
  onUpdatePartner: () => void;
  onSaveFeedback: (text: string) => void;
}) {
  const [text, setText] = useState(engagement.pass_feedback ?? "");
  useEffect(() => {
    setText(engagement.pass_feedback ?? "");
  }, [engagement.pass_feedback]);

  const handleBlur = () => {
    const trimmed = text.trim();
    if (trimmed === (engagement.pass_feedback ?? "").trim()) return;
    onSaveFeedback(trimmed);
  };

  const dateLabel = (engagement.last_contact_date || engagement.updated_at)
    ? new Date(engagement.last_contact_date || engagement.updated_at).toLocaleDateString()
    : null;

  return (
    <div className="rounded-sm border bg-background p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to={`/partners/${engagement.partner_id}`}
            className="text-sm font-medium hover:text-primary hover:underline inline-flex items-center gap-1 min-w-0"
          >
            <span className="truncate">{engagement.partner_name || "Unknown partner"}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
          </Link>
          {engagement.pass_price_surmountable && (
            <Badge variant="outline" className="text-[10px] h-5 border-amber-500/50 text-amber-700 dark:text-amber-400">
              Price surmountable
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dateLabel && (
            <span className="text-[10px] text-muted-foreground tabular-nums">{dateLabel}</span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={onUpdatePartner}
            disabled={updating}
          >
            <Sparkles className={`h-3.5 w-3.5 ${updating ? "animate-pulse" : ""}`} />
            Update partner profile
          </Button>
        </div>
      </div>
      <RichTextEditor
        value={text}
        onChange={(v) => {
          setText(v);
        }}
        placeholder="Paste the full denial description here…"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleBlur}>
          Save
        </Button>
      </div>
    </div>
  );
}

/* -------- Kanban card: email status + automation helpers ---------- */

function autoReasonLabel(reason: string): string {
  switch (reason) {
    case "auto_email_reply":
      return "moved on partner reply";
    case "auto_committed":
      return "moved on commitment entered";
    case "auto_passed":
      return "moved on denial captured";
    default:
      return reason.replace(/^auto_/, "").replace(/_/g, " ");
  }
}

function CardEmailStatus({
  partnerId,
  latest,
}: {
  partnerId: string;
  latest: LatestPartnerEmail | undefined;
}) {
  if (!latest) return null;
  const ageDays = Math.floor((Date.now() - new Date(latest.last_at).getTime()) / 86_400_000);
  const awaiting = latest.direction === "outbound" && ageDays >= 4;
  const relLabel =
    ageDays <= 0 ? "today" : ageDays === 1 ? "1d ago" : `${ageDays}d ago`;
  const line =
    latest.direction === "inbound"
      ? `They replied ${relLabel}`
      : `You emailed ${relLabel}`;
  return (
    <Link
      to={`/partners/${partnerId}#emails`}
      onMouseDown={(ev) => ev.stopPropagation()}
      draggable={false}
      className={`mt-1 flex items-center gap-1 text-[10px] leading-snug hover:underline ${
        awaiting ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
      }`}
      title={latest.subject ?? undefined}
    >
      {awaiting ? (
        <MailWarning className="h-3 w-3 shrink-0" />
      ) : (
        <Mail className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate">
        {awaiting ? `Awaiting reply · ${ageDays}d` : line}
      </span>
    </Link>
  );
}

/* -------- edit engagement dialog ---------- */

function EditEngagementDialog({
  engagement,
  onOpenChange,
  onSave,
  onRemove,
  saving,
}: {
  engagement: Engagement | null;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: Partial<Engagement>) => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const [stage, setStage] = useState<RaiseStage>("added_to_pipeline");
  const [owner, setOwner] = useState("");
  const [indicated, setIndicated] = useState<string>("");
  const [committed, setCommitted] = useState<string>("");
  const [nextAction, setNextAction] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!engagement) return;
    setStage(engagement.stage);
    setOwner(engagement.owner ?? "");
    setIndicated(engagement.indicated_amount != null ? String(engagement.indicated_amount) : "");
    setCommitted(engagement.committed_amount != null ? String(engagement.committed_amount) : "");
    setNextAction(engagement.next_action ?? "");
    setNextActionDate(engagement.next_action_date ?? "");
    setNotes(engagement.notes ?? "");
  }, [engagement]);

  const submit = () => {
    const toNum = (s: string) => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t.replace(/[$,]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const patch: Partial<Engagement> = {
      stage,
      owner: owner.trim() || null,
      indicated_amount: toNum(indicated),
      committed_amount: toNum(committed),
      next_action: nextAction.trim() || null,
      next_action_date: nextActionDate || null,
      notes: notes.trim() || null,
      stage_locked_manual: true,
    };
    onSave(patch);
  };

  return (
    <Dialog open={!!engagement} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {engagement?.partner_name || "engagement"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Stage</Label>
            <Select value={stage} onValueChange={(v) => setStage(v as RaiseStage)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RAISE_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Indicated ($)</Label>
              <Input value={indicated} onChange={(e) => setIndicated(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Committed ($)</Label>
              <Input value={committed} onChange={(e) => setCommitted(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Owner</Label>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. Daniel S." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Next action</Label>
              <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Follow up" />
            </div>
            <div className="space-y-1.5">
              <Label>Next action date</Label>
              <Input type="date" value={nextActionDate} onChange={(e) => setNextActionDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <RichTextEditor value={notes} onChange={setNotes} />
          </div>
        </div>
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onRemove}>
            <Trash2 className="h-4 w-4 mr-1.5" /> Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


