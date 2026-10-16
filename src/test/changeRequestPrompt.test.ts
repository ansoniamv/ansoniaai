import { describe, expect, it } from "vitest";
import { buildClaudePrompt } from "@/lib/changeRequestPrompt";
import type { ChangeRequest } from "@/hooks/useChangeRequests";

const base: ChangeRequest = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "  Sort the inbox by date received ",
  request_type: "change",
  page_label: "Outlook",
  page_path: "/outlook",
  current_behavior: "It sorts by sender.",
  desired_behavior: "Newest emails first.",
  reason: null,
  status: "new",
  admin_notes: null,
  roadmap_item_id: null,
  submitted_by: "u1",
  submitter_email: "someone@example.com",
  created_at: "2026-10-16T15:00:00Z",
  updated_at: "2026-10-16T15:00:00Z",
};

describe("buildClaudePrompt", () => {
  it("carries the request fields and the route", () => {
    const p = buildClaudePrompt(base);
    expect(p).toContain("- Title: Sort the inbox by date received\n");
    expect(p).toContain("route `/outlook`");
    expect(p).toContain("## What happens now\nIt sorts by sender.");
    expect(p).toContain("## What they want instead\nNewest emails first.");
    expect(p).toContain(base.id);
  });

  it("omits empty optional sections", () => {
    const p = buildClaudePrompt({ ...base, current_behavior: "  ", reason: null });
    expect(p).not.toContain("## What happens now");
    expect(p).not.toContain("## Why it matters");
    expect(p).not.toContain("## Admin notes");
  });

  it("includes admin notes once added", () => {
    expect(buildClaudePrompt({ ...base, admin_notes: "See useOutlook.ts" })).toContain("## Admin notes\nSee useOutlook.ts");
  });

  it("handles a request with no page", () => {
    expect(buildClaudePrompt({ ...base, page_label: null, page_path: null })).toContain("- Where in the app: Not specified");
  });
});
