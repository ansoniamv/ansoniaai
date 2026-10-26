import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldSourceView } from "@/components/FieldSourceView";
import type { DealDocument } from "@/hooks/useDealDocuments";
import type { FieldSource } from "../../supabase/functions/_shared/fieldSources";

vi.mock("@/hooks/useDealDocuments", () => ({ getDealDocumentUrl: vi.fn() }));

const doc = { id: "doc-1", storage_path: "deal/om.pdf", file_name: "Canterfield OM.pdf" } as DealDocument;
const fromOm = (over: Partial<FieldSource>): FieldSource => ({
  kind: "document",
  provider: "Deal document",
  label: "Offering memorandum",
  document_id: "doc-1",
  file_name: "Canterfield OM.pdf",
  location: "p.3, Property Overview",
  note: "p.3: '260 units'",
  recorded_at: "2026-10-26T12:00:00Z",
  ...over,
});

describe("FieldSourceView", () => {
  it("shows a checked quote in quotation marks, with where it is and a link to the file", () => {
    render(
      <FieldSourceView
        title="Units"
        figures={[{ source: fromOm({ quote: "260-unit Class A community", quote_verified: true }) }]}
        documents={[doc]}
      />,
    );
    expect(screen.getByText("“260-unit Class A community”")).toBeTruthy();
    expect(screen.getByText(/Offering memorandum · p\.3, Property Overview/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Canterfield OM\.pdf/ })).toBeTruthy();
  });

  it("never shows an unchecked quote as a quote", () => {
    render(
      <FieldSourceView
        title="Units"
        figures={[{ source: fromOm({ quote: "260-unit Class A community", quote_verified: false }) }]}
        documents={[doc]}
      />,
    );
    expect(screen.queryByText(/“/)).toBeNull();
    expect(screen.getByText(/not found word for word/)).toBeTruthy();
    expect(screen.getByText("p.3: '260 units'")).toBeTruthy();
  });

  it("says when the document has been removed from the deal", () => {
    render(<FieldSourceView title="Units" figures={[{ source: fromOm({}) }]} documents={[]} />);
    expect(screen.getByText(/no longer on the deal/)).toBeTruthy();
  });

  it("shows an API citation, and flags one written by the backfill", () => {
    render(
      <FieldSourceView
        title="Job Growth"
        figures={[{
          source: {
            kind: "api", provider: "BLS", backfilled: true,
            label: "BLS total nonfarm employment, year over year, for the property's metro area",
            recorded_at: "2026-10-26T12:00:00Z",
          },
        }]}
        documents={[]}
      />,
    );
    expect(screen.getByText(/BLS total nonfarm employment/)).toBeTruthy();
    expect(screen.getByText(/next time market metrics run/)).toBeTruthy();
  });

  it("shows both inputs and the formula for a computed stat, and says when one has no source", () => {
    render(
      <FieldSourceView
        title="Rent vs Market"
        formula="(in-place rent − market rent) ÷ market rent"
        figures={[
          { name: "In-place rent", value: "$2,625", source: null },
          { name: "Market rent", value: "$1,450", source: { kind: "api", provider: "HelloData", label: "Census-tract median rent, from HelloData's demographics", recorded_at: "2026-10-01T00:00:00Z" } },
        ]}
        documents={[]}
      />,
    );
    expect(screen.getByText("(in-place rent − market rent) ÷ market rent")).toBeTruthy();
    expect(screen.getByText("$2,625")).toBeTruthy();
    expect(screen.getByText(/No source recorded/)).toBeTruthy();
    expect(screen.getByText(/Census-tract median rent/)).toBeTruthy();
  });
});
