import { describe, expect, it } from "vitest";
import { dayLabel, describeChange, feedSearchText, groupChanges, sortFeed, type ChangeRow } from "@/lib/partnerFeed";

const row = (o: Partial<ChangeRow>): ChangeRow => ({
  id: Math.random().toString(36),
  partner_id: "p1",
  field: "relationship_strength",
  old_value: "Cold",
  new_value: "Very Warm",
  changed_by_label: "Dan",
  source: "user",
  changed_at: "2026-10-22T15:04:10Z",
  ...o,
});

describe("groupChanges", () => {
  it("merges one save's fields into a single item", () => {
    const items = groupChanges([
      row({}),
      row({ field: "capital_status", old_value: null, new_value: "Active", changed_at: "2026-10-22T15:04:11Z" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("2 fields updated");
    expect(items[0].byline).toBe("Edited by Dan");
    expect(items[0].changes?.map((c) => `${c.label}:${c.from}->${c.to}`)).toEqual([
      "Warmth:Cold->Very Warm",
      "Capital status:—->Active",
    ]);
  });

  it("keeps different people, partners and minutes apart", () => {
    const items = groupChanges([
      row({}),
      row({ changed_by_label: "Max" }),
      row({ partner_id: "p2" }),
      row({ changed_at: "2026-10-22T15:09:00Z" }),
    ]);
    expect(items).toHaveLength(4);
  });

  it("collapses a field changed twice to first-from and last-to, and drops a round trip", () => {
    const [a] = groupChanges([
      row({ old_value: "Cold", new_value: "Warm", changed_at: "2026-10-22T15:04:01Z" }),
      row({ old_value: "Warm", new_value: "Very Warm", changed_at: "2026-10-22T15:04:30Z" }),
    ]);
    expect(a.changes).toEqual([{ field: "relationship_strength", label: "Warmth", from: "Cold", to: "Very Warm" }]);

    expect(groupChanges([
      row({ old_value: "Cold", new_value: "Warm", changed_at: "2026-10-22T15:04:01Z" }),
      row({ old_value: "Warm", new_value: "Cold", changed_at: "2026-10-22T15:04:30Z" }),
    ])).toEqual([]);
  });

  it("marks job writes as automated and labels the source", () => {
    expect(groupChanges([row({ source: "system", changed_by_label: null })])[0]).toMatchObject({ automated: true, byline: "Automatic update" });
    expect(groupChanges([row({ source: "import", changed_by_label: "a@b.com" })])[0].byline).toBe("Warmth import by a@b.com");
    expect(groupChanges([row({ source: "suggestion" })])[0]).toMatchObject({ automated: false, byline: "Suggestion approved by Dan" });
  });
});

describe("describeChange", () => {
  it("formats arrays, booleans, archive and long text", () => {
    expect(describeChange({ field: "geography", old_value: [], new_value: ["TX", "FL"] })).toMatchObject({ from: "—", to: "TX, FL" });
    expect(describeChange({ field: "suburban", old_value: false, new_value: true })).toMatchObject({ from: "No", to: "Yes" });
    expect(describeChange({ field: "archived_at", old_value: null, new_value: "2026-10-22" })).toMatchObject({ from: "Active", to: "Archived" });
    expect(describeChange({ field: "additional_notes", old_value: "a", new_value: "b" })).toMatchObject({ from: "", to: "edited" });
  });
});

describe("sortFeed / search / dayLabel", () => {
  it("sorts newest first and drops undated rows", () => {
    const out = sortFeed([
      { key: "a", kind: "note", at: "2026-10-01T00:00:00Z", partnerId: "p", title: "x" },
      { key: "b", kind: "note", at: "", partnerId: "p", title: "x" },
      { key: "c", kind: "note", at: "2026-10-20T00:00:00Z", partnerId: "p", title: "x" },
    ]);
    expect(out.map((i) => i.key)).toEqual(["c", "a"]);
  });

  it("searches partner name and note text without tags", () => {
    const t = feedSearchText({ key: "n", kind: "note", at: "x", partnerId: "p", title: "Note", note: { content: "<p>Met at <b>NMHC</b></p>", format: "html" } }, "Osso Capital");
    expect(t).toContain("osso capital");
    expect(t).toContain("met at  nmhc");
  });

  it("labels today and yesterday", () => {
    const now = new Date(2026, 9, 22, 12);
    expect(dayLabel(new Date(2026, 9, 22, 8).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 21, 23).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 18, 9).toISOString(), now)).toBe("Sun, Oct 18");
  });
});
