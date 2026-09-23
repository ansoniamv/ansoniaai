import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireApprovedUser } from "../_shared/auth.ts";
import { getArcGISToken } from "../_shared/arcgisToken.ts";
import { graphConfigured, getGraphToken, graphSecretsPresent } from "../_shared/graphToken.ts";
import { MAILBOX_UPN } from "../_shared/graphMail.ts";
import { callClaudeRaw, isAnthropicConfigured } from "../_shared/anthropic.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Probe = {
  id: string;
  name: string;
  category: "connector" | "api" | "ai";
  status: "ok" | "degraded" | "down" | "unconfigured";
  latency_ms: number | null;
  detail: string;
  http_status?: number;
};

async function timed(fn: () => Promise<{ ok: boolean; status?: number; detail: string; degraded?: boolean }>): Promise<{ ms: number; ok: boolean; status?: number; detail: string; degraded?: boolean }> {
  const t0 = performance.now();
  try {
    const r = await fn();
    return { ms: Math.round(performance.now() - t0), ...r };
  } catch (e) {
    return { ms: Math.round(performance.now() - t0), ok: false, detail: (e as Error).message };
  }
}

type ProbeResult = { ok: boolean; status?: number; detail: string; degraded?: boolean };

/**
 * Firecrawl reachability, without paying for it.
 *
 * Two things matter here. The status page is opened casually and by several
 * people, so a probe that spends a paid search credit per page load is a real
 * recurring cost for a diagnostic. And the account-level credit-usage endpoint,
 * where available, answers a strictly better question: not just "is the key
 * accepted" but "how much is left".
 *
 * So: try credit-usage, fall back to a 1-result search only if that endpoint is
 * genuinely absent (404/405), and cache either answer for an hour. Worst case —
 * no credit-usage endpoint — that caps the cost at one credit per hour per warm
 * instance instead of one per page load.
 *
 * The cache is module-level, so it lives as long as the instance and is lost on
 * a cold start. That is the right tradeoff for a status page: a stale "ok" never
 * outlives the instance by much, and a cold start pays at most one probe.
 */
const FIRECRAWL_TTL_MS = 60 * 60 * 1000;
let firecrawlCache: { at: number; result: ProbeResult } | null = null;

async function probeFirecrawl(key: string | undefined): Promise<ProbeResult> {
  if (!key) return { ok: false, detail: "FIRECRAWL_API_KEY missing" };

  if (firecrawlCache && Date.now() - firecrawlCache.at < FIRECRAWL_TTL_MS) {
    const age = Math.round((Date.now() - firecrawlCache.at) / 60_000);
    return { ...firecrawlCache.result, detail: `${firecrawlCache.result.detail} (cached ${age}m)` };
  }

  const classify = async (r: Response, okDetail: string): Promise<ProbeResult> => {
    if (r.ok) return { ok: true, status: r.status, detail: okDetail };
    const body = await r.text().catch(() => "");
    if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, detail: "FIRECRAWL_API_KEY rejected" };
    if (r.status === 402) return { ok: false, degraded: true, status: 402, detail: "Credits exhausted" };
    if (r.status === 429) return { ok: false, degraded: true, status: 429, detail: "Rate limited" };
    return { ok: false, status: r.status, detail: `HTTP ${r.status}: ${body.slice(0, 120)}` };
  };

  let result: ProbeResult;
  try {
    const usage = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (usage.status === 404 || usage.status === 405) {
      // Not on this plan, or not this path — fall back to the call production
      // actually makes. Cached below like any other answer.
      const search = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "ansonia properties", limit: 1 }),
      });
      result = await classify(search, "Reachable (search probe — no credit-usage endpoint)");
    } else if (usage.ok) {
      const j = await usage.json().catch(() => ({}));
      const remaining =
        (j as any)?.data?.remaining_credits ?? (j as any)?.remaining_credits ?? null;
      result = {
        ok: true,
        status: usage.status,
        detail: remaining === null ? "Reachable" : `Reachable — ${remaining} credits remaining`,
      };
    } else {
      result = await classify(usage, "Reachable");
    }
  } catch (e) {
    // Network-level failure: report it, and do not cache it. A blip should not
    // pin the page to "down" for an hour.
    return { ok: false, detail: (e as Error).message };
  }

  firecrawlCache = { at: Date.now(), result };
  return result;
}

/**
 * Probe one mailbox. Microsoft Graph app-only is the only transport.
 *
 * The mailbox is named in the URL, so "reachable" and "is the right mailbox" are
 * the same question — a 404 means that UPN does not exist, a 403 means
 * application permissions (Mail.Read / Mail.Send, plus any application access
 * policy) do not cover it. There is no identity to drift.
 */
