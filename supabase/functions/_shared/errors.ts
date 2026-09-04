// Central error responder for edge functions.
//
// Upstream provider bodies (Microsoft Graph, HelloData, ArcGIS, Anthropic) and raw
// Postgres messages routinely name secrets, internal endpoints, table/column names
// and constraint identifiers. None of that may reach a caller. Full detail is logged
// server-side against a correlation id; the caller receives only that id, which
// support can use to find the log line.

/** Log full detail server-side under a correlation id; return only the id to the client. */
export function errorResponse(
  e: unknown,
  cors: Record<string, string>,
  ctx: { fn: string; status?: number; publicMessage?: string },
) {
  const correlationId = crypto.randomUUID();
  const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  // Server-side only. Never place this in a response body.
  console.error(JSON.stringify({ correlationId, fn: ctx.fn, detail }));
  return new Response(
    JSON.stringify({
      error: ctx.publicMessage ?? "Request failed. Contact support with this reference.",
      correlation_id: correlationId,
    }),
    {
      status: ctx.status ?? 500,
      headers: { ...cors, "Content-Type": "application/json" },
    },
  );
}

/**
 * Log an upstream failure and return a safe, generic message for the client.
 * Use where the value must be a string rather than a Response.
 */
export function safeUpstreamMessage(fn: string, context: string, raw: unknown): string {
  const correlationId = crypto.randomUUID();
  console.error(JSON.stringify({ correlationId, fn, context, detail: String(raw) }));
  return `${context} failed upstream (ref ${correlationId})`;
}
