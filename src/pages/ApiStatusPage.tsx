import { useEffect, useMemo, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Activity, Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import AiUsageDashboard from "@/components/AiUsageDashboard";

type Probe = {
  id: string;
  name: string;
  category: "connector" | "api" | "ai";
  status: "ok" | "degraded" | "down" | "unconfigured";
  latency_ms: number | null;
  detail: string;
  http_status?: number;
};

type Job = {
  id: string;
  name: string;
  schedule: string;
  last_success_at: string | null;
  detail?: string;
  stale?: boolean;
};

type StatusPayload = {
  ok: boolean;
  checked_at: string;
  probes: Probe[];
  jobs: Job[];
};

const STATUS_META: Record<Probe["status"], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: "Operational", cls: "text-emerald-600 bg-emerald-50 border-emerald-200", Icon: CheckCircle2 },
  degraded: { label: "Degraded", cls: "text-amber-700 bg-amber-50 border-amber-200", Icon: AlertTriangle },
  down: { label: "Down", cls: "text-red-700 bg-red-50 border-red-200", Icon: XCircle },
  unconfigured: { label: "Unconfigured", cls: "text-muted-foreground bg-muted/40 border-border", Icon: MinusCircle },
};

function relTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function jobFreshness(job: Job): "ok" | "stale" | "never" {
  if (!job.last_success_at) return "never";
  if (job.stale) return "stale";
  const ageMin = (Date.now() - new Date(job.last_success_at).getTime()) / 60000;
  const limit = job.schedule.includes("15 min") ? 45 : job.schedule.includes("30 min") ? 90 : job.schedule.includes("morning") ? 30 * 60 : 24 * 60;
  return ageMin > limit ? "stale" : "ok";
}

function latencyTone(ms: number | null): string {
  if (ms == null) return "text-muted-foreground";
  if (ms < 400) return "text-emerald-600";
  if (ms < 1500) return "text-amber-700";
  return "text-red-700";
}

