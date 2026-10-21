-- Partner outreach template: back in its category, and a fourth example.
--
-- The seeded template (20261023120000) was moved to category 'other' with
-- include_in_brief on, from the Data Room page at 21:07 UTC on 2026-10-21.
-- draft-partner-outreach reads only 'partner_outreach' sources, so it found no
-- template. This puts the row back and keeps it out of the Company Brief.
--
-- Example 4 is the short off-market check-in to a partner we have not spoken
-- to in a while, sent before underwriting is done. Its figures are blanked
-- like the others'.

UPDATE public.data_room_sources
SET category = 'partner_outreach',
    include_in_brief = false,
    body = body || $ex$

=== Example 4 (off-market, early look, partner we have not spoken to in a while) ===
Subject: Offmarket Opportunity - Ansonia Properties

Hey [first name] – been awhile! Hope you've been well. Writing as we're currently evaluating an interesting off-market value-add opportunity in a top-tier ___ suburb. ~___ units, $___M, ___ construction.

Does that profile match your current investment appetite? If so, happy to send along more information. Opportunity was just brought to us and we're still working through our initial underwriting...but given it's off-market and there's a potential need to move quickly, wanted to get in front of you early so that--if it is of interest--we could start conversations early and review contemporaneously.

Let us know your thoughts -- and even if not of interest, would be great to hop on a call with your team and hear what's a better fit for you today.

Best,
Phillip
$ex$
WHERE kind = 'note'
  AND title = 'New JV opportunity email (partner outreach)'
  AND category IN ('other', 'partner_outreach')
  AND body NOT LIKE '%=== Example 4%';
