// Shared HelloData property → deal-field mapping.
// Used by both `hellodata-enrich` (writes to DB) and `hellodata-detail`
// (returns fields for the New Deal form before a deal exists).
//
// KEEP THIS IN SYNC — any new field extraction should live here so the
// intake preview and the post-create enrichment stay consistent.

const pick = (...vals: any[]) => {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "number" && Number.isNaN(v)) continue;
    return v;
  }
  return null;
};
const pickNum = (...vals: any[]) => {
  const v = pick(...vals);
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
};

// Intake-only fields — captured on the New Deal form and never overwritten by
// enrichment. One definition, imported by hellodata-enrich and fetch-hellodata.
export const INTAKE_ONLY_KEYS = new Set([
  "property_name", "street_address_raw", "city", "state", "zip",
  "unit_count", "vintage_year",
]);

/**
 * Written only where the deal has no value yet. Intake fields plus
 * management_company — a HelloData mismatch overwrote hand-entered managers with
 * the wrong building's ("Ardent" -> "Extended Stay America"), and the prior value
 * is recoverable from nowhere.
 */
export const FILL_IF_NULL_KEYS = new Set([...INTAKE_ONLY_KEYS, "management_company"]);

/**
 * Flags that describe where a neighbouring value came from, mapped to the column
 * they annotate.
 *
 * unit_count_is_estimated says "the unit count on this row is a HelloData
 * prediction, not a filed number" — which is only true if HelloData's unit count
 * is the one on the row. unit_count is fill-if-null, so on a deal where an
 * analyst typed 212 from the OM the mapper's value is discarded and the flag,
 * written on its own, would libel a hand-entered figure as a guess. On exactly
 * the field passes_hard_filters gates at 150 units.
 *
 * So the flag goes wherever its value goes, and nowhere else.
 */
export const PROVENANCE_OF: Record<string, string> = {
  unit_count_is_estimated: "unit_count",
  vintage_is_estimated: "vintage_year",
};

/**
 * Pick the mapper fields that are safe to write onto a loaded deal row.
 *
 * Two rules, both learned the hard way:
 *  - Skip any key that is not a column on the row. The mapper emits
 *    street_address_raw for hellodata-detail's New Deal form, but that is not a
 *    column on public.deals, and including it makes PostgREST reject the ENTIRE
 *    update. Keying off the loaded row (which uses select("*"), so every real
 *    column is present even when null) keeps this correct as the mapper grows.
 *  - Skip nulls, and skip fill-if-null keys that already hold a value, so
 *    enrichment never blanks or overwrites a human-entered field.
 *
 * Pure and dependency-free so it can be unit tested outside Deno.
 */
export function selectWritableFields(
  mapped: Record<string, unknown>,
  dealRow: Record<string, unknown>,
  fillIfNull: Set<string> = FILL_IF_NULL_KEYS,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mapped)) {
    if (!(k in dealRow)) continue;
    if (v === null || v === undefined) continue;
    if (fillIfNull.has(k) && dealRow[k] != null) continue;
    out[k] = v;
  }
  // Third rule: a provenance flag is dropped unless the value it describes is
  // being written in the same update. See PROVENANCE_OF.
  for (const [flag, describes] of Object.entries(PROVENANCE_OF)) {
    if (flag in out && !(describes in out)) delete out[flag];
  }
  return out;
}

export type MappedHelloData = {
  update: Record<string, any>;
  photoUrls: string[];
  field_coverage: Record<string, boolean>;
};

/**
 * Demographic percentages arrive from HelloData as 0..1 fractions (verified
 * 27/27 payloads: vacant_housing_units_perc, *_degree_perc,
 * owner_occupied_housing_units_perc and every *_pop_perc key are all <= 1).
 * 0..100 is canonical in the database, so convert here.
 *
 * The <= 1 guard mirrors the one fetch-hellodata used, so remapping a payload is
 * idempotent. It is safe because this only ever reads RAW payload values, never a
 * stored column — feeding an already-converted column back through would
 * double-convert anything that legitimately landed in (0, 1].
 */
const pct = (v: unknown): number | null => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : null;
  if (n === null) return null;
  return n <= 1 ? +(n * 100).toFixed(2) : +n.toFixed(2);
};

