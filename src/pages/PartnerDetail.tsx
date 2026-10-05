import { useParams, useNavigate, useLocation } from "react-router-dom";
import { safeExternalUrl } from "@/lib/safeUrl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronLeft, Copy, ExternalLink, Mail, Linkedin, MapPin, Plus, Search, StickyNote, Sparkles, Archive, Pencil, Check, X, Trash2, Loader2, RefreshCw } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/RichTextEditor";
import { NoteContent } from "@/components/NoteContent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WarmthBadge } from "@/components/WarmthBadge";
import { usePartner, usePartnerContacts, usePartnerInteractions, usePartnerCurrency, useCreateInteraction, useArchivePartner, useUpdatePartner, useCreatePartnerContact, useUpdatePartnerContact, useDeletePartnerContact, type Partner, type PartnerContact } from "@/hooks/usePartners";
import { AboutPartnerCard, ActivityTimeline, DataHighlightsCard, ProfileSummaryCard, RecordSection, initials, noteDealIds, partnerHostname } from "@/components/PartnerRecordPanels";
import { PartnerDealsCard } from "@/components/PartnerDealsCard";
import { useDealNames, useEngagementsByPartner } from "@/hooks/useCapitalRaiseEngagements";
import { Label } from "@/components/ui/label";
import { DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useOutlookMessages, type OutlookMessage } from "@/hooks/useOutlook";
import { ComposeEmailDialog } from "@/components/ComposeEmailDialog";
import { EntityNotes } from "@/components/EntityNotes";
import { FloatingPanel } from "@/components/FloatingPanel";
import { PartnerSummaryCards } from "@/components/PartnerSummaryCards";
import { PartnerSuggestionsSection } from "@/components/PartnerSuggestionsSection";
import { WarmthSignalsPanel } from "@/components/WarmthSignalsPanel";
import { CapitalStatusCard } from "@/components/CapitalStatusCard";
import { PartnerAttachmentsCard } from "@/components/PartnerAttachmentsCard";
import { EmailReaderDialog } from "@/components/EmailReaderDialog";
import { useNotes } from "@/hooks/useNotes";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { INVESTOR_TYPES, GEOGRAPHY_QUICK_ADDS } from "@/lib/partnerOptions";

const WARMTH_OPTIONS = ["Existing Partner", "Very Warm", "Warm", "Tepid", "Cold"];

