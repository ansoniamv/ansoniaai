import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** A stored message plus the row's created_at, for the per-row timestamp. */
export type AtlasMessage = ChatMessage & { created_at?: string };

export function useThreads() {
  return useQuery({
    queryKey: ["chat_threads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_threads")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useThreadMessages(threadId: string | undefined) {
  return useQuery({
    queryKey: ["chat_messages", threadId],
    enabled: !!threadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("thread_id", threadId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      // created_at comes from the row, not the stored message blob, so the UI
      // can stamp each turn without the edge function writing one.
      return (data ?? []).map((r: any) => ({
        ...(r.message as ChatMessage),
        created_at: r.created_at as string | undefined,
      })) as AtlasMessage[];
    },
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("chat_threads")
        .insert({})
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat_threads"] }),
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chat_threads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat_threads"] }),
  });
}

/**
 * Streaming send.
 *
 * supabase.functions.invoke() buffers the whole response, so it cannot stream —
 * this goes direct to the function URL with the same credentials invoke would
 * have attached. The function still runs requireApprovedUser, so auth behaviour
 * is unchanged.
 */
export function useSendMessage() {
  const qc = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  // Abort on unmount — navigating away must not leave a reader running.
  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async ({ threadId, messages }: { threadId: string; messages: ChatMessage[] }) => {
      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      setStreamingText("");
      setStreamingStatus(null);
      setError(null);

      let aborted = false;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        const resp = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? SUPABASE_PUBLISHABLE_KEY}`,
            apikey: SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ thread_id: threadId, messages }),
          signal: controller.signal,
        });

        // Failures before the stream opens come back as plain JSON.
        if (!resp.ok || !resp.body) {
          let message = `Atlas failed (${resp.status}).`;
          try {
            const body = await resp.json();
            message = body?.error?.message ?? message;
          } catch {
            // Non-JSON body — keep the status message.
          }
          throw new Error(message);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        let streamError: string | null = null;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              let evt: any;
              try {
                evt = JSON.parse(payload);
              } catch {
                continue;
              }
              if (evt.type === "delta") {
                text += evt.text;
                setStreamingText(text);
                // First prose token means the tool phase is over.
                setStreamingStatus(null);
              } else if (evt.type === "status") {
                setStreamingStatus(statusLabel(evt.tool, evt.table));
              } else if (evt.type === "done") {
                setModel(evt.model);
              } else if (evt.type === "error") {
                streamError = evt.message ?? "Atlas failed.";
              }
            }
          }
        }

        if (streamError) throw new Error(streamError);

        // The rows are written server-side after a clean stream; refetch so the
        // stored copy replaces the live one.
        qc.invalidateQueries({ queryKey: ["chat_messages", threadId] });
        qc.invalidateQueries({ queryKey: ["chat_threads"] });
        return { text };
      } catch (e: any) {
        if (e?.name === "AbortError") {
          // Stopped deliberately. Keep whatever arrived; persist nothing.
          aborted = true;
          return { text: "", aborted: true };
        }
        setError(e?.message ?? "Atlas failed.");
        throw e;
      } finally {
        setIsStreaming(false);
        setStreamingStatus(null);
        if (!aborted) setStreamingText("");
        abortRef.current = null;
      }
    },
    [qc],
  );

  return { send, stop, isStreaming, streamingText, streamingStatus, error, setError, model };
}

/** "Querying deals…" reads better than a bare spinner during a tool round. */
function statusLabel(tool: string, table: string | null): string {
  if (tool === "query_table" && table) return `Querying ${table}…`;
  if (tool === "describe_table" && table) return `Reading ${table}…`;
  if (tool === "list_tables") return "Listing tables…";
  return "Working…";
}

/** "claude-opus-5" -> "Claude Opus 5", for the header badge. */
export function formatModelName(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return model
    .split("-")
    .map((part) => (/^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}
