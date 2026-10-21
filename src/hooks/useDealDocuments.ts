import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { persistDealScore } from "@/lib/persistDealScore";
import type { DocumentSummary } from "@/components/DealDocumentSummary";

/**
 * Deal documents (OM / rent roll / T12) and the field proposals parsed out of
 * them. The parse runs in the parse-deal-document edge function; nothing here
 * writes to the deal except useApplyDealProposals, which goes through
 * apply_deal_document_proposals().
 *
 * The tables are newer than the generated types, hence the `as never` casts —
 * the same approach as useDealFieldEvents.
 */

export const DEAL_DOCUMENTS_BUCKET = "deal-documents";
export const MAX_DEAL_DOCUMENT_BYTES = 50 * 1024 * 1024;

export type DealDocument = {
  id: string;
  deal_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  content_type: string | null;
  uploaded_by: string | null;
  doc_type: "om" | "rent_roll" | "t12" | "other" | null;
  doc_as_of: string | null;
  doc_property_name: string | null;
  /** Read out of extraction; see checkDocumentAgainstDeal. */
  doc_unit_count: number | null;
  doc_address: string | null;
  parse_status: "pending" | "parsing" | "parsed" | "failed";
  parse_error: string | null;
  parse_notes: string | null;
  summary: DocumentSummary | null;
  /** The full breakdown, read after the headline figures are saved. */
  detail_status: "reading" | "done" | "failed" | "skipped" | null;
  parse_started_at: string | null;
  parsed_at: string | null;
  created_at: string;
};

/**
 * A read older than this was killed, not slow: the edge runtime stops a request
 * at 400 s without an error. Matches STALE_PARSE_MS in parse-deal-document,
 * which lets a stale row be claimed again.
 */
export const STALE_READ_MS = 7 * 60_000;

const startedLongAgo = (d: DealDocument) =>
  !d.parse_started_at || Date.now() - new Date(d.parse_started_at).getTime() > STALE_READ_MS;

/** Where a document's read stands, including a run that died without saying so. */
export function readState(d: DealDocument): "reading" | "breakdown" | "stopped" | "breakdown_stopped" | "done" | "failed" {
  if (d.parse_status === "failed") return "failed";
  if (d.parse_status === "pending" || d.parse_status === "parsing") return startedLongAgo(d) && d.parse_status === "parsing" ? "stopped" : "reading";
  if (d.detail_status === "reading") return startedLongAgo(d) ? "breakdown_stopped" : "breakdown";
  return "done";
}

export type DealDocumentProposal = {
  id: string;
  deal_id: string;
  document_id: string;
  field: string;
  value: number;
  previous_value: number | null;
  evidence: string | null;
  rank: number;
  status: "pending" | "applied" | "dismissed" | "superseded";
  created_at: string;
};

const docsKey = (dealId: string) => ["deal_documents", dealId];
const proposalsKey = (dealId: string) => ["deal_document_proposals", dealId];

export function useDealDocuments(dealId: string | undefined) {
  return useQuery({
    queryKey: docsKey(dealId ?? ""),
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_documents" as never)
        // Two values from extraction, not the whole column: a rent roll's is the
        // full unit-by-unit transcription.
        .select("id,deal_id,storage_path,file_name,file_size,content_type,uploaded_by,doc_type,doc_as_of,doc_property_name,doc_unit_count:extraction->figures->unit_count->value,doc_address:extraction->>property_address,parse_status,parse_error,parse_notes,parse_started_at,parsed_at,created_at,summary,detail_status")
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DealDocument[];
    },
    // Poll only while something is being read; the parse runs server-side.
    // Keep polling when the tab is unfocused: people switch away during a
    // 30-second read, and the panel otherwise sat on "Reading…" until refocus.
    refetchInterval: (q) =>
      (q.state.data as DealDocument[] | undefined)?.some((d) => {
        const s = readState(d);
        return s === "reading" || s === "breakdown";
      })
        ? 3000
        : false,
    refetchIntervalInBackground: true,
  });
}