export default function PartnerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/partners");
  };
  const { data: partner, isLoading } = usePartner(id);
  const { data: contacts } = usePartnerContacts(id);
  const { data: interactions } = usePartnerInteractions(id);
  const createInteraction = useCreateInteraction();
  const { data: emails } = useOutlookMessages({ partnerId: id });
  const [newNote, setNewNote] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState("overview");
  const { data: currency } = usePartnerCurrency(id);
  const { data: partnerNotes } = useNotes("partner", id);
  const { data: engagements } = useEngagementsByPartner(id);
  const timelineDealIds = [
    ...(partnerNotes ?? []).flatMap(noteDealIds),
    ...(emails ?? []).map((m) => m.deal_id).filter((d): d is string => !!d),
  ];
  const { data: dealNames } = useDealNames(timelineDealIds);
  const dealTagSummary = {
    tagged: engagements?.length ?? 0,
    interested: engagements?.filter((e) => e.stage === "serious_interest").length ?? 0,
    committed: engagements?.filter((e) => e.stage === "committed").length ?? 0,
    passed: engagements?.filter((e) => e.stage === "passed").length ?? 0,
  };
  const [openEmail, setOpenEmail] = useState<OutlookMessage | null>(null);
  const qc = useQueryClient();
  const enrichedOnceRef = useRef<string | null>(null);
  const [reEnriching, setReEnriching] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const regenerateSummary = async () => {
    if (!id) return;
    setRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("summarize-partners", {
        body: { partner_ids: [id] },
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["partners", id] });
      qc.invalidateQueries({ queryKey: ["partners"] });
      const processed = (data as any)?.processed ?? 0;
      if ((data as any)?.halted === "credit_limit_reached") {
        toast.error("Workspace AI credit limit reached — ask the workspace owner to raise the limit");
      } else if (processed > 0) {
        toast.success("Profile summary regenerated");
      } else if (((data as any)?.skipped ?? 0) > 0) {
        toast.info("Summary is already up to date — no source fields changed");
      } else {
        toast.info("Nothing to regenerate");
      }
    } catch (e: any) {
      toast.error("Regenerate failed: " + (e?.message ?? e));
    } finally {
      setRegenerating(false);
    }
  };

  const rerunEnrichment = async () => {
    if (!id) return;
    setReEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-partner-from-notes", {
        body: { partner_id: id, force: true },
      });
      if (error) throw error;
      const filled = (data as any)?.filled ?? [];
      const skipped = (data as any)?.skipped;
      qc.invalidateQueries({ queryKey: ["partners", id] });
      if (skipped === "no_notes") toast.info("No notes to enrich from yet");
      else if (skipped === "all_fields_populated") toast.info("All fields already have values — nothing to fill");
      else if (skipped === "credit_limit_reached") toast.error("Workspace AI credit limit reached — ask the workspace owner to raise the limit");
      else if (skipped === "gateway_error") toast.error("AI service unavailable right now — try again shortly");
      else if (Array.isArray(filled) && filled.length > 0) toast.success(`Enriched ${filled.length} field${filled.length === 1 ? "" : "s"} from notes`);
      else toast.info("No new values found in notes");

    } catch (e: any) {
      toast.error("Re-run failed: " + (e?.message ?? e));
    } finally {
      setReEnriching(false);
    }
  };

  // Auto-enrich from notes once per partner load; the edge function short-circuits when
  // the notes haven't changed since last run.
  useEffect(() => {
    if (!id || !partner) return;
    if (enrichedOnceRef.current === id) return;
    enrichedOnceRef.current = id;
    supabase.functions
      .invoke("enrich-partner-from-notes", { body: { partner_id: id } })
      .then(({ data, error }) => {
        if (error) {
          console.warn("enrich-partner-from-notes error", error);
          return;
        }
        if (data && Array.isArray((data as any).filled) && (data as any).filled.length > 0) {
          qc.invalidateQueries({ queryKey: ["partners", id] });
        }
      })
      .catch((e) => console.warn("enrich-partner-from-notes threw", e));
  }, [id, partner, qc]);

  const addNote = () => {
    if (!newNote.trim() || !id) return;
    createInteraction.mutate(
      { partner_id: id, interaction_type: "note", content: newNote.trim(), author: "User" },
      {
        onSuccess: () => {
          setNewNote("");
          toast.success("Note added");
          // Fire-and-forget enrichment refresh from the new note.
          supabase.functions
            .invoke("enrich-partner-from-notes", { body: { partner_id: id } })
            .then(({ error }) => {
              if (error) console.warn("post-note enrichment failed", error);
              qc.invalidateQueries({ queryKey: ["partners", id] });
            })
            .catch((e) => console.warn("post-note enrichment threw", e));
        },
        onError: (err) => toast.error("Failed: " + err.message),
      }
    );
  };

  if (isLoading) return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      <Skeleton className="h-96 w-full" />
      <Skeleton className="h-96 w-full" />
      <Skeleton className="hidden xl:block h-96 w-full" />
    </div>
  );

  if (!partner) return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 text-center text-muted-foreground">Partner not found</div>
  );

  // An internal (Ansonia) record is not an outside capital source. It gets the
  // internal desk instead of the capital-partner profile below.

  const primaryEmail = contacts?.find((c) => c.email)?.email ?? "";

  return (
    <div className="grid gap-4 items-start lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">

      {/* ── Left: identity, quick actions, properties ── */}
      <aside className="space-y-4 lg:sticky lg:top-0 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto lg:pb-4">
        <PartnerRecordCard
          partner={partner}
          primaryEmail={primaryEmail}
          onBack={goBack}
          onEdit={() => setEditOpen(true)}
          onRerunEnrichment={rerunEnrichment}
          reEnriching={reEnriching}
          onRegenerateSummary={regenerateSummary}
          regenerating={regenerating}
          onOpenNotes={() => setNotesOpen(true)}
          onArchived={() => navigate("/partners")}
        />
        <AboutPartnerCard partner={partner} onEdit={() => setEditOpen(true)} />
      </aside>

      {/* ── Middle: tabs ── */}
      <main className="min-w-0">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3 h-10">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activities">Activities</TabsTrigger>
            <TabsTrigger value="intelligence" className="gap-1.5">
              Intelligence
              {!!currency?.pendingSuggestions && (
                <Badge className="h-4 px-1.5 text-[10px]">{currency.pendingSuggestions}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <DataHighlightsCard partner={partner} onOpenSuggestions={() => setTab("intelligence")} deals={dealTagSummary} />
            <CapitalStatusCard partner={partner} />
            <PartnerSummaryCards partner={partner} notes={partnerNotes} />
            <ActivityTimeline
              notes={partnerNotes}
              emails={emails}
              interactions={interactions}
              onOpenEmail={setOpenEmail}
              dealNames={dealNames}
              limit={4}
              onViewAll={() => setTab("activities")}
            />
            {/* Organized (AI-structured) Notes */}
            {partner.organized_notes && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-semibold inline-flex items-center gap-2">
                    <Sparkles className="h-4 w-4" /> Organized notes
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="prose prose-sm dark:prose-invert max-w-none
                                  prose-headings:font-semibold prose-headings:tracking-tight
                                  prose-h2:text-xs prose-h2:uppercase prose-h2:tracking-[0.12em]
                                  prose-h2:text-muted-foreground prose-h2:mt-5 prose-h2:mb-2
                                  prose-h2:pb-1 prose-h2:border-b prose-h2:border-border/60
                                  first:prose-h2:mt-0
                                  prose-p:my-1.5 prose-p:leading-relaxed
                                  prose-ul:my-1.5 prose-ul:pl-5 prose-li:my-0.5 prose-li:marker:text-muted-foreground
                                  prose-strong:text-foreground prose-strong:font-semibold">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{partner.organized_notes}</ReactMarkdown>
                  </div>
                </CardContent>
              </Card>
            )}
            {/* Full Notes (from imported capital partners list) — editable */}
            <EditablePartnerNotesCard partner={partner} />
          </TabsContent>

          <TabsContent value="activities" className="space-y-4 mt-4">
            <ActivityTimeline
              notes={partnerNotes}
              emails={emails}
              interactions={interactions}
              onOpenEmail={setOpenEmail}
              dealNames={dealNames}
              headerActions={
                <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => setNotesOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Note
                </Button>
              }
            />
          </TabsContent>

          <TabsContent value="intelligence" className="space-y-4 mt-4">
            {id && (
              <div id="partner-suggestions">
                <PartnerSuggestionsSection partnerId={id} manualFields={partner.manual_fields || []} />
              </div>
            )}
            {id && <WarmthSignalsPanel partnerId={id} currentLevel={partner.relationship_strength} />}
          </TabsContent>
        </Tabs>
      </main>

      {/* ── Right: summary + associations ── */}
      <aside className="space-y-4 min-w-0 lg:col-start-2 xl:col-start-auto">
        <ProfileSummaryCard partner={partner} onRegenerate={regenerateSummary} regenerating={regenerating} />
        <PartnerDealsCard partner={partner} />
        <ContactsSidebarCard partner={partner} contacts={contacts} />
        {id && <PartnerAttachmentsCard partnerId={id} />}
      </aside>

      <EmailReaderDialog message={openEmail} onClose={() => setOpenEmail(null)} />
      <PartnerEditDialog partner={partner} open={editOpen} onOpenChange={setEditOpen} />

      {id && (
        <FloatingPanel
          open={notesOpen}
          onClose={() => setNotesOpen(false)}
          title={<span className="flex items-center gap-2"><StickyNote className="h-4 w-4" /> Notes · {partner.name}</span>}
          storageKey={`partner-notes-panel:${id}`}
          defaultWidth={480}
          defaultHeight={620}
        >
          <EntityNotes entityType="partner" entityId={id} className="border-0 shadow-none rounded-none" />
        </FloatingPanel>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Left column — identity card: back link, Actions menu, name, quick actions
// ─────────────────────────────────────────────────────────────────────────────

function QuickAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  spinning,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 w-12"
    >
      <span className="h-9 w-9 rounded-full border bg-background flex items-center justify-center hover:bg-muted transition-colors">
        <Icon className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`} />
      </span>
      <span className="truncate w-full text-center">{label}</span>
    </button>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`))}
      className="text-muted-foreground hover:text-foreground"
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

function PartnerRecordCard({
  partner,
  primaryEmail,
  onBack,
  onEdit,
  onRerunEnrichment,
  reEnriching,
  onRegenerateSummary,
  regenerating,
  onOpenNotes,
  onArchived,
}: {
  partner: Partner;
  primaryEmail: string;
  onBack: () => void;
  onEdit: () => void;
  onRerunEnrichment: () => void;
  reEnriching: boolean;
  onRegenerateSummary: () => void;
  regenerating: boolean;
  onOpenNotes: () => void;
  onArchived: () => void;
}) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const host = partnerHostname(partner.website);
  const href = safeExternalUrl(partner.website);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm font-medium hover:text-primary">
          <ChevronLeft className="h-4 w-4" /> Capital Partners
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 font-semibold">
              Actions <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4 mr-2" /> Edit details</DropdownMenuItem>
            <DropdownMenuItem onClick={onRerunEnrichment} disabled={reEnriching}>
              <Sparkles className="h-4 w-4 mr-2" /> {reEnriching ? "Enriching…" : "Re-run enrichment"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRegenerateSummary} disabled={regenerating}>
              <RefreshCw className="h-4 w-4 mr-2" /> {regenerating ? "Regenerating…" : "Regenerate summary"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setArchiveOpen(true)}
              disabled={!!partner.archived_at}
              className="text-destructive focus:text-destructive"
            >
              <Archive className="h-4 w-4 mr-2" /> {partner.archived_at ? "Archived" : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
            {initials(partner.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight flex items-start gap-1.5">
              <span className="break-words">{partner.name}</span>
              <button type="button" onClick={onEdit} aria-label="Edit partner" className="mt-1 text-muted-foreground hover:text-foreground shrink-0">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </h1>
            {partner.archived_at && (
              <Badge variant="outline" className="mt-1 text-[10px] uppercase tracking-wide border-muted-foreground/40 text-muted-foreground">
                Archived
              </Badge>
            )}
          </div>
        </div>

        <div className="space-y-1 text-sm">
          {host && href && (
            <div className="flex items-center gap-2">
              <a href={href} target="_blank" rel="noreferrer" className="text-primary font-medium hover:underline inline-flex items-center gap-1 truncate">
                {host} <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <CopyButton value={partner.website!} label="Website" />
            </div>
          )}
          {primaryEmail && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate">{primaryEmail}</span>
              <CopyButton value={primaryEmail} label="Email" />
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {partner.firm_type && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">{partner.firm_type}</span>
            )}
            <WarmthBadge strength={partner.relationship_strength} />
          </div>
        </div>

        <div className="flex justify-between pt-1">
          <QuickAction icon={StickyNote} label="Note" onClick={onOpenNotes} />
          <ComposeEmailDialog
            trigger={<span><QuickAction icon={Mail} label="Email" /></span>}
            defaultTo={primaryEmail}
            defaultSubject={`Ansonia – ${partner.name}`}
            partnerId={partner.id}
          />
          <QuickAction icon={Sparkles} label="Enrich" onClick={onRerunEnrichment} disabled={reEnriching} spinning={false} />
          <QuickAction icon={RefreshCw} label="Summary" onClick={onRegenerateSummary} disabled={regenerating} spinning={regenerating} />
          <QuickAction icon={Pencil} label="Edit" onClick={onEdit} />
        </div>
      </CardContent>

      <ArchivePartnerDialog partner={partner} open={archiveOpen} onOpenChange={setArchiveOpen} onArchived={onArchived} />
    </Card>
  );
}

function ArchivePartnerDialog({
  partner,
  open,
  onOpenChange,
  onArchived,
}: {
  partner: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived: () => void;
}) {
  const archive = useArchivePartner();
  // Restoration lives on the Partners list page — the archive flow stays
  // one-way from the detail page.
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {partner.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This hides the partner from lists but keeps all contacts, notes, and interaction history intact. You can restore it later from the Partners page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              archive.mutate(partner.id, {
                onSuccess: () => {
                  toast.success(`${partner.name} archived`);
                  onArchived();
                },
                onError: (err: any) => toast.error("Archive failed: " + (err?.message ?? err)),
              })
            }
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit dialog — name, firm type, warmth, POC, website, HQ, investor type, geography
// ─────────────────────────────────────────────────────────────────────────────

function PartnerEditDialog({
  partner,
  open,
  onOpenChange,
}: {
  partner: Partner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdatePartner();
  const [name, setName] = useState(partner.name);
  const [firmType, setFirmType] = useState(partner.firm_type ?? "");
  const [warmth, setWarmth] = useState(partner.relationship_strength ?? "");
  const [poc, setPoc] = useState(partner.ansonia_poc ?? "");
  const [website, setWebsite] = useState(partner.website ?? "");
  const [hq, setHq] = useState(partner.headquarters ?? "");
  const [investorType, setInvestorType] = useState<string[]>(partner.investor_type ?? []);
  const [geography, setGeography] = useState<string[]>(partner.geography ?? []);
  const [geoInput, setGeoInput] = useState("");

  // Reset the draft from the stored record every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(partner.name);
    setFirmType(partner.firm_type ?? "");
    setWarmth(partner.relationship_strength ?? "");
    setPoc(partner.ansonia_poc ?? "");
    setWebsite(partner.website ?? "");
    setHq(partner.headquarters ?? "");
    setInvestorType(partner.investor_type ?? []);
    setGeography(partner.geography ?? []);
    setGeoInput("");
  }, [open, partner]);

  const toggleInvestorType = (v: string) =>
    setInvestorType((arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]));

  const addGeo = () => {
    const parts = geoInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setGeography((g) => Array.from(new Set([...g, ...parts])));
    setGeoInput("");
  };
  const removeGeo = (g: string) => setGeography((arr) => arr.filter((x) => x !== g));

  const save = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }
    update.mutate(
      {
        id: partner.id,
        name: trimmedName,
        firm_type: firmType.trim() || null,
        relationship_strength: warmth || null,
        ansonia_poc: poc.trim() || null,
        website: website.trim() || null,
        headquarters: hq.trim() || null,
        investor_type: investorType,
        geography: geography,
      } as any,
      {
        onSuccess: () => {
          toast.success("Partner updated");
          onOpenChange(false);
        },
        onError: (err: any) => toast.error("Save failed: " + (err?.message ?? err)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit partner details</DialogTitle>
          <DialogDescription>Investment parameters and capital status are edited in their own cards on the Overview tab.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Partner Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Firm Type</label>
            <Input value={firmType} onChange={(e) => setFirmType(e.target.value)} placeholder="e.g. Family Office" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Relationship Warmth</label>
            <Select value={warmth || "__none"} onValueChange={(v) => setWarmth(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Not set</SelectItem>
                {WARMTH_OPTIONS.map((w) => (
                  <SelectItem key={w} value={w}>{w}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Ansonia POC</label>
            <Input value={poc} onChange={(e) => setPoc(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Website</label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Headquarters</label>
            <Input value={hq} onChange={(e) => setHq(e.target.value)} placeholder="City, State" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs text-muted-foreground">Investor Type</label>
            <div className="flex flex-wrap gap-1.5">
              {INVESTOR_TYPES.map((t) => {
                const on = investorType.includes(t);
                return (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => toggleInvestorType(t)}
                  >
                    {t}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs text-muted-foreground">Geography</label>
            <div className="flex gap-2">
              <Input
                value={geoInput}
                onChange={(e) => setGeoInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addGeo();
                  }
                }}
                placeholder="Add markets / MSAs / states, then press Enter"
              />
              <Button type="button" variant="outline" onClick={addGeo}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {GEOGRAPHY_QUICK_ADDS.map((q) => {
                const already = geography.includes(q);
                return (
                  <Button
                    key={q}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={already}
                    onClick={() => setGeography((g) => Array.from(new Set([...g, q])))}
                  >
                    {already ? `✓ ${q}` : `+ ${q}`}
                  </Button>
                );
              })}
            </div>
            {geography.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {geography.map((g) => (
                  <Badge key={g} variant="secondary" className="gap-1">
                    {g}
                    <button type="button" onClick={() => removeGeo(g)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            <Check className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Right column — Contacts (HubSpot association card)
// ─────────────────────────────────────────────────────────────────────────────

function ContactsSidebarCard({ partner, contacts }: { partner: Partner; contacts: PartnerContact[] | undefined }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = (contacts ?? []).filter(
    (c) => !q || [c.name, c.email, c.role, c.firm_location].some((v) => v?.toLowerCase().includes(q)),
  );

  return (
    <RecordSection
      title={`Contacts (${contacts?.length ?? 0})`}
      actions={
        <ContactEditorDialog
          partnerId={partner.id}
          trigger={
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-primary">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          }
        />
      }
    >
      {(contacts?.length ?? 0) > 3 && (
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts" className="h-8 pl-8 text-sm" />
        </div>
      )}
      {list.length > 0 ? (
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {list.map((c) => (
            <div key={c.id} className="rounded-md border p-3 space-y-1.5">
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                  {initials(c.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-primary truncate">{c.name}</div>
                  {c.role && <div className="text-xs text-muted-foreground truncate">{c.role}</div>}
                </div>
                <div className="flex items-center shrink-0 -mr-1">
                  <ContactEditorDialog
                    partnerId={partner.id}
                    contact={c}
                    trigger={
                      <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Edit contact">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    }
                  />
                  <DeleteContactButton contact={c} />
                </div>
              </div>
              <div className="text-xs space-y-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-muted-foreground shrink-0">Email:</span>
                  {c.email ? (
                    <>
                      <ComposeEmailDialog
                        trigger={<button type="button" className="text-primary hover:underline truncate">{c.email}</button>}
                        defaultTo={c.email}
                        defaultSubject={`Ansonia – ${partner.name}`}
                        partnerId={partner.id}
                        partnerContactId={c.id}
                      />
                      <CopyButton value={c.email} label="Email" />
                    </>
                  ) : <span>--</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Phone:</span>
                  <span>{c.phone || "--"}</span>
                </div>
                {c.firm_location && (
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {c.firm_location}
                  </div>
                )}
              </div>
              {(c.ansonia_poc || c.linkedin_url) && (
                <div className="flex items-center gap-2 pt-0.5">
                  {c.ansonia_poc && (
                    <span className="text-[10px] font-medium bg-muted px-1.5 py-0.5 rounded border">POC: {c.ansonia_poc}</span>
                  )}
                  {c.linkedin_url && safeExternalUrl(c.linkedin_url) && (
                    <a href={safeExternalUrl(c.linkedin_url)!} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80" aria-label="LinkedIn">
                      <Linkedin className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">
          {contacts?.length ? "No contacts match." : "No contacts on file."}
        </p>
      )}
    </RecordSection>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Editable "Partner Notes" (additional_notes) card
// ─────────────────────────────────────────────────────────────────────────────

function EditablePartnerNotesCard({ partner }: { partner: Partner }) {
  const update = useUpdatePartner();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(partner.additional_notes ?? "");

  const enterEdit = () => {
    setDraft(partner.additional_notes ?? "");
    setEditing(true);
  };

  const save = () => {
    update.mutate(
      { id: partner.id, additional_notes: draft.trim() || null } as any,
      {
        onSuccess: () => {
          toast.success("Partner notes saved");
          setEditing(false);
        },
        onError: (err: any) => toast.error("Save failed: " + (err?.message ?? err)),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <StickyNote className="h-4 w-4" /> Partner Notes
        </CardTitle>
        {editing ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 px-2">
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={update.isPending} className="h-7 px-2">
              <Check className="h-3.5 w-3.5 mr-1" /> Save
            </Button>
          </div>
        ) : (
          <Button size="icon" variant="ghost" onClick={enterEdit} className="h-7 w-7" aria-label="Edit partner notes">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <RichTextEditor
            value={draft}
            onChange={setDraft}
            placeholder="Free-form notes about this partner…"
          />
        ) : partner.additional_notes ? (
          <NoteContent content={partner.additional_notes} className="leading-relaxed" />
        ) : (
          <p className="text-sm text-muted-foreground">No notes on file for this partner.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ContactEditorDialog({
  partnerId,
  contact,
  trigger,
}: {
  partnerId: string;
  contact?: PartnerContact;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [role, setRole] = useState(contact?.role ?? "");
  const [linkedin, setLinkedin] = useState(contact?.linkedin_url ?? "");
  const [firmLocation, setFirmLocation] = useState(contact?.firm_location ?? "");

  const createContact = useCreatePartnerContact();
  const updateContact = useUpdatePartnerContact();
  const isEdit = !!contact;
  const busy = createContact.isPending || updateContact.isPending;

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? "");
      setEmail(contact?.email ?? "");
      setPhone(contact?.phone ?? "");
      setRole(contact?.role ?? "");
      setLinkedin(contact?.linkedin_url ?? "");
      setFirmLocation(contact?.firm_location ?? "");
    }
  }, [open, contact]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: trimmedName,
      email: email.trim() || null,
      phone: phone.trim() || null,
      role: role.trim() || null,
      linkedin_url: linkedin.trim() || null,
      firm_location: firmLocation.trim() || null,
    };
    try {
      if (isEdit && contact) {
        await updateContact.mutateAsync({ id: contact.id, ...payload });
        toast.success("Contact updated");
      } else {
        await createContact.mutateAsync({ partner_id: partnerId, ...payload });
        toast.success("Contact added");
      }
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save contact");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this contact's details." : "Add a new contact for this partner."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Name <span className="text-destructive">*</span></Label>
            <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-email">Email</Label>
            <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-role">Role</Label>
            <Input id="contact-role" value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-linkedin">LinkedIn URL</Label>
            <Input id="contact-linkedin" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} maxLength={500} placeholder="https://linkedin.com/in/..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-location">Firm location</Label>
            <Input id="contact-location" value={firmLocation} onChange={(e) => setFirmLocation(e.target.value)} maxLength={200} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? "Save changes" : "Add contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteContactButton({ contact }: { contact: PartnerContact }) {
  const [open, setOpen] = useState(false);
  const deleteContact = useDeletePartnerContact();

  const handleDelete = async () => {
    try {
      await deleteContact.mutateAsync({ id: contact.id, partner_id: contact.partner_id });
      toast.success("Contact deleted");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete contact");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="Delete contact">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete contact?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove <strong>{contact.name}</strong> from this partner. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteContact.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleDelete(); }}
            disabled={deleteContact.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteContact.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}




