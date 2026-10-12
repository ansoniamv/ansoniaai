// src/hooks/usePropertyResearch.ts
//
// Starts a research job and follows it to completion over Supabase realtime,
// with a polling fallback. The mutation resolves when the job finishes, so the
// calling component can keep using `isPending` for its spinner.

import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

// --- snapshot shape (mirrors SNAPSHOT_SCHEMA in the edge function) ----------

type Sourced<T> = T & { source_url: string };

export type PropertySnapshot = {
  resolved: {
    property_name: string;
    address: string;
    confidence: "high" | "medium" | "low";
    notes: string;
    also_known_as: string[];
  };
  physical: {
    year_built: string;
    year_renovated: string;
    units: string;
    stories: string;
    unit_types: string[];
    sqft_range: string;
    amenities: string[];
    construction_type: string;
  };
  rents: {
    summary: string;
    one_bed_from: string;
    two_bed_from: string;
    three_bed_from: string;
    concessions: string;
    below_market_signal: string;
    renovated_premium: string;
  };
  resident_sentiment: {
    summary: string;
    platforms: Sourced<{ platform: string; rating: string; review_count: string; recency: string }>[];
    recurring_complaints: Sourced<{
      theme: string;
      frequency: "isolated" | "repeated" | "dominant";
      capex_implication: string;
    }>[];
    recurring_praise: string[];
    management_responsiveness: string;
    sentiment_trend: "improving" | "stable" | "declining" | "unknown";
  };
  ownership: {
    owner_entity: string;
    parent_sponsor: string;
    management_company: string;
    acquired: string;
    hold_period_signal: string;
    contact: string;
    other_properties: string[];
  };
  debt_and_distress: {
    summary: string;
    signals: Sourced<{
      signal: string; detail: string; date: string;
      severity: "informational" | "notable" | "material";
    }>[];
  };
  news_mentions: Sourced<{
    headline: string; date: string; publication: string; why_it_matters: string;
    category: "transaction" | "litigation" | "crime_safety" | "development" | "regulatory" | "operations" | "community" | "other";
  }>[];
  legal_and_regulatory: {
    summary: string;
    items: Sourced<{ item: string; detail: string; status: string }>[];
  };
  submarket: {
    summary: string;
    major_employers: string[];
    employment_news: string;
    new_supply: string;
    infrastructure: string;
    schools: string;
    safety: string;
  };
  competitive_set: Sourced<{
    name: string; distance: string; year_built: string;
    units: string; asking_rents: string; positioning: string;
  }>[];
  overlooked: Sourced<{
    finding: string; why_it_matters: string;
    impact: "opportunity" | "risk" | "context";
  }>[];
  buybox_fit: {
    verdict: "strong" | "possible" | "weak" | "unknown";
    criterion_reads: { criterion: string; read: "pass" | "fail" | "unknown"; evidence: string }[];
    reasons: string[];
  };
  diligence_questions: string[];
  could_not_verify: string[];
  sources: { title: string; url: string; used_for: string }[];
};

export type ResearchDepth = "quick" | "standard" | "deep";

export type PropertyResearchResult = {
  snapshot: PropertySnapshot;
  model: string | null;
  generated_at: string;
  cached: boolean;
  cost_usd: number | null;
};

type StartArgs = {
  address?: string;
  property_name?: string;
  deal_id?: string;
  depth?: ResearchDepth;
  force?: boolean;
};

const POLL_MS = 4000;
const MAX_WAIT_MS = 15 * 60 * 1000;

/** What the edge function returns when a run is started (or served warm). */
type StartResponse = {
  job_id?: string;
  status?: string;
  cached?: boolean;
  snapshot?: PropertySnapshot;
  model?: string | null;
  generated_at?: string;
  already_running?: boolean;
  error?: string;
};

/** The job row, as the realtime channel and the poll both deliver it. */
type JobRow = Tables<"property_research_jobs">;

