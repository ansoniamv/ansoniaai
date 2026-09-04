/**
 * User-facing error text.
 *
 * Never render a server error verbatim. Postgres messages name tables, columns
 * and constraints, and for an RLS denial they describe the policy; edge-function
 * errors can carry upstream provider detail. Show intent plus a traceable
 * reference, and keep the real message in the dev console only.
 */
export function userMessage(e: unknown, fallback = "Something went wrong."): string {
  const id =
    (e as { correlation_id?: string })?.correlation_id ??
    (e as { context?: { correlation_id?: string } })?.context?.correlation_id;

  if (import.meta.env.DEV) console.error(e);

  return id ? `${fallback} (ref ${id})` : fallback;
}

/**
 * For client-side validation only — Zod issues, form checks and other messages
 * produced in the browser. These are safe to show verbatim and users need them.
 */
export function validationMessage(message: string): string {
  return message;
}
