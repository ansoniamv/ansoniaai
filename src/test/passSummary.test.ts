import { describe, it, expect } from "vitest";
import {
  emailText,
  mentionsDeal,
  newPart,
  planUpdates,
  quoteHolds,
  sourceTexts,
  type CriteriaUpdate,
  type Email,
} from "../../supabase/functions/_shared/passSummary";

const partnerEmail: Email = {
  id: "m-partner",
  date: "2026-09-10T19:36:57Z",
  from: "someone@partnerfirm.com",
  partner_sent: true,
  subject: "RE: Randall Highlands",
  body: "Unfortunately, we'll have to pass. We don't invest in the Chicago suburbs.",
};
const ourEmail: Email = {
  id: "m-ours",
  date: "2026-09-11T10:00:00Z",
  from: "analyst@ansoniaproperties.com",
  partner_sent: false,
  subject: "Re: Randall Highlands",
  body: "Understood. Our sense is they need a $40M minimum now.",
};
const texts = sourceTexts("too small, $50M minimum investment", [partnerEmail, ourEmail]);
const ctx = { deal_id: "deal-1", engagement_id: "eng-1" };
const PASS_AT = "2026-09-10T20:00:00Z";

const up = (u: Partial<CriteriaUpdate>): CriteriaUpdate => ({
  field: "geography_avoid",
  market: null,
  amount_m: null,
  status: null,
  available_from: null,
  detail: null,
  quote: "We don't invest in the Chicago suburbs.",
  source: "m-partner",
  ...u,
});

const basePartner = {
  manual_fields: [] as string[],
  enriched_fields: {} as Record<string, any>,
  geography: ["Chicago"],
  geography_avoid: [] as string[],
  min_equity_m: null as number | null,
  capital_status: null as string | null,
  capital_status_as_of: null as string | null,
  strategy_value_add: true,
};

describe("mentionsDeal", () => {
  it("matches a deal by its most distinctive word", () => {
    expect(mentionsDeal("thanks for thinking of us on Canterfield", "1900 At Canterfield")).toBe(true);
    expect(mentionsDeal("COMING SOON: Randall Highlands | Value-Add", "Randall Highlands")).toBe(true);
  });
  it("does not match a different word that starts the same", () => {
    expect(mentionsDeal("our Canterbury fund", "1900 At Canterfield")).toBe(false);
  });
});

describe("newPart", () => {
  it("drops the quoted thread under the reply", () => {
    const body = "We'll pass on this one.\r\n\r\nFrom: Analyst <a@ansoniaproperties.com>\r\nSent: ...\r\nOld text";
    expect(newPart(body)).toBe("We'll pass on this one.");
  });
});

describe("emailText", () => {
  it("reads the HTML body (body_text is never synced) and stops at Outlook's quoted thread", () => {
    const body_html =
      '<html><head><style>p{margin:0}</style></head><body><div>Phill,</div><div><br></div>' +
      "<div>Unfortunately, we&#39;ll have to pass.</div><div>We have limited availability in our current fund for additional multifamily investments in Illinois.</div>" +
      '<hr><div id="divRplyFwdMsg"><b>From:</b> Analyst</div><div>COMING SOON: Randall Highlands</div></body></html>';
    const text = emailText({ body_html, preview: "Phill, Unfortunately, we'll have to pass. We have limited availability in our current fund for additional multifamil" });
    expect(text).toContain("additional multifamily investments in Illinois.");
    expect(text).not.toContain("COMING SOON");
    expect(text).not.toContain("margin");
  });
});

describe("quoteHolds", () => {
  it("accepts the partner's words from pass notes or their email, despite spacing and curly quotes", () => {
    expect(quoteHolds("too small,  $50M minimum", "feedback", texts)).toBe(true);
    expect(quoteHolds("We don’t invest in the Chicago suburbs", "m-partner", texts)).toBe(true);
  });
  it("rejects a paraphrase", () => {
    expect(quoteHolds("They avoid suburban Chicago", "m-partner", texts)).toBe(false);
  });
  it("rejects anything an Ansonia email says about them", () => {
    expect(quoteHolds("they need a $40M minimum now", "m-ours", texts)).toBe(false);
  });
});

