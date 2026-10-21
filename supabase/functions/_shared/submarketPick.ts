// Picking a deal's CoStar submarket with Claude.
//
// The CoStar export carries no boundaries, so this cannot be a spatial join.
// What it can be is the same judgement an analyst makes with the picker open:
// narrow ~2,300 submarkets to the deal's state and metro, then choose the one
// whose name covers the address. Claude knows that "Barrow County" is east of
// Atlanta and that 75204 is Uptown Dallas; the list keeps it from inventing a
// code. Pure functions here so the narrowing and the validation are testable.
import { normalizeState } from "./esriMatch.ts";

export type SubmarketRow = {
  geography_code: string;
  geography_name: string;
  market_name: string | null;
  submarket_name: string | null;
  state: string | null;
};

export type DealLocation = {
  property_name?: string | null;
  address?: string | null;
  property_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  msa?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

export type Confidence = "high" | "medium" | "low";

export type SubmarketPick =
  | { code: string; confidence: Confidence; reason: string }
  | { code: null; confidence: Confidence; reason: string };

/** Every state in the largest state's list is still ~300 lines; past this the prompt is noise. */
const MAX_CANDIDATES = 400;

/** Two-letter state from the deal's state field, or the tail of an msa like "Dallas-Fort Worth, TX". */
export function dealState(deal: DealLocation): string | null {
  const direct = normalizeState(deal.state);
  if (direct) return direct;
  const tail = (deal.msa ?? "").match(/,\s*([A-Za-z]{2})(?:[-–][A-Za-z]{2})*\s*(?:MSA)?\s*$/);
  return tail ? normalizeState(tail[1]) : null;
}

/** "Chicago-Naperville-Elgin, IL" → "chicago"; "Austin" → "austin". Same words SubmarketPicker ranks on. */
function placeWords(deal: DealLocation): string[] {
  return [deal.city, deal.msa?.split(/[-,]/)[0]]
    .filter((w): w is string => !!w)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 2);
}

/** "Kansas City - MO USA" → "kansas city". */
function marketCity(row: SubmarketRow): string {
  return (row.market_name ?? row.geography_name).split(" - ")[0].trim().toLowerCase();
}

/**
 * The submarkets worth showing Claude for this deal.
 *
 * The view derives a submarket's state from its MARKET's name, so a market that
 * crosses a state line files every submarket under its principal state: Kansas
 * City, KS submarkets sit under "Kansas City - MO USA". Matching on the state
 * alone would hide the right answer from a Kansas deal, so markets whose city
 * matches the deal's city or metro are included whatever state they are filed
 * under.
 */
export function candidatesFor(deal: DealLocation, all: SubmarketRow[]): SubmarketRow[] {
  const st = dealState(deal);
  const words = placeWords(deal);
  const metroMatch = (r: SubmarketRow) => words.some((w) => marketCity(r).includes(w));

  const inState = all.filter((r) => (st && r.state === st) || metroMatch(r));
  if (inState.length <= MAX_CANDIDATES) return inState;
  const metro = inState.filter(metroMatch);
  return metro.length ? metro : inState.slice(0, MAX_CANDIDATES);
}

export const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["geography_code", "confidence", "reason"],
  properties: {
    geography_code: {
      type: "string",
      description: "The code from the list, exactly as written, or NONE.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reason: { type: "string", description: "One short sentence: why this submarket, or why none." },
  },
} as const;

export function buildPrompt(deal: DealLocation, candidates: SubmarketRow[]): string {
  const facts = [
    ["Property", deal.property_name],
    ["Street", deal.address ?? deal.property_address],
    ["City", deal.city],
    ["State", deal.state],
    ["ZIP", deal.zip],
    ["Metro", deal.msa],
    ["Coordinates", deal.latitude != null && deal.longitude != null ? `${deal.latitude}, ${deal.longitude}` : null],
  ]
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join("\n");

  const list = candidates
    .map((c) => `${c.geography_code} | ${c.market_name ?? ""} | ${c.submarket_name ?? c.geography_name}`)
    .join("\n");

  return `Which CoStar multifamily submarket is this property in?

${facts}

CoStar submarkets (code | market | submarket):
${list}

Rules:
- Answer with one code from the list, copied exactly, or NONE.
- CoStar submarkets are usually named for a county, a city, or a named part of a city ("Uptown/Oak Lawn", "Far North Austin", "Barrow County"). Use your knowledge of where the address, ZIP or coordinates sit.
- confidence "high": you know the address falls in that submarket. "medium": the city or ZIP clearly belongs to it but a boundary could be close. "low": you are guessing between several.
- If the location is too vague to place (no street, ZIP or coordinates and the city spans several submarkets), say so with "low" rather than picking the biggest one.
- Never pick a submarket in a different metro because its name sounds similar.`;
}

/**
 * Turns Claude's answer into a pick, refusing anything not on the list.
 *
 * The schema constrains shape, not membership: a well-formed code that was
 * never offered is still invented, and must read as "no pick" rather than be
 * written to the deal.
 */
export function interpretPick(raw: unknown, candidates: SubmarketRow[]): SubmarketPick {
  const r = (raw ?? {}) as Record<string, unknown>;
  const confidence: Confidence = r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low";
  const reason = String(r.reason ?? "").trim().slice(0, 300);
  const code = String(r.geography_code ?? "").trim();
  const offered = candidates.some((c) => c.geography_code === code);
  if (!offered) {
    return {
      code: null,
      confidence: "low",
      reason: code && code.toUpperCase() !== "NONE" ? `Answered ${code}, which was not on the list.` : reason,
    };
  }
  return { code, confidence, reason };
}

/** Only a confident pick is written to the deal; a low one is recorded as a note and left for a person. */
export function shouldAssign(pick: SubmarketPick): pick is SubmarketPick & { code: string } {
  return pick.code !== null && pick.confidence !== "low";
}
