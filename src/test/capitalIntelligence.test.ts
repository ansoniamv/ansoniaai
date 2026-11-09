import { describe, expect, it } from "vitest";
import { interpretReads, notesText, READ_SCHEMA, STRATEGY_BUCKETS } from "../../supabase/functions/_shared/strategyRead";
import { rankBucket, type IntelPartner, type ReadRow } from "@/lib/capitalIntelligence";

const NOTES =
  "## Firm Overview\n- Currently investing out of flagship Value-Add Fund IV ($1.4bn) and a separate open-ended, quarterly-raise Core-Plus/Yield fund (similar to BREIT/SREIT).\n- Not doing ground-up development.";

describe("interpretReads", () => {
  it("keeps a level the notes back with a quote, in the notes' own words", () => {
    const { reads, dropped } = interpretReads(
      {
        core_plus: { level: "dedicated", quote: "a separate open-ended, quarterly-raise Core-Plus/Yield fund", reason: "Runs a Core-Plus/Yield fund." },
        value_add: { level: "dedicated", quote: "flagship Value-Add Fund IV ($1.4bn)", reason: "Fund IV." },
        opportunistic: { level: "avoids", quote: "Not doing ground-up development.", reason: "No development." },
        workforce: { level: "none", quote: null, reason: null },
        affordable: { level: "none", quote: null, reason: null },
      },
      NOTES,
    );
    expect(dropped).toEqual([]);
    expect(reads.core_plus.level).toBe("dedicated");
    expect(NOTES).toContain(reads.core_plus.quote!);
    expect(reads.opportunistic.level).toBe("avoids");
    expect(reads.workforce).toEqual({ level: "none", quote: null, reason: null });
  });

  it("downgrades a rating with no quote, or a quote not in the notes, to none", () => {
    const { reads, dropped } = interpretReads(
      {
        core_plus: { level: "active", quote: null, reason: "x" },
        affordable: { level: "dedicated", quote: "Their LIHTC syndication arm closed three deals last month", reason: "x" },
      },
      NOTES,
    );
    expect(reads.core_plus.level).toBe("none");
    expect(reads.affordable.level).toBe("none");
    expect(dropped.sort()).toEqual(["affordable", "core_plus"]);
  });

  it("treats garbage and unknown levels as none", () => {
    expect(interpretReads(null, NOTES).reads.value_add.level).toBe("none");
    expect(interpretReads({ value_add: { level: "maybe", quote: "Fund IV" } }, NOTES).reads.value_add.level).toBe("none");
  });

  it("schema requires every bucket", () => {
    expect(READ_SCHEMA.required).toEqual([...STRATEGY_BUCKETS]);
  });

  it("notesText joins both note fields and skips blanks", () => {
    expect(notesText({ organized_notes: " a ", additional_notes: null })).toBe("a");
    expect(notesText({ organized_notes: "a", additional_notes: "b" })).toBe("a\n\nb");
    expect(notesText({})).toBe("");
  });
});

const base: IntelPartner = {
  id: "",
  name: "",
  relationship_strength: null,
  capital_status: null,
  capital_available_from: null,
  min_equity_m: null,
  max_equity_m: null,
  archived_at: null,
  blacklisted_at: null,
};
const p = (o: Partial<IntelPartner>): IntelPartner => ({ ...base, ...o });
const read = (level: string): ReadRow => ({
  reads: { core_plus: { level: level as never, quote: "q", reason: "r" } },
  read_at: "2026-11-06T00:00:00Z",
});

describe("rankBucket", () => {
  const now = new Date("2026-11-06T12:00:00");

  it("ranks a cold partner with a dedicated Core+ fund above a warm box-only partner", () => {
    const partners = [
      p({ id: "box", name: "Box Only", strategy_core_plus: true, relationship_strength: "Very Warm" }),
      p({ id: "fund", name: "Fund", strategy_core_plus: true, relationship_strength: "Cold" }),
    ];
    const reads = new Map<string, ReadRow>([["fund", read("dedicated")], ["box", { reads: {}, read_at: "x" }]]);
    const out = rankBucket("core_plus", partners, reads, now);
    expect(out.map((r) => r.partner.id)).toEqual(["fund", "box"]);
    expect(out[0].score).toBe(50 + 15);
    expect(out[1].score).toBe(15 + 20);
    expect(out[1].unread).toBe(false);
  });

  it("lists a partner with notes evidence but no box, and leaves out partners with neither", () => {
    const partners = [p({ id: "a", name: "A" }), p({ id: "b", name: "B" })];
    const out = rankBucket("core_plus", partners, new Map([["a", read("active")]]), now);
    expect(out.map((r) => r.partner.id)).toEqual(["a"]);
    expect(out[0].boxChecked).toBe(false);
  });

  it("keeps a ticked box the notes contradict, at the bottom", () => {
    const partners = [
      p({ id: "no", name: "No", strategy_core_plus: true, relationship_strength: "Existing Partner" }),
      p({ id: "cold", name: "Cold", strategy_core_plus: true, relationship_strength: "Cold" }),
    ];
    const out = rankBucket("core_plus", partners, new Map([["no", read("avoids")]]), now);
    expect(out.map((r) => r.partner.id)).toEqual(["cold", "no"]);
  });

  it("does not list a partner whose notes only say avoids and the box is not ticked", () => {
    expect(rankBucket("core_plus", [p({ id: "x", name: "X" })], new Map([["x", read("avoids")]]), now)).toEqual([]);
  });

  it("applies capital status, and drops the penalty once the available-from date passes", () => {
    const partners = [
      p({ id: "out", name: "Out", strategy_core_plus: true, capital_status: "Out of Capital" }),
      p({ id: "back", name: "Back", strategy_core_plus: true, capital_status: "Constrained", capital_available_from: "2026-10-01" }),
    ];
    const out = rankBucket("core_plus", partners, new Map(), now);
    const byId = Object.fromEntries(out.map((r) => [r.partner.id, r]));
    expect(byId.out.score).toBe(15 - 30);
    expect(byId.back.score).toBe(15);
    expect(byId.back.needsReconfirmation).toBe(true);
    expect(byId.out.unread).toBe(true);
  });

  it("skips archived and blacklisted partners", () => {
    const partners = [
      p({ id: "a", name: "A", strategy_core_plus: true, archived_at: "2026-01-01" }),
      p({ id: "b", name: "B", strategy_core_plus: true, blacklisted_at: "2026-01-01" }),
    ];
    expect(rankBucket("core_plus", partners, new Map(), now)).toEqual([]);
  });

  it("opportunistic has no box, so only notes put a partner on it", () => {
    const partners = [p({ id: "a", name: "A", strategy_core_plus: true, strategy_value_add: true })];
    expect(rankBucket("opportunistic", partners, new Map(), now)).toEqual([]);
  });
});