describe("planUpdates", () => {
  it("adds an avoided market and stamps it with the deal it came from", () => {
    const p = { ...basePartner, geography: [] };
    const plan = planUpdates(p, [up({ market: "Chicago suburbs" })], texts, PASS_AT, ctx);
    expect(plan.write.geography_avoid).toEqual(["Chicago suburbs"]);
    expect(plan.write.enriched_fields.geography_avoid).toMatchObject({ source: "deal_pass", deal_id: "deal-1", message_ids: ["m-partner"] });
    expect(plan.records[0].outcome).toBe("applied");
  });

  it("suggests instead when the avoided market contradicts where they invest", () => {
    const plan = planUpdates(basePartner, [up({ market: "chicago" })], texts, PASS_AT, ctx);
    expect(plan.write).toEqual({});
    expect(plan.suggestions[0]).toMatchObject({ type: "avoided_market_add", proposed_value: "chicago" });
  });

  it("suggests instead when a person locked the field", () => {
    const p = { ...basePartner, geography: [], manual_fields: ["geography_avoid"] };
    const plan = planUpdates(p, [up({ market: "Chicago suburbs" })], texts, PASS_AT, ctx);
    expect(plan.write).toEqual({});
    expect(plan.records[0].outcome).toBe("suggested");
  });

  it("fills a blank minimum from the pass notes", () => {
    const plan = planUpdates(basePartner, [up({ field: "min_equity_m", amount_m: 50, quote: "$50M minimum investment", source: "feedback" })], texts, PASS_AT, ctx);
    expect(plan.write.min_equity_m).toBe(50);
    // Pass notes carry no date of their own, so the pass date stands in.
    expect(plan.write.enriched_fields.min_equity_m.as_of).toBe(PASS_AT);
  });

  it("never overwrites a minimum someone typed in", () => {
    const p = { ...basePartner, min_equity_m: 10 };
    const plan = planUpdates(p, [up({ field: "min_equity_m", amount_m: 50, quote: "$50M minimum investment", source: "feedback" })], texts, PASS_AT, ctx);
    expect(plan.write).toEqual({});
    expect(plan.suggestions[0]).toMatchObject({ type: "partner_field", field: "min_equity_m", current_value: 10, proposed_value: 50 });
  });

  it("replaces an AI-filled minimum, but not with older information", () => {
    const older = { ...basePartner, min_equity_m: 10, enriched_fields: { min_equity_m: { source: "notes", as_of: "2025-01-01" } } };
    const u = up({ field: "min_equity_m", amount_m: 50, quote: "$50M minimum investment", source: "feedback" });
    expect(planUpdates(older, [u], texts, PASS_AT, ctx).write.min_equity_m).toBe(50);

    const newer = { ...older, enriched_fields: { min_equity_m: { source: "notes", as_of: "2026-10-01" } } };
    const plan = planUpdates(newer, [u], texts, PASS_AT, ctx);
    expect(plan.write).toEqual({});
    expect(plan.records[0].outcome).toBe("older");
  });

  it("ignores an update grounded only in an Ansonia email", () => {
    const plan = planUpdates(basePartner, [up({ field: "min_equity_m", amount_m: 40, quote: "they need a $40M minimum now", source: "m-ours" })], texts, PASS_AT, ctx);
    expect(plan.write).toEqual({});
    expect(plan.records).toEqual([]);
  });

  it("sets capital status with its date, and leaves a newer status alone", () => {
    const u = up({ field: "capital_status", status: "Constrained", available_from: "2027-01-01", detail: "next fund early 2027", quote: "We'll have to pass", source: "m-partner" });
    const plan = planUpdates(basePartner, [u], texts, PASS_AT, ctx);
    expect(plan.write).toMatchObject({ capital_status: "Constrained", capital_available_from: "2027-01-01", capital_status_as_of: partnerEmail.date });

    const confirmedLater = { ...basePartner, capital_status: "Selective", capital_status_as_of: "2026-10-05T00:00:00Z" };
    expect(planUpdates(confirmedLater, [u], texts, PASS_AT, ctx).records[0].outcome).toBe("older");

    const same = { ...basePartner, capital_status: "Constrained" };
    expect(planUpdates(same, [u], texts, PASS_AT, ctx).records[0].outcome).toBe("unchanged");
  });

  it("only ever turns a strategy off", () => {
    const p = { ...basePartner, strategy_value_add: null };
    const plan = planUpdates(p, [up({ field: "strategy_value_add", quote: "We'll have to pass", source: "m-partner" })], texts, PASS_AT, ctx);
    expect(plan.write.strategy_value_add).toBe(false);
  });
});
