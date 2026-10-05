import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let rows: Record<string, unknown>[] = [];
const updates: { table: string; values: Record<string, unknown>; id: unknown }[] = [];
const inserts: { table: string; values: Record<string, unknown> }[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => ({
    select: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }),
    update: (values: Record<string, unknown>) => ({
      eq: async (_col: string, id: unknown) => {
        updates.push({ table, values, id });
        return { error: null };
      },
    }),
    insert: async (values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return { error: null };
    },
  });
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: { from, channel: () => channel, removeChannel: () => {}, functions: { invoke: async () => ({}) } },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { email: "a@b.com" } }) }));
vi.mock("@/hooks/useTeamMembers", () => ({
  useTeamMembers: () => ({ data: [] }),
  useAssignInboxDeal: () => ({ mutate: vi.fn() }),
  initialsOf: () => "",
}));
// Radix popper is very slow under jsdom; these tests are about sections, not menus.
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Tooltip: Pass, TooltipTrigger: Pass, TooltipContent: () => null, TooltipProvider: Pass };
});

import DealPipelinePage from "./DealPipelinePage";

const deal = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  property_name: name,
  fit_tier: "strong",
  fit_score: 80,
  gate_status: null,
  denied: false,
  accepted_deal_id: null,
  reviewed: false,
  email_received_at: "2026-10-01T14:30:00Z",
  ...over,
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DealPipelinePage />
    </QueryClientProvider>,
  );

const section = (title: string) => screen.getByRole("heading", { name: title }).closest("[id^=section-]") as HTMLElement;

describe("Deal Inbox", () => {
  beforeEach(() => {
    updates.length = 0;
    inserts.length = 0;
    rows = [
      deal("s-old", "Strong Old", { email_received_at: "2026-09-20T12:00:00Z" }),
      deal("s-new", "Strong New", { email_received_at: "2026-10-02T12:00:00Z" }),
      deal("m", "Medium One", { fit_tier: "medium" }),
      deal("maybe", "Maybe One", { fit_tier: "maybe" }),
      deal("filt", "Filtered One", { fit_tier: null, gate_status: "filtered", gate_reason: "Out of market" }),
      deal("new", "Unscored One", { fit_tier: null }),
      deal("den", "Denied One", { denied: true, denial_category: "Too Small", denial_reason: "80 units" }),
      deal("acc", "Accepted One", { accepted_deal_id: "d1" }),
    ];
  });

  it("groups deals by tier, newest first, and leaves accepted deals out", async () => {
    renderPage();
    await screen.findByText("Strong New");

    const titles = Array.from(document.querySelectorAll("[id^=section-] h2")).map((h) => h.textContent);
    expect(titles).toEqual(["Awaiting Score", "Strong Fit", "Medium Fit", "Screened Out / Other Deals", "Denied"]);

    const strong = within(section("Strong Fit")).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(strong).toEqual(["Strong New", "Strong Old"]);
    expect(within(section("Medium Fit")).getByText("Medium One")).toBeInTheDocument();
    expect(within(section("Awaiting Score")).getByText("Unscored One")).toBeInTheDocument();
    expect(screen.queryByText("Accepted One")).toBeNull();
    expect(screen.queryByText(/Mark Reviewed/)).toBeNull();
  });

  it("shows the email date on each tile", async () => {
    renderPage();
    const tile = (await screen.findByText("Medium One")).closest(".surface-card") as HTMLElement;
    expect(within(tile).getByText(/^Received \w{3}, Oct 1, 2026 · /)).toBeInTheDocument();
  });

  it("keeps Other and Denied collapsed until opened", async () => {
    renderPage();
    await screen.findByText("Strong New");
    expect(screen.queryByText("Maybe One")).toBeNull();
    expect(screen.queryByText("Denied One")).toBeNull();

    fireEvent.click(screen.getByRole("heading", { name: "Screened Out / Other Deals" }));
    expect(within(section("Screened Out / Other Deals")).getByText("Maybe One")).toBeInTheDocument();
    expect(within(section("Screened Out / Other Deals")).getByText("Filtered One")).toBeInTheDocument();
  });

  const openDenied = async () => {
    renderPage();
    await screen.findByText("Strong New");
    fireEvent.click(screen.getByRole("heading", { name: "Denied" }));
    return section("Denied");
  };
  const tileOf = (name: string) => screen.getByText(name).closest(".surface-card") as HTMLElement;

  it("requires a reason to restore a denied deal, and records it for learning", async () => {
    const denied = await openDenied();
    expect(within(denied).getByText("Too Small")).toBeInTheDocument();
    expect(within(denied).queryByRole("button", { name: /Deny/ })).toBeNull();

    fireEvent.click(within(tileOf("Denied One")).getByRole("button", { name: /Restore/ }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm Restore" });
    expect(confirm).toBeDisabled();
    expect(updates).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Reason for restoring"), { target: { value: "Price cut 10%" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(inserts).toHaveLength(1));
    expect(updates[0]).toMatchObject({ table: "inbox_deals", id: "den", values: { denied: false, reviewed: false } });
    expect(inserts[0]).toMatchObject({
      table: "deal_feedback",
      values: { inbox_deal_id: "den", action: "restore", category: "Too Small", reason_text: "Price cut 10%" },
    });
  });

  it("lists marked-reviewed deals under Denied and restores them without a reason", async () => {
    rows.push(deal("rev", "Reviewed One", { reviewed: true }));
    const denied = await openDenied();
    expect(within(tileOf("Reviewed One")).getByText("No denial reason given")).toBeInTheDocument();
    expect(within(denied).getByText("Reviewed One")).toBeInTheDocument();

    fireEvent.click(within(tileOf("Reviewed One")).getByRole("button", { name: /Restore/ }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({ id: "rev", values: { reviewed: false } });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(inserts).toHaveLength(0);
  });
});
