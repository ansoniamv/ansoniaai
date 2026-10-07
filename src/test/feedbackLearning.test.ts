import { describe, expect, it } from "vitest";
import { DUPLICATE_CATEGORY, effectiveFeedback, FEEDBACK_SCAN_LIMIT, MAX_LEARNING_EXAMPLES } from "../../supabase/functions/_shared/feedbackLearning";

const row = (inbox_deal_id: string | null, action: string, created_at: string) => ({ inbox_deal_id, action, created_at });

describe("effectiveFeedback", () => {
  it("a restore supersedes the earlier denial of the same deal", () => {
    const { denials, restores } = effectiveFeedback([
      row("a", "deny", "2026-10-01T00:00:00Z"),
      row("a", "restore", "2026-10-02T00:00:00Z"),
      row("b", "deny", "2026-10-01T00:00:00Z"),
    ]);
    expect(denials.map((r) => r.inbox_deal_id)).toEqual(["b"]);
    expect(restores.map((r) => r.inbox_deal_id)).toEqual(["a"]);
  });

  it("a re-denial after a restore counts as a denial again", () => {
    const { denials, restores } = effectiveFeedback([
      row("a", "deny", "2026-10-03T00:00:00Z"),
      row("a", "restore", "2026-10-02T00:00:00Z"),
      row("a", "deny", "2026-10-01T00:00:00Z"),
    ]);
    expect(denials).toHaveLength(1);
    expect(denials[0].created_at).toBe("2026-10-03T00:00:00Z");
    expect(restores).toHaveLength(0);
  });

  it("keeps rows with no inbox deal and returns newest first", () => {
    const { denials } = effectiveFeedback([
      row(null, "deny", "2026-09-01T00:00:00Z"),
      row("c", "deny", "2026-10-01T00:00:00Z"),
      row(null, "deny", "2026-09-15T00:00:00Z"),
    ]);
    expect(denials.map((r) => r.created_at)).toEqual([
      "2026-10-01T00:00:00Z",
      "2026-09-15T00:00:00Z",
      "2026-09-01T00:00:00Z",
    ]);
  });

  it("a duplicate pass is not a fit signal and replaces the earlier decision", () => {
    const { denials, restores } = effectiveFeedback([
      row("a", "deny", "2026-10-01T00:00:00Z"),
      { ...row("a", "deny", "2026-10-03T00:00:00Z"), category: DUPLICATE_CATEGORY },
      { ...row("b", "deny", "2026-10-02T00:00:00Z"), category: "Too Small" },
    ]);
    expect(denials.map((r) => r.inbox_deal_id)).toEqual(["b"]);
    expect(restores).toHaveLength(0);
  });
});

describe("the scan window", () => {
  it("is wide enough that duplicate passes cannot crowd out real reasons", () => {
    // Reproduces the live failure: a run of duplicate passes followed by the
    // real denials. On a 100-row window these were the only rows visible and
    // the strategy note was built from 4 decisions out of 286.
    const rows: Array<{ inbox_deal_id: string; action: string; category: string; created_at: string }> = [];
    for (let i = 0; i < 96; i++) {
      rows.push({
        inbox_deal_id: `dup-${i}`,
        action: "deny",
        category: DUPLICATE_CATEGORY,
        created_at: `2026-10-07T${String(i % 24).padStart(2, "0")}:00:00Z`,
      });
    }
    for (let i = 0; i < 150; i++) {
      rows.push({
        inbox_deal_id: `real-${i}`,
        action: "deny",
        category: "Market / Geography",
        created_at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      });
    }

    const narrow = effectiveFeedback(
      [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100),
    );
    expect(narrow.denials.length).toBeLessThan(10);

    const wide = effectiveFeedback(
      [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, FEEDBACK_SCAN_LIMIT),
    );
    expect(wide.denials.length).toBe(150);
  });

  it("caps examples after filtering, not before", () => {
    expect(FEEDBACK_SCAN_LIMIT).toBeGreaterThan(MAX_LEARNING_EXAMPLES);
  });
});
