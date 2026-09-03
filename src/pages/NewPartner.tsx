import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

import { useCreatePartner } from "@/hooks/usePartners";
import { useCreateNote } from "@/hooks/useNotes";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { supabase } from "@/integrations/supabase/client";
import { INVESTOR_TYPES, GEOGRAPHY_QUICK_ADDS } from "@/lib/partnerOptions";

const FIRM_TYPES = ["GP", "LP", "Family Office", "REIT", "Insurance", "Pension", "Endowment", "Fund of Funds", "Other"];
const WARMTH_LEVELS = ["Existing Partner", "Very Warm", "Warm", "Tepid", "Cold"];
const HOLD_PERIODS = ["Short (<3 yr)", "Medium (3–7 yr)", "Long (7–10 yr)", "Perpetual"];
const PRODUCT_TYPES = ["Multifamily", "Office", "Industrial", "Retail", "Mixed-Use", "Hospitality", "Student Housing", "Senior Living", "Self-Storage"];

type FormState = {
  name: string;
  firm_type: string;
  relationship_strength: string;
  ansonia_poc: string;
  headquarters: string;
  min_equity_m: string;
  max_equity_m: string;
  investor_type: string[];
  hold_period: string[];
  product_types: string[];
  geography: string[];
  urban_infill: boolean;
  suburban: boolean;
  strategy_value_add: boolean;
  strategy_core_plus: boolean;
  strategy_workforce: boolean;
  strategy_affordable: boolean;
  additional_notes: string;
  initial_note: string;
  contacts: ContactDraft[];
};

type ContactDraft = {
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin_url: string;
  firm_location: string;
};

const emptyContact = (): ContactDraft => ({
  name: "", role: "", email: "", phone: "", linkedin_url: "", firm_location: "",
});

const initial: FormState = {
  name: "",
  firm_type: "",
  relationship_strength: "",
  ansonia_poc: "",
  headquarters: "",
  min_equity_m: "",
  max_equity_m: "",
  investor_type: [],
  hold_period: [],
  product_types: [],
  geography: [],
  urban_infill: false,
  suburban: false,
  strategy_value_add: false,
  strategy_core_plus: false,
  strategy_workforce: false,
  strategy_affordable: false,
  additional_notes: "",
  initial_note: "",
  contacts: [emptyContact()],
};

