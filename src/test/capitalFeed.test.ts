import { describe, expect, it } from "vitest";
import {
  buildStories,
  criteriaHeadline,
  fmtEquityM,
  htmlToText,
  joinList,
  storiesFromChanges,
  storyFromNote,
  storyFromQuickNote,
  type NoteRow,
} from "@/lib/capitalFeed";
import type { ChangeRow } from "@/lib/partnerFeed";

const change = (over: Partial<ChangeRow>): ChangeRow => ({
  id: "x", partner_id: "p1", field: "max_equity_m", old_value: null, new_value: null,
  changed_by_label: "Dana", source: "user", changed_at: "2026-10-20T15:00:12Z", ...over,
});

const note = (over: Partial<NoteRow>): NoteRow => ({
  id: "n1", entity_id: "p1", content: "", content_format: "plain", classification_summary: null,
  author: "Max", team_member_id: "t1", created_at: "2026-10-20T15:00:00Z", ...over,
});

const name = () => "Skydeck";

describe("criteriaHeadline", () => {
  it("reads a check-size change as a sentence", () => {
    expect(criteriaHeadline("Skydeck", [{ field: "max_equity_m", from: 5, to: 10 }]))
      .toBe("Skydeck raised their maximum equity check to $10M");
    expect(criteriaHeadline("Skydeck", [{ field: "min_equity_m", from: 5, to: 2.5 }]))
      .toBe("Skydeck lowered their minimum equity check to $2.5M");
    expect(criteriaHeadline("Skydeck", [{ field: "max_equity_m", from: null, to: 10 }]))
      .toBe("Skydeck set their maximum equity check at $10M");
  });

  it("states the range when both ends change", () => {
    expect(criteriaHeadline("Skydeck", [
      { field: "min_equity_m", from: 2, to: 5 },
      { field: "max_equity_m", from: 8, to: 10 },
    ])).toBe("Skydeck changed their equity check size to $5M–$10M");
  });

  it("names markets added and dropped", () => {
    expect(criteriaHeadline("Skydeck", [{ field: "geography", from: ["TX"], to: ["TX", "Florida", "Georgia"] }]))
      .toBe("Skydeck is now targeting Florida and Georgia");
    expect(criteriaHeadline("Skydeck", [{ field: "geography", from: ["TX", "FL"], to: ["FL"] }]))
      .toBe("Skydeck is no longer targeting TX");
    expect(criteriaHeadline("Skydeck", [{ field: "geography_avoid", from: [], to: ["Chicago"] }]))
      .toBe("Skydeck now avoids Chicago");
  });

  it("groups strategy switches", () => {
    expect(criteriaHeadline("Skydeck", [
      { field: "strategy_value_add", from: false, to: true },
      { field: "strategy_workforce", from: null, to: true },
      { field: "strategy_core_plus", from: true, to: false },
    ])).toBe("Skydeck is now open to value-add and workforce deals and is no longer pursuing core-plus deals");
  });

  it("joins two clauses and counts the rest", () => {
    expect(criteriaHeadline("Skydeck", [
      { field: "max_equity_m", from: 5, to: 10 },
      { field: "hold_period", from: "5-7 years", to: "3-5 years" },
      { field: "capital_status", from: "Active", to: "Paused" },
      { field: "investor_type", from: "Family office", to: "Fund" },
    ])).toBe("Skydeck raised their maximum equity check to $10M and changed their capital status to Paused, plus 2 more changes");
  });
});

