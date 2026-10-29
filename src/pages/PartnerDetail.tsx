import { useParams, useNavigate, useLocation } from "react-router-dom";
import { safeExternalUrl } from "@/lib/safeUrl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronLeft, Copy, ExternalLink, Mail, Linkedin, MapPin, Plus, Search, StickyNote, Sparkles, Archive, Ban, Pencil, RefreshCw, Star } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoteContent } from "@/components/NoteContent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WarmthBadge } from "@/components/WarmthBadge";
import { BlacklistBanner, BlacklistPartnerDialog } from "@/components/PartnerBlacklist";
import { usePartner, usePartnerContacts, usePartnerInteractions, usePartnerCurrency, useCreateInteraction, useArchivePartner, useUpdatePartnerContact, type Partner, type PartnerContact } from "@/hooks/usePartners";
import { AboutPartnerCard, ActivityTimeline, DataHighlightsCard, ProfileSummaryCard, RecordSection, initials, noteDealIds, partnerHostname } from "@/components/PartnerRecordPanels";
import { PartnerDealsCard } from "@/components/PartnerDealsCard";
import { useDealNames, useEngagementsByPartner } from "@/hooks/useCapitalRaiseEngagements";
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
import { Checkbox } from "@/components/ui/checkbox";

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
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_340px]">
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

  const primaryEmail =
    contacts?.find((c) => c.is_primary && c.email)?.email ?? contacts?.find((c) => c.email)?.email ?? "";

  return (
    <div className="grid gap-4 items-start lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_340px]">

      {/* ── Left: identity, quick actions, properties ── */}
      <aside className="space-y-4 lg:sticky lg:top-0 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto lg:pb-4">
        <PartnerRecordCard
          partner={partner}
          primaryEmail={primaryEmail}
          onBack={goBack}
          onEdit={() => navigate(`/partners/${id}/edit`)}
          onRerunEnrichment={rerunEnrichment}
          reEnriching={reEnriching}
          onRegenerateSummary={regenerateSummary}
          regenerating={regenerating}
          onOpenNotes={() => setNotesOpen(true)}
          onArchived={() => navigate("/partners")}
        />
        <AboutPartnerCard partner={partner} />
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
              <Card className="border-hairline shadow-none">
                <CardHeader className="py-3">
                  <CardTitle className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-2">
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
            {/* Full Notes (from imported capital partners list); edited in the partner form */}
            <PartnerNotesCard partner={partner} />
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
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const host = partnerHostname(partner.website);
  const href = safeExternalUrl(partner.website);

  return (
    <Card className="border-hairline shadow-none">
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
            <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4 mr-2" /> Edit partner</DropdownMenuItem>
            <DropdownMenuItem onClick={onRerunEnrichment} disabled={reEnriching}>
              <Sparkles className="h-4 w-4 mr-2" /> {reEnriching ? "Enriching…" : "Re-run enrichment"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRegenerateSummary} disabled={regenerating}>
              <RefreshCw className="h-4 w-4 mr-2" /> {regenerating ? "Regenerating…" : "Regenerate summary"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setBlacklistOpen(true)}
              className={partner.blacklisted_at ? undefined : "text-destructive focus:text-destructive"}
            >
              <Ban className="h-4 w-4 mr-2" /> {partner.blacklisted_at ? "Remove from blacklist" : "Blacklist…"}
            </DropdownMenuItem>
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
            <h1 className="font-display text-xl font-semibold tracking-tight leading-tight flex items-start gap-1.5">
              <span className="break-words">{partner.name}</span>
            </h1>
            {partner.archived_at && (
              <Badge variant="outline" className="mt-1 text-[10px] uppercase tracking-wide border-muted-foreground/40 text-muted-foreground">
                Archived
              </Badge>
            )}
          </div>
        </div>

        <BlacklistBanner partner={partner} />

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
            {(partner.investor_type ?? []).map((t) => (
              <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">{t}</span>
            ))}
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
        </div>

        <Button variant="outline" className="w-full gap-1.5" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Edit partner
        </Button>
      </CardContent>

      <ArchivePartnerDialog partner={partner} open={archiveOpen} onOpenChange={setArchiveOpen} onArchived={onArchived} />
      <BlacklistPartnerDialog partner={partner} open={blacklistOpen} onOpenChange={setBlacklistOpen} />
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
// Right column — Contacts (HubSpot association card)
// ─────────────────────────────────────────────────────────────────────────────

function ContactsSidebarCard({ partner, contacts }: { partner: Partner; contacts: PartnerContact[] | undefined }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // The outreach default leads the list; the rest keep their alphabetical order.
  const list = (contacts ?? [])
    .filter((c) => !q || [c.name, c.email, c.role, c.firm_location].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));

  return (
    <RecordSection
      title={`Contacts (${contacts?.length ?? 0})`}
      actions={
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-primary" onClick={() => navigate(`/partners/${partner.id}/edit#contacts`)}>
          <Plus className="h-3.5 w-3.5" /> Add / edit
        </Button>
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
                  <PrimaryContactButton contact={c} />
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
              <OutreachRoleLine contact={c} />
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
// "Partner Notes" (additional_notes) card
// ─────────────────────────────────────────────────────────────────────────────

function PartnerNotesCard({ partner }: { partner: Partner }) {
  return (
    <Card className="border-hairline shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-2">
          <StickyNote className="h-4 w-4" /> Partner Notes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {partner.additional_notes ? (
          <NoteContent content={partner.additional_notes} className="leading-relaxed" />
        ) : (
          <p className="text-sm text-muted-foreground">No notes on file for this partner.</p>
        )}
      </CardContent>
    </Card>
  );
}

// Outreach drafts go To the partner's default contact and CC anyone marked
// "always CC". Marking a contact default clears the previous one (DB trigger).
function PrimaryContactButton({ contact }: { contact: PartnerContact }) {
  const update = useUpdatePartnerContact();
  const toggle = async () => {
    try {
      // The mutation refetches the partner's contacts, which picks up the old default being cleared.
      await update.mutateAsync({ id: contact.id, is_primary: !contact.is_primary });
      toast.success(contact.is_primary ? "Default contact cleared" : `${contact.name} is now the default contact`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={toggle}
      disabled={update.isPending}
      aria-label={contact.is_primary ? "Clear default contact" : "Make default contact for outreach"}
      title={contact.is_primary ? "Default contact for outreach — click to clear" : "Make default contact for outreach"}
    >
      <Star className={`h-3 w-3 ${contact.is_primary ? "fill-amber-400 text-amber-500" : ""}`} />
    </Button>
  );
}

function OutreachRoleLine({ contact }: { contact: PartnerContact }) {
  const update = useUpdatePartnerContact();
  if (contact.is_primary) {
    return (
      <span className="inline-flex text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900 px-1.5 py-0.5 rounded">
        Default contact for outreach
      </span>
    );
  }
  if (!contact.email) return null;
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer w-fit">
      <Checkbox
        className="h-3.5 w-3.5"
        checked={contact.always_cc}
        disabled={update.isPending}
        onCheckedChange={(v) =>
          update.mutate(
            { id: contact.id, always_cc: v === true },
            { onError: (e) => toast.error((e as Error).message) },
          )
        }
      />
      Always CC on outreach
    </label>
  );
}