/**
 * Untyped HelloData JSON. The payload is a third-party shape that has already
 * changed under this code once (floor_plans / unit_mix, neither of which ever
 * existed), so every read below goes through a guard rather than a cast.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Strict boolean read. A missing flag is null, not false — "HelloData did not
 *  say" and "HelloData said no" are different answers to a hard filter. */
const bool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === 0) return v === 1;
  return null;
};

const asDate = (v: unknown): number | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

const DAY_MS = 86_400_000;

type PricePoint = { at: number; until: number | null; price: number };

/**
 * Rent history keyed by unit, gathered from wherever HelloData hung it.
 *
 * The history array has been seen both at the property root and nested on each
 * building_availability entry, so both are read. Effective price wins over
 * asking: a concession that grows month over month is a rent cut, and reading
 * asking price would miss it entirely.
 */
export function collectRentHistory(p: Raw, avail: Raw[]): Map<string, PricePoint[]> {
  const series = new Map<string, PricePoint[]>();

  const add = (key: string, h: Raw) => {
    const at = asDate(h?.from_date ?? h?.start_date ?? h?.date ?? h?.as_of);
    const price = num(h?.effective_price ?? h?.price ?? h?.min_effective_price ?? h?.min_price);
    if (at === null || price === null || price <= 0) return;
    const until = asDate(h?.to_date ?? h?.end_date);
    const list = series.get(key) ?? [];
    list.push({ at, until, price });
    series.set(key, list);
  };

  const keyOf = (u: Raw, fallback: number) =>
    String(
      u?.unit_name ?? u?.unit ?? u?.name ?? u?.unit_number ??
      u?.floorplan_name ?? u?.floorplan ?? u?.id ?? `#${fallback}`,
    );

  avail.forEach((u, i) => {
    if (!Array.isArray(u?.history)) return;
    const key = keyOf(u, i);
    for (const h of u.history) add(key, h);
  });

  if (Array.isArray(p?.history)) {
    p.history.forEach((h: Raw, i: number) => add(keyOf(h, i), h));
  }

  for (const list of series.values()) list.sort((a, b) => a.at - b.at);
  return series;
}

/** Price a unit was carrying on a given date: the last interval covering it,
 *  else the last price quoted before it. Null when the unit was not yet listed.
 *  Points are ascending, so both candidates are the last assignment wins. */
function priceOn(points: PricePoint[], when: number): number | null {
  let covering: number | null = null;
  let carried: number | null = null;
  for (const pt of points) {
    if (pt.at > when) break;
    carried = pt.price;
    if (pt.until === null || pt.until >= when) covering = pt.price;
  }
  return covering ?? carried;
}

/**
 * Same-unit median rent change over a trailing window, in percent.
 *
 * Averaging all listed rents and comparing months would measure the unit mix as
 * much as the rent — a month that happens to list three penthouses reads as a
 * rent spike. Only units priced in BOTH windows are compared, each against
 * itself, and the median of those changes is taken so one renovated unit
 * returning at +40% cannot carry the number.
 *
 * Anchored to the latest date in the data, not to today, so a cached payload
 * still reports a true trailing window rather than sliding into silence.
 */
export function sameUnitRentTrendPct(
  series: Map<string, PricePoint[]>,
  monthsBack: number,
  minUnits = 3,
): number | null {
  let anchor = 0;
  for (const points of series.values()) {
    for (const pt of points) if (pt.at > anchor) anchor = pt.at;
  }
  if (!anchor) return null;

  const then = anchor - monthsBack * 30.44 * DAY_MS;
  const changes: number[] = [];
  for (const points of series.values()) {
    const before = priceOn(points, then);
    const after = priceOn(points, anchor);
    if (before === null || after === null || before <= 0) continue;
    // A unit whose first quote lands after the window opens has no "before" to
    // compare against; priceOn returns null there, so it drops out on its own.
    changes.push(((after - before) / before) * 100);
  }
  if (changes.length < minUnits) return null;
  const m = median(changes);
  return m === null ? null : +m.toFixed(2);
}

/** Amenity lists arrive as strings or as {name}/{label} objects. */
function normalizeAmenities(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .map((a: Raw) =>
      typeof a === "string" ? a : (a?.name ?? a?.label ?? a?.amenity ?? a?.title ?? null),
    )
    .filter((a: Raw): a is string => typeof a === "string" && a.trim() !== "")
    .map((a) => a.trim());
  const unique = Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
  return unique.length ? unique : null;
}

