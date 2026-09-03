import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useBuyBoxThesis() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["buy_box_thesis"],
    queryFn: async () => {
      const { data, error } = await supabase.from("buy_box_thesis").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase.from("buy_box_thesis").update({ content }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["buy_box_thesis"] });
      toast.success("Thesis saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { ...query, update };
}
