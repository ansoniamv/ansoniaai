import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PropertySnapshot = {
  resolved: {
    property_name: string;
    address: string;
    confidence: "high" | "medium" | "low";
    notes: string;
  };
  physical: {
    year_built: string;
    units: string;
    stories: string;
    unit_types: string[];
    sqft_range: string;
  };
  rents: {
    summary: string;
    one_bed_from: string;
    two_bed_from: string;
    three_bed_from: string;
    below_market_signal: string;
  };
  market_signals: { signal: string; detail: string; source_url: string }[];
  ownership: {
    owner_entity: string;
    management_company: string;
    contact: string;
    source_url: string;
  };
  sentiment: { summary: string; positives: string[]; negatives: string[] };
  buybox_fit: { verdict: "strong" | "possible" | "weak" | "unknown"; reasons: string[] };
  could_not_verify: string[];
  sources: { title: string; url: string }[];
};

export type PropertyResearchResult = {
  snapshot: PropertySnapshot;
  model: string;
  generated_at: string;
};

export function usePropertyResearch() {
  return useMutation({
    mutationFn: async (args: { address?: string; property_name?: string; deal_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("property-research", {
        body: args,
      });
      // FunctionsHttpError hides the response body — pull it out so we surface the real message.
      if (error) {
        let msg = error.message;
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch {
          // ignore — fall back to the SDK-provided message
        }
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as PropertyResearchResult;
    },
    onError: (e: Error) => toast.error(e.message, { duration: 8000 }),
  });
}
