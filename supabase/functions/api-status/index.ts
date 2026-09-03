import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireApprovedUser } from "../_shared/auth.ts";
import { getArcGISToken } from "../_shared/arcgisToken.ts";
import { resolveAtlasKey, ATLAS_CANDIDATES } from "../_shared/outlookKeys.ts";


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

const GATEWAY = "https://connector-gateway.lovable.dev";
const EXPECTED_ATLAS = "atlas@ansoniaproperties.com";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireApprovedUser(req);
  if (!auth.ok) return auth.response;


  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const OUTLOOK_KEY = Deno.env.get("MICROSOFT_OUTLOOK_API_KEY");
  const atlasRes = resolveAtlasKey();
  

  const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const HELLODATA_KEY = Deno.env.get("HELLODATA_API_KEY");
  const ESRI_API_KEY = Deno.env.get("ESRI_API_KEY");
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Run probes in parallel.
  const [outlook, outlookAtlas, hellodata, esri, firecrawl, lovableAi] = await Promise.all([
    // Outlook via gateway — acquisitions mailbox
    timed(async () => {
      if (!LOVABLE_API_KEY || !OUTLOOK_KEY) return { ok: false, detail: "Connector not linked" };
      const r = await fetch(`${GATEWAY}/microsoft_outlook/me/messages?$top=1&$select=id`, {
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": OUTLOOK_KEY },
      });
      return { ok: r.ok, status: r.status, detail: r.ok ? "Reachable" : `HTTP ${r.status}` };
    }),
    // Outlook — Atlas mailbox (separate connection from acquisitions)
    timed(async () => {
      const found = atlasRes.present.length
        ? `Found: ${atlasRes.present.join(", ")}`
        : `No Atlas secret found (checked: ${ATLAS_CANDIDATES.join(", ")})`;
      if (!LOVABLE_API_KEY || !atlasRes.key) {
        return { ok: false, detail: `Atlas connector not linked — ${found}` };
      }
      if (atlasRes.collidesWithAcquisitions) {
        return {
          ok: false, status: 409,
          detail: `${atlasRes.name} matches the acquisitions key — wrong mailbox authorized. ${found}`,
        };
      }
      // Identity check: which mailbox is this connection actually bound to?
      const idRes = await fetch(`${GATEWAY}/microsoft_outlook/me?$select=mail,userPrincipalName`, {
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": atlasRes.key },
      });
      if (idRes.ok) {
        const me = await idRes.json().catch(() => ({}));
        const addr = String(me.mail || me.userPrincipalName || "").toLowerCase();
        if (addr && addr !== EXPECTED_ATLAS) {
          return {
            ok: false, status: 409,
            detail: `Connected to ${addr}, expected ${EXPECTED_ATLAS} — re-authorize in a private window signed in as Atlas. ${found}`,
          };
        }
        return {
          ok: true, status: idRes.status,
          detail: `Connected as ${addr || "unknown"} via ${atlasRes.name}. ${found}`,
        };
      }
      if (idRes.status === 401 || idRes.status === 403) {
        return {
          ok: false, status: idRes.status,
          detail: `HTTP ${idRes.status} via ${atlasRes.name} — grant expired or revoked, reconnect the mailbox. ${found}`,
        };
      }
      // Gateway may not proxy /me — fall back to the message probe, unverified identity.
      const r = await fetch(`${GATEWAY}/microsoft_outlook/me/messages?$top=1&$select=id`, {
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": atlasRes.key },
      });
      if (r.ok) {
        return {
          ok: true, status: r.status,
          detail: `Reachable via ${atlasRes.name} — mailbox identity unverified (/me returned HTTP ${idRes.status}). ${found}`,
        };
      }
      if (r.status === 401 || r.status === 403) {
        return {
          ok: false, status: r.status,
          detail: `HTTP ${r.status} via ${atlasRes.name} — Atlas grant expired, reconnect the mailbox. ${found}`,
        };
      }
      return { ok: false, status: r.status, detail: `HTTP ${r.status} via ${atlasRes.name}. ${found}` };
    }),

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
    // Firecrawl via gateway verify
    timed(async () => {
      if (!LOVABLE_API_KEY || !FIRECRAWL_KEY) return { ok: false, detail: "Connector not linked" };
      const r = await fetch(`${GATEWAY}/api/v1/verify_credentials`, {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": FIRECRAWL_KEY },
      });
      const j = await r.json().catch(() => ({}));
      const ok = r.ok && j.outcome === "verified";
      return { ok: r.ok && j.outcome !== "failed", degraded: j.outcome === "skipped", status: r.status, detail: j.outcome || `HTTP ${r.status}` };
    }),
    // Lovable AI Gateway — minimal real inference call.
    // NOTE: /v1/models is NOT a documented gateway route and always 404s;
    // the gateway's real surface is /v1/chat/completions.
    timed(async () => {
      if (!LOVABLE_API_KEY) return { ok: false, detail: "LOVABLE_API_KEY missing" };
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      });
      if (r.ok) { await r.text().catch(() => ""); return { ok: true, status: r.status, detail: "Reachable" }; }
      const body = await r.text().catch(() => "");
      if (r.status === 402) return { ok: false, degraded: true, status: 402, detail: "AI credits exhausted" };
      if (r.status === 429) return { ok: false, degraded: true, status: 429, detail: "Rate limited" };
      return { ok: false, status: r.status, detail: `HTTP ${r.status}: ${body.slice(0, 120)}` };
    }),

  ]);

  const probes: Probe[] = [
    {
      id: "outlook", name: "Microsoft Outlook — Acquisitions", category: "connector",
      status: !OUTLOOK_KEY ? "unconfigured" : outlook.ok ? "ok" : "down",
      latency_ms: outlook.ms, detail: outlook.detail, http_status: outlook.status,
    },
    {
      id: "outlook_atlas", name: "Microsoft Outlook — Atlas", category: "connector",
      status: atlasRes.present.length === 0 ? "unconfigured" : outlookAtlas.ok ? "ok" : "down",
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
      id: "lovable_ai", name: "Lovable AI Gateway", category: "ai",
      status: !LOVABLE_API_KEY ? "unconfigured" : lovableAi.ok ? "ok" : lovableAi.degraded ? "degraded" : "down",
      latency_ms: lovableAi.ms, detail: lovableAi.detail, http_status: lovableAi.status,
    },
    {
      id: "anthropic", name: "Anthropic (backup LLM)", category: "ai",
      status: ANTHROPIC_KEY ? "ok" : "unconfigured",
      latency_ms: null,
      detail: ANTHROPIC_KEY ? "Key configured (not pinged)" : "Not configured",
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
