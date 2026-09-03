import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";


export const RAISE_STAGES = [
  "Identified",
  "Contacted",
  "Meeting Scheduled",
  "Term Sheet",
  "Committed",
  "Closed",
] as const;

export type RaiseStage = typeof RAISE_STAGES[number];

export type CapitalRaiseEntry = {
  id: string;
  deal_id: string;
  partner_id: string;
  stage: string;
  equity_amount: number | null;
  assigned_poc: string | null;
  last_activity_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // joined
  partner_name?: string;
  deal_name?: string;
};

export function useCapitalRaiseByDeal(dealId: string | undefined) {
  return useQuery({
    queryKey: ["capital-raise", "deal", dealId],
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("capital_raise_entries")
        .select("*, partners(name), deals(property_name)")
        .eq("deal_id", dealId!)
        .order("created_at");
      if (error) throw error;
      return data.map((d: any) => ({
        ...d,
        partner_name: d.partners?.name,
        deal_name: d.deals?.property_name,
      })) as CapitalRaiseEntry[];
    },
  });
}

export function useCapitalRaiseByPartner(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["capital-raise", "partner", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("capital_raise_entries")
        .select("*, partners(name), deals(property_name)")
        .eq("partner_id", partnerId!)
        .order("created_at");
      if (error) throw error;
      return data.map((d: any) => ({
        ...d,
        partner_name: d.partners?.name,
        deal_name: d.deals?.property_name,
      })) as CapitalRaiseEntry[];
    },
  });
}

export function useAllCapitalRaise() {
  return useQuery({
    queryKey: ["capital-raise"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("capital_raise_entries")
        .select("*, partners(name), deals(property_name)")
        .order("created_at");
      if (error) throw error;
      return data.map((d: any) => ({
        ...d,
        partner_name: d.partners?.name,
        deal_name: d.deals?.property_name,
      })) as CapitalRaiseEntry[];
    },
  });
}

export function useCreateCapitalRaise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: { deal_id: string; partner_id: string; stage?: string; equity_amount?: number; assigned_poc?: string; notes?: string }) => {
      const { data, error } = await supabase
        .from("capital_raise_entries")
        .insert(entry)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capital-raise"] }),
  });
}

export function useUpdateCapitalRaise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; stage?: string; equity_amount?: number | null; assigned_poc?: string | null; notes?: string | null; last_activity_date?: string }) => {
      const { data, error } = await supabase
        .from("capital_raise_entries")
        .update({ ...updates, last_activity_date: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capital-raise"] }),
  });
}

export function useDeleteCapitalRaise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("capital_raise_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capital-raise"] }),
  });
}

/* ---------------- Raise archiving (reversible) ----------------
 * Archiving a raise is a visibility + read-only action on the deal row.
 * No engagement, amount, pass reason or note is ever deleted — restore
 * clears the three columns and the raise returns exactly as it was.
 */

function invalidateRaise(qc: ReturnType<typeof useQueryClient>, dealId: string) {
  qc.invalidateQueries({ queryKey: ["capital-raise-page"] });
  qc.invalidateQueries({ queryKey: ["capital-raise"] });
  qc.invalidateQueries({ queryKey: ["deals"] });
  qc.invalidateQueries({ queryKey: ["deals", dealId] });
}

export type ArchiveRaiseVars = {
  dealId: string;
  note?: string | null;
  finalStatus?: "raising" | "fully_committed" | "closed";
  /** Suppress the built-in toast (e.g. when the caller shows its own). */
  silent?: boolean;
};

export function useRestoreRaise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId }: { dealId: string; silent?: boolean }) => {
      const { error } = await (supabase as any)
        .from("deals")
        .update({
          raise_status: "raising",
          raise_archived_at: null,
          raise_archived_by: null,
          raise_archive_note: null,
        })
        .eq("id", dealId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      invalidateRaise(qc, v.dealId);
      if (!v.silent) toast.success("Raise restored to active");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not restore the raise"),
  });
}

export function useArchiveRaise() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const restore = useRestoreRaise();
  return useMutation({
    mutationFn: async ({ dealId, note, finalStatus }: ArchiveRaiseVars) => {
      const updates: Record<string, any> = {
        raise_archived_at: new Date().toISOString(),
        raise_archived_by: profile?.email ?? null,
        raise_archive_note: note?.trim() || null,
      };
      if (finalStatus) updates.raise_status = finalStatus;
      const { error } = await (supabase as any).from("deals").update(updates).eq("id", dealId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      invalidateRaise(qc, v.dealId);
      if (!v.silent) {
        toast.success("Raise archived", {
          action: { label: "Undo", onClick: () => restore.mutate({ dealId: v.dealId }) },
        });
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not archive the raise"),
  });
}
