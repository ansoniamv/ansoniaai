-- Bring the buy-box thesis in line with the portfolio it describes.
--
-- The thesis last changed on 2026-07-01 and led with "Sunbelt and Midwest". The
-- portfolio on ansoniaproperties.com is 16 current assets: 10 Illinois (5 of them
-- Chicago, plus West Dundee, Naperville, St. Charles, Wheeling, Downers Grove and
-- Freeport), 3 Texas, 1 Ohio, 1 Wisconsin. Three of sixteen are Sunbelt. It is a
-- Chicago-led Midwest book with a Texas position, not a Sunbelt book.
--
-- Vintage drifted too. 2101 S. Michigan (1971), Fairways of Naperville (1985),
-- The Crossings at St. Charles (1988) and Alara North Burnet (mid-1980s) all sit
-- outside the stated 1990-2020 preference, and Fielder Crossing (137 units) is
-- below the stated 150+ floor, with Sunbury Commons at 152 and Alara at 160 only
-- just clearing it.
--
-- This matters because the thesis is not decoration: deal-score feeds it to the
-- model for the thesis-alignment adjustment. A thesis that disowns four of the
-- firm's own buildings teaches the scorer to mark down exactly the deals the firm
-- actually buys. The numbers below are unchanged where they are already enforced
-- in DEFAULT_BENCHMARKS; only the wording that contradicted the portfolio moved.
--
-- Written to match what the portfolio shows. If the Sunbelt emphasis is the
-- forward-looking intent rather than a description, say so here explicitly, so
-- the model is told it is a target rather than a filter.

update public.buy_box_thesis
set content = 'We target value-add multifamily in the Midwest and Sunbelt, with the existing book concentrated in Chicagoland and secondary Illinois/Ohio markets plus a Texas position (Austin, Dallas-Fort Worth, Denton). We are actively expanding the Sunbelt share. We look for in-place rents lagging market by 10%+, constrained supply pipelines, and population/job growth at or above national averages. Prefer 1985-2020 vintage and 150+ units, though 120+ units is workable in a submarket we already operate in. Operational upside is the core thesis: no revenue management, high concessions, dated interiors, below-market expense ratios. Avoid markets with >5% new supply as % of stock, declining population, or median income below $55k. Strong school districts and access to employment nodes are positive signals. Proximity to an asset we already own or have operated is a material positive: known submarket, management in place, operating leverage.',
    updated_at = now();