async function probeMailbox(
  mailbox: "acquisitions" | "atlas",
): Promise<{ ok: boolean; status?: number; detail: string; degraded?: boolean }> {
  if (!graphConfigured()) {
    return {
      ok: false,
      detail:
        `GRAPH_* secrets not set (present: ${graphSecretsPresent().join(", ") || "none"}) — ` +
        "Graph app-only is the only mailbox transport.",
    };
  }

  {
    const upn = MAILBOX_UPN[mailbox];
    let token = "";
    try {
      token = (await getGraphToken()).token;
    } catch (e) {
      return { ok: false, detail: `${(e as Error).message} (secrets present: ${graphSecretsPresent().join(", ")})` };
    }
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}/messages?$top=1&$select=id`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (r.ok) return { ok: true, status: r.status, detail: `Reachable as ${upn} (Graph app-only)` };
    const body = await r.text().catch(() => "");
    if (r.status === 404) {
      return { ok: false, status: 404, detail: `Mailbox ${upn} not found — check GRAPH_${mailbox.toUpperCase()}_UPN.` };
    }
    if (r.status === 403) {
      return {
        ok: false, status: 403,
        detail: `Forbidden for ${upn} — app lacks Mail.Read/Mail.Send application permission, or an application access policy excludes this mailbox.`,
      };
    }
    if (r.status === 401) {
      return { ok: false, status: 401, detail: `Unauthorized for ${upn} — admin consent missing or client secret rotated.` };
    }
    return { ok: false, status: r.status, detail: `HTTP ${r.status} for ${upn}: ${body.slice(0, 120)}` };
  }

}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireApprovedUser(req);
  if (!auth.ok) return auth.response;


  const OUTLOOK_KEY = Deno.env.get("MICROSOFT_OUTLOOK_API_KEY");

  const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const HELLODATA_KEY = Deno.env.get("HELLODATA_API_KEY");
  const ESRI_API_KEY = Deno.env.get("ESRI_API_KEY");
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Run probes in parallel.
  const [outlook, outlookAtlas, hellodata, esri, firecrawl, anthropic] = await Promise.all([
    // Outlook — acquisitions mailbox
    timed(() => probeMailbox("acquisitions")),
    // Outlook — Atlas mailbox
    timed(() => probeMailbox("atlas")),

    // HelloData
    timed(async () => {
      if (!HELLODATA_KEY) return { ok: false, detail: "API key missing" };
      const r = await fetch("https://api.hellodata.ai/property/search?q=test", {
        headers: { "x-api-key": HELLODATA_KEY },
      });
      return { ok: r.ok, status: r.status, detail: r.ok ? "Reachable" : `HTTP ${r.status}` };
    }),
    // ESRI — probe with the SAME token selection production enrichment uses,
    // so the status page can't report healthy/dead on a credential we don't use.
    timed(async () => {
      if (!ESRI_API_KEY && !Deno.env.get("ESRI_CLIENT_ID")) return { ok: false, detail: "No ArcGIS credentials configured" };
      const { token, source } = await getArcGISToken();
      const url = new URL("https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates");
      url.searchParams.set("SingleLine", "1600 Pennsylvania Ave NW, Washington, DC");
      url.searchParams.set("f", "json");
      url.searchParams.set("maxLocations", "1");
      url.searchParams.set("token", token);
      const r = await fetch(url.toString());
      const j = await r.json().catch(() => ({}));
      const via = source === "oauth" ? "OAuth token" : source === "api_key_fallback" ? "API key (OAuth fallback)" : "static API key";
      if (j?.error) return { ok: false, status: r.status, detail: `${j.error.message || `code ${j.error.code}`} — via ${via}` };
      const ok = r.ok && Array.isArray(j?.candidates) && j.candidates.length > 0;
      return { ok, degraded: ok && source === "api_key_fallback", status: r.status, detail: ok ? `Geocode OK via ${via}` : `HTTP ${r.status} via ${via}` };
    }),
    // Firecrawl — direct against api.firecrawl.dev, the same host and auth
    // find-partner-website uses, so this cannot report healthy on a path
    // production does not take.
    timed(() => probeFirecrawl(FIRECRAWL_KEY)),
    // Anthropic — a real inference call through the same client every AI path
    // uses, so a key that passes here is one those paths will work with.
    // Haiku at max_tokens: 1 is the cheapest round trip that still proves auth,
    // routing and quota rather than merely that a secret is present.
    timed(async () => {
      if (!isAnthropicConfigured()) return { ok: false, detail: "ANTHROPIC_API_KEY missing" };
      try {
        const res = await callClaudeRaw({
          model: "claude-haiku-4-5",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
          maxRetries: 0,
          timeoutMs: 15_000,
        });
        return { ok: true, status: 200, detail: `Reachable (${res.model})` };
      } catch (e: any) {
        const status = typeof e?.status === "number" ? e.status : undefined;
        const body = String(e?.body ?? e?.message ?? e).slice(0, 160);
        if (status === 401) return { ok: false, status, detail: "ANTHROPIC_API_KEY rejected" };
        if (status === 429) return { ok: false, degraded: true, status, detail: "Rate limited" };
        if (status === 400 && /credit balance/i.test(body)) {
          return { ok: false, degraded: true, status, detail: "Credit balance too low" };
        }
        return { ok: false, status, detail: body };
      }
    }),

  ]);

  const probes: Probe[] = [
    {
      id: "outlook", name: "Microsoft Outlook — Acquisitions", category: "connector",
      status: (!graphConfigured() && !OUTLOOK_KEY) ? "unconfigured"
        : outlook.degraded ? "degraded" : outlook.ok ? "ok" : "down",
      latency_ms: outlook.ms, detail: outlook.detail, http_status: outlook.status,
    },
    {
      id: "outlook_atlas", name: "Microsoft Outlook — Atlas", category: "connector",
      status: !graphConfigured() ? "unconfigured"
        : outlookAtlas.degraded ? "degraded" : outlookAtlas.ok ? "ok" : "down",
      latency_ms: outlookAtlas.ms, detail: outlookAtlas.detail, http_status: outlookAtlas.status,
    },
    {
      id: "firecrawl", name: "Firecrawl (Web Crawler)", category: "connector",
      status: !FIRECRAWL_KEY ? "unconfigured" : firecrawl.degraded ? "degraded" : firecrawl.ok ? "ok" : "down",
      latency_ms: firecrawl.ms, detail: firecrawl.detail, http_status: firecrawl.status,
    },
    {
      id: "hellodata", name: "HelloData", category: "api",
      status: !HELLODATA_KEY ? "unconfigured" : hellodata.ok ? "ok" : "down",
      latency_ms: hellodata.ms, detail: hellodata.detail, http_status: hellodata.status,
    },
    {
      id: "esri", name: "ESRI / ArcGIS", category: "api",
      status: (!ESRI_API_KEY && !Deno.env.get("ESRI_CLIENT_ID")) ? "unconfigured" : esri.degraded ? "degraded" : esri.ok ? "ok" : "down",
      latency_ms: esri.ms, detail: esri.detail, http_status: esri.status,
    },
    {
      id: "anthropic", name: "Anthropic (Claude)", category: "ai",
      status: !ANTHROPIC_KEY ? "unconfigured"
        : anthropic.degraded ? "degraded" : anthropic.ok ? "ok" : "down",
      latency_ms: anthropic.ms, detail: anthropic.detail, http_status: anthropic.status,
    },
  ];

  // Last-sync timestamps for sync jobs — per mailbox, so a healthy acquisitions
  // sync can never mask a dead Atlas mailbox.
  const [acqSync, atlasSync, atlasAutomation, crawlerSync, gateRun, scoreRun] = await Promise.all([
    supabase.from("outlook_messages").select("synced_at").eq("mailbox", "acquisitions").order("synced_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("outlook_messages").select("synced_at").eq("mailbox", "atlas").order("synced_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("connectors").select("enabled, config").eq("key", "atlas_automation").maybeSingle(),
    supabase.from("deal_emails").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("inbox_deals").select("gate_checked_at").not("gate_checked_at", "is", null).order("gate_checked_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("inbox_deals").select("updated_at").not("fit_score", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const atlasCfg = (atlasAutomation.data?.config as any) || {};

  type Job = {
    id: string;
    name: string;
    schedule: string;
    last_success_at: string | null;
    detail?: string;
    stale?: boolean;
  };

  const jobs: Job[] = [
    { id: "outlook_sync_acquisitions", name: "Outlook Sync — Acquisitions", schedule: "Daily 04:00 UTC", last_success_at: acqSync.data?.synced_at ?? null },
    { id: "outlook_sync_atlas", name: "Outlook Sync — Atlas", schedule: "Every 30 min", last_success_at: atlasSync.data?.synced_at ?? null },
    {
      id: "atlas_analysis", name: "Atlas Email Analysis", schedule: "Every 30 min",
      last_success_at: atlasCfg.last_success_at ?? atlasCfg.last_run_at ?? null,
      detail: atlasAutomation.data?.enabled === false ? "Automation disabled" : (atlasCfg.last_error || undefined),
    },
    { id: "acquisitions_inbox", name: "Acquisitions Inbox Ingest", schedule: "Every 30 min", last_success_at: crawlerSync.data?.created_at ?? null },
    { id: "gate_deals", name: "Deal Gating", schedule: "On ingest", last_success_at: gateRun.data?.gate_checked_at ?? null },
    { id: "score_deals", name: "Buy-Box Scoring", schedule: "On gate pass", last_success_at: scoreRun.data?.updated_at ?? null },
  ];

  const DAY_MS = 24 * 60 * 60 * 1000;
  for (const j of jobs) {
    j.stale = !!j.last_success_at && Date.now() - new Date(j.last_success_at).getTime() > DAY_MS;
  }

  return new Response(
    JSON.stringify({ ok: true, checked_at: new Date().toISOString(), probes, jobs }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
