import { describe, expect, it } from "vitest";
import {
  asOfDate,
  budgetAmount,
  digestEvents,
  failureMessage,
  fileExtension,
  listCostUsd,
  modelFileName,
  parseRunResult,
  pickModelInputs,
  pickOutputs,
  runIsOver,
  type ModelInputDoc,
} from "../../supabase/functions/_shared/dealModel";

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("asOfDate", () => {
  it("reads numeric, ISO and month-name dates", () => {
    expect(asOfDate("As of 10/13/2026")).toBe(utc(2026, 10, 13));
    expect(asOfDate("2026-09-30")).toBe(utc(2026, 9, 30));
    expect(asOfDate("Sep 30, 2026")).toBe(utc(2026, 9, 30));
    expect(asOfDate("Rent roll 10/13/26")).toBe(utc(2026, 10, 13));
  });

  it("takes a bare month as its last day, not a day read out of the year", () => {
    expect(asOfDate("September 2026")).toBe(utc(2026, 9, 30));
    expect(asOfDate("T12 ending Sept. 2026")).toBe(utc(2026, 9, 30));
    expect(asOfDate("Feb-24")).toBe(utc(2024, 2, 29));
  });

  it("takes the end of a period", () => {
    expect(asOfDate("Oct 2025 - Sep 2026")).toBe(utc(2026, 9, 30));
    expect(asOfDate("10/1/2025 through 9/30/2026")).toBe(utc(2026, 9, 30));
  });

  it("returns null rather than a wrong date for text with no valid date", () => {
    expect(asOfDate(null)).toBeNull();
    expect(asOfDate("")).toBeNull();
    expect(asOfDate("Trailing twelve months")).toBeNull();
    expect(asOfDate("13/45/2026")).toBeNull();
    expect(asOfDate("2/30/2026")).toBeNull();
  });
});

describe("pickModelInputs", () => {
  const doc = (id: string, doc_type: string | null, doc_as_of: string | null, created_at = "2026-10-01T00:00:00Z"): ModelInputDoc => ({
    id,
    file_name: `${id}.xlsx`,
    doc_type,
    doc_as_of,
    created_at,
  });

  it("takes the newest T12, the rent roll closest to it and the newest OM", () => {
    const pick = pickModelInputs([
      doc("t12-old", "t12", "T12 ending June 2026"),
      doc("t12-new", "t12", "T12 ending Sep 2026"),
      doc("rr-far", "rent_roll", "As of 1/5/2026"),
      doc("rr-near", "rent_roll", "As of 10/13/2026"),
      doc("rr-newer", "rent_roll", "As of 3/1/2027"),
      doc("om", "om", null),
      doc("comps", "other", null),
    ]);
    expect(pick).toEqual({ t12: "t12-new", rent_roll: "rr-near", om: "om" });
  });

  it("falls back to upload order when documents state no date", () => {
    const pick = pickModelInputs([
      doc("t12", "t12", null),
      doc("rr-1", "rent_roll", null, "2026-10-01T00:00:00Z"),
      doc("rr-2", "rent_roll", null, "2026-10-05T00:00:00Z"),
    ]);
    expect(pick.rent_roll).toBe("rr-2");
  });

  it("never guesses a comps export and leaves missing roles out", () => {
    expect(pickModelInputs([doc("x", "other", null), doc("y", null, null)])).toEqual({});
  });
});

describe("small helpers", () => {
  it("fileExtension keeps the extension lower-cased", () => {
    expect(fileExtension("Grey RR 10.13.26.XLSX")).toBe(".xlsx");
    expect(fileExtension("README")).toBe("");
  });

  it("budgetAmount writes cents and refuses nonsense", () => {
    expect(budgetAmount(15)).toBe("1500");
    expect(budgetAmount(12.345)).toBe("1235");
    expect(() => budgetAmount(0)).toThrow();
    expect(() => budgetAmount(Number.NaN)).toThrow();
  });

  it("listCostUsd reads the minor-unit string only", () => {
    expect(listCostUsd({ amount: "812", currency: "USD" })).toBe(8.12);
    expect(listCostUsd({ amount: "8.12" })).toBeNull();
    expect(listCostUsd(null)).toBeNull();
  });

  it("modelFileName strips characters a path or Windows rejects", () => {
    expect(modelFileName("Greyeagle")).toBe("00. Pro Forma - Greyeagle vCURRENT.xlsx");
    expect(modelFileName("A/B: Phase #2")).toBe("00. Pro Forma - A B Phase 2 vCURRENT.xlsx");
  });
});

