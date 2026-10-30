import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExpandPassNote } from "@/components/ExpandPassNote";

const ENG = "11111111-1111-1111-1111-111111111111";

describe("ExpandPassNote", () => {
  beforeEach(() => invoke.mockReset());

  it("offers nothing on an empty note, since it only expands what was typed", () => {
    const { container } = render(<ExpandPassNote engagementId={ENG} note="<p></p>" onUse={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sends the note, shows the expansion, and puts it in the editor on Use this", async () => {
    invoke.mockResolvedValue({ data: { expanded: "They have no allocation for this deal." }, error: null });
    const onUse = vi.fn();
    render(
      <ExpandPassNote
        engagementId={ENG}
        note="<p>Dont have a bucket of capital for this</p>"
        category="Timing / Capital availability"
        onUse={onUse}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /expand with ai/i }));
    expect(await screen.findByText("They have no allocation for this deal.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("expand-pass-note", {
      body: {
        engagement_id: ENG,
        note: "<p>Dont have a bucket of capital for this</p>",
        category: "Timing / Capital availability",
        price_surmountable: undefined,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /use this/i }));
    expect(onUse).toHaveBeenCalledWith("<p>They have no allocation for this deal.</p>");
  });

  it("drops the expansion once the note it was made from is edited", async () => {
    invoke.mockResolvedValue({ data: { expanded: "Expanded text." }, error: null });
    const { rerender } = render(<ExpandPassNote engagementId={ENG} note="<p>short</p>" onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /expand with ai/i }));
    expect(await screen.findByText("Expanded text.")).toBeInTheDocument();

    rerender(<ExpandPassNote engagementId={ENG} note="<p>short, edited</p>" onUse={vi.fn()} />);
    expect(screen.queryByText("Expanded text.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expand with ai/i })).toBeInTheDocument();
  });
});
