import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PartnerTask = {
  id: string;
  partner_id: string;
  contact_id: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: "open" | "done" | string;
  priority: "low" | "normal" | "high" | string;
  assignee: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function usePartnerTasks(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["partner-tasks", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_tasks" as any)
        .select("*")
        .eq("partner_id", partnerId!)
        .order("status", { ascending: true })
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as PartnerTask[];
    },
  });
}

export function useCreatePartnerTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (task: Partial<PartnerTask> & { partner_id: string; title: string }) => {
      const { data, error } = await supabase
        .from("partner_tasks" as any)
        .insert(task as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as PartnerTask;
    },
    onSuccess: (t: any) => {
      qc.invalidateQueries({ queryKey: ["partner-tasks", t.partner_id] });
      qc.invalidateQueries({ queryKey: ["partner-tasks-open-all"] });
    },
  });
}

export function useUpdatePartnerTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<PartnerTask> & { id: string }) => {
      const { data, error } = await supabase
        .from("partner_tasks" as any)
        .update(patch as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as PartnerTask;
    },
    onSuccess: (t: any) => {
      qc.invalidateQueries({ queryKey: ["partner-tasks", t.partner_id] });
      qc.invalidateQueries({ queryKey: ["partner-tasks-open-all"] });
    },
  });
}

export function useDeletePartnerTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; partner_id: string }) => {
      const { error } = await supabase.from("partner_tasks" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_: any, v: any) => {
      qc.invalidateQueries({ queryKey: ["partner-tasks", v.partner_id] });
      qc.invalidateQueries({ queryKey: ["partner-tasks-open-all"] });
    },
  });
}

/** All open tasks across all partners — for dashboard/reminders badge. */
export function useAllOpenPartnerTasks() {
  return useQuery({
    queryKey: ["partner-tasks-open-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_tasks" as any)
        .select("*")
        .eq("status", "open")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as PartnerTask[];
    },
  });
}
