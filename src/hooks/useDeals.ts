import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { DEAL_LIST_COLUMNS } from "@/lib/dealColumns";
import { persistDealScore, rescoreAllDeals } from "@/lib/persistDealScore";

async function scoreAfterWrite<T extends { id: string }>(row: T): Promise<T> {
  try {
    const fields = await persistDealScore(row as never);
    return { ...row, ...fields };
  } catch (e) {
    console.error("[useDeals] persistDealScore failed (non-fatal)", e);
    return row;
  }
}

export type Deal = Tables<"deals">;


export function useDeals() {
  return useQuery({
    queryKey: ["deals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select(DEAL_LIST_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as Deal[];
    },
  });
}


export function useDeal(id: string | undefined) {
  return useQuery({
    queryKey: ["deals", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deal: Partial<Deal> & { property_name: string; status: Deal["status"] }) => {
      const { data, error } = await supabase
        .from("deals")
        .insert(deal)
        .select()
        .single();
      if (error) throw error;

      // Fire-and-forget address enrichment + schools lookup so new deals get
      // demographics and school data without a manual click. Schools need
      // lat/lon written by esri-enrich, so chain them.
      const address = [data.city, data.state].filter(Boolean).join(", ");
      if (address) {
        supabase.functions
          .invoke("esri-enrich", { body: { deal_id: data.id, address } })
          .then(({ error: enrichErr }) => {
            if (enrichErr) {
              console.error("esri-enrich error:", enrichErr);
              return;
            }
            supabase.functions
              .invoke("schools-enrich", { body: { deal_id: data.id } })
              .then(({ error: schErr }) => {
                if (schErr) console.error("schools-enrich error:", schErr);
              });
          });
      }

      return await scoreAfterWrite(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

// Compare what we asked the database to store against what it handed back.
// Loose on shape (numeric 51.25 vs "51.25"), strict on "did the value change".
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return String(a) === String(b);
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...deal }: Partial<Deal> & { id: string }) => {
      const { data, error } = await supabase
        .from("deals")
        .update(deal)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      // A write can come back 200 and still not stick — a column the API role
      // can't write, a stale PostgREST schema cache, or a trigger that rewrites
      // the value. Trusting the status code is how an edit silently reverts on
      // the next refetch. Compare the echoed row field by field instead.
      const rejected = Object.keys(deal).filter(
        (k) => !sameValue((data as Record<string, unknown>)?.[k], (deal as Record<string, unknown>)[k])
      );
      if (rejected.length) {
        const detail = rejected
          .map((k) => `${k}: asked ${JSON.stringify((deal as Record<string, unknown>)[k])}, stored ${JSON.stringify((data as Record<string, unknown>)?.[k])}`)
          .join("; ");
        throw new Error(`The database did not keep this edit — ${detail}`);
      }

      return await scoreAfterWrite(data);
    },
    // Optimistic write: paint the new value immediately and roll it back only
    // if the database actually refuses it.
    onMutate: async ({ id, ...deal }: Partial<Deal> & { id: string }) => {
      await queryClient.cancelQueries({ queryKey: ["deals"] });
      const prevList = queryClient.getQueryData<Deal[]>(["deals"]);
      const prevOne = queryClient.getQueryData<Deal>(["deals", id]);
      queryClient.setQueryData<Deal[]>(["deals"], (prev) =>
        prev ? prev.map((d) => (d.id === id ? ({ ...d, ...deal } as Deal) : d)) : prev
      );
      queryClient.setQueryData(["deals", id], (prev: Deal | undefined) =>
        prev ? ({ ...prev, ...deal } as Deal) : prev
      );
      return { prevList, prevOne, id };
    },
    onError: (_err, _vars, ctx) => {
      const c = ctx as { prevList?: Deal[]; prevOne?: Deal; id?: string } | undefined;
      if (!c) return;
      if (c.prevList) queryClient.setQueryData(["deals"], c.prevList);
      if (c.prevOne && c.id) queryClient.setQueryData(["deals", c.id], c.prevOne);
    },
    onSuccess: (data) => {
      // Patch the cached list immediately: an invalidate alone can leave the
      // table showing the pre-edit value until the next refetch.
      queryClient.setQueryData<Deal[]>(["deals"], (prev) =>
        prev ? prev.map((d) => (d.id === data.id ? { ...d, ...data } : d)) : prev
      );
      queryClient.setQueryData(["deals", data.id], (prev: Deal | undefined) =>
        prev ? { ...prev, ...data } : prev
      );
      queryClient.invalidateQueries({ queryKey: ["deals"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["deals", data.id], refetchType: "all" });
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("deals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useRescoreAllDeals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rescoreAllDeals(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}
