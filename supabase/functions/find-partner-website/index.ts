import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireApprovedUser } from "../_shared/auth.ts";

const BLOCKED_HOSTS = [
  "linkedin.com", "bloomberg.com", "crunchbase.com", "pitchbook.com",
  "sec.gov", "wikipedia.org", "facebook.com", "twitter.com", "x.com",
  "instagram.com", "youtube.com", "reddit.com", "medium.com",
  "prnewswire.com", "businesswire.com", "globenewswire.com",
  "google.com", "bing.com", "yahoo.com", "wsj.com", "nytimes.com",
  "forbes.com", "bisnow.com", "connect.cre", "commercialobserver.com",
  "therealdeal.com", "yardi.com", "costar.com",
];

function rootDomain(u: string): string | null {
  try {
    const url = new URL(u);
    return url.protocol.startsWith("http") ? `${url.protocol}//${url.hostname}` : null;
  } catch {
    return null;
  }
}

function isBlocked(u: string): boolean {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));
  } catch {
    return true;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireApprovedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { partner_id } = await req.json().catch(() => ({}));
    if (!partner_id || typeof partner_id !== "string") {
      return new Response(JSON.stringify({ error: "partner_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: partner, error: pErr } = await supabase
      .from("partners")
      .select("id, name, website")
      .eq("id", partner_id)
      .single();
    if (pErr || !partner) throw new Error(pErr?.message || "Partner not found");
    if (partner.website) {
      return new Response(JSON.stringify({ skipped: "already_has_website", website: partner.website }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const key = Deno.env.get("FIRECRAWL_API_KEY");
    if (!key) throw new Error("FIRECRAWL_API_KEY not configured");

    const query = `${partner.name} official website`;
    const res = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 8 }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Firecrawl [${res.status}]: ${body}`);
    }
    const json = await res.json();
    const results: any[] =
      json?.data?.web ?? json?.data ?? json?.web ?? json?.results ?? [];

    let picked: string | null = null;
    for (const r of results) {
      const url: string | undefined = r?.url ?? r?.link;
      if (!url) continue;
      if (isBlocked(url)) continue;
      const root = rootDomain(url);
      if (!root) continue;
      picked = root;
      break;
    }

    if (!picked) {
      return new Response(JSON.stringify({ skipped: "no_match" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: uErr } = await supabase
      .from("partners")
      .update({ website: picked })
      .eq("id", partner_id);
    if (uErr) throw uErr;

    return new Response(JSON.stringify({ website: picked }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("find-partner-website error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