describe("digestEvents and runIsOver", () => {
  const msg = (id: string, text: string) => ({ id, type: "agent.message", content: [{ type: "text", text }] });

  it("keeps the latest PROGRESS line and the last message", () => {
    const d = digestEvents([
      msg("1", "PROGRESS: Coding the T12"),
      msg("2", "Some note\nPROGRESS: Building floor plans"),
      msg("3", "Unrelated message"),
    ]);
    expect(d.progress).toBe("Building floor plans");
    expect(d.lastMessage).toBe("Unrelated message");
  });

  it("tracks held tool calls until they are answered", () => {
    const d = digestEvents([
      { id: "a", type: "agent.tool_use", evaluated_permission: "ask" },
      { id: "b", type: "agent.tool_use", evaluated_permission: "allow" },
      { id: "c", type: "agent.tool_use", evaluated_permission: "ask" },
      { id: "d", type: "user.tool_confirmation", tool_use_id: "a" },
    ]);
    expect(d.pendingAsks).toEqual(["c"]);
  });

  it("is over only on a final idle or a termination", () => {
    const idle = (type: string) => digestEvents([{ id: "x", type: "session.status_idle", stop_reason: { type } }]);
    expect(runIsOver("idle", idle("end_turn"))).toBe(true);
    expect(runIsOver("idle", idle("budget_reached"))).toBe(true);
    expect(runIsOver("idle", idle("requires_action"))).toBe(false);
    expect(runIsOver("running", idle("end_turn"))).toBe(false);
    expect(runIsOver("terminated", digestEvents([]))).toBe(true);
    // Idle with no idle event read yet: wait for the next check.
    expect(runIsOver("idle", digestEvents([]))).toBe(false);
  });

  it("carries the stop reason over from an earlier check, and clears it when the run resumes", () => {
    const first = digestEvents([{ id: "1", type: "session.status_idle", stop_reason: { type: "end_turn" } }]);
    expect(digestEvents([], first).stopReason).toBe("end_turn");
    expect(digestEvents([{ id: "2", type: "session.status_running" }], first).stopReason).toBeNull();
  });
});

describe("outputs", () => {
  it("picks the newest save of the model and the reports", () => {
    const out = pickOutputs([
      { id: "m1", filename: "00. Pro Forma - X vCURRENT.xlsx", created_at: "2026-10-28T10:00:00Z" },
      { id: "m2", filename: "00. Pro Forma - X vCURRENT.xlsx", created_at: "2026-10-28T10:20:00Z" },
      { id: "q", filename: "outputs/qc.md", created_at: "2026-10-28T10:21:00Z" },
      { id: "r", filename: "result.json", created_at: "2026-10-28T10:22:00Z" },
    ]);
    expect(out.model?.id).toBe("m2");
    expect(out.qc?.id).toBe("q");
    expect(out.result?.id).toBe("r");
  });

  it("parseRunResult treats a missing or malformed result as incomplete", () => {
    expect(parseRunResult('{"complete": true, "skipped": []}')).toEqual({ complete: true, skipped: [] });
    expect(parseRunResult('{"complete": "yes"}').complete).toBe(false);
    expect(parseRunResult("not json")).toEqual({ complete: false, skipped: [] });
    expect(parseRunResult(null)).toEqual({ complete: false, skipped: [] });
  });

  it("failureMessage names the cost cap when that is why", () => {
    const capped = digestEvents([{ id: "1", type: "session.status_idle", stop_reason: { type: "budget_reached" } }]);
    expect(failureMessage(capped, 15)).toContain("$15 cost cap");
  });
});