describe("storiesFromChanges", () => {
  it("groups one save into one story and ignores non-criteria fields", () => {
    const out = storiesFromChanges([
      change({ id: "a", field: "max_equity_m", old_value: 5, new_value: 10 }),
      change({ id: "b", field: "relationship_strength", old_value: "Warm", new_value: "Hot" }),
      change({ id: "c", field: "ansonia_poc", old_value: "A", new_value: "B" }),
    ], name);
    expect(out).toHaveLength(1);
    expect(out[0].headline).toBe("Skydeck raised their maximum equity check to $10M");
    expect(out[0].changes?.map((c) => c.field)).toEqual(["max_equity_m"]);
    expect(out[0].byline).toBe("Updated by Dana");
  });

  it("drops warmth-only saves and warmth imports entirely", () => {
    expect(storiesFromChanges([change({ field: "relationship_strength", old_value: "Warm", new_value: "Hot" })], name)).toEqual([]);
    expect(storiesFromChanges([change({ source: "import", old_value: 1, new_value: 2 })], name)).toEqual([]);
  });

  it("drops a field changed and changed back inside the same minute", () => {
    expect(storiesFromChanges([
      change({ id: "a", old_value: 5, new_value: 10, changed_at: "2026-10-20T15:00:01Z" }),
      change({ id: "b", old_value: 10, new_value: 5, changed_at: "2026-10-20T15:00:30Z" }),
    ], name)).toEqual([]);
  });

  it("leaves out Atlas's own rewrites of a partner's criteria", () => {
    expect(storiesFromChanges([change({ source: "system", changed_by_label: null, old_value: 5, new_value: 25 })], name)).toEqual([]);
  });

  it("carries what led to each change", () => {
    const ref = { source: "email", message_ids: ["m1"], quote: "Our minimum check is now $10M." };
    const [s] = storiesFromChanges([change({ source: "suggestion", old_value: 5, new_value: 10, source_ref: ref })], name);
    expect(s.changes![0].ref).toEqual(ref);
  });
});

describe("notes", () => {
  it("leads with the partner and the AI summary", () => {
    const s = storyFromNote(note({
      content: "<p>Met with the team. They are raising Fund IV.</p>", content_format: "html",
      classification_summary: "Raising Fund IV; open to $10-25M checks",
    }), "Skydeck")!;
    expect(s.headline).toBe("Skydeck: Raising Fund IV; open to $10-25M checks");
    expect(s.dek).toBe("Met with the team. They are raising Fund IV.");
    expect(s.byline).toBe("Note by Max");
  });

  it("falls back to the first sentence without a summary", () => {
    const s = storyFromNote(note({ content: "Wants Sunbelt value-add only. Nothing under 150 units." }), "Skydeck")!;
    expect(s.headline).toBe("Skydeck: Wants Sunbelt value-add only.");
  });

  it("skips notes a background job wrote", () => {
    expect(storyFromNote(note({ content: "Auto note", author: null, team_member_id: null }), "Skydeck")).toBeNull();
  });

  it("turns quick notes into stories without the 'User' placeholder", () => {
    const s = storyFromQuickNote({ id: "q", partner_id: "p1", content: "Call went well; send the OM", author: "User", interaction_date: "2026-10-20", created_at: "2026-10-20T15:00:00Z" }, "Skydeck")!;
    expect(s.headline).toBe("Skydeck: Call went well; send the OM");
    expect(s.byline).toBe("Quick note");
  });
});

describe("helpers", () => {
  it("sorts stories newest first across sources", () => {
    const stories = buildStories({
      notes: [note({ content: "Older note text here." , created_at: "2026-10-19T00:00:00Z" })],
      quickNotes: [],
      changes: [change({ old_value: 5, new_value: 10, changed_at: "2026-10-21T00:00:00Z" })],
    }, name);
    expect(stories.map((s) => s.category)).toEqual(["criteria", "note"]);
  });

  it("formats lists, $M amounts and html", () => {
    expect(joinList(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
    expect(fmtEquityM(10)).toBe("$10M");
    expect(fmtEquityM(0.5)).toBe("$500K");
    expect(fmtEquityM(null)).toBeNull();
    expect(htmlToText("<p>A &amp; B</p><p>C</p>")).toBe("A & B C");
  });
});

describe("capital status from approved suggestions", () => {
  it("headlines the status and runs the detail underneath", () => {
    const [s] = storiesFromChanges([change({
      field: "capital_status", source: "suggestion", changed_by_label: "max@ansonia.com",
      old_value: null, new_value: { status: "Constrained", detail: "A large MF recap is taking most of the fund" },
    })], name);
    expect(s.headline).toBe("Skydeck changed their capital status to Constrained");
    expect(s.dek).toBe("A large MF recap is taking most of the fund");
    expect(s.changes?.[0].to).toBe("Constrained");
    expect(s.byline).toBe("Atlas suggestion approved by max@ansonia.com");
  });
});
