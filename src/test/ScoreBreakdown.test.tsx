import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { scorePipelineDeal } from "../../supabase/functions/_shared/pipelineScoreEngine";

const renderCard = (data: unknown, summary: string | null = null) =>
  render(
    <TooltipProvider>
      <ScoreBreakdown data={data as never} summary={summary} />
    </TooltipProvider>,
  );

describe("ScoreBreakdown", () => {
  it("shows values in plain units, with source and what fills the gaps", () => {
    const score = scorePipelineDeal(
      { deal: { asking_price: 37, unit_count: 150, estimated_equity: 12.9 } },
      [{ id: "e", key: "deal_economics", name: "Deal Economics", weight: 10 }],
      [
        { pillar_id: "e", name: "Price per unit", field_source: "derived.price_per_unit", scoring_method: "lower_better", min_value: 50000, max_value: 300000, optimal_min: null, optimal_max: null, weight_within_pillar: 30 },
        { pillar_id: "e", name: "Going-in yield", field_source: "derived.going_in_yield_pct", scoring_method: "higher_better", min_value: 4, max_value: 7, optimal_min: null, optimal_max: null, weight_within_pillar: 30 },
      ],
    );
    renderCard({ ...score, final_score: score.base_score, adjustment: 0 });
    fireEvent.click(screen.getByText("Deal Economics"));
    expect(screen.getByText("$247K")).toBeInTheDocument();
    expect(screen.getByText("Source: Asking price ÷ units")).toBeInTheDocument();
    expect(screen.getByText("Upload a T12 and set the asking price")).toBeInTheDocument();
  });

  it("hides deal-score's template summary but keeps a real AI rationale", () => {
    const data = { version: 2, base_score: 52, final_score: 52, adjustment: 0, pillars: [] };
    const { unmount } = renderCard(data, "Base score 52 from 6 of 6 pillars (100% weight covered).");
    expect(screen.queryByText(/^Base score 52/)).toBeNull();
    unmount();
    renderCard(data, "Strong Columbus location, but the basis is rich for the vintage.");
    expect(screen.getByText(/Strong Columbus location/)).toBeInTheDocument();
  });

  it("asks for a rescore on a breakdown written before version 2", () => {
    renderCard({
      base_score: 52,
      final_score: 52,
      adjustment: 0,
      pillars: [{ key: "e", name: "Deal Economics", weight: 10, score: 40, signals: [
        { name: "Price per unit", field_source: "derived.price_per_unit", raw_value: 0.25, score: 100, weight: 40 },
      ] }],
    });
    expect(screen.getByText(/Rescore to see sources/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Deal Economics"));
    // The old value was in $M per unit; it is shown as stored, not as "$0".
    expect(screen.getByText("0.25")).toBeInTheDocument();
  });
});
