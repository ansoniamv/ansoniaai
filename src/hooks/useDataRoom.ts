import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { keptOutOfBrief, sourceState, type DataRoomBrief, type DataRoomCategory, type DataRoomHit, type DataRoomSource } from "@/lib/dataRoom";

export * from "@/lib/dataRoom";

/**
 * The Data Room: sources about the firm (files, websites, notes), each read by
 * process-data-room-source, and the Company Brief compiled from them by
 * build-data-room-brief. Everyone approved reads; admins write (RLS enforces it).
 *
 * The tables are newer than the generated types, hence the `as never` casts —
 * the same approach as useDealDocuments.
 */

export const DATA_ROOM_BUCKET = "data-room";
export const MAX_DATA_ROOM_FILE_BYTES = 50 * 1024 * 1024;
export const DATA_ROOM_ACCEPT = ".pdf,.docx,.pptx,.xlsx,.xlsm,.xls,.csv,.tsv,.txt,.md";

const SOURCES_KEY = ["data_room_sources"];
const BRIEF_KEY = ["data_room_brief"];

export function useDataRoomSources() {
  return useQuery({
    queryKey: SOURCES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_room_sources" as never)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DataRoomSource[];
    },
    // Poll only while something is being read; the read runs server-side.
    refetchInterval: (q) =>
      (q.state.data as DataRoomSource[] | undefined)?.some((s) => sourceState(s) === "reading") ? 3000 : false,
    refetchIntervalInBackground: true,
  });
}

export function useDataRoomBrief() {
  return useQuery({
    queryKey: BRIEF_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_room_brief" as never)
        .select("content,source_ids,model,built_at,edited_at")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as DataRoomBrief | null;
    },
  });
}

/** Pull the real message out of a FunctionsHttpError, which hides the body. */
async function invokeError(error: unknown): Promise<Error> {
  try {
    const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context?.json?.();
    if (body?.error) return new Error(body.error);
  } catch {
    // fall through
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Ask the function to read a source. If the request never reaches it the row
 * would sit at 'pending' forever, so mark it failed here; a 409 means a read is
 * already running, which is not a failure.
 */
async function startProcessing(sourceId: string) {
  const { error } = await supabase.functions.invoke("process-data-room-source", { body: { source_id: sourceId } });
  if (!error) return;
  const status = (error as { context?: { status?: number } })?.context?.status;
  const err = await invokeError(error);
  if (status !== 409) {
    await supabase
      .from("data_room_sources" as never)
      .update({ status: "failed", error: `Could not start reading: ${err.message}` } as never)
      .eq("id", sourceId)
      .eq("status", "pending");
  }
  throw err;
}

async function insertSource(row: Record<string, unknown>): Promise<string> {
  if (keptOutOfBrief(String(row.category))) row = { ...row, include_in_brief: false };
  const { data, error } = await supabase
    .from("data_room_sources" as never)
    .insert(row as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as unknown as { id: string }).id;
}

export function useAddDataRoomFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, category }: { file: File; category: DataRoomCategory }) => {
      const key = `${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from(DATA_ROOM_BUCKET)
        .upload(key, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;
      let id: string;
      try {
        id = await insertSource({
          kind: "file",
          title: file.name,
          category,
          storage_path: key,
          file_name: file.name,
          file_size: file.size,
          content_type: file.type || null,
        });
      } catch (e) {
        await supabase.storage.from(DATA_ROOM_BUCKET).remove([key]);
        throw e;
      }
      qc.invalidateQueries({ queryKey: SOURCES_KEY });
      await startProcessing(id);
      return id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

export function useAddDataRoomWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ url, category }: { url: string; category: DataRoomCategory }) => {
      const id = await insertSource({ kind: "website", title: url, category, url });
      qc.invalidateQueries({ queryKey: SOURCES_KEY });
      await startProcessing(id);
      return id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

export function useSaveDataRoomNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (note: { id?: string; title: string; body: string; category: DataRoomCategory }) => {
      let id = note.id;
      if (id) {
        const { error } = await supabase
          .from("data_room_sources" as never)
          .update({
            title: note.title,
            body: note.body,
            category: note.category,
            status: "pending",
            ...(keptOutOfBrief(note.category) ? { include_in_brief: false } : {}),
          } as never)
          .eq("id", id);
        if (error) throw error;
      } else {
        id = await insertSource({ kind: "note", title: note.title, body: note.body, category: note.category });
      }
      qc.invalidateQueries({ queryKey: SOURCES_KEY });
      await startProcessing(id);
      return id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

export function useUpdateDataRoomSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string } & Partial<Pick<DataRoomSource, "title" | "category" | "include_in_brief">>) => {
      if (fields.category && keptOutOfBrief(fields.category)) fields = { ...fields, include_in_brief: false };
      const { error } = await supabase.from("data_room_sources" as never).update(fields as never).eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

export function useReprocessDataRoomSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startProcessing,
    onSettled: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

export function useDeleteDataRoomSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: DataRoomSource) => {
      if (s.storage_path) {
        const { error } = await supabase.storage.from(DATA_ROOM_BUCKET).remove([s.storage_path]);
        if (error) throw error;
      }
      // Its passages go with it (ON DELETE CASCADE).
      const { error } = await supabase.from("data_room_sources" as never).delete().eq("id", s.id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

export async function getDataRoomFileUrl(storagePath: string, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage.from(DATA_ROOM_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export function useBuildDataRoomBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("build-data-room-brief", { body: {} });
      if (error) throw await invokeError(error);
      return data as DataRoomBrief;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BRIEF_KEY }),
  });
}

/** A hand edit keeps the brief's source list, so staleness still tracks the library. */
export function useSaveDataRoomBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ content, userId }: { content: string; userId: string | undefined }) => {
      const { error } = await supabase
        .from("data_room_brief" as never)
        .update({ content, edited_at: new Date().toISOString(), edited_by: userId ?? null } as never)
        .eq("id", 1);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BRIEF_KEY }),
  });
}

export function useSearchDataRoom(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["search_data_room", q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_data_room" as never, { _query: q, _limit: 12 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as DataRoomHit[];
    },
  });
}
