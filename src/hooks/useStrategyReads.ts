import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReadRow } from "@/lib/capitalIntelligence";

const KEY = ["partner_strategy_reads"];

/** Every partner's stored strategy read, by partner id. */
export function useStrategyReads() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("partner_strategy_reads").select("partner_id, reads, read_at");
      if (error) throw error;
      const m = new Map<string, ReadRow>();
      for (const r of data ?? []) m.set(r.partner_id, { reads: (r.reads ?? {}) as NonNullable<ReadRow>["reads"], read_at: r.read_at });
      return m;
    },
  });
}

export type RefreshResult = { processed: number; skipped: number; failed: number; remaining: number; halted?: string };

/**
 * Re-read every partner whose notes changed. The function stops before the
 * edge timeout and reports what is left, so this calls again until done.
 */
export function useRefreshStrategyReads(onProgress?: (done: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<RefreshResult> => {
      const total: RefreshResult = { processed: 0, skipped: 0, failed: 0, remaining: 0 };
      for (let round = 0; round < 8; round++) {
        const { data, error } = await supabase.functions.invoke("read-partner-strategies", { body: {} });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        total.processed += data.processed ?? 0;
        total.failed += data.failed ?? 0;
        total.skipped = data.skipped ?? 0;
        total.remaining = data.remaining ?? 0;
        onProgress?.(total.processed);
        qc.invalidateQueries({ queryKey: KEY });
        if (data.halted) return { ...total, halted: data.halted };
        if (!total.remaining) break;
      }
      return total;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