/**
 * `snapshot` is jsonb, so the generated types expose it as the opaque `Json`.
 * Postgres cannot tell us its shape, and no change to PropertySnapshot can
 * close that gap — the assertion belongs here, at the one boundary where the
 * database hands it over, rather than being spread across every read site.
 *
 * The shape itself is enforced upstream: the edge function constrains the
 * model with SNAPSHOT_SCHEMA before the row is ever written.
 */
const asSnapshot = (v: unknown) => v as PropertySnapshot;

/** Pull the real error body out of a FunctionsHttpError. */
async function readFunctionError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return body.error;
    }
  } catch { /* fall through */ }
  return (error as { message?: string })?.message ?? "Research failed.";
}

export function usePropertyResearch() {
  const [progress, setProgress] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (args: StartArgs): Promise<PropertyResearchResult> => {
      setProgress("Queueing…");
      setJobId(null);

      const { data: raw, error } = await supabase.functions.invoke("property-research", { body: args });
      const data = raw as StartResponse | null;
      if (error) throw new Error(await readFunctionError(error));
      if (data?.error) throw new Error(data.error);

      // A recent snapshot already existed — nothing was spent.
      if (data?.cached && data.snapshot) {
        setProgress(null);
        return {
          snapshot: data.snapshot,
          model: data.model ?? null,
          generated_at: data.generated_at ?? new Date().toISOString(),
          cached: true,
          cost_usd: null,
        };
      }

      const id = data?.job_id;
      if (!id) throw new Error("No job was created.");
      setJobId(id);
      setProgress("Starting research…");

      return await waitForJob(id, setProgress);
    },
    onError: (e: Error) => {
      setProgress(null);
      toast.error(e.message, { duration: 10000 });
    },
    onSuccess: () => setProgress(null),
  });

  const cancel = useCallback(async () => {
    if (!jobId) return;
    await supabase.from("property_research_jobs")
      .update({ status: "cancelled" }).eq("id", jobId);
    setProgress(null);
  }, [jobId]);

  return { ...mutation, progress, jobId, cancel };
}

/**
 * Resolve when the job row reaches a terminal state. Realtime is the fast path;
 * the poll is there because a dropped socket must not strand the user in front
 * of a spinner forever.
 */
function waitForJob(
  jobId: string,
  onProgress: (note: string | null) => void,
): Promise<PropertyResearchResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      clearTimeout(timeout);
      supabase.removeChannel(channel);
      fn();
    };

    const handle = (row: JobRow | null) => {
      if (!row) return;
      if (row.progress) onProgress(row.progress);

      if (row.status === "succeeded") {
        finish(() => resolve({
          snapshot: asSnapshot(row.snapshot),
          model: row.model ?? null,
          generated_at: row.finished_at ?? new Date().toISOString(),
          cached: false,
          cost_usd: row.cost_usd != null ? Number(row.cost_usd) : null,
        }));
      } else if (row.status === "failed") {
        finish(() => reject(new Error(row.error || "Research failed.")));
      } else if (row.status === "cancelled") {
        finish(() => reject(new Error("Research was cancelled.")));
      }
    };

    const channel = supabase
      .channel(`research-job-${jobId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "property_research_jobs",
        filter: `id=eq.${jobId}`,
      }, (payload) => handle(payload.new as JobRow))
      .subscribe();

    const poller = setInterval(async () => {
      const { data } = await supabase
        .from("property_research_jobs").select("*").eq("id", jobId).maybeSingle();
      handle(data);
    }, POLL_MS);

    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Research is taking unusually long. Check back shortly — the job is still running in the background.")));
    }, MAX_WAIT_MS);
  });
}

/** Previously saved snapshots for a deal, newest first. */
export function usePriorResearch(dealId?: string) {
  const [rows, setRows] = useState<
    { id: string; snapshot: PropertySnapshot; created_at: string; model: string | null; cost_usd: number | null }[]
  >([]);

  useEffect(() => {
    if (!dealId) return;
    let active = true;
    supabase
      .from("property_research")
      .select("id, snapshot, created_at, model, cost_usd")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (active && data) {
          setRows(data.map((r) => ({ ...r, snapshot: asSnapshot(r.snapshot) })));
        }
      });
    return () => { active = false; };
  }, [dealId]);

  return rows;
}
