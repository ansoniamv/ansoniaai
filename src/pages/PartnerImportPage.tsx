import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { usePartners } from "@/hooks/usePartners";
import { findSimilarPartners, notesToHtml } from "@/lib/partnerImport";

// Same options as the New Partner form and the extractor's schema.
const FIRM_TYPES = ["GP", "LP", "Family Office", "REIT", "Insurance", "Pension", "Endowment", "Fund of Funds", "Other"];
const WARMTH_LEVELS = ["Existing Partner", "Very Warm", "Warm", "Tepid", "Cold"];
const NONE = "__none__";
const MAX_NOTES_CHARS = 30000;

type ContactDraft = {
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin_url: string;
  firm_location: string;
};

type Draft = {
  name: string;
  firm_type: string;
  headquarters: string;
  website: string;
  relationship_strength: string;
  contacts: ContactDraft[];
};

const emptyContact = (): ContactDraft => ({
  name: "", role: "", email: "", phone: "", linkedin_url: "", firm_location: "",
});

/** What extract-partner-from-notes returns: cleanDraft's shape, nulls for "not in the notes". */
type Nullable<T> = { [K in keyof T]: T[K] | null };
type RawDraft = Nullable<Omit<Draft, "contacts">> & { contacts?: Nullable<ContactDraft>[] };

/** The function's nulls become empty strings so every field is a controlled input. */
function toDraft(raw: RawDraft | undefined): Draft {
  return {
    name: raw?.name ?? "",
    firm_type: raw?.firm_type ?? "",
    headquarters: raw?.headquarters ?? "",
    website: raw?.website ?? "",
    relationship_strength: raw?.relationship_strength ?? "",
    contacts: (raw?.contacts ?? []).map((c) => ({
      name: c.name ?? "",
      role: c.role ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      linkedin_url: c.linkedin_url ?? "",
      firm_location: c.firm_location ?? "",
    })),
  };
}

/** Supabase errors are plain objects with a message, not always Error instances. */
const errorMessage = (e: unknown): string =>
  typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");

type Stage = "idle" | "extracting" | "creating" | "enriching";