const FEE_FIELDS: Array<{ key: string; label: string; frequency: string }> = [
  { key: "admin_fee", label: "Admin fee", frequency: "one_time" },
  { key: "application_fee", label: "Application fee", frequency: "one_time" },
  { key: "amenity_fee", label: "Amenity fee", frequency: "monthly" },
  { key: "storage_fee", label: "Storage", frequency: "monthly" },
  { key: "parking_covered", label: "Parking — covered", frequency: "monthly" },
  { key: "parking_garage", label: "Parking — garage", frequency: "monthly" },
  { key: "parking_surface_lot", label: "Parking — surface lot", frequency: "monthly" },
  { key: "cats_monthly_rent", label: "Cat rent", frequency: "monthly" },
  { key: "dogs_monthly_rent", label: "Dog rent", frequency: "monthly" },
  { key: "cats_one_time_fee", label: "Cat fee", frequency: "one_time" },
  { key: "dogs_one_time_fee", label: "Dog fee", frequency: "one_time" },
  { key: "cats_deposit", label: "Cat deposit", frequency: "deposit" },
  { key: "dogs_deposit", label: "Dog deposit", frequency: "deposit" },
  { key: "min_deposit", label: "Deposit (min)", frequency: "deposit" },
  { key: "max_deposit", label: "Deposit (max)", frequency: "deposit" },
];

/**
 * The posted fee schedule, normalized. This is a rate card, NOT an other-income
 * estimate: pet rent is collected from pet owners and covered parking from
 * whoever rents a space, so summing the monthly column would invent revenue.
 * move_in_fees_total stays to admin plus application, the two every new lease pays.
 */
export function buildFeeSchedule(p: Raw): {
  schedule: Array<{ label: string; amount: number; frequency: string }> | null;
  moveInFeesTotal: number | null;
} {
  const rows: Array<{ label: string; amount: number; frequency: string }> = [];
  for (const f of FEE_FIELDS) {
    const amount = num(p?.[f.key]);
    if (amount !== null && amount > 0) rows.push({ label: f.label, amount, frequency: f.frequency });
  }
  if (Array.isArray(p?.fees)) {
    for (const f of p.fees) {
      const amount = num(f?.amount ?? f?.value ?? f?.price ?? f?.fee);
      const label = f?.label ?? f?.name ?? f?.type ?? f?.description;
      if (amount === null || amount <= 0 || typeof label !== "string") continue;
      if (rows.some((r) => r.label.toLowerCase() === label.trim().toLowerCase())) continue;
      const freq = String(f?.frequency ?? f?.period ?? "").toLowerCase();
      rows.push({
        label: label.trim(),
        amount,
        frequency: /month/.test(freq) ? "monthly" : /deposit/.test(freq) ? "deposit" : "one_time",
      });
    }
  }

  const admin = num(p?.admin_fee);
  const app = num(p?.application_fee);
  const moveInFeesTotal = admin === null && app === null ? null : (admin ?? 0) + (app ?? 0);

  return { schedule: rows.length ? rows : null, moveInFeesTotal };
}

const WEEKS_PER_MONTH = 4.345;

/**
 * What the largest active concession is worth, in weeks of free rent and as a
 * percentage of one year's rent.
 *
 * Distinct from concession_spread_pct above, and the two must not be added:
 * that one measures asking-minus-effective on units currently listed, this one
 * reads the advertised offer and survives a property with nothing available.
 * Where both are populated they should roughly agree.
 */
