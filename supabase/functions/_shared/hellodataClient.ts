// Shared HelloData HTTP client. Extracted from fetch-hellodata so the scheduled
// drain reuses the same retry/backoff behaviour instead of carrying a second
// copy that can drift.
//
// Billing note: every call here is billed. /property/search and /property/{id}
// are separate charges, so a deal with no hellodata_id costs two.

const HD_BASE = "https://api.hellodata.ai";

function key(): string {
  const k = Deno.env.get("HELLODATA_API_KEY");
  if (!k) throw new Error("HELLODATA_API_KEY not configured");
  return k;
}

/** Single-shot call, no retry — used for /property/search. */
export async function hdSearch(query: string): Promise<any> {
  const path = `/property/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(`${HD_BASE}${path}`, { headers: { "x-api-key": key() } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HelloData ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`HelloData ${path} returned non-JSON`); }
}

/** Pull the first usable id out of a search response. */
export function firstHelloDataId(search: any): string | null {
  const results = Array.isArray(search) ? search : (search?.results ?? []);
  const top = results[0];
  return top?.id ?? top?.property_id ?? top?.hellodata_id ?? null;
}

/**
 * /property/{id} with a 20s timeout and exponential backoff on 429/5xx and on
 * network/timeout errors. Does NOT retry 4xx such as 401/404 — those are not
 * going to get better and each attempt is billed.
 */
export async function hdPropertyResilient(hdId: string): Promise<any> {
  const path = `/property/${encodeURIComponent(hdId)}`;
  const url = `${HD_BASE}${path}`;
  const maxAttempts = 3;
  const backoffMs = [1000, 2000, 4000];
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let nonRetriable = false;
    try {
      const res = await fetch(url, { headers: { "x-api-key": key() }, signal: controller.signal });
      const text = await res.text();

      if (res.ok) {
        try { return JSON.parse(text); }
        catch { throw new Error(`HelloData ${path} attempt ${attempt} returned non-JSON (status ${res.status})`); }
      }

      const retriable = res.status === 429 || (res.status >= 500 && res.status < 600);
      const msg = `HelloData ${path} attempt ${attempt}/${maxAttempts} → ${res.status}: ${text.slice(0, 300)}`;
      if (!retriable) { nonRetriable = true; throw new Error(msg); }
      lastErr = new Error(msg);
      console.warn(`[hellodata] retriable failure: ${msg}`);
    } catch (e: any) {
      if (nonRetriable) throw e;
      const isAbort = e?.name === "AbortError";
      lastErr = isAbort
        ? new Error(`HelloData ${path} attempt ${attempt}/${maxAttempts} → timeout after 20s`)
        : new Error(`HelloData ${path} attempt ${attempt}/${maxAttempts} → network error: ${e?.message ?? String(e)}`);
      console.warn(`[hellodata] ${lastErr.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, backoffMs[attempt - 1]));
  }
  throw lastErr ?? new Error(`HelloData ${path} failed after ${maxAttempts} attempts`);
}

// ---------------------------------------------------------------------------
// Match gate
//
// The previous buildAddressQuery joined [address, city, state, zip] and returned
// on the first non-empty set. deals.address is NULL on 82/82 rows, so in practice
// EVERY search this system ever issued was "City, State, Zip" — a city, not a
// building — and results[0] was accepted unverified. That produced a ~44%
// mismatch rate: two unrelated deals matched the same Columbus extended-stay
// hotel, an 809-unit deal matched a 4-unit record.
//
// The name+city fallback underneath it was unreachable: it required city && state
// to be non-null, but only ran when the joined parts array was empty, which
// requires them to be null. Deleted rather than repaired — a name+city query is
// what produced the hotel.
//
// Until deals carry real street addresses the correct behaviour is to refuse.
// ---------------------------------------------------------------------------

export type AddressRefusal = { ok: false; reason: string };
export type AddressQuery = { ok: true; query: string; street: string };

/** A usable street address needs a number and a name — "Columbus, OH" does not. */
export function hasStreetAddress(s: unknown): boolean {
  const v = String(s ?? "").trim();
  if (!v) return false;
  return /\d+\s+\S*[A-Za-z]{2,}/.test(v);
}

/**
 * Build a search query, or refuse with a human-readable reason.
 *
 * property_address is trustworthy ONLY where the deal is not already enriched —
 * on a 'fetched' row HelloData wrote it, so using it to verify a HelloData match
 * is circular and would launder a bad match into a confirmed one.
 */
export function buildAddressQuery(deal: any): AddressQuery | AddressRefusal {
  const enriched = deal?.hellodata_status === "fetched";
  const candidates = [deal?.address, enriched ? null : deal?.property_address];
  const street = candidates.find((c) => hasStreetAddress(c));
  if (!street) {
    return {
      ok: false,
      reason: enriched
        ? "No street address on file (the stored address came from HelloData, so it cannot verify a HelloData match)"
        : "No street address on file — a city-level search cannot identify a building",
    };
  }
  const query = [street, deal?.city, deal?.state, deal?.zip].filter(Boolean).join(", ");
  return { ok: true, query, street: String(street) };
}

