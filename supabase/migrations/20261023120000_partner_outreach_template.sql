-- Partner outreach template: a Data Room category for the emails Ansonia sends
-- capital partners when a new deal opens, and the first such template, built
-- from three emails the team has sent.
--
-- draft-partner-outreach reads every ready source in this category as its
-- style guide and writes one draft per deal, which the Draft Outreach dialog on
-- the capital raise tab turns into an unsent Outlook draft per partner.
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
How we write the first email to a capital partner about a new deal. Follow the structure and tone of the examples below; take every fact from the deal, never from the examples.

Subject line
- "New JV Opportunity - Ansonia Properties" for a marketed deal.
- "Offmarket Opportunity - Ansonia Properties" when the deal is off-market or not yet on the market.

Structure
1. Greeting: "Hey {first name} –". Short and informal.
2. One or two sentences: the deal name, what it is (unit count, vintage, product type), where it is, and the ask ("wanted to see if you're interested in looking at it with us").
3. Location and demand: school district rating, nearby employment and retail nodes, drive time to downtown, average household income (1/3/5-mile when we have it).
4. Thesis and why us: what the value-add is (rents below comps, interiors untouched, loss-to-lease, RUBS, ancillary income), and what we already own or manage nearby or in the same product type.
5. "Deal Points" bullets, label: value. Use the ones we have, in this order: Units / Vintage; Asset Profile; Purchase Price (with $/unit); Going-In Cap / Stabilized Yield-on-Cost; 5-Yr IRR / Equity Multiple (written as "19%+ / 2.0x+"); Avg. Cash Yield; Total Equity Check (approximate, "~$17M"); CFO (call for offers) date.
6. Close: what is attached (the OM), offer to send the model, timing of the call for offers.
7. Sign-off "Best,\nPhillip" then the signature block exactly as below.

Tone: direct, confident, specific. Numbers rather than adjectives. No hype words, no exclamation marks. About 150–250 words before the signature.

Signature (always, verbatim):
Phillip M. Vdovets
Ansonia Properties, LLC
815 W Van Buren St, Suite 550
Chicago, IL 60607
C (847) 505-4282

=== Example 1 (marketed deal) ===
Subject: New JV Opportunity - Ansonia Properties

Hey Bart –

We're pursuing a new deal called Estates at New Albany, a multifamily asset located in the New Albany suburb of Columbus, OH – and wanted to see if you're interested in looking at it with us.

This asset is located in one of the best school districts in Columbus (A+ Niche Rating), the New Albany, Gahanna, and Easton retail & employment nodes while also being proximate to downtown Columbus (15-min). The 1-, 3-, 5-mile avg. HH income is $106k, 121k, 113k, respectively.

We know this product extremely well: we've recently bought a deal that has similar townhome-style units in Sunbury, OH – of the 428 total units at this property, there are 92 townhome units and 113 units with bonus loft or den - average unit size is 1,185sqft.

Attached the condensed OM for your reference, our model is ready to share, if of interest. In the meantime, below is a quick snapshot with key deal points:

Estates at New Albany Deal Points:
* Units / Vintage: 428 units / 1998-2000 YOC
* Asset Profile: Value-add
* IRR / EM: 19%+ / 2.0x+
* Stabilized Yield-on-Cost: 7.0%+
* Total Equity Check: ~$44m

Initial call for offers has not yet been set but anticipate it taking place in early June – I've attached the OM – let me know if you'd like to see the model.

Best,
Phillip

Phillip M. Vdovets
Ansonia Properties, LLC
815 W Van Buren St, Suite 550
Chicago, IL 60607
C (847) 505-4282

=== Example 2 (marketed deal, new contact at the firm) ===
Subject: New JV Opportunity - Ansonia Properties

Declaration team - reaching out since my prior contact, George Roux, left the firm.

Sharing a Chicago-area opportunity - Randall Highlands - a 146-unit, 2013-vintage townhome community in North Aurora, in the Fox Valley corridor just north of I-88 ($140K average HH income). All two- and three-bedroom units averaging 1,469 SF with private entries and attached two-car garages - effectively single-family living, and there is very little competing product like it in the submarket.

The thesis is straightforward. In-place rents sit roughly $0.20/SF below the comp set despite the larger floor plans. Ownership already put $5.5M into roofs and amenities, so the remaining lift is interior - cabinet fronts, lighting, LVP and finishing their refrigerator program - alongside loss-to-lease burnoff, RUBS and ancillary income.

High-Level Deal Points:
- Units / Vintage: 146 / 2013
- Asset Profile: Townhome, value-add, western suburbs
- Purchase Price: Mid $40M (~$300K/unit for TH product)
- Going-In Cap / Stabilized Yield-on-Cost: 5.3% / 6.5%
- 5-Yr IRR / Equity Multiple: 19%+ / 2.0x+
- Avg. Cash Yield: 7%+
- Total Equity Check: ~$17M (Ansonia willing to contribute in excess of a typical 90/10 or 80/20 structure)
- CFO: September 10

I've attached the OM & happy to send the model if you're interested in reviewing with us.

Best,
Phillip

Phillip M. Vdovets
Ansonia Properties, LLC
815 W Van Buren St, Suite 550
Chicago, IL 60607
C (847) 505-4282

=== Example 3 (off-market, before financials) ===
Subject: Offmarket Opportunity - Ansonia Properties

Hey {first name} – wanted to flag a deal we've been tracking for a while that we expect to hit the market in the next month or so. We should have an early look and expect to receive financials as soon as next week.

Arlington Club Apartments (Wheeling, IL)
* 430 units
* 1987 vintage
* Large 1- and 2-bedroom floorplans
* Expected pricing: $100–$110M

We already own and manage in the submarket and know the asset and competitive set well. Household incomes in the area are $125K+, and most of the units have not been renovated in 20+ years, i.e., there is a meaningful value-add opportunity.

Would you have interest in looking at this with us? Happy to share our underwriting and financials once we receive the information.

Best,
Phillip

Phillip M. Vdovets
Ansonia Properties, LLC
815 W Van Buren St, Suite 550
Chicago, IL 60607
C (847) 505-4282
$tpl$, false, 'ready',
  'Template for the first email to capital partners about a new deal: subject line, structure, tone, deal-point bullets and signature, with three example emails (two marketed, one off-market).',
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.data_room_sources WHERE category = 'partner_outreach');