export function usePendingDealProposals(dealId: string | undefined) {
  return useQuery({
    queryKey: proposalsKey(dealId ?? ""),
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_document_proposals" as never)
        .select("id,deal_id,document_id,field,value,previous_value,evidence,rank,status,created_at")
        .eq("deal_id", dealId!)
        .eq("status", "pending")
        .order("rank", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DealDocumentProposal[];
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
 * Ask the function to read a document. If the request never reaches it (offline,
 * CORS, function down) the row would sit at 'pending' — shown as "Reading…" with
 * retry disabled — forever, so mark it failed here. A 409 means a parse is
 * already running, which is not a failure.
 */
async function startParse(documentId: string) {
  const { error } = await supabase.functions.invoke("parse-deal-document", { body: { document_id: documentId } });
  if (!error) return;
  const status = (error as { context?: { status?: number } })?.context?.status;
  const err = await invokeError(error);
  if (status !== 409) {
    await supabase
      .from("deal_documents" as never)
      .update({ parse_status: "failed", parse_error: `Could not start reading: ${err.message}` } as never)
      .eq("id", documentId)
      .eq("parse_status", "pending");
  }
  throw err;
}

export function useUploadDealDocument(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const key = `${dealId}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from(DEAL_DOCUMENTS_BUCKET)
        .upload(key, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;

      const { data, error } = await supabase
        .from("deal_documents" as never)
        .insert({
          deal_id: dealId,
          storage_path: key,
          file_name: file.name,
          file_size: file.size,
          content_type: file.type || null,
        } as never)
        .select("id")
        .single();
      if (error) {
        await supabase.storage.from(DEAL_DOCUMENTS_BUCKET).remove([key]);
        throw error;
      }
      const id = (data as unknown as { id: string }).id;
      qc.invalidateQueries({ queryKey: docsKey(dealId) });
      await startParse(id);
      return id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: docsKey(dealId) }),
  });
}

export function useReparseDealDocument(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startParse,
    onSettled: () => qc.invalidateQueries({ queryKey: docsKey(dealId) }),
  });
}

export function useDeleteDealDocument(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (doc: DealDocument) => {
      const { error: stErr } = await supabase.storage.from(DEAL_DOCUMENTS_BUCKET).remove([doc.storage_path]);
      if (stErr) throw stErr;
      // Its proposals go with it (ON DELETE CASCADE); applied values stay on the deal.
      const { error } = await supabase.from("deal_documents" as never).delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: docsKey(dealId) });
      qc.invalidateQueries({ queryKey: proposalsKey(dealId) });
    },
  });
}

export async function getDealDocumentUrl(storagePath: string, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage
    .from(DEAL_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

/** Write the chosen proposals to the deal, then rescore it like any other edit. */
export function useApplyDealProposals(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (proposalIds: string[]) => {
      const { data, error } = await supabase.rpc("apply_deal_document_proposals" as never, {
        _proposal_ids: proposalIds,
      } as never);
      if (error) throw error;

      const { data: fresh, error: reErr } = await supabase.from("deals").select("*").eq("id", dealId).maybeSingle();
      if (reErr) throw reErr;
      if (fresh) {
        try {
          await persistDealScore(fresh);
        } catch (e) {
          console.error("[useApplyDealProposals] rescore failed", e);
        }
      }
      return data as unknown as number;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: proposalsKey(dealId) });
      qc.invalidateQueries({ queryKey: ["deals", dealId] });
      qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useDismissDealProposals(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (proposalIds: string[]) => {
      const { error } = await supabase
        .from("deal_document_proposals" as never)
        .update({ status: "dismissed", decided_at: new Date().toISOString() } as never)
        .in("id", proposalIds)
        .eq("status", "pending");
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: proposalsKey(dealId) }),
  });
}