export default function ApiStatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [summaryResult, setSummaryResult] = useState<string | null>(null);

  // Bulk-generate stored partner profile summaries. The edge function skips
  // any partner whose source fields haven't changed, so this is cheap to re-run.
  const generateSummaries = async () => {
    setGenerating(true);
    setSummaryResult(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("summarize-partners", {
        body: {},
      });
      if (err) throw err;
      const r = res as any;
      const parts = [
        `Processed ${r?.processed ?? 0}`,
        `skipped ${r?.skipped ?? 0} unchanged`,
      ];
      if ((r?.failed ?? 0) > 0) parts.push(`${r.failed} failed`);
      setSummaryResult(parts.join(" · "));
      if (r?.halted === "credit_limit_reached") {
        toast.error("Workspace AI credit limit reached — batch halted early");
      } else {
        toast.success("Partner summaries up to date");
      }
    } catch (e: any) {
      toast.error("Generation failed: " + (e?.message ?? e));
    } finally {
      setGenerating(false);
    }
  };

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.functions.invoke("api-status");
    if (err) setError(err.message);
    else setData(res as StatusPayload);
    setLoading(false);
  }, []);

  // Poll every 5 minutes, and only while the tab is visible. Each tick fires 5
  // external probes + 4 DB queries in the api-status function, so a background
  // tab left open all day was generating ~1,440 probe rounds per tab.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") fetchStatus();
      }, 300_000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") fetchStatus();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchStatus]);


  const grouped = useMemo(() => {
    const g: Record<Probe["category"], Probe[]> = { connector: [], api: [], ai: [] };
    (data?.probes ?? []).forEach((p) => g[p.category].push(p));
    return g;
  }, [data]);

  const summary = useMemo(() => {
    const probes = data?.probes ?? [];
    return {
      ok: probes.filter((p) => p.status === "ok").length,
      degraded: probes.filter((p) => p.status === "degraded").length,
      down: probes.filter((p) => p.status === "down").length,
      unconfigured: probes.filter((p) => p.status === "unconfigured").length,
    };
  }, [data]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-display font-semibold tracking-tight">API Status</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live health, latency, and last-sync telemetry across all connected services.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Checked {relTime(data.checked_at)}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? "animate-spin" : ""}`} />
            Re-check
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-4 border-red-200 bg-red-50 text-red-800 text-sm">
          Failed to load status: {error}
        </Card>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["ok", "degraded", "down", "unconfigured"] as const).map((k) => {
          const meta = STATUS_META[k];
          return (
            <Card key={k} className="p-4 surface-card min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                  {meta.label}
                </span>
                <meta.Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-display font-semibold mt-2 tabular-nums tracking-tight">{summary[k]}</div>
            </Card>
          );
        })}
      </div>

      {/* Probes by category */}
      {(["connector", "api", "ai"] as const).map((cat) => {
        const items = grouped[cat];
        if (!items.length) return null;
        const label = cat === "connector" ? "Connectors" : cat === "api" ? "Data APIs" : "AI Providers";
        return (
          <section key={cat} className="space-y-2">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
              {label}
            </h2>
            <Card className="surface-card divide-y divide-hairline">
              {items.map((p) => {
                const meta = STATUS_META[p.status];
                return (
                  <div key={p.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.detail}</div>
                    </div>
                    <div className={`text-xs tabular-nums font-mono ${latencyTone(p.latency_ms)}`}>
                      {p.latency_ms != null ? `${p.latency_ms} ms` : "—"}
                    </div>
                    {p.http_status ? (
                      <Badge variant="outline" className="text-[10px] font-mono tabular-nums">
                        {p.http_status}
                      </Badge>
                    ) : (
                      <span />
                    )}
                    <div className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${meta.cls}`}>
                      <meta.Icon className="h-3.5 w-3.5" />
                      <span className="font-medium">{meta.label}</span>
                    </div>
                  </div>
                );
              })}
            </Card>
          </section>
        );
      })}

      {/* Sync jobs */}
      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
          Scheduled Jobs — Last Successful Run
        </h2>
        <Card className="surface-card divide-y divide-hairline">
          {(data?.jobs ?? []).map((j) => {
            const fresh = jobFreshness(j);
            const tone =
              fresh === "ok" ? "text-emerald-600" : fresh === "stale" ? "text-amber-700" : "text-muted-foreground";
            const Icon = fresh === "ok" ? Activity : fresh === "stale" ? AlertTriangle : MinusCircle;
            return (
              <div key={j.id} className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{j.name}</div>
                  <div className="text-xs text-muted-foreground">{j.schedule}</div>
                  {j.detail && (
                    <div className="text-[11px] text-muted-foreground truncate">{j.detail}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs tabular-nums">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {fresh === "stale" ? (
                    <span className="rounded-full border border-amber-300 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-amber-700">
                      Stale — last success {relTime(j.last_success_at)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{relTime(j.last_success_at)}</span>
                  )}
                </div>
                <Icon className={`h-4 w-4 ${tone}`} />
              </div>
            );
          })}
          {!data?.jobs?.length && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">No jobs reporting yet.</div>
          )}
        </Card>
      </section>

      {/* Partner profile summaries — bulk generation, hash-gated */}
      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
          Partner Profile Summaries
        </h2>
        <Card className="surface-card px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">LLM partner summaries</div>
            <div className="text-xs text-muted-foreground">
              Stored 1–2 sentence profile per partner, shown in partner matching. Only partners whose
              data changed since the last run are re-processed.
              {summaryResult && (
                <span className="block mt-1 font-medium text-foreground">{summaryResult}</span>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={generateSummaries} disabled={generating} className="shrink-0">
            <Sparkles className={`h-3.5 w-3.5 mr-2 ${generating ? "animate-pulse" : ""}`} />
            {generating ? "Generating…" : "Generate missing summaries"}
          </Button>
        </Card>
      </section>

      <AiUsageDashboard />
    </div>
  );
}
