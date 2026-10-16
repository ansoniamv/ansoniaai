import type { ChangeRequest } from "@/hooks/useChangeRequests";

export const REQUEST_TYPE_LABEL: Record<ChangeRequest["request_type"], string> = {
  bug: "Bug — something is broken",
  change: "Change — adjust how something works",
  feature: "New feature",
};

function section(heading: string, body: string | null | undefined): string {
  const text = body?.trim();
  return text ? `## ${heading}\n${text}\n\n` : "";
}

/**
 * Turns a change request into a prompt an admin pastes into Claude Code in
 * VS Code. Built at render time, not stored, so improving this template
 * improves the prompt for every request, old ones included.
 */
export function buildClaudePrompt(req: ChangeRequest): string {
  const submitted = new Date(req.created_at).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  const where = req.page_path
    ? `${req.page_label || "Unlabeled page"} (route \`${req.page_path}\` — src/App.tsx maps routes to page components)`
    : req.page_label || "Not specified";

  return (
    `A user of the Ansonia AI platform submitted this change request. ` +
    `The repo is a React + Vite frontend in src/ with Supabase migrations and edge functions in supabase/.\n\n` +
    `## Request\n` +
    `- Title: ${req.title.trim()}\n` +
    `- Type: ${REQUEST_TYPE_LABEL[req.request_type]}\n` +
    `- Where in the app: ${where}\n` +
    `- Submitted by: ${req.submitter_email ?? "unknown"} on ${submitted}\n` +
    `- Request ID: ${req.id}\n\n` +
    section("What happens now", req.current_behavior) +
    section("What they want instead", req.desired_behavior) +
    section("Why it matters", req.reason) +
    section("Admin notes", req.admin_notes) +
    `## How to work\n` +
    `1. Find the code behind that page and confirm the current behavior before changing anything. ` +
    `If the request is ambiguous, or conflicts with how the code is meant to work, stop and ask me before building.\n` +
    `2. Give me a short plan, then implement it on a new branch off main.\n` +
    `3. Database changes go in a new migration in supabase/migrations/ — never edit an existing one. ` +
    `Edge functions don't deploy on push, so list any function that needs a deploy.\n` +
    `4. Run the typecheck and build, then tell me what you verified and what you couldn't.\n`
  );
}
