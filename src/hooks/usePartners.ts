import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Partner = {
  id: string;
  name: string;
  firm_type: string | null;
  relationship_strength: string | null;
  investor_type: string[];
  headquarters: string | null;
  website: string | null;
  min_equity_m: number | null;
  max_equity_m: number | null;
  hold_period: string[];
  geography: string[];
  geography_avoid: string[];
  urban_infill: boolean;
  suburban: boolean;
  strategy_value_add: boolean;
  strategy_core_plus: boolean;
  strategy_workforce: boolean;
  strategy_affordable: boolean;
  product_types: string[];
  ansonia_poc: string | null;
  additional_notes: string | null;
  organized_notes: string | null;
  data_source: string | null;
  status: string | null;
  manual_fields: string[];
  enriched_fields: Record<string, any> | null;
  profile_summary: string | null;
  profile_summary_updated_at: string | null;
  profile_summary_hash: string | null;
  capital_status: string | null;
  capital_available_from: string | null;
  capital_status_as_of: string | null;
  capital_status_detail: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  last_edited_at: string;
};

export type PartnerContact = {
  id: string;
  partner_id: string;
  name: string;
  email: string | null;
  linkedin_url: string | null;
  firm_location: string | null;
  ansonia_poc: string | null;
  phone: string | null;
  role: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerInteraction = {
  id: string;
  partner_id: string;
  contact_id: string | null;
  interaction_type: string;
  author: string | null;
  content: string;
  source: string | null;
  interaction_date: string;
  created_at: string;
  source_message_ids?: string[] | null;
  fact_category?: string | null;
};

export const PROFILE_COMPLETENESS_FIELDS = [
  "capital_status", "min_equity_m", "max_equity_m", "geography", "product_types",
  "hold_period", "investor_type", "relationship_strength",
  "strategy_value_add", "strategy_core_plus", "strategy_workforce", "strategy_affordable",
] as const;

export type PartnerCurrency = {
  lastContactAt: string | null;
  lastUpdatedAt: string | null;
  pendingSuggestions: number;
  fieldsFilled: number;
  fieldsTotal: number;
};

/** All four profile-currency figures in one round trip. */
export function usePartnerCurrency(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["partner_currency", partnerId],
    enabled: !!partnerId,
    queryFn: async (): Promise<PartnerCurrency> => {
      const [partnerRes, interRes, mailRes, sugRes] = await Promise.all([
        (supabase as any).from("partners")
          .select(`last_edited_at,${PROFILE_COMPLETENESS_FIELDS.join(",")}`)
          .eq("id", partnerId).maybeSingle(),
        (supabase as any).from("partner_interactions")
          .select("interaction_date").eq("partner_id", partnerId)
          .order("interaction_date", { ascending: false }).limit(1).maybeSingle(),
        (supabase as any).from("outlook_messages")
          .select("received_at").eq("partner_id", partnerId)
          .order("received_at", { ascending: false }).limit(1).maybeSingle(),
        (supabase as any).from("partner_suggestions")
          .select("id", { count: "exact", head: true })
          .eq("partner_id", partnerId).eq("status", "pending"),
      ]);

      const p: any = partnerRes.data || {};
      let filled = 0;
      for (const f of PROFILE_COMPLETENESS_FIELDS) {
        const v = p[f];
        if (v === null || v === undefined) continue;
        if (Array.isArray(v) ? v.length > 0 : v !== "" && v !== false) filled++;
      }

      const candidates = [
        interRes.data?.interaction_date ?? null,
        mailRes.data?.received_at ?? null,
      ].filter(Boolean) as string[];
      const lastContactAt = candidates.length
        ? candidates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
        : null;

      return {
        lastContactAt,
        lastUpdatedAt: p.last_edited_at ?? null,
        pendingSuggestions: sugRes.count ?? 0,
        fieldsFilled: filled,
        fieldsTotal: PROFILE_COMPLETENESS_FIELDS.length,
      };
    },
  });
}

export function usePartners(options?: { includeArchived?: boolean }) {
  const includeArchived = !!options?.includeArchived;
  return useQuery({
    queryKey: ["partners", { includeArchived }],
    queryFn: async () => {
      let query = supabase.from("partners").select("*").order("name", { ascending: true });
      if (!includeArchived) query = query.is("archived_at", null);
      const { data, error } = await query;
      if (error) throw error;
      return data as Partner[];
    },
  });
}

