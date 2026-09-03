import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type TeamMemberLite = Pick<Tables<"team_members">, "id" | "full_name" | "avatar_url" | "role" | "email">;

export type NoteLinkLite = {
  id: string;
  linked_type: "deal" | "partner";
  linked_id: string;
};

export type Note = {
  id: string;
  entity_type: string;
  entity_id: string;
  content: string;
  content_format: string;
  author: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  team_member_id: string | null;
  contact_id?: string | null;
  team_members?: TeamMemberLite | null;
  note_links?: NoteLinkLite[] | null;
  partner_contacts?: { id: string; name: string; role: string | null } | null;
  classification?: "firm" | "deal" | "unclassified" | null;
  classification_summary?: string | null;
  classified_at?: string | null;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
  created_at: string;
};

export type EntityTag = {
  id: string;
  tag_id: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
};

export function useNotes(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: ["notes", entityType, entityId],
    enabled: !!entityId,
    queryFn: async () => {
      // 1) Find notes linked to this entity via note_links (secondary tags)
      const { data: links, error: linksErr } = await supabase
        .from("note_links")
        .select("note_id")
        .eq("linked_type", entityType)
        .eq("linked_id", entityId!);
      if (linksErr) throw linksErr;
      const linkedIds = Array.from(new Set((links ?? []).map((l) => l.note_id)));

      // 2) Build combined filter: primary-owner match OR id-in linked set
      const filterParts = [`and(entity_type.eq.${entityType},entity_id.eq.${entityId})`];
      if (linkedIds.length > 0) {
        filterParts.push(`id.in.(${linkedIds.join(",")})`);
      }

      const { data, error } = await supabase
        .from("notes")
        .select(
          "*, team_members(id, full_name, avatar_url, role, email), note_links(id, linked_type, linked_id), partner_contacts(id, name, role)"
        )
        .or(filterParts.join(","))
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Dedupe legacy duplicates: same normalized content + author created within
      // the same second (from before the note_links refactor).
      const norm = (s: string | null | undefined) =>
        (s ?? "")
          .replace(/<[^>]+>/g, " ")     // strip HTML tags
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const seen = new Set<string>();
      const deduped: Note[] = [];
      for (const n of (data ?? []) as unknown as Note[]) {
        const bucket = n.created_at ? n.created_at.slice(0, 19) : "";
        const key = `${norm(n.content)}|${n.author ?? n.team_member_id ?? ""}|${bucket}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(n);
      }
      return deduped;
    },
  });
}

export function useAllNotes() {
  return useQuery({
    queryKey: ["notes", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("*, team_members(id, full_name, avatar_url, role, email), note_links(id, linked_type, linked_id), partner_contacts(id, name, role)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as Note[];
    },
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (note: { entity_type: string; entity_id: string; content: string; content_format?: "plain" | "html"; author?: string; is_pinned?: boolean; team_member_id?: string | null; contact_id?: string | null }) => {
      const { data, error } = await supabase
        .from("notes")
        .insert(note as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      if (variables?.entity_type === "partner" && variables?.entity_id) {
        supabase.functions
          .invoke("enrich-partner-from-notes", { body: { partner_id: variables.entity_id } })
          .then(({ error }) => {
            if (error) console.warn("post-note enrichment failed", error);
            qc.invalidateQueries({ queryKey: ["partners", variables.entity_id] });
          })
          .catch((e) => console.warn("post-note enrichment threw", e));
      }
    },
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; content?: string; content_format?: "plain" | "html"; is_pinned?: boolean; contact_id?: string | null }) => {
      const { data, error } = await supabase
        .from("notes")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });
}

// Tags
export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Tag[];
    },
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tag: { name: string; color?: string }) => {
      const { data, error } = await supabase
        .from("tags")
        .insert(tag)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; color?: string }) => {
      const { data, error } = await supabase
        .from("tags")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tags").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });
}

// Entity Tags
export function useEntityTags(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: ["entity-tags", entityType, entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entity_tags")
        .select("*, tags(*)")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId!);
      if (error) throw error;
      return data as (EntityTag & { tags: Tag })[];
    },
  });
}

export function useAddEntityTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (et: { tag_id: string; entity_type: string; entity_id: string }) => {
      const { data, error } = await supabase
        .from("entity_tags")
        .insert(et)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entity-tags"] }),
  });
}

export function useRemoveEntityTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("entity_tags").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entity-tags"] }),
  });
}
