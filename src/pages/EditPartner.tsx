import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { PartnerForm } from "@/components/PartnerForm";
import { PartnerFormPage } from "@/pages/NewPartner";
import {
  usePartner, usePartnerContacts, useUpdatePartner, useCreatePartnerContact,
  useUpdatePartnerContact, useDeletePartnerContact,
} from "@/hooks/usePartners";
import { useAuth } from "@/hooks/useAuth";
import { partnerToForm, formToPartnerFields, buildPartnerUpdate, diffContacts, type PartnerFormState } from "@/lib/partnerForm";

/** Edit an existing partner in the same form Add Partner uses. */
export default function EditPartner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { data: partner, isLoading } = usePartner(id);
  const { data: contacts, isLoading: contactsLoading } = usePartnerContacts(id);
  const update = useUpdatePartner();
  const createContact = useCreatePartnerContact();
  const updateContact = useUpdatePartnerContact();
  const deleteContact = useDeletePartnerContact();

  const [form, setForm] = useState<PartnerFormState | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the stored record once; later refetches must not wipe the user's edits.
  useEffect(() => {
    if (form || !partner || contactsLoading) return;
    setForm(partnerToForm(partner, contacts ?? []));
  }, [form, partner, contacts, contactsLoading]);

  // "Edit" links can point at a section (/edit#contacts); scroll there once the form exists.
  useEffect(() => {
    if (!form || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!form, location.hash]);

  const back = () => navigate(`/partners/${id}`);

  const save = async () => {
    if (!partner || !form) return;
    const parsed = formToPartnerFields(form);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    const { changed, update: patch } = buildPartnerUpdate(partner, parsed.fields, profile?.email ?? null);
    const { inserts, updates, deletes } = diffContacts(contacts ?? [], form);
    const contactChanges = inserts.length + updates.length + deletes.length;
    if (changed.length === 0 && contactChanges === 0) {
      toast.info("No changes to save");
      back();
      return;
    }

    setSaving(true);
    try {
      if (changed.length) await update.mutateAsync({ id: partner.id, ...patch } as any);
      for (const c of inserts) await createContact.mutateAsync({ partner_id: partner.id, ...c });
      for (const c of updates) await updateContact.mutateAsync(c);
      for (const cid of deletes) await deleteContact.mutateAsync({ id: cid, partner_id: partner.id });
      const parts = [
        changed.length && `${changed.length} field${changed.length === 1 ? "" : "s"}`,
        contactChanges && `${contactChanges} contact change${contactChanges === 1 ? "" : "s"}`,
      ].filter(Boolean);
      toast.success(`Saved ${parts.join(" and ")}`);
      back();
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || (partner && !form)) {
    return (
      <div className="max-w-5xl w-full mx-auto space-y-6">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!partner || !form) {
    return <div className="text-center text-muted-foreground py-12">Partner not found</div>;
  }

  return (
    <PartnerFormPage
      title={`Edit ${partner.name}`}
      subtitle="Every field from Add Partner, in the same place. Fields you change are locked from AI enrichment."
      onBack={back}
      onSave={save}
      saving={saving}
      saveLabel="Save Changes"
    >
      <PartnerForm mode="edit" form={form} setForm={setForm as React.Dispatch<React.SetStateAction<PartnerFormState>>} />
    </PartnerFormPage>
  );
}
