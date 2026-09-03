import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";

export type TeamMember = Tables<"team_members">;

export function useTeamMembers() {
  return useQuery({
    queryKey: ["team_members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .order("active", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TeamMember[];
    },
    staleTime: 60_000,
  });
}

export function useCreateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: { full_name: string; role?: string | null; email?: string | null; avatar_url?: string | null }) => {
      const { data, error } = await supabase.from("team_members").insert(m).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team_members"] }),
  });
}

export function useAssignInboxDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, assigned_to }: { id: string; assigned_to: string | null }) => {
      const { error } = await supabase.from("inbox_deals").update({ assigned_to }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox_deals_pipeline"] });
      qc.invalidateQueries({ queryKey: ["dashboard_inbox_deals"] });
    },
  });
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "??";
}

export function useCurrentTeamMember(): TeamMember | undefined {
  const { user } = useAuth();
  const { data: members } = useTeamMembers();
  const email = user?.email?.toLowerCase();
  if (!email || !members) return undefined;
  return members.find((m) => m.email?.toLowerCase() === email);
}
