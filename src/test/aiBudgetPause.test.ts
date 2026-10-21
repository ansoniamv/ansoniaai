import { describe, it, expect } from "vitest";
import { budgetPause } from "@/lib/aiBudgetPause";

describe("budgetPause", () => {
  it("recognises the daily cap refusal", () => {
    expect(
      budgetPause(
        "Daily AI budget reached: $5.44 of $3.00. Background jobs pause until 00:00 UTC; anything you click still works.",
      ),
    ).toEqual({ scope: "daily" });
  });

  it("recognises the monthly cap refusal", () => {
    expect(
      budgetPause("Monthly AI budget reached: $90.12 of $90.00. All AI features are paused until the limit is raised or the month rolls over."),
    ).toEqual({ scope: "monthly" });
  });

  it("treats real failures as failures", () => {
    expect(budgetPause("No per-email summary was produced.")).toBeNull();
    expect(budgetPause("Anthropic 529: overloaded")).toBeNull();
    // Anchored: a model error that merely mentions the budget is still a failure.
    expect(budgetPause("upstream said: Daily AI budget reached: $1 of $3")).toBeNull();
  });

  it("is null when there is no error", () => {
    expect(budgetPause(null)).toBeNull();
    expect(budgetPause(undefined)).toBeNull();
    expect(budgetPause("")).toBeNull();
  });
});
