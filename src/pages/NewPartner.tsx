import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PartnerForm } from "@/components/PartnerForm";
import { useCreatePartner, usePartners } from "@/hooks/usePartners";
import { normalizeFirmName } from "@/components/PartnerBlacklist";
import { useCreateNote } from "@/hooks/useNotes";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { supabase } from "@/integrations/supabase/client";
import { emptyPartnerForm, formToPartnerFields, diffContacts, type PartnerFormState } from "@/lib/partnerForm";

export default function NewPartner() {
  const navigate = useNavigate();
  const createPartner = useCreatePartner();
  const createNote = useCreateNote();
  const { user } = useAuth();
  const currentMember = useCurrentTeamMember();

  const [form, setForm] = useState<PartnerFormState>(emptyPartnerForm);

  // Warn when the firm being added is one the team already blacklisted.
  const { data: existingPartners } = usePartners({ includeArchived: true });
  const blacklistedMatches = useMemo(() => {
    const q = normalizeFirmName(form.name);
    if (q.length < 3) return [];
    return (existingPartners ?? []).filter((p) => {
      if (!p.blacklisted_at) return false;
      const n = normalizeFirmName(p.name);
      return n.length >= 3 && (n.includes(q) || q.includes(n));
    });
  }, [existingPartners, form.name]);

  const submit = async () => {
    const parsed = formToPartnerFields(form);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    const { fields } = parsed;

    try {
      const partner = await createPartner.mutateAsync({
        ...fields,
        // Warmth and capital status set by hand stay put against later AI updates.
        manual_fields: [
          ...(fields.relationship_strength ? ["relationship_strength"] : []),
          ...(fields.capital_status ? ["capital_status"] : []),
        ],
        ...(fields.capital_status ? { capital_status_as_of: new Date().toISOString() } : {}),
      });

      if (form.initial_note.trim()) {
        try {
          await createNote.mutateAsync({
            entity_type: "partner",
            entity_id: partner.id,
            content: form.initial_note,
            content_format: "html",
            author: currentMember?.full_name ?? user?.email ?? undefined,
            team_member_id: currentMember?.id ?? null,
          });
        } catch (e) {
          console.warn("initial note failed", e);
        }
      }

      const { inserts } = diffContacts([], form);
      if (inserts.length > 0) {
        const { error: cErr } = await supabase
          .from("partner_contacts")
          .insert(inserts.map((c) => ({ ...c, partner_id: partner.id })));
        if (cErr) console.warn("contacts insert failed", cErr);
      }

      if (!fields.website) {
        // Fire-and-forget website discovery
        supabase.functions
          .invoke("find-partner-website", { body: { partner_id: partner.id } })
          .then(({ data, error }) => {
            if (error) console.warn("find-partner-website error", error);
            else if ((data as any)?.website) console.log("website found:", (data as any).website);
          })
          .catch((e) => console.warn("find-partner-website threw", e));
      }

      toast.success(fields.website ? `${partner.name} added` : `${partner.name} added — finding website in the background`);
      navigate(`/partners/${partner.id}`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to create partner");
    }
  };

  return (
    <PartnerFormPage
      title="Add Capital Partner"
      subtitle="Capture firm details and investment criteria. Edit Partner opens this same form later."
      onBack={() => navigate("/partners")}
      onSave={submit}
      saving={createPartner.isPending}
      saveLabel="Save Partner"
    >
      <PartnerForm
        mode="create"
        form={form}
        setForm={setForm}
        nameAlert={blacklistedMatches.map((p) => (
          <div key={p.id} role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <span className="font-semibold text-destructive">
              <Link to={`/partners/${p.id}`} className="underline">{p.name}</Link> is blacklisted.
            </span>
            {p.blacklist_reason && <span className="text-foreground"> {p.blacklist_reason}</span>}
          </div>
        ))}
      />
    </PartnerFormPage>
  );
}

/** Page frame shared by Add and Edit: back, title, and Save at the top and bottom. */
export function PartnerFormPage({
  title,
  subtitle,
  onBack,
  onSave,
  saving,
  saveLabel,
  children,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
  children: React.ReactNode;
}) {
  const saveButton = (
    <Button onClick={onSave} disabled={saving}>
      {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
      {saveLabel}
    </Button>
  );
  return (
    <div className="max-w-5xl w-full mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="min-w-0">
            <h1 className="font-display text-2xl tracking-tight truncate">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {saveButton}
      </div>
      {children}
      <div className="flex justify-end gap-2 pb-8">
        <Button variant="outline" onClick={onBack} disabled={saving}>Cancel</Button>
        {saveButton}
      </div>
    </div>
  );
}
