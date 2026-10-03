import { describe, expect, it } from "vitest";
import { bucketInboxDeals, inboxSectionFor } from "@/lib/inboxSections";

const deal = (over: Partial<Parameters<typeof inboxSectionFor>[0]> & { id?: string } = {}) => ({
  id: "x",
  fit_tier: "strong",
  gate_status: null,
  denied: false,
  accepted_deal_id: null,
  email_received_at: "2026-10-01T12:00:00Z",
  denied_at: null,
  ...over,
});

describe("inboxSectionFor", () => {
  it("routes by tier", () => {
    expect(inboxSectionFor(deal({ fit_tier: "strong" }))).toBe("strong");
    expect(inboxSectionFor(deal({ fit_tier: "Medium" }))).toBe("medium");
    expect(inboxSectionFor(deal({ fit_tier: "maybe" }))).toBe("other");
    expect(inboxSectionFor(deal({ fit_tier: "skip" }))).toBe("other");
    expect(inboxSectionFor(deal({ fit_tier: null }))).toBe("unscored");
  });

  it("sends gate-filtered deals to other, whatever their tier", () => {
    expect(inboxSectionFor(deal({ fit_tier: "strong", gate_status: "filtered" }))).toBe("other");
    expect(inboxSectionFor(deal({ fit_tier: null, gate_status: "filtered" }))).toBe("other");
  });

  it("denied wins over tier and gate; accepted deals are not shown", () => {
    expect(inboxSectionFor(deal({ denied: true, gate_status: "filtered" }))).toBe("denied");
    expect(inboxSectionFor(deal({ accepted_deal_id: "d1" }))).toBeNull();
  });

  it("puts deals that were only marked reviewed in denied", () => {
    expect(inboxSectionFor(deal({ reviewed: true }))).toBe("denied");
    expect(inboxSectionFor(deal({ reviewed: true, accepted_deal_id: "d1" }))).toBeNull();
  });
});

describe("bucketInboxDeals", () => {
  it("sorts each section newest first, undated last", () => {
    const b = bucketInboxDeals([
      deal({ id: "old", email_received_at: "2026-09-01T00:00:00Z" }),
      deal({ id: "undated", email_received_at: null }),
      deal({ id: "new", email_received_at: "2026-10-02T00:00:00Z" }),
    ]);
    expect(b.strong.map((d) => d.id)).toEqual(["new", "old", "undated"]);
  });

  it("sorts denied by when it was denied", () => {
    const b = bucketInboxDeals([
      deal({ id: "a", denied: true, email_received_at: "2026-10-02T00:00:00Z", denied_at: "2026-10-02T01:00:00Z" }),
      deal({ id: "b", denied: true, email_received_at: "2026-09-01T00:00:00Z", denied_at: "2026-10-03T00:00:00Z" }),
    ]);
    expect(b.denied.map((d) => d.id)).toEqual(["b", "a"]);
  });
});