export function concessionValue(
  activeConcessions: Array<{ description: unknown; items: unknown }>,
  monthlyRent: number | null,
): { weeksFree: number | null; pctOfRent: number | null } {
  let weeksFree: number | null = null;
  let pctOfRent: number | null = null;

  const bump = (weeks: number | null, pct: number | null) => {
    if (weeks !== null && (weeksFree === null || weeks > weeksFree)) weeksFree = weeks;
    if (pct !== null && (pctOfRent === null || pct > pctOfRent)) pctOfRent = pct;
  };

  for (const c of activeConcessions) {
    const items = Array.isArray(c.items) ? c.items : [];
    for (const it of items as Raw[]) {
      const weeks = num(it?.free_weeks ?? it?.weeks_free ?? it?.weeks);
      const months = num(it?.free_months ?? it?.months_free ?? it?.months);
      const totalWeeks = weeks !== null || months !== null
        ? (weeks ?? 0) + (months ?? 0) * WEEKS_PER_MONTH
        : null;
      const pctItem = num(it?.percent_off ?? it?.percentage ?? it?.percent ?? it?.discount_percent);
      const dollars = num(it?.amount_off ?? it?.dollar_amount ?? it?.amount ?? it?.discount_amount);
      const fromDollars = dollars !== null && monthlyRent && monthlyRent > 0
        ? (dollars / (monthlyRent * 12)) * 100
        : null;
      bump(
        totalWeeks,
        totalWeeks !== null ? (totalWeeks / 52) * 100 : (pctItem ?? fromDollars),
      );
    }

    // Fall back to the advertised text when the structured extraction is absent.
    if (typeof c.description === "string") {
      const text = c.description.toLowerCase();
      const wk = text.match(/(\d+(?:\.\d+)?)\s*weeks?\s*(?:of\s*)?free/);
      const mo = text.match(/(\d+(?:\.\d+)?)\s*months?\s*(?:of\s*)?free/);
      const half = /half\s*(?:a\s*)?month\s*free/.test(text) ? 0.5 : null;
      const months = mo ? Number(mo[1]) : half;
      const totalWeeks = wk ? Number(wk[1]) : (months !== null ? months * WEEKS_PER_MONTH : null);
      if (totalWeeks !== null) bump(totalWeeks, (totalWeeks / 52) * 100);
    }
  }

  return {
    weeksFree: weeksFree === null ? null : +(weeksFree as number).toFixed(2),
    pctOfRent: pctOfRent === null ? null : +(pctOfRent as number).toFixed(2),
  };
}