export default function NewPartner() {
  const navigate = useNavigate();
  const createPartner = useCreatePartner();
  const createNote = useCreateNote();
  const { user } = useAuth();
  const currentMember = useCurrentTeamMember();

  const [form, setForm] = useState<FormState>(initial);
  const [geoInput, setGeoInput] = useState("");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleInArray = (key: "investor_type" | "hold_period" | "product_types", val: string) => {
    setForm((f) => {
      const arr = f[key];
      return { ...f, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });
  };

  const addGeo = () => {
    const parts = geoInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setForm((f) => ({
      ...f,
      geography: Array.from(new Set([...f.geography, ...parts])),
    }));
    setGeoInput("");
  };
  const removeGeo = (g: string) =>
    setForm((f) => ({ ...f, geography: f.geography.filter((x) => x !== g) }));

  const updateContact = (idx: number, patch: Partial<ContactDraft>) =>
    setForm((f) => ({
      ...f,
      contacts: f.contacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  const addContact = () =>
    setForm((f) => ({ ...f, contacts: [...f.contacts, emptyContact()] }));
  const removeContact = (idx: number) =>
    setForm((f) => ({
      ...f,
      contacts: f.contacts.length === 1 ? [emptyContact()] : f.contacts.filter((_, i) => i !== idx),
    }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Firm name is required");
      return;
    }
    const min = form.min_equity_m ? Number(form.min_equity_m) : null;
    const max = form.max_equity_m ? Number(form.max_equity_m) : null;
    if (min != null && Number.isNaN(min)) return toast.error("Min equity must be a number");
    if (max != null && Number.isNaN(max)) return toast.error("Max equity must be a number");

    try {
      const partner = await createPartner.mutateAsync({
        name: form.name.trim(),
        firm_type: form.firm_type || null,
        relationship_strength: form.relationship_strength || null,
        ansonia_poc: form.ansonia_poc.trim() || null,
        headquarters: form.headquarters.trim() || null,
        min_equity_m: min,
        max_equity_m: max,
        investor_type: form.investor_type,
        hold_period: form.hold_period,
        product_types: form.product_types,
        geography: form.geography,
        urban_infill: form.urban_infill,
        suburban: form.suburban,
        strategy_value_add: form.strategy_value_add,
        strategy_core_plus: form.strategy_core_plus,
        strategy_workforce: form.strategy_workforce,
        strategy_affordable: form.strategy_affordable,
        additional_notes: form.additional_notes.trim() || null,
      });

      if (form.initial_note.trim()) {
        try {
          await createNote.mutateAsync({
            entity_type: "partner",
            entity_id: partner.id,
            content: `<p>${form.initial_note.replace(/\n/g, "<br/>")}</p>`,
            content_format: "html",
            author: currentMember?.full_name ?? user?.email ?? undefined,
            team_member_id: currentMember?.id ?? null,
          });
        } catch (e) {
          console.warn("initial note failed", e);
        }
      }

      // Insert contacts (skip fully-blank rows)
      const cleanContacts = form.contacts
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
      if (cleanContacts.length > 0) {
        const { error: cErr } = await supabase.from("partner_contacts").insert(cleanContacts);
        if (cErr) console.warn("contacts insert failed", cErr);
      }

      // Fire-and-forget website discovery
      supabase.functions
        .invoke("find-partner-website", { body: { partner_id: partner.id } })
        .then(({ data, error }) => {
          if (error) console.warn("find-partner-website error", error);
          else if ((data as any)?.website) console.log("website found:", (data as any).website);
        })
        .catch((e) => console.warn("find-partner-website threw", e));

      toast.success(`${partner.name} added — finding website in the background`);
      navigate(`/partners/${partner.id}`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to create partner");
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/partners")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Add Capital Partner</h1>
            <p className="text-sm text-muted-foreground">
              Capture firm details and investment criteria. You can refine later on the partner page.
            </p>
          </div>
        </div>
        <Button onClick={submit} disabled={createPartner.isPending}>
          {createPartner.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Save Partner
        </Button>
      </div>

      {/* Firm Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Firm Overview</CardTitle>
          <CardDescription>Identity and relationship context</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Firm Name <span className="text-red-500">*</span></Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Pearlmark Real Estate" />
          </div>
          <div className="space-y-1.5">
            <Label>Firm Type</Label>
            <Select value={form.firm_type} onValueChange={(v) => set("firm_type", v)}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {FIRM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Relationship Strength</Label>
            <Select value={form.relationship_strength} onValueChange={(v) => set("relationship_strength", v)}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {WARMTH_LEVELS.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Ansonia POC</Label>
            <Input value={form.ansonia_poc} onChange={(e) => set("ansonia_poc", e.target.value)} placeholder="Who at Ansonia owns this relationship" />
          </div>
          <div className="space-y-1.5">
            <Label>Firm Headquarters</Label>
            <Input
              value={form.headquarters}
              onChange={(e) => set("headquarters", e.target.value)}
              placeholder="e.g. New York, NY (or full address)"
            />
          </div>
        </CardContent>
      </Card>

      {/* Check size */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Equity Check Size</CardTitle>
          <CardDescription>Typical range per deal, in $ millions</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Min Equity ($M)</Label>
            <Input type="number" inputMode="decimal" value={form.min_equity_m} onChange={(e) => set("min_equity_m", e.target.value)} placeholder="e.g. 5" />
          </div>
          <div className="space-y-1.5">
            <Label>Max Equity ($M)</Label>
            <Input type="number" inputMode="decimal" value={form.max_equity_m} onChange={(e) => set("max_equity_m", e.target.value)} placeholder="e.g. 25" />
          </div>
        </CardContent>
      </Card>

      {/* Investment criteria */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Investment Criteria</CardTitle>
          <CardDescription>Structured filters used for matching to deals</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <CheckboxGroup
            label="Investor Type"
            options={INVESTOR_TYPES}
            selected={form.investor_type}
            onToggle={(v) => toggleInArray("investor_type", v)}
          />
          <Separator />
          <CheckboxGroup
            label="Hold Period"
            options={HOLD_PERIODS}
            selected={form.hold_period}
            onToggle={(v) => toggleInArray("hold_period", v)}
          />
          <Separator />
          <CheckboxGroup
            label="Product Types"
            options={PRODUCT_TYPES}
            selected={form.product_types}
            onToggle={(v) => toggleInArray("product_types", v)}
          />
          <Separator />

          {/* Geography */}
          <div className="space-y-2">
            <Label>Geography</Label>
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
            <div className="flex flex-wrap gap-1.5">
              {GEOGRAPHY_QUICK_ADDS.map((q) => {
                const already = form.geography.includes(q);
                return (
                  <Button
                    key={q}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={already}
                    onClick={() =>
                      setForm((f) => ({ ...f, geography: Array.from(new Set([...f.geography, q])) }))
                    }
                  >
                    {already ? `✓ ${q}` : `+ ${q}`}
                  </Button>
                );
              })}
            </div>
            {form.geography.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {form.geography.map((g) => (
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

          <Separator />

          {/* Site preference */}
          <div className="space-y-2">
            <Label>Site Preference</Label>
            <div className="grid grid-cols-2 gap-3">
              <ToggleRow label="Urban Infill" checked={form.urban_infill} onChange={(v) => set("urban_infill", v)} />
              <ToggleRow label="Suburban" checked={form.suburban} onChange={(v) => set("suburban", v)} />
            </div>
          </div>

          <Separator />

          {/* Strategy */}
          <div className="space-y-2">
            <Label>Strategy</Label>
            <div className="grid grid-cols-2 gap-3">
              <ToggleRow label="Value-Add" checked={form.strategy_value_add} onChange={(v) => set("strategy_value_add", v)} />
              <ToggleRow label="Core Plus" checked={form.strategy_core_plus} onChange={(v) => set("strategy_core_plus", v)} />
              <ToggleRow label="Workforce" checked={form.strategy_workforce} onChange={(v) => set("strategy_workforce", v)} />
              <ToggleRow label="Affordable" checked={form.strategy_affordable} onChange={(v) => set("strategy_affordable", v)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contacts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
          <CardDescription>
            Specific people at the firm. Add as many as you like — leave a row blank to skip it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.contacts.map((c, idx) => (
            <div key={idx} className="rounded-md border p-4 space-y-3 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Contact {idx + 1}
                </span>
                {(form.contacts.length > 1 || c.name || c.email || c.phone) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground hover:text-destructive"
                    onClick={() => removeContact(idx)}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Remove
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={c.name} onChange={(e) => updateContact(idx, { name: e.target.value })} placeholder="Jane Doe" />
                </div>
                <div className="space-y-1.5">
                  <Label>Title / Role</Label>
                  <Input value={c.role} onChange={(e) => updateContact(idx, { role: e.target.value })} placeholder="Managing Director" />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={c.email} onChange={(e) => updateContact(idx, { email: e.target.value })} placeholder="jane@firm.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={c.phone} onChange={(e) => updateContact(idx, { phone: e.target.value })} placeholder="(212) 555-0100" />
                </div>
                <div className="space-y-1.5">
                  <Label>LinkedIn URL</Label>
                  <Input value={c.linkedin_url} onChange={(e) => updateContact(idx, { linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/…" />
                </div>
                <div className="space-y-1.5">
                  <Label>Location</Label>
                  <Input value={c.firm_location} onChange={(e) => updateContact(idx, { firm_location: e.target.value })} placeholder="New York, NY" />
                </div>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addContact}>
            <span className="mr-1">+</span> Add another contact
          </Button>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
          <CardDescription>
            Free-form context. "Additional notes" lives on the firm profile; the note below is saved as your first
            timeline note.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Additional Notes (profile)</Label>
            <RichTextEditor
              value={form.additional_notes}
              onChange={(v) => set("additional_notes", v)}
              placeholder="Anything structured that doesn't fit above — mandate language, restrictions, fund vintage, etc."
            />
          </div>
          <div className="space-y-1.5">
            <Label>First Note (timeline)</Label>
            <RichTextEditor
              value={form.initial_note}
              onChange={(v) => set("initial_note", v)}
              placeholder="Kick-off context: intro source, conversations to date, next steps..."
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 pb-8">
        <Button variant="outline" onClick={() => navigate("/partners")} disabled={createPartner.isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={createPartner.isPending}>
          {createPartner.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Save Partner
        </Button>
      </div>
    </div>
  );
}

function CheckboxGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {options.map((opt) => (
          <label
            key={opt}
            className="flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-muted/50"
          >
            <Checkbox checked={selected.includes(opt)} onCheckedChange={() => onToggle(opt)} />
            <span className="truncate">{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
