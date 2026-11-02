import { describe, it, expect } from "vitest";
import { hasCitation } from "../../supabase/functions/_shared/citation";
import { readProvenance } from "@/lib/fieldProvenance";
import { manualStamps } from "@/lib/partnerForm";

describe("hasCitation", () => {
  it("accepts an email", () => {
    expect(hasCitation({ message_ids: ["AAMk-1"], quote: "anything" })).toBe(true);
  });

  it("accepts a pass reason with its engagement and notes", () => {
    expect(hasCitation({
      message_ids: [], quote: "$50M minimum investment", quote_from: "pass_notes",
      engagement_id: "eng-1", notes: "too small, $50M minimum investment",
    })).toBe(true);
  });

  it("accepts a partner note with a quote", () => {
    expect(hasCitation({ note_ids: ["n1"], quote: "really want affordable deals" })).toBe(true);
  });

  it("refuses evidence with nothing to check", () => {
    expect(hasCitation(null)).toBe(false);
    expect(hasCitation({ message_ids: [] })).toBe(false);
    expect(hasCitation({ message_ids: [""], quote: "a quote with no source" })).toBe(false);
    // A pass-reason quote that does not say which pass it came from.
    expect(hasCitation({ message_ids: [], quote: "$50M minimum investment", quote_from: "pass_notes", notes: "x" })).toBe(false);
  });
});

describe("readProvenance", () => {
  it("reads a pass-derived stamp as a pass, with who typed it", () => {
    const p = readProvenance({
      min_equity_m: {
        source: "deal_pass", as_of: "2026-10-23T00:00:00Z", message_ids: [], quote: "$50M minimum",
        quote_from: "pass_notes", notes: "too small, $50M minimum", typed_by: "Phil V", typed_at: "2026-10-23T16:32:02Z",
      },
    }, "min_equity_m");
    expect(p?.source).toBe("pass");
    expect(p?.pass_note).toEqual({ notes: "too small, $50M minimum", typed_by: "Phil V", typed_at: "2026-10-23T16:32:02Z" });
  });

  it("never labels a stamp with no source and no email as an email", () => {
    expect(readProvenance({ geography: { as_of: "2026-01-01T00:00:00Z" } }, "geography")?.source).toBe("unknown");
    expect(readProvenance({ geography: { as_of: "2026-01-01T00:00:00Z", message_ids: ["AAMk-1"] } }, "geography")?.source).toBe("email");
    expect(readProvenance({ geography: { extracted_at: "2026-01-01T00:00:00Z", source_note_ids: ["n1"] } }, "geography")?.source).toBe("notes");
  });
});

describe("manualStamps", () => {
  it("cites every typed value as set by hand, skipping blanks and yes/no defaults", () => {
    const s = manualStamps(
      { geography: ["Dallas"], min_equity_m: 10, max_equity_m: null, product_types: [], strategy_value_add: true } as any,
      "Max V",
      "2026-11-02T00:00:00Z",
    );
    expect(Object.keys(s).sort()).toEqual(["geography", "min_equity_m"]);
    expect(s.geography).toEqual({ source: "manual", as_of: "2026-11-02T00:00:00Z", written_at: "2026-11-02T00:00:00Z", set_by: "Max V" });
  });
});

describe("approvalStamp", () => {
  it("keeps the pass-reason citation on a field a reviewer approved", async () => {
    const { approvalStamp } = await import("@/hooks/usePartnerSuggestions");
    const stamp = approvalStamp({
      created_at: "2026-10-30T17:39:26Z",
      evidence: {
        message_ids: [], quote: "$50M minimum", email_date: "2026-10-23T00:00:00Z", deal_id: "deal-1",
        engagement_id: "eng-1", quote_from: "pass_notes", notes: "too small, $50M minimum",
        typed_by: null, typed_at: "2026-10-23T16:32:02Z",
      },
    } as any, "reviewer@ansoniaproperties.com");
    expect(stamp).toMatchObject({
      source: "deal_pass", quote_from: "pass_notes", deal_id: "deal-1", engagement_id: "eng-1",
      typed_at: "2026-10-23T16:32:02Z", approved_by: "reviewer@ansoniaproperties.com",
    });
    expect(readProvenance({ f: stamp }, "f")?.source).toBe("pass");
  });

  it("stamps an email suggestion as email", async () => {
    const { approvalStamp } = await import("@/hooks/usePartnerSuggestions");
    const stamp = approvalStamp({ created_at: "2026-10-30T00:00:00Z", evidence: { message_ids: ["AAMk-1"], quote: "q" } } as any, null);
    expect(stamp).toMatchObject({ source: "email", message_ids: ["AAMk-1"], quote: "q" });
  });
});
