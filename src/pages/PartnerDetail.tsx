import { useParams, useNavigate, useLocation } from "react-router-dom";
import { safeExternalUrl } from "@/lib/safeUrl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Building2, Mail, Linkedin, Phone, MapPin, Plus, StickyNote, Inbox, Sparkles, Archive, Pencil, Check, X, Paperclip, File as FileIcon, FileText, FileImage, FileSpreadsheet, Download, Trash2, Loader2, Upload, RefreshCw } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WarmthBadge } from "@/components/WarmthBadge";
import { usePartner, usePartnerContacts, usePartnerInteractions, useCreateInteraction, useArchivePartner, useUpdatePartner, usePartnerAttachments, useUploadPartnerAttachment, useDeletePartnerAttachment, useCreatePartnerContact, useUpdatePartnerContact, useDeletePartnerContact, type Partner, type PartnerAttachment, type PartnerContact } from "@/hooks/usePartners";
import { Label } from "@/components/ui/label";
import { DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useOutlookMessages, useOutlookMessageBody, type OutlookMessage } from "@/hooks/useOutlook";
import DOMPurify from "dompurify";
import { ExternalLink } from "lucide-react";
import { ComposeEmailDialog } from "@/components/ComposeEmailDialog";
import { EntityNotes } from "@/components/EntityNotes";
import { FloatingPanel } from "@/components/FloatingPanel";
import { PartnerSummaryCards } from "@/components/PartnerSummaryCards";
import { PartnerSuggestionsSection } from "@/components/PartnerSuggestionsSection";
import { WarmthSignalsPanel } from "@/components/WarmthSignalsPanel";
import { CapitalStatusCard } from "@/components/CapitalStatusCard";
import { PartnerCurrencyStrip } from "@/components/PartnerCurrencyStrip";
import { PipelineSharedLine } from "@/components/PipelineSharedLine";
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
  const { data: partnerNotes } = useNotes("partner", id);
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
    <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );

  if (!partner) return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 text-center text-muted-foreground">Partner not found</div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-6">

      <PartnerHeader
        partner={partner}
        onBack={goBack}
        onRerunEnrichment={rerunEnrichment}
        reEnriching={reEnriching}
        onRegenerateSummary={regenerateSummary}
        regenerating={regenerating}
        onOpenNotes={() => setNotesOpen(true)}
        onArchived={() => navigate("/partners")}
      />

      <PartnerSummaryCards partner={partner} notes={partnerNotes} />

      <CapitalStatusCard partner={partner} />

      {id && (
        <div id="partner-suggestions">
          <PartnerSuggestionsSection partnerId={id} manualFields={partner.manual_fields || []} />
        </div>
      )}
      {id && <WarmthSignalsPanel partnerId={id} currentLevel={partner.relationship_strength} />}





      {/* Organized (AI-structured) Notes */}
      {partner.organized_notes && (
        <Card>
          <CardHeader className="pb-3 items-center text-center">
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground inline-flex items-center gap-2 justify-center">
              <Sparkles className="h-4 w-4" /> Organized Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
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



      {/* Contacts */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground inline-flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Contacts ({contacts?.length ?? 0})
          </CardTitle>
          <ContactEditorDialog
            partnerId={partner.id}
            trigger={
              <Button variant="outline" size="sm" className="h-7 gap-1">
                <Plus className="h-3.5 w-3.5" /> Add contact
              </Button>
            }
          />
        </CardHeader>
        <CardContent>
          {contacts && contacts.length > 0 ? (
            <div className="space-y-2">
              {contacts.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-md border bg-muted/30">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{c.name}</div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {c.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                      {c.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
                      {c.role && <span className="flex items-center gap-1">{c.role}</span>}
                      {c.firm_location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{c.firm_location}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.email && (
                      <ComposeEmailDialog
                        trigger={
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                            <Mail className="h-3.5 w-3.5" /> Email
                          </Button>
                        }
                        defaultTo={c.email}
                        defaultSubject={`Ansonia – ${partner.name}`}
                        partnerId={partner.id}
                        partnerContactId={c.id}
                      />
                    )}
                    {c.linkedin_url && (
                      <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                        <Linkedin className="h-4 w-4" />
                      </a>
                    )}
                    {c.ansonia_poc && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border">
                        POC: {c.ansonia_poc}
                      </span>
                    )}
                    <ContactEditorDialog
                      partnerId={partner.id}
                      contact={c}
                      trigger={
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit contact">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                    <DeleteContactButton contact={c} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No contacts on file.</p>
          )}
        </CardContent>
      </Card>



      {/* Email Interactions (from Outlook) */}
      <Card>
        <CardHeader className="pb-3 items-center text-center">
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground inline-flex items-center gap-2 justify-center">
            <Inbox className="h-4 w-4" /> Email Interactions ({emails?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {emails && emails.length > 0 ? (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {emails.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setOpenEmail(m)}
                  className="w-full text-left p-2.5 rounded-md border bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-xs font-semibold truncate">{m.subject || "(no subject)"}</span>
                    <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                      {m.received_at ? new Date(m.received_at).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1">
                    <span className="truncate">{m.from_name || m.from_email || "Unknown sender"}</span>
                    {m.from_email && <span className="truncate">&lt;{m.from_email}&gt;</span>}
                  </div>
                  {m.preview && (
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {m.preview}
                    </p>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No emails linked to this partner. Sync Outlook to pull email history.</p>
          )}
        </CardContent>
      </Card>

      <EmailReaderDialog message={openEmail} onClose={() => setOpenEmail(null)} />



      {/* Attachments */}
      {id && <PartnerAttachmentsCard partnerId={id} />}

      {/* Notes (rich — deal tags, author, date) */}
      {id && <EntityNotes entityType="partner" entityId={id} />}


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

function ArchivePartnerButton({
  partner,
  onArchived,
}: {
  partner: { id: string; name: string; archived_at: string | null };
  onArchived: () => void;
}) {
  const archive = useArchivePartner();
  // Restoration lives on the Partners list page — archived firms just show a
  // status badge here without a restore action, to keep the archive flow
  // one-way from the detail page.
  if (partner.archived_at) {
    return (
      <Button variant="ghost" size="sm" disabled title="Archived — restore from the Partners list" className="gap-1.5">
        <Archive className="h-4 w-4" /> Archived
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive gap-1.5">
          <Archive className="h-4 w-4" /> Archive
        </Button>

      </AlertDialogTrigger>
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
// Editable header — name, firm type, warmth, POC, website, HQ
// ─────────────────────────────────────────────────────────────────────────────

function PartnerHeader({
  partner,
  onBack,
  onRerunEnrichment,
  reEnriching,
  onRegenerateSummary,
  regenerating,
  onOpenNotes,
  onArchived,
}: {
  partner: Partner;
  onBack: () => void;
  onRerunEnrichment: () => void;
  reEnriching: boolean;
  onRegenerateSummary: () => void;
  regenerating: boolean;
  onOpenNotes: () => void;
  onArchived: () => void;
}) {
  const update = useUpdatePartner();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(partner.name);
  const [firmType, setFirmType] = useState(partner.firm_type ?? "");
  const [warmth, setWarmth] = useState(partner.relationship_strength ?? "");
  const [poc, setPoc] = useState(partner.ansonia_poc ?? "");
  const [website, setWebsite] = useState(partner.website ?? "");
  const [hq, setHq] = useState(partner.headquarters ?? "");
  const [investorType, setInvestorType] = useState<string[]>(partner.investor_type ?? []);
  const [geography, setGeography] = useState<string[]>(partner.geography ?? []);
  const [geoInput, setGeoInput] = useState("");

  const enterEdit = () => {
    setName(partner.name);
    setFirmType(partner.firm_type ?? "");
    setWarmth(partner.relationship_strength ?? "");
    setPoc(partner.ansonia_poc ?? "");
    setWebsite(partner.website ?? "");
    setHq(partner.headquarters ?? "");
    setInvestorType(partner.investor_type ?? []);
    setGeography(partner.geography ?? []);
    setGeoInput("");
    setEditing(true);
  };

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
          setEditing(false);
        },
        onError: (err: any) => toast.error("Save failed: " + (err?.message ?? err)),
      },
    );
  };

  if (editing) {
    return (
      <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Editing partner</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={update.isPending}>
              <Check className="h-3.5 w-3.5 mr-1" /> Save
            </Button>
          </div>
        </div>
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
      </div>
    );
  }

  let hostname: string | null = null;
  if (partner.website) {
    try { hostname = new URL(partner.website).hostname.replace(/^www\./, ""); } catch { hostname = partner.website; }
  }

  return (
    <div className="flex items-start gap-3">
      <Button variant="ghost" size="icon" onClick={onBack} className="mt-1">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          {partner.name}
          {partner.archived_at && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-muted-foreground/40 text-muted-foreground">
              Archived
            </Badge>
          )}
        </h1>
        <PartnerCurrencyStrip partnerId={partner.id} enrichedFields={partner.enriched_fields} />
        <PipelineSharedLine partnerId={partner.id} />

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {partner.firm_type && (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">
              {partner.firm_type}
            </span>
          )}
          <WarmthBadge strength={partner.relationship_strength} />
          {partner.ansonia_poc && (
            <span className="text-xs text-muted-foreground">POC: {partner.ansonia_poc}</span>
          )}
          {partner.headquarters && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {partner.headquarters}
            </span>
          )}
          {hostname && safeExternalUrl(partner.website) && (
            <a
              href={safeExternalUrl(partner.website)!}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              🌐 {hostname}
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={enterEdit} className="gap-1.5">
          <Pencil className="h-4 w-4" /> Edit
        </Button>
        <Button variant="outline" size="sm" onClick={onRerunEnrichment} disabled={reEnriching} className="gap-1.5">
          <Sparkles className={`h-4 w-4 ${reEnriching ? "animate-pulse" : ""}`} />
          {reEnriching ? "Enriching…" : "Re-run enrichment"}
        </Button>
        <Button variant="outline" size="sm" onClick={onRegenerateSummary} disabled={regenerating} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
          {regenerating ? "Regenerating…" : "Regenerate summary"}
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenNotes} className="gap-1.5">
          <StickyNote className="h-4 w-4" /> Notes
        </Button>
        <ArchivePartnerButton partner={partner} onArchived={onArchived} />
      </div>
    </div>
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

// ─────────────────────────────────────────────────────────────────────────────
// Attachments card
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function formatFileSize(bytes: number | null | undefined) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function AttachmentIcon({ contentType, fileName }: { contentType: string | null; fileName: string }) {
  const ct = (contentType || "").toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (ct.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext))
    return <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (ct.includes("pdf") || ext === "pdf")
    return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (ct.includes("sheet") || ct.includes("excel") || ["xls", "xlsx", "csv"].includes(ext))
    return <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (ct.startsWith("text/") || ["doc", "docx", "txt", "md"].includes(ext))
    return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
  return <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function isPdfAttachment(a: PartnerAttachment) {
  const ct = (a.content_type || "").toLowerCase();
  const ext = a.file_name.split(".").pop()?.toLowerCase() || "";
  return ct === "application/pdf" || ext === "pdf";
}

function canPreviewAttachment(a: PartnerAttachment) {
  const ct = (a.content_type || "").toLowerCase();
  const ext = a.file_name.split(".").pop()?.toLowerCase() || "";
  return (
    ct.startsWith("image/") ||
    ct.startsWith("text/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "md", "csv"].includes(ext)
  );
}

function PartnerAttachmentsCard({ partnerId }: { partnerId: string }) {
  const { data: attachments } = usePartnerAttachments(partnerId);
  const upload = useUploadPartnerAttachment();
  const del = useDeletePartnerAttachment();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PartnerAttachment | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<PartnerAttachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const valid: File[] = [];
    for (const f of arr) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${f.name} is over 25 MB and was skipped`);
        continue;
      }
      valid.push(f);
    }
    setPendingFiles(valid);
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) {
      toast.error("Choose a file to upload");
      return;
    }
    setUploading(true);
    try {
      for (const file of pendingFiles) {
        try {
          await upload.mutateAsync({
            partnerId,
            file,
            label: label.trim() || null,
          });
          toast.success(`Uploaded ${file.name}`);
        } catch (e: any) {
          toast.error(`Failed to upload ${file.name}: ${e?.message ?? e}`);
        }
      }
      setPendingFiles([]);
      setLabel("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setUploading(false);
    }
  };

  const fetchAttachmentBlob = async (a: PartnerAttachment): Promise<Blob> => {
    const { data, error } = await supabase.storage
      .from("partner-attachments")
      .download(a.storage_path);
    if (error) throw error;
    if (!data) throw new Error("No file data returned");
    return data.type || !a.content_type ? data : new Blob([data], { type: a.content_type });
  };

  const openAttachment = async (a: PartnerAttachment) => {
    setPreviewAttachment(a);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const blob = await fetchAttachmentBlob(a);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (e: any) {
      setPreviewError(e?.message ?? String(e));
      toast.error("Could not open file: " + (e?.message ?? e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadAttachment = async (a: PartnerAttachment) => {
    try {
      const blob = await fetchAttachmentBlob(a);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      toast.error("Download failed: " + (e?.message ?? e));
    }
  };



  const count = attachments?.length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3 items-center text-center">
        <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground inline-flex items-center gap-2 justify-center">
          <Paperclip className="h-4 w-4" /> Attachments ({count})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Uploader row */}
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-md border bg-muted/20">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" />
            {pendingFiles.length > 0
              ? `${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} chosen`
              : "Choose file"}
          </Button>
          <Input
            placeholder="Label (optional) — e.g. Term Sheet, NDA"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-9 flex-1 min-w-[200px]"
            disabled={uploading}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleUpload}
            disabled={uploading || pendingFiles.length === 0}
            className="gap-1.5"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload
          </Button>
        </div>

        {/* List */}
        {attachments && attachments.length > 0 ? (
          <div className="space-y-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="p-2.5 rounded-md border bg-muted/20 hover:bg-muted/40 transition-colors flex items-center gap-3"
              >
                <AttachmentIcon contentType={a.content_type} fileName={a.file_name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        if (isPdfAttachment(a)) downloadAttachment(a);
                        else openAttachment(a);
                      }}
                      className="text-sm font-medium truncate text-primary hover:underline text-left"
                    >
                      {a.file_name}
                    </button>
                    {a.label && (
                      <Badge variant="secondary" className="text-[10px]">
                        {a.label}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                    {a.file_size != null && <span>{formatFileSize(a.file_size)}</span>}
                    <span>·</span>
                    <span>{new Date(a.created_at).toLocaleDateString()}</span>
                    {a.uploaded_by && (
                      <>
                        <span>·</span>
                        <span className="truncate">{a.uploaded_by}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => downloadAttachment(a)}
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(a)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No attachments yet. Upload deal docs, term sheets, or NDAs to keep them with this partner.
          </p>
        )}
      </CardContent>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.file_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmDelete) return;
                del.mutate(
                  {
                    id: confirmDelete.id,
                    partner_id: confirmDelete.partner_id,
                    storage_path: confirmDelete.storage_path,
                  },
                  {
                    onSuccess: () => {
                      toast.success("Attachment deleted");
                      setConfirmDelete(null);
                    },
                    onError: (err: any) =>
                      toast.error("Delete failed: " + (err?.message ?? err)),
                  },
                );
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!previewAttachment}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewAttachment(null);
            setPreviewUrl(null);
            setPreviewError(null);
            setPreviewLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-5xl p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b">
            <DialogTitle className="text-base truncate pr-8">{previewAttachment?.file_name}</DialogTitle>
            <DialogDescription>
              {previewAttachment?.file_size != null ? formatFileSize(previewAttachment.file_size) : "Attachment preview"}
            </DialogDescription>
          </DialogHeader>
          <div className="h-[72vh] bg-muted/20">
            {previewLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading preview…
              </div>
            ) : previewError ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <FileIcon className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Preview unavailable: {previewError}</p>
                {previewAttachment && (
                  <Button type="button" size="sm" onClick={() => downloadAttachment(previewAttachment)} className="gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                )}
              </div>
            ) : previewAttachment && previewUrl && canPreviewAttachment(previewAttachment) ? (
              (previewAttachment.content_type || "").startsWith("image/") ? (
                <div className="h-full w-full flex items-center justify-center p-4">
                  <img src={previewUrl} alt={previewAttachment.file_name} className="max-h-full max-w-full object-contain" />
                </div>
              ) : (
                <iframe title={previewAttachment.file_name} src={previewUrl} className="h-full w-full border-0" />
              )
            ) : previewAttachment ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <AttachmentIcon contentType={previewAttachment.content_type} fileName={previewAttachment.file_name} />
                <p className="text-sm text-muted-foreground">This file type cannot be previewed in the browser.</p>
                <Button type="button" size="sm" onClick={() => downloadAttachment(previewAttachment)} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
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

function EmailReaderDialog({ message, onClose }: { message: OutlookMessage | null; onClose: () => void }) {
  const { data: body, isLoading } = useOutlookMessageBody(message?.id);
  const open = !!message;
  const html = body?.body_html ? DOMPurify.sanitize(body.body_html, { ADD_ATTR: ["target", "rel"] }) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug pr-8">{message?.subject || "(no subject)"}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-1 text-xs">
              <span>
                <span className="font-medium text-foreground">{message?.from_name || message?.from_email || "Unknown"}</span>
                {message?.from_email && <span className="text-muted-foreground"> &lt;{message.from_email}&gt;</span>}
              </span>
              <span className="text-muted-foreground">
                {message?.received_at ? new Date(message.received_at).toLocaleString() : ""}
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto border-t pt-4 -mx-6 px-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading message…</p>
          ) : html ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none break-words"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm font-sans break-words">
              {body?.body_text || message?.preview || "(empty message)"}
            </pre>
          )}
        </div>
        {safeExternalUrl(message?.web_link) && (
          <DialogFooter>
            <Button asChild variant="outline" size="sm">
              <a href={safeExternalUrl(message!.web_link)!} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Open in Outlook
              </a>
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}



