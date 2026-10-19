import { useEffect, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ChangeRequestType = "bug" | "change" | "feature";
export type ChangeRequestStatus = "new" | "queued" | "in_progress" | "done" | "declined";

export type ChangeRequest = {
  id: string;
  title: string;
  request_type: ChangeRequestType;
  page_label: string | null;
  page_path: string | null;
  current_behavior: string | null;
  desired_behavior: string;
  reason: string | null;
  status: ChangeRequestStatus;
  admin_notes: string | null;
  roadmap_item_id: string | null;
  submitted_by: string;
  submitter_email: string | null;
  created_at: string;
  updated_at: string;
};

export type ChangeRequestInput = {
  title: string;
  request_type: ChangeRequestType;
  page_label?: string | null;
  page_path?: string | null;
  current_behavior?: string | null;
  desired_behavior: string;
  reason?: string | null;
};

export type ChangeRequestPatch = Partial<Pick<ChangeRequest, "status" | "admin_notes" | "roadmap_item_id">>;

const QK = ["roadmap_change_requests"] as const;

export function useChangeRequests() {
  const qc = useQueryClient();
  const { user } = useAuth();
  // supabase.channel() returns the existing channel when the name is taken, and adding
  // .on() to an already-subscribed channel throws. The hook mounts several times on
  // /roadmap (header dialog, panel, panel dialog), so each instance needs its own name.
  const channelId = useId();

  const query = useQuery({
    queryKey: QK,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roadmap_change_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChangeRequest[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`roadmap_change_requests_rt:${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roadmap_change_requests" },
        () => qc.invalidateQueries({ queryKey: QK }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, channelId]);

  const submitRequest = useMutation({
    mutationFn: async (input: ChangeRequestInput) => {
      const { data, error } = await supabase
        .from("roadmap_change_requests")
        .insert({ ...input, submitter_email: user?.email ?? null })
        .select()
        .single();
      if (error) throw error;
      return data as ChangeRequest;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const updateRequest = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ChangeRequestPatch }) => {
      const { data, error } = await supabase
        .from("roadmap_change_requests")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as ChangeRequest;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const deleteRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("roadmap_change_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  return {
    requests: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    submitRequest,
    updateRequest,
    deleteRequest,
  };
}
