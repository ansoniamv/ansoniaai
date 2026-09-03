import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PipelineExport = {
  id: string;
  partner_id: string;
  exported_by: string | null;
  exported_at: string;
  deal_ids: string[];
  deal_count: number;
  format: "pdf";
  included_outside: boolean;
  included_score: boolean;
};

/** Most recent share for a partner, for the "Pipeline shared" line on PartnerDetail. */
export function useLastPipelineExport(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["partner_pipeline_exports", partnerId],
    enabled: !!partnerId,
    queryFn: async (): Promise<(PipelineExport & { exporter_name: string | null }) | null> => {
      const { data, error } = await (supabase as any)
        .from("partner_pipeline_exports")
        .select("*")
        .eq("partner_id", partnerId!)
        .order("exported_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      let exporter_name: string | null = null;
      if (data.exported_by) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name,email")
          .eq("id", data.exported_by)
          .maybeSingle();
        exporter_name = prof?.full_name || prof?.email || null;
      }
      return { ...(data as PipelineExport), exporter_name };
    },
  });
}

export function useLogPipelineExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      partner_id: string;
      deal_ids: string[];
      included_outside: boolean;
      included_score: boolean;
    }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("partner_pipeline_exports").insert({
        partner_id: input.partner_id,
        exported_by: auth.user?.id ?? null,
        deal_ids: input.deal_ids,
        deal_count: input.deal_ids.length,
        format: "pdf",
        included_outside: input.included_outside,
        included_score: input.included_score,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["partner_pipeline_exports", vars.partner_id] });
    },
  });
}
