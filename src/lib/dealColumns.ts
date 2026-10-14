/**
 * Explicit column list for deal LIST queries. Excludes the wide jsonb blobs no
 * list view renders (hellodata_raw, floor_plans, concessions_history,
 * ami_limits, race_breakdown_tract, rent_comps, sales_comps, documents,
 * photo_urls, photos, fee_schedule, building_amenities, unit_amenities,
 * building_quality_detail). Detail views select "*".
 * Measured: select("*") over 64 deals = ~4.2 MB; this list = ~2.1 MB.
 *
 * hellodata_payload is NOT here, and that is the single biggest thing about
 * this list. Measured on 97 deals with EXPLAIN (ANALYZE, SERIALIZE):
 *
 *   id, name, hellodata_payload          462 ms   34 MB on the wire
 *   id, name, payload->market_rent         45 ms    7 kB
 *   id, name, plain scalars              4.6 ms    9 kB
 *
 * Every list and dashboard load was shipping 34 MB to read one number per
 * deal: the market rent for the rent-lag calculation. The three arrow selects
 * below pull exactly that number, server-side, under its three known key
 * spellings. Bulk rescoring genuinely needs the whole blob and uses
 * DEAL_SCORING_COLUMNS instead — the same split as useMapDeals, for the same
 * reason: one column set cannot serve a cheap path and an expensive one.
 *
 * The scalar HelloData-derived fields (rent_trend_*, exposure_pct,
 * concession_*, the is_* subtype flags) ARE listed: they are a few bytes each
 * and they are what a pipeline view would filter and sort on.
 */
export const DEAL_LIST_COLUMNS =
  "active_concessions_summary,address,affordable,ai_score,ai_score_summary,analyst_grade,annual_population_growth,area_median_income,area_median_income_1mi,asking_price,assigned_to,avg_posting_duration,avg_price_change,avg_time_on_market,bachelors_pct_tract,broker,building_quality_score,census_tract_id,cfo_date,cfo_note,city,classic_units_remaining,concession_pct_of_rent,concession_weeks_free,created_at,deal_tier,denial_overview,denial_overview_at,denial_themes,denial_themes_at,dscr,enriched_at,equity_multiple,estimated_equity,exit_cap,expense_ratio,exposure_pct,factor_scores,grm,gross_scheduled_rent,hard_filter_failures,hellodata_error,hellodata_id,hellodata_last_synced_at,hellodata_status,hold_period_years,id,in_place_avg_rent,in_place_cap_rate,inbox_deal_id,interest_level,interest_rate,is_affordable_housing,is_build_to_rent,is_condo,is_lease_up,is_senior_housing,is_single_family,is_student_housing,job_growth_pct,last_scored_at,latitude,loan_term_years,longitude,ltv,management_company,market_cap_rate,marketed,median_age_tract,median_days_on_market,median_income_tract,median_rent_tract,move_in_fees_total,msa,nearest_employment_node_min,new_supply_pct_of_stock,notes,number_stories,occupancy_pct,owner_occupied_pct_tract,passes_hard_filters,pillar_scores,pipeline_stage,population_density_tract,population_growth_pct,price_per_sqft,projected_irr,property_address,property_name,property_phone,property_website,raise_archive_note,raise_archived_at,raise_archived_by,raise_status,regulatory_risk,renovation_budget_per_unit,rent_trend_12mo_pct,rent_trend_3mo_pct,review_avg_rating,review_count,review_negative_count,review_positive_count,school_rating,score_confidence,score_coverage,score_thesis_adjustment,scored_at,source,stabilized_cap_rate,stabilized_noi,stabilized_rent,state,status,street_view_url,t12_noi,t12_opex,target_raise,total_capex,total_committed,total_renovated_units,total_score,total_sqft,unit_count,unit_count_is_estimated,units_available,updated_at,uses_rev_management,vacancy_rate_tract,value_add_potential,value_add_upside,vintage_is_estimated,vintage_year,year1_coc,zip,hd_market_rent_per_unit:hellodata_payload->market_rent_per_unit,hd_avg_market_rent:hellodata_payload->avg_market_rent,hd_market_rent:hellodata_payload->market_rent";

/**
 * The list columns PLUS the raw payload, for bulk rescoring.
 *
 * scoreDeal() reads market rent, occupancy, quality_score, expense_ratio, egr
 * and the renovation premium out of hellodata_payload, so a rescore cannot use
 * the trimmed list. This is deliberately the slow query: it runs on an explicit
 * action, not on page load.
 */
export const DEAL_SCORING_COLUMNS = DEAL_LIST_COLUMNS + ",hellodata_payload";
