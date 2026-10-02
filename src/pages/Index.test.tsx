import { useState, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Deal } from "@/hooks/useDeals";

const mutate = vi.fn();
let mockDeals: Deal[] = [];

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useDeals", () => ({
  useDeals: () => ({ data: mockDeals, isLoading: false }),
  useUpdateDeal: () => ({ mutate }),
}));
vi.mock("@/hooks/useDealEnrichments", () => ({
  useDealEnrichments: () => ({ data: new Map() }),
  deriveMedianHHIncome: () => null,
  derivePopGrowth: () => null,
}));
vi.mock("@/hooks/useAllDealNotes", () => ({ useAllDealNotes: () => ({ data: {} }) }));
vi.mock("@/hooks/usePartners", () => ({ usePartners: () => ({ data: [] }) }));
vi.mock("@/hooks/useUserPreference", () => ({
  useUserPreference: <T,>(_key: string, initial: T) => useState<T>(initial),
}));

// Radix's popper takes ~40s to mount under jsdom (fine in a real browser), so
// render the CFO editor's popover inline. These tests cover what it saves, not
// how it is positioned.
vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
  };
});

import Index from "./Index";

function deal(id: string, property_name: string, status: string, extra: Partial<Deal> = {}): Deal {
  return {
    id,
    property_name,
    status,
    city: null,
    broker: null,
    state: null,
    cfo_date: null,
    cfo_note: null,
    asking_price: null,
    unit_count: null,
    ai_score: null,
    created_at: "2026-09-30T12:00:00Z",
    ...extra,
  } as unknown as Deal;
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <Index />
    </MemoryRouter>
  );

describe("Pipeline page", () => {
  beforeEach(() => {
    mutate.mockReset();
    mockDeals = [
      deal("1", "Elliot Pioneer", "Screening", { cfo_date: "2026-10-15" }),
      deal("2", "Miro Apartments", "Underwriting", { cfo_note: "Off Market" }),
      deal("3", "Birch Hill Apartments", "On Hold/Tracking"),
      deal("4", "Old Pass Deal", "Pass"),
    ];
  });

  it("moves On Hold deals into their own table below the pipeline", () => {
    renderPage();
    const [main, hold] = screen.getAllByRole("table");
    expect(within(main).getByText("Elliot Pioneer")).toBeInTheDocument();
    expect(within(main).queryByText("Birch Hill Apartments")).toBeNull();
    expect(within(hold).getByText("Birch Hill Apartments")).toBeInTheDocument();
    expect(within(hold).queryByText("Elliot Pioneer")).toBeNull();
    expect(screen.getByRole("heading", { name: "On Hold / Tracking" })).toBeInTheDocument();
    // Header no longer counts parked deals as active.
    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(screen.getByText("1 on hold")).toBeInTheDocument();
  });

  it("collapses the On Hold section", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /On Hold \/ Tracking/ }));
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryByText("Birch Hill Apartments")).toBeNull();
  });

  it("omits the On Hold section when nothing is on hold", () => {
    mockDeals = mockDeals.filter((d) => d.status !== "On Hold/Tracking");
    renderPage();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "On Hold / Tracking" })).toBeNull();
  });

  it("shows a CFO date or a CFO note", () => {
    renderPage();
    const [main] = screen.getAllByRole("table");
    expect(within(main).getByText("10/15/26")).toBeInTheDocument();
    expect(within(main).getByText("Off Market")).toBeInTheDocument();
  });

  it("saves typed CFO text as a note and clears the date", async () => {
    renderPage();
    fireEvent.click(screen.getByText("10/15/26"));
    const input = await screen.findByPlaceholderText("10/15/26 or Off Market");
    expect(input).toHaveValue("10/15/26");
    fireEvent.change(input, { target: { value: "Off Mkt - recap" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toEqual({ id: "1", cfo_date: null, cfo_note: "Off Mkt - recap" });
  });

  it("saves a typed date into cfo_date", async () => {
    renderPage();
    fireEvent.click(screen.getByText("Off Market"));
    const input = await screen.findByPlaceholderText("10/15/26 or Off Market");
    fireEvent.change(input, { target: { value: "11/3/26" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toEqual({ id: "2", cfo_date: "2026-11-03", cfo_note: null });
  });
});