export default function PartnerImportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const currentMember = useCurrentTeamMember();
  const { data: partners = [] } = usePartners({ includeArchived: true });

  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stage, setStage] = useState<Stage>("idle");

  const busy = stage !== "idle";
  const similar = useMemo(
    () => (draft?.name.trim() ? findSimilarPartners(draft.name, partners) : []),
    [draft?.name, partners],
  );

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const updateContact = (idx: number, patch: Partial<ContactDraft>) =>
    setDraft((d) => (d ? { ...d, contacts: d.contacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)) } : d));
  const addContact = () => setDraft((d) => (d ? { ...d, contacts: [...d.contacts, emptyContact()] } : d));
  const removeContact = (idx: number) =>
    setDraft((d) => (d ? { ...d, contacts: d.contacts.filter((_, i) => i !== idx) } : d));

  const extract = async () => {
    if (!notes.trim()) return;
    setStage("extracting");
    try {
      const { data, error } = await supabase.functions.invoke("extract-partner-from-notes", {
        body: { notes },
      });
      if (error) throw error;
      const next = toDraft((data as { draft?: RawDraft } | null)?.draft);
      setDraft(next);
      if (!next.name) toast.warning("No firm name found in the notes — type it in below");
    } catch (e) {
      toast.error("Could not read the notes: " + errorMessage(e));
    } finally {
      setStage("idle");
    }
  };

  const create = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error("Firm name is required");
      return;
    }
    setStage("creating");
    try {
      const { data: partner, error } = await supabase
        .from("partners")
        .insert({
          name,
          firm_type: draft.firm_type || null,
          headquarters: draft.headquarters.trim() || null,
          website: draft.website.trim() || null,
          relationship_strength: draft.relationship_strength || null,
          // A warmth confirmed here is a person's call, as on the New Partner form.
          manual_fields: draft.relationship_strength ? ["relationship_strength"] : [],
          data_source: "Notes import",
        })
        .select()
        .single();
      if (error) throw error;

      const contacts = draft.contacts
        .filter((c) => c.name.trim() || c.email.trim() || c.phone.trim())
        .map((c) => ({
          partner_id: partner.id,
          name: c.name.trim() || "(unnamed)",
          role: c.role.trim() || null,
          email: c.email.trim() || null,
          phone: c.phone.trim() || null,
          linkedin_url: c.linkedin_url.trim() || null,
          firm_location: c.firm_location.trim() || null,
        }));
      if (contacts.length > 0) {
        const { error: cErr } = await supabase.from("partner_contacts").insert(contacts);
        if (cErr) toast.error("Partner created, but contacts failed to save: " + cErr.message);
      }

      // The notes are saved on the partner, so the enricher reads them — now
      // and on every later re-run — and they show in the profile's notes.
      const { error: nErr } = await supabase.from("notes").insert({
        entity_type: "partner",
        entity_id: partner.id,
        content: notesToHtml(notes),
        content_format: "html",
        author: currentMember?.full_name ?? user?.email ?? null,
        team_member_id: currentMember?.id ?? null,
      });
      if (nErr) {
        toast.error("Partner created, but the notes failed to save: " + nErr.message);
      } else {
        // Awaited, so the profile opens with its mandate and briefing filled
        // rather than filling in a few seconds after it renders.
        setStage("enriching");
        const { data: enr, error: eErr } = await supabase.functions.invoke("enrich-partner-from-notes", {
          body: { partner_id: partner.id, force: true },
        });
        const skipped = (enr as { skipped?: string } | null)?.skipped;
        if (eErr || skipped) {
          toast.warning("Partner created, but the profile details could not be filled from the notes yet — use Re-run enrichment on the profile");
        }
      }

      if (!partner.website) {
        supabase.functions
          .invoke("find-partner-website", { body: { partner_id: partner.id } })
          .catch((e) => console.warn("find-partner-website threw", e));
      }

      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      toast.success(`${partner.name} added`);
      navigate(`/partners/${partner.id}`);
    } catch (e) {
      toast.error(errorMessage(e) || "Failed to create partner");
      setStage("idle");
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/partners")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="font-display text-2xl tracking-tight">Partner Import</h1>
          <p className="text-sm text-muted-foreground">
            Paste notes on a new capital partner. We draft the profile, you check it, and the mandate and briefing are filled from the notes.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Notes</CardTitle>
          <CardDescription>
            Meeting or call notes, an intro email, a signature block — anything about the firm and the people there.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={"Call with Jane Smith (MD, Acme Capital, jane@acmecap.com) — Dallas-based family office, writes $5–20M LP checks into value-add multifamily across Texas and the Southeast, 5–7 yr hold…"}
            className="min-h-[220px] text-sm"
            disabled={busy}
          />
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] ${notes.length > MAX_NOTES_CHARS ? "text-destructive" : "text-muted-foreground"}`}>
              {notes.length.toLocaleString()} / {MAX_NOTES_CHARS.toLocaleString()} characters
            </span>
            <Button
              onClick={extract}
              disabled={busy || !notes.trim() || notes.length > MAX_NOTES_CHARS}
              variant={draft ? "outline" : "default"}
              className="gap-1.5"
            >
              {stage === "extracting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {draft ? "Re-read notes" : "Draft profile"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Review</CardTitle>
            <CardDescription>
              Fix anything the notes got wrong. Geography, check size, strategy and the briefing are filled after you create the profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {similar.length > 0 && (
              <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  Possibly already in Capital Partners:{" "}
                  {similar.slice(0, 5).map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ", "}
                      <Link to={`/partners/${p.id}`} className="font-medium underline">{p.name}</Link>
                      {p.archived_at && " (archived)"}
                    </span>
                  ))}
                  . If it's the same firm, add the notes on that profile instead.
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pi-name">Firm name *</Label>
                <Input id="pi-name" value={draft.name} onChange={(e) => set("name", e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label>Firm type</Label>
                <Select value={draft.firm_type || NONE} onValueChange={(v) => set("firm_type", v === NONE ? "" : v)} disabled={busy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not stated</SelectItem>
                    {FIRM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Warmth</Label>
                <Select
                  value={draft.relationship_strength || NONE}
                  onValueChange={(v) => set("relationship_strength", v === NONE ? "" : v)}
                  disabled={busy}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Leave to activity</SelectItem>
                    {WARMTH_LEVELS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pi-hq">Headquarters</Label>
                <Input id="pi-hq" value={draft.headquarters} onChange={(e) => set("headquarters", e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pi-web">Website</Label>
                <Input
                  id="pi-web"
                  value={draft.website}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="Found automatically if left blank"
                  disabled={busy}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Contacts</Label>
                <Button variant="ghost" size="sm" onClick={addContact} disabled={busy} className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add contact
                </Button>
              </div>
              {draft.contacts.length === 0 && (
                <p className="text-sm text-muted-foreground">No people found in the notes.</p>
              )}
              {draft.contacts.map((c, i) => (
                <div key={i} className="relative grid gap-2 rounded-md border p-3 pr-10 sm:grid-cols-3">
                  <Input placeholder="Name" value={c.name} onChange={(e) => updateContact(i, { name: e.target.value })} disabled={busy} />
                  <Input placeholder="Title" value={c.role} onChange={(e) => updateContact(i, { role: e.target.value })} disabled={busy} />
                  <Input placeholder="Email" value={c.email} onChange={(e) => updateContact(i, { email: e.target.value })} disabled={busy} />
                  <Input placeholder="Phone" value={c.phone} onChange={(e) => updateContact(i, { phone: e.target.value })} disabled={busy} />
                  <Input placeholder="Office location" value={c.firm_location} onChange={(e) => updateContact(i, { firm_location: e.target.value })} disabled={busy} />
                  <Input placeholder="LinkedIn URL" value={c.linkedin_url} onChange={(e) => updateContact(i, { linkedin_url: e.target.value })} disabled={busy} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 h-7 w-7"
                    onClick={() => removeContact(i)}
                    disabled={busy}
                    aria-label="Remove contact"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 border-t pt-4">
              {stage === "enriching" && (
                <span className="text-sm text-muted-foreground">Filling mandate and briefing from the notes…</span>
              )}
              <Button onClick={create} disabled={busy || !draft.name.trim()} className="gap-1.5">
                {stage === "creating" || stage === "enriching" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create partner
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