export function usePartner(id: string | undefined) {
  return useQuery({
    queryKey: ["partners", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partners")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Partner;
    },
  });
}

export function usePartnerContacts(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["partner-contacts", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_contacts")
        .select("*")
        .eq("partner_id", partnerId!)
        .order("name");
      if (error) throw error;
      return data as PartnerContact[];
    },
  });
}

export function usePartnerInteractions(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["partner-interactions", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_interactions")
        .select("*")
        .eq("partner_id", partnerId!)
        .order("interaction_date", { ascending: false });
      if (error) throw error;
      return data as PartnerInteraction[];
    },
  });
}

export function useUpdatePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...partner }: Partial<Partner> & { id: string }) => {
      const { data, error } = await supabase
        .from("partners")
        .update(partner)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["partners", data.id] });
    },
  });
}

export function useCreatePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (partner: Partial<Partner>) => {
      const { data, error } = await supabase
        .from("partners")
        .insert(partner as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
    },
  });
}

/**
 * Legacy hard-delete. No longer wired to any UI — archive is the user-facing
 * flow. Kept for programmatic/admin use only.
 */
export function useDeletePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("partners").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
    },
  });
}

export function useArchivePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("partners")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["partners", data.id] });
    },
  });
}

export function useRestorePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("partners")
        .update({ archived_at: null })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["partners", data.id] });
    },
  });
}

export function useCreateInteraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (interaction: Partial<PartnerInteraction>) => {
      const { data, error } = await supabase
        .from("partner_interactions")
        .insert(interaction as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_: any, variables: any) => {
      queryClient.invalidateQueries({ queryKey: ["partner-interactions", variables.partner_id] });
    },
  });
}

export function useCreatePartnerContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contact: Partial<PartnerContact> & { partner_id: string; name: string }) => {
      const { data, error } = await supabase
        .from("partner_contacts")
        .insert(contact as any)
        .select()
        .single();
      if (error) throw error;
      return data as PartnerContact;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["partner-contacts", data.partner_id] });
      queryClient.invalidateQueries({ queryKey: ["partner-contacts", "all-counts"] });
    },
  });
}

export function useUpdatePartnerContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PartnerContact> & { id: string }) => {
      const { data, error } = await supabase
        .from("partner_contacts")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as PartnerContact;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["partner-contacts", data.partner_id] });
    },
  });
}

export function useDeletePartnerContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, partner_id }: { id: string; partner_id: string }) => {
      const { error } = await supabase.from("partner_contacts").delete().eq("id", id);
      if (error) throw error;
      return { id, partner_id };
    },
    onSuccess: ({ partner_id }) => {
      queryClient.invalidateQueries({ queryKey: ["partner-contacts", partner_id] });
      queryClient.invalidateQueries({ queryKey: ["partner-contacts", "all-counts"] });
    },
  });
}

export type PartnerAttachment = {
  id: string;
  partner_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  content_type: string | null;
  label: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export function usePartnerAttachments(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["partner-attachments", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_attachments")
        .select("*")
        .eq("partner_id", partnerId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PartnerAttachment[];
    },
  });
}

export function useUploadPartnerAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      partnerId,
      file,
      label,
      uploadedBy,
    }: {
      partnerId: string;
      file: File;
      label?: string | null;
      uploadedBy?: string | null;
    }) => {
      const key = `${partnerId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("partner-attachments")
        .upload(key, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("partner_attachments")
        .insert({
          partner_id: partnerId,
          storage_path: key,
          file_name: file.name,
          file_size: file.size,
          content_type: file.type || null,
          label: label ?? null,
          uploaded_by: uploadedBy ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as PartnerAttachment;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["partner-attachments", data.partner_id] });
    },
  });
}

export async function getPartnerAttachmentUrl(storagePath: string, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage
    .from("partner-attachments")
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export function useDeletePartnerAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, partner_id, storage_path }: { id: string; partner_id: string; storage_path: string }) => {
      const { error: storageError } = await supabase.storage
        .from("partner-attachments")
        .remove([storage_path]);
      if (storageError) throw storageError;
      const { error } = await supabase.from("partner_attachments").delete().eq("id", id);
      if (error) throw error;
      return { id, partner_id };
    },
    onSuccess: ({ partner_id }) => {
      queryClient.invalidateQueries({ queryKey: ["partner-attachments", partner_id] });
    },
  });
}



