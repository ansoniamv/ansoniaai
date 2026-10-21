-- Partner outreach template: a Data Room category for the emails Ansonia sends
-- capital partners when a new deal opens, and the first such template, built
-- from three emails the team has sent.
--
-- The template leaves every deal figure blank (___ or [label]).
-- draft-partner-outreach fills the blanks from the deal's uploaded OM, rent
-- roll and T12 and its deal record, and writes one draft per deal. The Draft
-- Outreach dialog on the capital raise tab turns that draft into an unsent
-- Outlook draft per partner.
--
-- A template is not a fact about the firm, so it stays out of the Company
-- Brief (include_in_brief = false); the app keeps it out when a source is
-- moved into this category.

ALTER TABLE public.data_room_sources DROP CONSTRAINT IF EXISTS data_room_sources_category_check;
ALTER TABLE public.data_room_sources ADD CONSTRAINT data_room_sources_category_check
  CHECK (category IN ('company', 'strategy', 'pro_forma', 'investor_deck',
                      'track_record', 'market', 'operations', 'partner_outreach', 'other'));

-- Seeded as ready: a note's text is the template itself, and the drafter reads
-- the body directly. "Read again" on the Data Room page writes the AI summary
-- and search passages like any other note.
INSERT INTO public.data_room_sources (kind, title, category, body, include_in_brief, status, summary, processed_at)
SELECT 'note', 'New JV opportunity email (partner outreach)', 'partner_outreach', $tpl$
How we write the first email to a capital partner about a new deal. Every blank (___ or [label]) is filled for the deal being sent, from its OM, rent roll, T12 and deal record. The examples further down show tone and phrasing only; their figures are blanked on purpose.

Subject line
- "New JV Opportunity - Ansonia Properties" for a marketed deal.
- "Offmarket Opportunity - Ansonia Properties" when the deal is off-market or not yet on the market.

TEMPLATE

Hey [first name] –

We're pursuing a new deal called [property name], a [unit count]-unit, [vintage]-vintage [product type] in [submarket / city, state] – and wanted to see if you're interested in looking at it with us.

[Location and demand, 1–2 sentences: school district rating, nearby employment and retail nodes, drive time to downtown, 1-/3-/5-mile avg. HH income of ___ / ___ / ___.]

[Thesis and why us, 2–3 sentences: in-place rents ___ below the comp set / market, loss-to-lease of ___%, occupancy of ___%, what ownership has already spent and what interior work remains, RUBS and ancillary income; what Ansonia already owns or manages nearby or in the same product type.]

[Property name] Deal Points:
* Units / Vintage: ___ / ___
* Asset Profile: ___
* Purchase Price: ___ (~$___/unit)
* Going-In Cap / Stabilized Yield-on-Cost: ___% / ___%
* 5-Yr IRR / Equity Multiple: ___%+ / ___x+
* Avg. Cash Yield: ___%+
* Total Equity Check: ~$___M
* CFO: ___

I've attached the OM & happy to send the model if you're interested in reviewing with us.

Best,
Phillip

Phillip M. Vdovets
Ansonia Properties, LLC
815 W Van Buren St, Suite 550
Chicago, IL 60607
C (847) 505-4282

RULES
- Use the deal-point bullets we can fill, in this order; drop a bullet we have nothing for rather than guessing.
- Returns (IRR, equity multiple, yield-on-cost, cash yield) come from our underwriting, not the OM's; leave them blank for a person to fill if no source states them.
- Round the way the examples do: "19%+ / 2.0x+", "~$17M", "Mid $40M", "$140K".
- Off-market or before financials: shorter. Name, city, a few bullets (units, vintage, floorplans, expected pricing), what we know about the submarket, and an offer to share underwriting once financials arrive.
- Tone: direct, confident, specific. Numbers rather than adjectives. No hype words, no exclamation marks. About 150–250 words before the signature.
- The signature block is always exactly as above.

EXAMPLES (figures blanked; for tone and phrasing only)

=== Example 1 (marketed deal) ===
Subject: New JV Opportunity - Ansonia Properties

Hey Bart –

We're pursuing a new deal called Estates at New Albany, a multifamily asset located in the New Albany suburb of Columbus, OH – and wanted to see if you're interested in looking at it with us.

This asset is located in one of the best school districts in Columbus (___ Niche Rating), the New Albany, Gahanna, and Easton retail & employment nodes while also being proximate to downtown Columbus (___-min). The 1-, 3-, 5-mile avg. HH income is ___, ___, ___, respectively.

We know this product extremely well: we've recently bought a deal that has similar townhome-style units in Sunbury, OH – of the ___ total units at this property, there are ___ townhome units and ___ units with bonus loft or den - average unit size is ___sqft.

Attached the condensed OM for your reference, our model is ready to share, if of interest. In the meantime, below is a quick snapshot with key deal points:

Estates at New Albany Deal Points:
* Units / Vintage: ___ units / ___ YOC
* Asset Profile: Value-add
* IRR / EM: ___%+ / ___x+
* Stabilized Yield-on-Cost: ___%+
* Total Equity Check: ~$___m

Initial call for offers has not yet been set but anticipate it taking place in ___ – I've attached the OM – let me know if you'd like to see the model.

Best,
Phillip

=== Example 2 (marketed deal, new contact at the firm) ===
Subject: New JV Opportunity - Ansonia Properties

Declaration team - reaching out since my prior contact, George Roux, left the firm.

Sharing a Chicago-area opportunity - Randall Highlands - a ___-unit, ___-vintage townhome community in North Aurora, in the Fox Valley corridor just north of I-88 (___ average HH income). All two- and three-bedroom units averaging ___ SF with private entries and attached two-car garages - effectively single-family living, and there is very little competing product like it in the submarket.

The thesis is straightforward. In-place rents sit roughly $___/SF below the comp set despite the larger floor plans. Ownership already put $___ into roofs and amenities, so the remaining lift is interior - cabinet fronts, lighting, LVP and finishing their refrigerator program - alongside loss-to-lease burnoff, RUBS and ancillary income.

High-Level Deal Points:
- Units / Vintage: ___ / ___
- Asset Profile: Townhome, value-add, western suburbs
- Purchase Price: ___ (~$___/unit for TH product)
- Going-In Cap / Stabilized Yield-on-Cost: ___% / ___%
- 5-Yr IRR / Equity Multiple: ___%+ / ___x+
- Avg. Cash Yield: ___%+
- Total Equity Check: ~$___M (Ansonia willing to contribute in excess of a typical 90/10 or 80/20 structure)
- CFO: ___

I've attached the OM & happy to send the model if you're interested in reviewing with us.

Best,
Phillip

=== Example 3 (off-market, before financials) ===
Subject: Offmarket Opportunity - Ansonia Properties

Hey [first name] – wanted to flag a deal we've been tracking for a while that we expect to hit the market in the next month or so. We should have an early look and expect to receive financials as soon as next week.

Arlington Club Apartments (Wheeling, IL)
* ___ units
* ___ vintage
* Large 1- and 2-bedroom floorplans
* Expected pricing: ___

We already own and manage in the submarket and know the asset and competitive set well. Household incomes in the area are ___+, and most of the units have not been renovated in ___+ years, i.e., there is a meaningful value-add opportunity.

Would you have interest in looking at this with us? Happy to share our underwriting and financials once we receive the information.

Best,
Phillip
$tpl$, false, 'ready',
  'Fill-in-the-blanks template for the first email to capital partners about a new deal: subject line, structure, deal-point bullets, rules and signature, plus three example emails with their figures blanked.',
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.data_room_sources WHERE category = 'partner_outreach');
