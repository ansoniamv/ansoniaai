import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type RoadmapStatus = "shipped" | "in_progress" | "planned" | "idea";
export type RoadmapPriority = "P0" | "P1" | "P2" | "P3";

export type RoadmapItem = {
  id: string;
  title: string;
  description: string | null;
  phase: string;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  completion_rule: unknown | null;
  auto_completed: boolean;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type RoadmapItemInput = {
  title: string;
  description?: string | null;
  phase: string;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  sort_order?: number;
};

const QK = ["roadmap_items"] as const;

async function logEvent(args: {
  item_id: string;
  event_type: string;
  from_status?: string | null;
  to_status?: string | null;
  detail?: string | null;
  actor?: string | null;
}) {
  await supabase.from("roadmap_events").insert(args);
}

export function useRoadmap() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const actor = user?.email ?? "unknown";

  const query = useQuery({
    queryKey: QK,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roadmap_items")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RoadmapItem[];
    },
  });

  const eventsQuery = useQuery({
    queryKey: ["roadmap_events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roadmap_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("roadmap_items_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roadmap_items" },
        () => qc.invalidateQueries({ queryKey: QK }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roadmap_events" },
        () => qc.invalidateQueries({ queryKey: ["roadmap_events"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);


  const createItem = useMutation({
    mutationFn: async (input: RoadmapItemInput) => {
      const { data, error } = await supabase
        .from("roadmap_items")
        .insert({
          ...input,
          completed_at: input.status === "shipped" ? new Date().toISOString() : null,
        })
        .select()
        .single();
      if (error) throw error;
      await logEvent({
        item_id: data.id,
        event_type: "status_changed",
        from_status: null,
        to_status: input.status,
        actor,
        detail: `Created as ${input.status}`,
      });
      return data as RoadmapItem;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const updateItem = useMutation({
    mutationFn: async (input: { id: string; prev: RoadmapItem; patch: Partial<RoadmapItemInput> }) => {
      const { id, prev, patch } = input;
      const statusChanged = patch.status && patch.status !== prev.status;
      const updatePayload: Record<string, unknown> = { ...patch };
      if (statusChanged) {
        updatePayload.completed_at = patch.status === "shipped" ? new Date().toISOString() : null;
        updatePayload.auto_completed = false;
      }
      const { data, error } = await supabase
        .from("roadmap_items")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      if (statusChanged) {
        await logEvent({
          item_id: id,
          event_type: patch.status === "shipped" ? "marked_shipped" : "status_changed",
          from_status: prev.status,
          to_status: patch.status!,
          actor,
        });
      }
      return data as RoadmapItem;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("roadmap_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  return {
    items: query.data ?? [],
    events: eventsQuery.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createItem,
    updateItem,
    deleteItem,
  };
}