export function mapHelloDataProperty(p: any): MappedHelloData {
  const demo = p.demographics || {};
  const pricing = p.pricing_strategy || {};
  const quality = p.building_quality || {};
  const reviews = p.review_analysis || p.reviews || {};
  const avail = Array.isArray(p.building_availability)
    ? p.building_availability
    : (Array.isArray(p.availability) ? p.availability
      : (Array.isArray(p.units) ? p.units
        : (Array.isArray(p.floor_plans) ? p.floor_plans : [])));
  const concessions = Array.isArray(p.concessions_history)
    ? p.concessions_history
    : (Array.isArray(p.concessions) ? p.concessions : []);
  const ami = p.ami_limits ?? p.ami ?? p.area_median_income ?? null;

  const overallQ = typeof quality.property_overall_quality === "number"
    ? quality.property_overall_quality
    : (() => {
        const qVals = Object.values(quality).filter((v) => typeof v === "number") as number[];
        return qVals.length ? qVals.reduce((a, b) => a + b, 0) / qVals.length : null;
      })();
  const buildingQualityScore = overallQ != null ? Math.round(overallQ * 100) : null;

  const unitRent = (u: any) => pickNum(
    u.effective_price, u.price, u.min_effective_price, u.min_price,
    u.rent, u.asking_rent, u.market_rent, u.monthly_rent, u.list_price,
    u.avg_price, u.avg_effective_price, u.avg_rent,
  );
  const unitSqft = (u: any) => pickNum(
    u.sqft, u.min_sqft, u.max_sqft, u.square_feet, u.sq_ft, u.size,
    u.floor_area, u.area_sqft, u.avg_sqft,
  );
  const unitDom = (u: any) => pickNum(
    u.days_on_market, u.dom, u.days_listed, u.time_on_market, u.avg_days_on_market,
  );

  // Concession spread: the gap between advertised price and effective price on
  // available units, which is what a concession actually is. This is a real
  // signal building_availability supports, unlike market-vs-in-place rent — both
  // sides of which would come from this same array, making the comparison
  // circular. Kept as its own field; deliberately NOT routed into rent_lag.
  const concessionPairs = avail
    .map((u: any) => {
      const asking = pickNum(u.max_price, u.price);
      const effective = pickNum(u.effective_price, u.max_effective_price, u.min_effective_price);
      return asking && effective && asking > 0 ? (asking - effective) / asking : null;
    })
    .filter((v: any): v is number => typeof v === "number" && Number.isFinite(v));
  const concessionSpreadPct = concessionPairs.length
    ? +((concessionPairs.reduce((a: number, b: number) => a + b, 0) / concessionPairs.length) * 100).toFixed(2)
    : null;

  const rents = avail.map(unitRent).filter((r: any) => typeof r === "number");
  const inPlaceAvgRent = rents.length > 0
    ? Math.round(rents.reduce((a, b) => a + b, 0) / rents.length)
    // Fall back to property-level average rent when no available units are listed
    : pickNum(
        p.avg_effective_price, p.avg_price, p.avg_rent, p.average_rent, p.effective_rent,
        p.asking_rent, p.market_rent, p.median_rent, p.rent,
        pricing.avg_effective_price, pricing.avg_price, pricing.avg_rent, pricing.average_rent,
        pricing.effective_rent, pricing.asking_rent, pricing.market_rent,
      );

  const planMap: Record<string, { count: number; rentSum: number; rentCount: number; sqftSum: number; sqftCount: number; dom: number[] }> = {};
  for (const u of avail) {
    const beds = pick(u.bed, u.bedrooms, u.beds, u.bedroom_count);
    const key = beds == null ? "?" : (beds === 0 ? "Studio" : String(beds));
    if (!planMap[key]) planMap[key] = { count: 0, rentSum: 0, rentCount: 0, sqftSum: 0, sqftCount: 0, dom: [] };
    planMap[key].count += 1;
    const rent = unitRent(u);
    if (typeof rent === "number") { planMap[key].rentSum += rent; planMap[key].rentCount += 1; }
    const sqft = unitSqft(u);
    if (typeof sqft === "number") { planMap[key].sqftSum += sqft; planMap[key].sqftCount += 1; }
    const dom = unitDom(u);
    if (typeof dom === "number") planMap[key].dom.push(dom);
  }
  const bedOrder = ["Studio", "0", "1", "2", "3", "4", "5", "?"];
  const floorPlans = Object.entries(planMap)
    .map(([beds, v]) => ({
      beds,
      unit_count: v.count,
      avg_rent: v.rentCount ? Math.round(v.rentSum / v.rentCount) : null,
      avg_sqft: v.sqftCount ? Math.round(v.sqftSum / v.sqftCount) : null,
      avg_days_on_market: v.dom.length ? Math.round(v.dom.reduce((a, b) => a + b, 0) / v.dom.length) : null,
    }))
    .sort((a, b) => {
      const ai = bedOrder.indexOf(a.beds); const bi = bedOrder.indexOf(b.beds);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  const normalizedConcessions = concessions.map((c: any) => ({
    description: pick(c.concessions, c.description, c.concession_type, c.details, c.offer, c.promotion),
    start_date: pick(c.from_date, c.start_date, c.starts_at, c.effective_date),
    end_date: pick(c.to_date, c.end_date, c.ends_at, c.expiration_date),
    items: c.items ?? null,
  }));

  const now = new Date();
  const active = normalizedConcessions.filter((c: any) => {
    const end = c.end_date ? new Date(c.end_date) : null;
    return !end || end >= now;
  });
  const activeConcessionsSummary = active.length > 0
    ? active.map((c: any) => c.description).filter(Boolean).join("; ").slice(0, 500)
    : null;

  // Same 0..1 source scale as the other demographic percentages, so normalized
  // the same way — otherwise race shares would render at 1/100th of the others.
  const raceBreakdown: Record<string, number> = {};
  for (const [k, v] of Object.entries(demo)) {
    if (k.endsWith("_pop_perc") && k !== "unemployed_pop_perc" && typeof v === "number") {
      const scaled = pct(v);
      if (scaled !== null) {
        raceBreakdown[k.replace(/_pop_perc$/, "").replace(/_/g, " ")] = scaled;
      }
    }
  }
  const bachelorsPct = (typeof demo.bachelors_degree_perc === "number" ? demo.bachelors_degree_perc : 0)
    + (typeof demo.masters_degree_perc === "number" ? demo.masters_degree_perc : 0)
    + (typeof demo.graduate_professional_degree_perc === "number" ? demo.graduate_professional_degree_perc : 0);

  const sumCounts = (o: any) => o && typeof o === "object"
    ? Object.values(o).filter((n) => typeof n === "number").reduce((a: number, b: any) => a + b, 0)
    : null;
  const reviewAvgRaw = pickNum(
    typeof reviews.avg_score === "number" ? reviews.avg_score * 5 : null,
    reviews.average_rating, reviews.avg_rating, reviews.rating, reviews.overall_rating, reviews.score,
  );
  // 2dp, matching the precision the inline fetch-hellodata mapper wrote.
  const reviewAvg = reviewAvgRaw === null ? null : +reviewAvgRaw.toFixed(2);
  const reviewCount = pickNum(
    reviews.count_reviews, reviews.review_count, reviews.count,
    reviews.total_reviews, reviews.num_reviews, reviews.reviews_count,
  );

  const composedAddress = [p.street_address, p.city, p.state, p.zip_code].filter(Boolean).join(", ") || null;

  // Photos
  const toUrl = (entry: any): string | null => {
    if (!entry) return null;
    if (typeof entry === "string") return entry;
    if (typeof entry === "object") {
      return entry.url || entry.src || entry.href || entry.uri || entry.image || entry.image_url || null;
    }
    return null;
  };
  const collectFrom = (arr: any): string[] =>
    Array.isArray(arr) ? arr.map(toUrl).filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)) : [];

  let photoUrls: string[] = [];
  for (const src of [p.photos, p.building_photos, p.images, p.media, p.property_photos]) {
    const found = collectFrom(src);
    if (found.length) { photoUrls = found; break; }
  }
  if (!photoUrls.length) {
    const nested: string[] = [];
    for (const arr of [avail, Array.isArray(p.units) ? p.units : [], Array.isArray(p.floor_plans) ? p.floor_plans : []]) {
      const out: string[] = [];
      for (const u of arr as any[]) {
        out.push(...collectFrom(u?.photos));
        out.push(...collectFrom(u?.images));
        out.push(...collectFrom(u?.media));
      }
      if (out.length) { nested.push(...out); break; }
    }
    photoUrls = nested;
  }
  photoUrls = Array.from(new Set(photoUrls)).slice(0, 12);

  // --- Rent trajectory ------------------------------------------------------
  const rentHistory = collectRentHistory(p, avail);
  const rentTrend3mo = sameUnitRentTrendPct(rentHistory, 3);
  const rentTrend12mo = sameUnitRentTrendPct(rentHistory, 12);

  // --- Leasing velocity -----------------------------------------------------
  // An empty availability array is a fact (nothing on the market); a missing one
  // is not. Only the first should read as zero exposure.
  const hasAvailArray = Array.isArray(p.building_availability) ||
    Array.isArray(p.availability) || Array.isArray(p.units);
  const unitsAvailable = hasAvailArray ? avail.length : null;
  const totalUnits = pickNum(p.number_units, p.unit_count, p.units, p.number_units_prediction);
  const exposurePct = unitsAvailable !== null && totalUnits && totalUnits > 0
    ? +((unitsAvailable / totalUnits) * 100).toFixed(2)
    : null;
  const medianDom = (() => {
    const doms = avail.map(unitDom).filter((d: number | null): d is number => typeof d === "number");
    const m = median(doms);
    return m === null ? null : Math.round(m);
  })();

  // --- Fees, amenities, room-level condition --------------------------------
  const { schedule: feeSchedule, moveInFeesTotal } = buildFeeSchedule(p);
  const buildingAmenities = normalizeAmenities(p.building_amenities ?? p.amenities);
  const unitAmenities = normalizeAmenities(p.unit_amenities);
  const qualityDetail = (() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(quality)) {
      const n = num(v);
      if (n !== null) out[k] = Math.round(n * 100);
    }
    return Object.keys(out).length ? out : null;
  })();

  // --- Concession economics -------------------------------------------------
  const { weeksFree, pctOfRent } = concessionValue(active, inPlaceAvgRent);

  // --- Unit count and vintage, with provenance ------------------------------
  // The prediction is used only where the filed value is missing, and the deal
  // carries a flag saying so, because both fields gate the buy box.
  const filedUnits = pickNum(p.number_units, p.unit_count, p.units);
  const predictedUnits = pickNum(p.number_units_prediction);
  const unitCount = filedUnits ?? predictedUnits;
  const filedVintage = pickNum(p.year_built, p.vintage_year, p.built_year);
  const predictedVintage = pickNum(p.year_built_prediction);
  const vintageYear = filedVintage ?? predictedVintage;

  const update: Record<string, any> = {
    // Intake-visible fields
    property_name: pick(p.building_name, p.property_name, p.name),
    street_address_raw: pick(p.street_address, p.address_line_1, p.addr1),
    city: pick(p.city),
    state: pick(p.state, p.state_code),
    zip: pick(p.zip_code, p.zip, p.postal_code),
    unit_count: unitCount,
    vintage_year: vintageYear,
    unit_count_is_estimated: unitCount === null ? null : filedUnits === null,
    vintage_is_estimated: vintageYear === null ? null : filedVintage === null,

    // Enrichment fields (persisted by hellodata-enrich)
    msa: pick(p.msa, p.metro, p.metropolitan_area),
    management_company: pick(p.management_company, p.manager, p.property_manager),
    median_income_tract: pickNum(demo.median_income, demo.median_household_income, demo.household_median_income),
    median_rent_tract: pickNum(demo.median_rent, demo.median_gross_rent),
    median_age_tract: pickNum(demo.median_age),
    // Summed first, converted second: three fractions summed then scaled, not
    // three scaled values summed (same result, but the order is load-bearing if
    // the guard ever sees a value > 1).
    bachelors_pct_tract: pct(bachelorsPct > 0 ? bachelorsPct : pickNum(demo.bachelors_degree_perc)),
    vacancy_rate_tract: pct(pickNum(demo.vacant_housing_units_perc, demo.vacancy_rate, demo.vacancy_perc)),
    owner_occupied_pct_tract: pct(pickNum(demo.owner_occupied_housing_units_perc, demo.owner_occupied_pct, demo.owner_occupied_perc)),
    population_density_tract: pickNum(demo.pop_density, demo.population_density, demo.density),
    race_breakdown_tract: Object.keys(raceBreakdown).length ? raceBreakdown : null,
    building_quality_score: buildingQualityScore,
    is_lease_up: pick(p.is_lease_up, p.lease_up),
    uses_rev_management: pick(pricing.is_using_rev_management, pricing.uses_rev_management),
    // NOTE: this is the average ASKING rent on available units, not tenant-paid
    // in-place rent. See scoreRentLag in src/lib/dealScoring.ts.
    in_place_avg_rent: inPlaceAvgRent,
    concession_spread_pct: concessionSpreadPct,
    // Whole days, matching the integer the inline mapper wrote.
    avg_time_on_market: (() => {
      const d = pickNum(pricing.avg_time_on_market, pricing.avg_dom, pricing.average_time_on_market);
      return d === null ? null : Math.round(d);
    })(),
    avg_price_change: pickNum(pricing.avg_price_change, pricing.average_price_change),
    avg_posting_duration: pickNum(pricing.avg_duration, pricing.avg_posting_duration, pricing.average_duration),
    active_concessions_summary: activeConcessionsSummary,
    concessions_history: normalizedConcessions.length ? normalizedConcessions : null,
    floor_plans: floorPlans.length ? floorPlans : null,
    ami_limits: ami,
    review_avg_rating: reviewAvg,
    review_count: reviewCount,
    review_positive_count: sumCounts(reviews.positive_counts) ?? pickNum(reviews.positive_count, reviews.positive),
    review_negative_count: sumCounts(reviews.negative_counts) ?? pickNum(reviews.negative_count, reviews.negative),
    property_phone: pick(p.building_phone_number, p.phone, p.phone_number, p.contact_phone),
    property_website: pick(p.building_website, p.website, p.url, p.site_url),
    property_address: pick(composedAddress, p.address, p.full_address),
    photo_urls: photoUrls.length ? photoUrls : null,

    // --- Fields below read the cached payload only. No extra API call. ------
    rent_trend_3mo_pct: rentTrend3mo,
    rent_trend_12mo_pct: rentTrend12mo,
    units_available: unitsAvailable,
    exposure_pct: exposurePct,
    median_days_on_market: medianDom,
    concession_weeks_free: weeksFree,
    concession_pct_of_rent: pctOfRent,
    fee_schedule: feeSchedule,
    move_in_fees_total: moveInFeesTotal,
    building_amenities: buildingAmenities,
    unit_amenities: unitAmenities,
    building_quality_detail: qualityDetail,
    is_student_housing: bool(p.is_student),
    is_senior_housing: bool(p.is_senior),
    is_affordable_housing: bool(p.is_affordable),
    is_build_to_rent: bool(p.is_build_to_rent),
    is_condo: bool(p.is_condo),
    is_single_family: bool(p.is_single_family),
    number_stories: pickNum(p.number_stories) ?? pickNum(p.number_stories_prediction),
    census_tract_id: pick(p.census_tract_id, p.census_tract, p.tract_id),
    street_view_url: pick(p.street_view_url),
  };

  const field_coverage: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(update)) {
    const present = !(v === null || v === undefined || v === "" ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0));
    field_coverage[k] = present;
  }

  return { update, photoUrls, field_coverage };
}
