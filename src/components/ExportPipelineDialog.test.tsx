import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ExportPipelineDialog } from "./ExportPipelineDialog";
import type { Deal } from "@/hooks/useDeals";

vi.mock("@/hooks/usePartners", () => ({
  usePartners: () => ({ data: [] }),
}));

function makeDeal(id: string, propertyName: string, marketed = true): Deal {
  return {
    id,
    property_name: propertyName,
    marketed,
    status: "active",
    pipeline_stage: "screening",
    notes: null,
    investment_strategy: null,
    total_price: null,
    equity_target: null,
    preferred_return: null,
    target_irr: null,
    hold_period: null,
    projected_noi: null,
    year_built: null,
    units: null,
    square_feet: null,
    occupancy: null,
    latitude: null,
    longitude: null,
    market: null,
    submarket: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: null,
    org_id: null,
  } as unknown as Deal;
}

function renderDialog(deals: Deal[]) {
  return render(
    <MemoryRouter>
      <ExportPipelineDialog open deals={deals} onOpenChange={() => {}} />
    </MemoryRouter>,
  );
}

describe("ExportPipelineDialog select-all", () => {
  it("off-market deals are unchecked by default and no amber warning shows", () => {
    const deals = [
      makeDeal("1", "On Market Deal", true),
      makeDeal("2", "Off Market Deal", false),
    ];
    renderDialog(deals);

    const rows = screen.getAllByRole("checkbox");
    // master + 2 deal rows
    expect(rows.length).toBe(3);
    expect(rows[1]).toHaveAttribute("data-state", "checked");
    expect(rows[2]).toHaveAttribute("data-state", "unchecked");
    expect(screen.queryByText(/may be under NDA/i)).toBeNull();
  });

  it("select-all checks every deal, updates count, and shows amber warning", () => {
    const deals = [
      makeDeal("1", "Deal One", true),
      makeDeal("2", "Deal Two", true),
      makeDeal("3", "Off Market", false),
    ];
    renderDialog(deals);

    const master = screen.getAllByRole("checkbox")[0];
    fireEvent.click(master);

    const rows = screen.getAllByRole("checkbox");
    expect(rows.every((r) => r.getAttribute("data-state") === "checked")).toBe(true);
    expect(screen.getByText(/3\s+of\s+3\s+selected/i)).toBeInTheDocument();
    expect(screen.getByText(/1 off-market deal is included/i)).toBeInTheDocument();
  });

  it("clicking select-all toggles the full selection", () => {
    const deals = [makeDeal("1", "Deal One", true), makeDeal("2", "Deal Two", true)];
    renderDialog(deals);

    const master = screen.getAllByRole("checkbox")[0];
    // Active on-market deals start selected, so the master is checked.
    expect(master).toHaveAttribute("data-state", "checked");

    fireEvent.click(master);
    expect(screen.getByText(/0\s+of\s+2\s+selected/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole("checkbox").some((r) => r.getAttribute("data-state") === "checked"),
    ).toBe(false);

    fireEvent.click(master);
    expect(screen.getByText(/2\s+of\s+2\s+selected/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole("checkbox").every((r) => r.getAttribute("data-state") === "checked"),
    ).toBe(true);
  });


  it("shows indeterminate when some deals are selected, and clicking selects all", () => {
    const deals = [makeDeal("1", "Deal One", true), makeDeal("2", "Deal Two", true)];
    renderDialog(deals);

    const rows = screen.getAllByRole("checkbox");
    fireEvent.click(rows[1]); // uncheck first default-checked row, leaving one checked

    const master = screen.getAllByRole("checkbox")[0];
    expect(master).toHaveAttribute("data-state", "indeterminate");

    fireEvent.click(master);
    expect(screen.getByText(/2\s+of\s+2\s+selected/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole("checkbox").every((r) => r.getAttribute("data-state") === "checked"),
    ).toBe(true);
  });


  it("shows amber warning when a single off-market deal is checked by hand", () => {
    const deals = [makeDeal("1", "Off Market Deal", false)];
    renderDialog(deals);

    const rows = screen.getAllByRole("checkbox");
    fireEvent.click(rows[1]); // check the off-market row

    expect(screen.getByText(/1 off-market deal is included/i)).toBeInTheDocument();
  });

});
