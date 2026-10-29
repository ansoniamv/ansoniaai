// The capital-partner form. Add Partner and Edit Partner both render this, so
// every field is in the same place whichever way you come in.
import { useState } from "react";
import { MapPinOff, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/RichTextEditor";
import { CAPITAL_STATUS_OPTIONS } from "@/components/CapitalStatusCard";
import {
  WARMTH_LEVELS, INVESTOR_TYPES, INVESTMENT_TYPES, HOLD_PERIODS, PRODUCT_TYPES, GEOGRAPHY_QUICK_ADDS,
} from "@/lib/partnerOptions";
import { emptyContact, isBlankContact, type ContactDraft, type PartnerFormState } from "@/lib/partnerForm";
import { cn } from "@/lib/utils";

const NONE = "__none__";

type ArrayKey = "investor_type" | "investment_type" | "hold_period" | "product_types";

export function PartnerForm({
  mode,
  form,
  setForm,
  nameAlert,
}: {
  mode: "create" | "edit";
  form: PartnerFormState;
  setForm: React.Dispatch<React.SetStateAction<PartnerFormState>>;
  /** Shown under the firm name (the blacklist warning on Add). */
  nameAlert?: React.ReactNode;
}) {
  const set = <K extends keyof PartnerFormState>(k: K, v: PartnerFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleInArray = (key: ArrayKey, val: string) =>
    setForm((f) => {
      const arr = f[key];
      return { ...f, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });

  const updateContact = (idx: number, patch: Partial<ContactDraft>) =>
    setForm((f) => ({ ...f, contacts: f.contacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)) }));
  const addContact = () => setForm((f) => ({ ...f, contacts: [...f.contacts, emptyContact()] }));
  const removeContact = (idx: number) =>
    setForm((f) => {
      const gone = f.contacts[idx];
      const rest = f.contacts.filter((_, i) => i !== idx);
      return {
        ...f,
        contacts: rest.length ? rest : [emptyContact()],
        removed_contacts: gone.id ? [...f.removed_contacts, gone] : f.removed_contacts,
      };
    });
  const undoRemove = (id: string) =>
    setForm((f) => {
      const back = f.removed_contacts.find((c) => c.id === id);
      if (!back) return f;
      const kept = f.contacts.filter((c) => c.id || !isBlankContact(c));
      return {
        ...f,
        contacts: [...kept, back],
        removed_contacts: f.removed_contacts.filter((c) => c.id !== id),
      };
    });

  return (
    <div className="space-y-6">
      {/* Firm Overview */}
      <Card id="firm" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">Firm Overview</CardTitle>
          <CardDescription>Identity and relationship context</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Firm Name <span className="text-red-500">*</span></Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Pearlmark Real Estate" />
            {nameAlert}
          </div>
          <div className="space-y-1.5">
            <Label>Relationship Warmth</Label>
            <OptionSelect value={form.relationship_strength} options={WARMTH_LEVELS} onChange={(v) => set("relationship_strength", v)} />
          </div>
          <div className="space-y-1.5">
            <Label>Ansonia POC</Label>
            <Input value={form.ansonia_poc} onChange={(e) => set("ansonia_poc", e.target.value)} placeholder="Who at Ansonia owns this relationship" />
          </div>
          <div className="space-y-1.5">
            <Label>Firm Headquarters</Label>
            <Input value={form.headquarters} onChange={(e) => set("headquarters", e.target.value)} placeholder="e.g. New York, NY (or full address)" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Website</Label>
            <Input
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder={mode === "create" ? "Leave blank and it will be looked up after saving" : "https://"}
            />
          </div>
        </CardContent>
      </Card>

      {/* Check size */}
      <Card id="equity" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">Equity Check Size</CardTitle>
          <CardDescription>Typical range per deal, in $ millions</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Min Equity ($M)</Label>
            <Input type="number" inputMode="decimal" step="any" value={form.min_equity_m} onChange={(e) => set("min_equity_m", e.target.value)} placeholder="e.g. 5" />
          </div>
          <div className="space-y-1.5">
            <Label>Max Equity ($M)</Label>
            <Input type="number" inputMode="decimal" step="any" value={form.max_equity_m} onChange={(e) => set("max_equity_m", e.target.value)} placeholder="e.g. 25" />
          </div>
        </CardContent>
      </Card>

      {/* Investment criteria */}
      <Card id="criteria" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">Investment Criteria</CardTitle>
          <CardDescription>Structured filters used for matching to deals</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <CheckboxGroup label="Investor Type" hint="who they are" options={INVESTOR_TYPES} selected={form.investor_type} onToggle={(v) => toggleInArray("investor_type", v)} />
          <Separator />
          <CheckboxGroup label="Investment Type" hint="how they invest with us" options={INVESTMENT_TYPES} selected={form.investment_type} onToggle={(v) => toggleInArray("investment_type", v)} />
          <Separator />
          <CheckboxGroup label="Hold Period" options={HOLD_PERIODS} selected={form.hold_period} onToggle={(v) => toggleInArray("hold_period", v)} />
          <Separator />
          <CheckboxGroup label="Product Types" options={PRODUCT_TYPES} selected={form.product_types} onToggle={(v) => toggleInArray("product_types", v)} />
          <Separator />

          <div className="space-y-2">
            <Label>Strategy</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ToggleRow label="Value-Add" checked={form.strategy_value_add} onChange={(v) => set("strategy_value_add", v)} />
              <ToggleRow label="Core Plus" checked={form.strategy_core_plus} onChange={(v) => set("strategy_core_plus", v)} />
              <ToggleRow label="Workforce" checked={form.strategy_workforce} onChange={(v) => set("strategy_workforce", v)} />
              <ToggleRow label="Affordable" checked={form.strategy_affordable} onChange={(v) => set("strategy_affordable", v)} />
            </div>
          </div>
          <Separator />

          <div className="space-y-2">
            <Label>Site Preference</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ToggleRow label="Urban Infill" checked={form.urban_infill} onChange={(v) => set("urban_infill", v)} />
              <ToggleRow label="Suburban" checked={form.suburban} onChange={(v) => set("suburban", v)} />
            </div>
          </div>
          <Separator />

          <ChipField
            label="Target Geography"
            value={form.geography}
            onChange={(v) => set("geography", v)}
            placeholder="Add markets / MSAs / states, then press Enter"
            quickAdds={GEOGRAPHY_QUICK_ADDS}
          />
          <ChipField
            label={
              <span className="inline-flex items-center gap-1">
                <MapPinOff className="h-3.5 w-3.5 text-destructive/70" /> Avoided Markets
                <span className="text-xs font-normal text-muted-foreground">(manual only — never AI-guessed)</span>
              </span>
            }
            value={form.geography_avoid}
            onChange={(v) => set("geography_avoid", v)}
            placeholder="e.g. California, San Francisco"
            destructive
          />
        </CardContent>
      </Card>

      {/* Capital status */}
      <Card id="capital" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">Capital Status</CardTitle>
          <CardDescription>Whether they have money to put out right now. Changing it stamps today as the confirmation date.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.capital_status || NONE} onValueChange={(v) => set("capital_status", v === NONE ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not established</SelectItem>
                {CAPITAL_STATUS_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Available From</Label>
            <Input type="date" value={form.capital_available_from} onChange={(e) => set("capital_available_from", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Detail</Label>
            <Input value={form.capital_status_detail} onChange={(e) => set("capital_status_detail", e.target.value)} placeholder="Their own words" />
          </div>
        </CardContent>
      </Card>

      {/* Contacts */}
      <Card id="contacts" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
          <CardDescription>
            Specific people at the firm. Add as many as you like — leave a row blank to skip it.
            {mode === "edit" && " The default contact and always-CC settings stay on the partner page."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {form.contacts.map((c, idx) => (
              <div key={c.id ?? `new-${idx}`} className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {c.id ? c.name || `Contact ${idx + 1}` : `New contact`}
                  </span>
                  {(form.contacts.length > 1 || c.id || !isBlankContact(c)) && (
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
                  <Field label="Name"><Input value={c.name} onChange={(e) => updateContact(idx, { name: e.target.value })} placeholder="Jane Doe" /></Field>
                  <Field label="Title / Role"><Input value={c.role} onChange={(e) => updateContact(idx, { role: e.target.value })} placeholder="Managing Director" /></Field>
                  <Field label="Email"><Input type="email" value={c.email} onChange={(e) => updateContact(idx, { email: e.target.value })} placeholder="jane@firm.com" /></Field>
                  <Field label="Phone"><Input value={c.phone} onChange={(e) => updateContact(idx, { phone: e.target.value })} placeholder="(212) 555-0100" /></Field>
                  <Field label="LinkedIn URL"><Input value={c.linkedin_url} onChange={(e) => updateContact(idx, { linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/…" /></Field>
                  <Field label="Location"><Input value={c.firm_location} onChange={(e) => updateContact(idx, { firm_location: e.target.value })} placeholder="New York, NY" /></Field>
                </div>
              </div>
            ))}
          </div>
          {form.removed_contacts.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm space-y-1">
              <div className="font-medium text-destructive">Deleted when you save:</div>
              {form.removed_contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span>{c.name || c.email || "(unnamed)"}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => undoRemove(c.id!)}>
                    <Undo2 className="h-3.5 w-3.5 mr-1" /> Keep
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button type="button" variant="outline" size="sm" onClick={addContact}>
            <span className="mr-1">+</span> Add another contact
          </Button>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card id="notes" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
          <CardDescription>
            {mode === "create"
              ? "Free-form context. \"Partner notes\" lives on the firm profile; the note below is saved as your first timeline note."
              : "Free-form context that lives on the firm profile. Timeline notes are added from the partner page."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Partner Notes (profile)</Label>
            <RichTextEditor
              value={form.additional_notes}
              onChange={(v) => set("additional_notes", v)}
              placeholder="Anything structured that doesn't fit above — mandate language, restrictions, fund vintage, etc."
            />
          </div>
          {mode === "create" && (
            <div className="space-y-1.5">
              <Label>First Note (timeline)</Label>
              <RichTextEditor
                value={form.initial_note}
                onChange={(v) => set("initial_note", v)}
                placeholder="Kick-off context: intro source, conversations to date, next steps..."
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** A select over a fixed list that still shows a stored value from outside the list. */
function OptionSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const all = value && !options.includes(value) ? [...options, value] : options;
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Not set</SelectItem>
        {all.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * Checkbox grid for a fixed option list. Values already on the partner that
 * aren't in the list (older free-text entries) show as extra
 * checked boxes, so they can be kept or unticked instead of silently dropped.
 */
function CheckboxGroup({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  label: string;
  hint?: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  // Captured once so an unticked extra stays visible to re-tick.
  const [extras] = useState(() => selected.filter((v) => !options.includes(v)));
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {hint && <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {hint}</span>}
      </Label>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {[...options, ...extras].map((opt) => (
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

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between border rounded-md px-3 py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** Free-text chips for text[] fields. Typed text is added on Enter, comma, the Add button, or leaving the box. */
function ChipField({
  label,
  value,
  onChange,
  placeholder,
  quickAdds = [],
  destructive = false,
}: {
  label: React.ReactNode;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  quickAdds?: string[];
  destructive?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange(Array.from(new Set([...value, ...parts])));
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" onClick={commit}>Add</Button>
      </div>
      {quickAdds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {quickAdds.map((q) => {
            const already = value.includes(q);
            return (
              <Button
                key={q}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={already}
                onClick={() => onChange(Array.from(new Set([...value, q])))}
              >
                {already ? `✓ ${q}` : `+ ${q}`}
              </Button>
            );
          })}
        </div>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {value.map((g) => (
            <Badge
              key={g}
              variant={destructive ? "outline" : "secondary"}
              className={cn("gap-1", destructive && "border-destructive/60 text-destructive bg-destructive/10")}
            >
              {g}
              <button type="button" aria-label={`Remove ${g}`} onClick={() => onChange(value.filter((x) => x !== g))} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
