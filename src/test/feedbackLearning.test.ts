import { describe, expect, it } from "vitest";
import { effectiveFeedback } from "../../supabase/functions/_shared/feedbackLearning";

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
});
