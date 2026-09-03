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

export type MappedHelloData = {
  update: Record<string, any>;
  photoUrls: string[];
  field_coverage: Record<string, boolean>;
};

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

  const raceBreakdown: Record<string, number> = {};
  for (const [k, v] of Object.entries(demo)) {
    if (k.endsWith("_pop_perc") && k !== "unemployed_pop_perc" && typeof v === "number") {
      raceBreakdown[k.replace(/_pop_perc$/, "").replace(/_/g, " ")] = v;
    }
  }
  const bachelorsPct = (typeof demo.bachelors_degree_perc === "number" ? demo.bachelors_degree_perc : 0)
    + (typeof demo.masters_degree_perc === "number" ? demo.masters_degree_perc : 0)
    + (typeof demo.graduate_professional_degree_perc === "number" ? demo.graduate_professional_degree_perc : 0);

  const sumCounts = (o: any) => o && typeof o === "object"
    ? Object.values(o).filter((n) => typeof n === "number").reduce((a: number, b: any) => a + b, 0)
    : null;
  const reviewAvg = pickNum(
    typeof reviews.avg_score === "number" ? reviews.avg_score * 5 : null,
    reviews.average_rating, reviews.avg_rating, reviews.rating, reviews.overall_rating, reviews.score,
  );
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

  const update: Record<string, any> = {
    // Intake-visible fields
    property_name: pick(p.building_name, p.property_name, p.name),
    street_address_raw: pick(p.street_address, p.address_line_1, p.addr1),
    city: pick(p.city),
    state: pick(p.state, p.state_code),
    zip: pick(p.zip_code, p.zip, p.postal_code),
    unit_count: pickNum(p.number_units, p.unit_count, p.units),
    vintage_year: pickNum(p.year_built, p.vintage_year, p.built_year),

    // Enrichment fields (persisted by hellodata-enrich)
    msa: pick(p.msa, p.metro, p.metropolitan_area),
    management_company: pick(p.management_company, p.manager, p.property_manager),
    median_income_tract: pickNum(demo.median_income, demo.median_household_income, demo.household_median_income),
    median_rent_tract: pickNum(demo.median_rent, demo.median_gross_rent),
    median_age_tract: pickNum(demo.median_age),
    bachelors_pct_tract: bachelorsPct > 0 ? bachelorsPct : pickNum(demo.bachelors_degree_perc),
    vacancy_rate_tract: pickNum(demo.vacant_housing_units_perc, demo.vacancy_rate, demo.vacancy_perc),
    owner_occupied_pct_tract: pickNum(demo.owner_occupied_housing_units_perc, demo.owner_occupied_pct, demo.owner_occupied_perc),
    population_density_tract: pickNum(demo.pop_density, demo.population_density, demo.density),
    race_breakdown_tract: Object.keys(raceBreakdown).length ? raceBreakdown : null,
    building_quality_score: buildingQualityScore,
    is_lease_up: pick(p.is_lease_up, p.lease_up),
    uses_rev_management: pick(pricing.is_using_rev_management, pricing.uses_rev_management),
    in_place_avg_rent: inPlaceAvgRent,
    avg_time_on_market: pickNum(pricing.avg_time_on_market, pricing.avg_dom, pricing.average_time_on_market),
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
