import { describe, it, expect } from "vitest";
import { matchQuote } from "../../supabase/functions/_shared/quoteMatch";

const thread = [
  "Got it, thanks.",
  "",
  "From: Analyst <analyst@ansoniaproperties.com>",
  "Sent: Monday, July 6, 2026 8:14 PM",
  "Subject: Re: New JV Opportunity",
  "",
  "Thanks. We are risk off on Denver at the moment due to new supply concerns. Looping in a colleague who can opine further.",
  "We're topping out at a $12M-$15M check size so this would not be a fit for us. If you want a coinvest let me know.",
].join("\n");

const hit = (text: string, quote: string) => {
  const m = matchQuote(text, quote);
  return m && text.slice(m.start, m.end);
};

describe("matchQuote", () => {
  it("finds the exact words first", () => {
    const m = matchQuote(thread, "risk off on  Denver at the moment");
    expect(m?.exact).toBe(true);
    expect(thread.slice(m!.start, m!.end)).toBe("risk off on Denver at the moment");
  });

  it("finds the sentence a pass note paraphrases", () => {
    expect(hit(thread, 'Partner went "risk off" on Denver over new supply')).toBe(
      "We are risk off on Denver at the moment due to new supply concerns.",
    );
  });

  it("weighs the amounts in a check-size note", () => {
    expect(hit(thread, "Check size caps at $12–15M vs. our ~$30M+ ask; open to a smaller co-invest slice")).toBe(
      "We're topping out at a $12M-$15M check size so this would not be a fit for us.",
    );
  });

  it("returns nothing when no sentence is close", () => {
    expect(matchQuote(thread, "too small, $50M minimum investment")).toBeNull();
  });

  it("does not match on one shared word", () => {
    expect(matchQuote(thread, "Denver is fine")).toBeNull();
  });
});