const STOPWORDS = new Set(["apartments", "apartment", "the", "at", "of", "and", "homes", "place", "tower", "towers", "house", "on", "ii", "i", "a"]);
const tokens = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
const streetNumber = (s: unknown) => (String(s ?? "").match(/\b(\d+)\b/) || [])[1] ?? null;

/**
 * Unit tolerance, +/-25%. Chosen against the observed failures: rejects
 * 809-vs-4, 656-vs-123, 208-vs-436, 260-vs-100, 138-vs-78; accepts 176-vs-208
 * (+18%) and 96-vs-97. Tighter false-positives on legitimate OM-vs-HelloData
 * differences — phasing, excluded units, commercial space.
 */
const UNIT_TOLERANCE = 0.25;

export type MatchEvidence = {
  confidence: number;
  accepted: boolean;
  reason: string;
  signals: Record<string, string>;
};

/**
 * Score one candidate. Hard fails are contradictions of fact (different zip or
 * street number). Asset-type flags are ONE signal, not a veto — Whitestone
 * Crossing matched correctly on name and unit count while carrying
 * is_single_family=true.
 */
export function scoreCandidate(deal: any, cand: any): MatchEvidence {
  const signals: Record<string, string> = {};
  let score = 0;
  let possible = 0;

  const dZip = String(deal?.zip ?? "").slice(0, 5);
  const cZip = String(cand?.zip_code ?? "").slice(0, 5);
  if (dZip && cZip) {
    possible += 30;
    if (dZip === cZip) {
      score += 30;
      signals.zip = "match " + cZip;
    } else {
      return { confidence: 0, accepted: false, reason: "zip mismatch (" + dZip + " vs " + cZip + ")", signals: { zip: "MISMATCH" } };
    }
  }

  const dNo = streetNumber(deal?.address ?? deal?.property_address);
  const cNo = streetNumber(cand?.street_address);
  if (dNo && cNo) {
    possible += 30;
    if (dNo === cNo) {
      score += 30;
      signals.street_number = "match " + cNo;
    } else {
      return { confidence: 0, accepted: false, reason: "street number mismatch (" + dNo + " vs " + cNo + ")", signals: { street_number: "MISMATCH" } };
    }
  }

  const dTok = tokens(deal?.property_name);
  const cTok = tokens(cand?.building_name);
  if (dTok.length && cTok.length) {
    possible += 25;
    const shared = dTok.filter((t) => cTok.includes(t));
    if (shared.length) {
      score += 25;
      signals.name = "shared [" + shared.join(", ") + "]";
    } else {
      signals.name = "no overlap";
    }
  }

  const dU = Number(deal?.unit_count);
  const cU = Number(cand?.number_units);
  if (Number.isFinite(dU) && Number.isFinite(cU) && dU > 0 && cU > 0) {
    possible += 25;
    const drift = Math.abs(cU - dU) / dU;
    if (drift <= UNIT_TOLERANCE) {
      score += 25;
      signals.units = dU + " vs " + cU;
    } else {
      signals.units = "OUT OF RANGE " + dU + " vs " + cU;
    }
  }

  const typeFlags: string[] = [];
  if (cand?.is_single_family === true) typeFlags.push("is_single_family");
  if (cand?.is_apartment === false) typeFlags.push("is_apartment=false");
  if (typeFlags.length) signals.asset_type = typeFlags.join(", ");

  const confidence = possible > 0 ? Math.round((score / possible) * 100) : 0;
  // Asset-type contradiction is not a sole veto, but it withdraws the benefit of
  // the doubt: a borderline match carrying one is rejected.
  const threshold = typeFlags.length ? 80 : 70;
  const accepted = possible >= 50 && confidence >= threshold;
  const reason = accepted
    ? "confidence " + confidence + "%"
    : possible < 50
      ? "too few comparable signals to verify this match"
      : "confidence " + confidence + "% below " + threshold + "% threshold";

  return { confidence, accepted, reason, signals };
}

/** Best acceptable candidate, or null. Never returns a low-confidence guess. */
export function pickBestMatch(
  deal: any,
  results: any[],
): { candidate: any | null; evidence: MatchEvidence } {
  const scored = (results ?? []).map((c) => ({ candidate: c, evidence: scoreCandidate(deal, c) }));
  const accepted = scored
    .filter((s) => s.evidence.accepted)
    .sort((a, b) => b.evidence.confidence - a.evidence.confidence);
  if (accepted.length) return accepted[0];
  const best = scored.sort((a, b) => b.evidence.confidence - a.evidence.confidence)[0];
  return {
    candidate: null,
    evidence: best?.evidence ?? { confidence: 0, accepted: false, reason: "no candidates returned", signals: {} },
  };
}

