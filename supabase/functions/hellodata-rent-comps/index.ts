// hellodata-rent-comps
// Rent vs market for one deal, from HelloData only (see
// _shared/hellodataRentComps.ts for what is compared and why).
//
//   1. POST /property/comparables with the deal's HelloData record: 5 comps.
//   2. /property/{id} for each comp, unless hellodata_comp_rents has it from
//      the last 30 days. Each lookup is billed; neighbours share comps.
//   3. Property rents vs comp rents by bedroom count -> deals.hd_* columns,
//      then rescore.
//
// Runs as an onboarding step after HelloData, and from the deal page. A deal
// done in the last 30 days returns its saved result unless force: true.
//
// Body: { deal_id, force? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";
import { logApiRequest } from "../_shared/logUsage.ts";
import { hdComparables, hdPropertyResilient } from "../_shared/hellodataClient.ts";
import { type CompRents, rentsByBed, rentVsMarket } from "../_shared/hellodataRentComps.ts";
import { rescoreBuybox } from "../_shared/buyboxScore.ts";

const FN = "hellodata-rent-comps";
const TOP_N = 5;
const CACHE_DAYS = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const authz = await requireUserOrService(req);
  if (authz && !authz.ok) return authz.response;

  try {
    const body = await req.json().catch(() => ({}));
    const dealId = body.deal_id;
    if (typeof dealId !== "string" || !UUID_RE.test(dealId)) return json({ error: "deal_id must be a UUID" }, 400);
    const force = body.force === true;
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: connector } = await sb.from("connectors").select("enabled").eq("key", "hellodata").maybeSingle();
    if (connector && connector.enabled === false) return json({ status: "skipped", reason: "HelloData connector is turned off." });

    const { data: deal, error } = await sb
      .from("deals")
      .select("id, hellodata_status, hellodata_id, hellodata_payload, hd_rent_comps_at, hd_rent_vs_market_pct")
      .eq("id", dealId)
      .maybeSingle();
    if (error) throw error;
    if (!deal) return json({ error: "deal not found" }, 404);
    if (deal.hellodata_status !== "fetched" || !deal.hellodata_payload) {
      return json({ status: "skipped", reason: "No HelloData record for this deal yet." });
    }
    const fresh = deal.hd_rent_comps_at && Date.now() - Date.parse(deal.hd_rent_comps_at) < CACHE_DAYS * 86_400_000;
    if (fresh && !force) return json({ status: "cached", pct: deal.hd_rent_vs_market_pct });

    const subject = deal.hellodata_payload;
    const subjectByBed = rentsByBed(subject);
    if (!Object.keys(subjectByBed).length) {
      return json({ status: "skipped", reason: "HelloData lists no recent rents for this property." });
    }

    // 1. The comps.
    const list = await hdComparables(subject, TOP_N);
    await logApiRequest(sb, { function_name: FN, service: "hellodata", provider: "HelloData", deal_id: dealId });
    const picked = list.filter((c: any) => c?.id && String(c.id) !== String(subject.id ?? deal.hellodata_id)).slice(0, TOP_N);
    if (!picked.length) return json({ status: "skipped", reason: "HelloData returned no comparables." });

    // 2. Each comp's rents, from the 30-day cache or a billed lookup.
    const ids = picked.map((c: any) => String(c.id));
    const since = new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString();
    const { data: cached } = await sb.from("hellodata_comp_rents").select("*").in("hellodata_id", ids).gte("fetched_at", since);
    const cache = new Map((cached ?? []).map((r: any) => [r.hellodata_id, r]));

    let lookups = 0;
    const comps: CompRents[] = [];
    for (const c of picked) {
      const id = String(c.id);
      let byBed = cache.get(id)?.by_bed as CompRents["by_bed"] | undefined;
      if (!byBed) {
        try {
          const p = await hdPropertyResilient(id);
          lookups++;
          await logApiRequest(sb, { function_name: FN, service: "hellodata", provider: "HelloData", deal_id: dealId });
          byBed = rentsByBed(p);
          await sb.from("hellodata_comp_rents").upsert({
            hellodata_id: id,
            building_name: p?.building_name ?? c.building_name ?? null,
            street_address: p?.street_address ?? c.street_address ?? null,
            number_units: num(p?.number_units),
            year_built: num(p?.year_built),
            by_bed: byBed,
            fetched_at: new Date().toISOString(),
          });
        } catch (e) {
          console.error(JSON.stringify({ fn: FN, dealId, comp: id, detail: String((e as Error)?.message ?? e) }));
          continue;
        }
      }
      comps.push({
        id,
        name: c.building_name ?? null,
        address: [c.street_address, c.city, c.state].filter(Boolean).join(", ") || null,
        distance_miles: num(c.distance_miles),
        similarity: num(c.similarity_score?.overall),
        number_units: num(c.number_units),
        year_built: num(c.year_built),
        by_bed: byBed,
      });
    }

    // 3. Compare and save.
    const result = rentVsMarket(subjectByBed, comps.map((c) => c.by_bed));
    const at = new Date().toISOString();
    const source = {
      kind: "api",
      provider: "HelloData",
      label: `Listed rents, this property vs ${comps.length} HelloData comps, matched by bedroom count`,
      recorded_at: at,
    };
    const update: Record<string, unknown> = {
      hd_subject_rent: result?.subject_rent ?? null,
      hd_comp_market_rent: result?.market_rent ?? null,
      hd_rent_vs_market_pct: result?.pct ?? null,
      hd_rent_comps: { comps, beds: result?.beds ?? [], subject_by_bed: subjectByBed, computed_at: at },
      hd_rent_comps_at: at,
    };
    if (result) {
      update.field_sources = { hd_subject_rent: source, hd_comp_market_rent: source, hd_rent_vs_market_pct: source };
    }
    const { error: upErr } = await sb.from("deals").update(update).eq("id", dealId);
    if (upErr) throw upErr;
    await rescoreBuybox(sb, dealId);

    if (!result) {
      return json({ status: "skipped", reason: "The comps list no rents for the bedroom counts this property lists.", comps: comps.length, lookups });
    }
    return json({ status: "ok", pct: result.pct, subject_rent: result.subject_rent, market_rent: result.market_rent, comps: comps.length, lookups });
  } catch (e) {
    return errorResponse(e, cors, { fn: FN });
  }
});
