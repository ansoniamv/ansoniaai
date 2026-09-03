import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Pillar = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  weight: number;
  sort_order: number;
  is_active: boolean;
};

export type Signal = {
  id: string;
  pillar_id: string;
  name: string;
  description: string | null;
  field_source: string;
  scoring_method: "higher_better" | "lower_better" | "range_optimal" | "boolean";
  min_value: number | null;
  max_value: number | null;
  optimal_min: number | null;
  optimal_max: number | null;
  weight_within_pillar: number;
  is_active: boolean;
  sort_order: number;
};

export function useBuyBoxPillars() {
  const qc = useQueryClient();

  const pillars = useQuery({
    queryKey: ["buy_box_pillars"],
    queryFn: async () => {
      const { data, error } = await supabase.from("buy_box_pillars").select("*").order("sort_order");
      if (error) throw error;
      return data as Pillar[];
    },
  });

  const signals = useQuery({
    queryKey: ["buy_box_signals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("buy_box_signals").select("*").order("sort_order");
      if (error) throw error;
      return data as Signal[];
    },
  });

  const updatePillar = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Pillar> }) => {
      const { error } = await supabase.from("buy_box_pillars").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["buy_box_pillars"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateSignal = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Signal> }) => {
      const { error } = await supabase.from("buy_box_signals").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["buy_box_signals"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const addSignal = useMutation({
    mutationFn: async (s: Omit<Signal, "id">) => {
      const { error } = await supabase.from("buy_box_signals").insert(s);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["buy_box_signals"] });
      toast.success("Signal added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSignal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("buy_box_signals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["buy_box_signals"] });
      toast.success("Signal deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    pillars: pillars.data ?? [],
    signals: signals.data ?? [],
    isLoading: pillars.isLoading || signals.isLoading,
    updatePillar,
    updateSignal,
    addSignal,
    deleteSignal,
  };
}
