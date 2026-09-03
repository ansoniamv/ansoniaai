import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ChatMessage = { role: "user" | "assistant"; content: string };

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
      return (data ?? []).map((r: any) => r.message as ChatMessage);
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

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, messages }: { threadId: string; messages: ChatMessage[] }) => {
      const { data, error } = await supabase.functions.invoke("chat", {
        body: { thread_id: threadId, messages },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (data as { message: ChatMessage }).message;
    },
    onSuccess: (_m, vars) => {
      qc.invalidateQueries({ queryKey: ["chat_messages", vars.threadId] });
      qc.invalidateQueries({ queryKey: ["chat_threads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
