import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NoteLink = {
  id: string;
  note_id: string;
  linked_type: "deal" | "partner";
  linked_id: string;
  created_at: string;
};

/** Fetch links for a single note. */
export function useNoteLinks(noteId: string | undefined) {
  return useQuery({
    queryKey: ["note-links", noteId],
    enabled: !!noteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("note_links")
        .select("*")
        .eq("note_id", noteId!);
      if (error) throw error;
      return data as unknown as NoteLink[];
    },
  });
}

/** Batched — load links for many notes in one query, grouped by note_id. */
export function useNoteLinksForNotes(noteIds: string[]) {
  const key = [...noteIds].sort().join(",");
  return useQuery({
    queryKey: ["note-links", "batch", key],
    enabled: noteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("note_links")
        .select("*")
        .in("note_id", noteIds);
      if (error) throw error;
      const byNote: Record<string, NoteLink[]> = {};
      for (const row of (data ?? []) as unknown as NoteLink[]) {
        (byNote[row.note_id] ||= []).push(row);
      }
      return byNote;
    },
  });
}

export function useAddNoteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (link: { note_id: string; linked_type: "deal" | "partner"; linked_id: string }) => {
      const { data, error } = await supabase
        .from("note_links")
        .insert(link)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as NoteLink;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["note-links"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}

export function useRemoveNoteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("note_links").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["note-links"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}

export async function insertNoteLinks(
  note_id: string,
  refs: { linked_type: "deal" | "partner"; linked_id: string }[]
) {
  if (refs.length === 0) return;
  const { error } = await supabase
    .from("note_links")
    .insert(refs.map((r) => ({ note_id, linked_type: r.linked_type, linked_id: r.linked_id })));
  if (error) throw error;
}
