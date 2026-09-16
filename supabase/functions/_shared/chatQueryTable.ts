/**
 * The chat agent's `query_table` execution.
 *
 * Extracted from chat/index.ts so it can be unit tested without a Deno runtime,
 * the same way _shared/hellodataClient is tested. chat/index.ts calls
 * `runQueryTable` and does nothing else with the tool's arguments.
 *
 * Both guards below exist for one reason: Ansonia's own record lives in the
 * `partners` table and is NOT an outside capital source. If the chat model can
 * read it, it will describe us as an investor in our own pipeline — reporting
 * Ansonia as an LP who passed, counting us in "how many partners do we have",
 * and summarizing our own house record as a firm's investment criteria.
 */

/**
 * Matches a PostgREST embedded resource on `partners` — `partners(name)` and
 * aliased forms like `p:partners(name)`. Deliberately does NOT match
 * `partner_contacts(...)` or `partner_interactions(...)`: those hold contact and
 * touchpoint rows, not the partner profile the guard is protecting.
 */
export const PARTNERS_EMBED_RE = /\bpartners\s*\(/;

export const PARTNERS_EMBED_ERROR =
  "Embedding `partners(...)` in a select is not supported. " +
  "Query the `partners` table directly instead — it applies the required filters.";

/** True when a select string reaches partner rows through an embed. */
export function hasPartnersEmbed(select: unknown): boolean {
  return typeof select === "string" && PARTNERS_EMBED_RE.test(select);
}

/**
 * True for tables whose rows must never include Ansonia's own record.
 * Only `partners` holds it; everything else references it by id.
 */
export function needsInternalPartnerFilter(table: unknown): boolean {
  return table === "partners";
}

type QueryArgs = {
  table?: unknown;
  select?: unknown;
  filters?: Record<string, unknown> | null;
  order_by?: string;
  ascending?: boolean;
  limit?: number;
};

// Minimal structural type for the PostgREST builder, so the module needs no
// supabase-js import and a test can pass a recording fake.
type QueryBuilder = {
  select: (s: string) => QueryBuilder;
  limit: (n: number) => QueryBuilder;
  order: (c: string, o: { ascending: boolean }) => QueryBuilder;
  eq: (c: string, v: unknown) => QueryBuilder;
  neq: (c: string, v: unknown) => QueryBuilder;
  ilike: (c: string, v: unknown) => QueryBuilder;
  gt: (c: string, v: unknown) => QueryBuilder;
  gte: (c: string, v: unknown) => QueryBuilder;
  lt: (c: string, v: unknown) => QueryBuilder;
  lte: (c: string, v: unknown) => QueryBuilder;
  in: (c: string, v: unknown) => QueryBuilder;
};

type ClientLike = { from: (table: string) => QueryBuilder };

export type QueryTableResult =
  | { error: string }
  | { rows: unknown[]; count: number };

export async function runQueryTable(
  supabase: ClientLike,
  args: QueryArgs,
  allowedTables: readonly string[],
): Promise<QueryTableResult> {
  const { table, select = "*", filters = {}, order_by, ascending = false, limit = 25 } = args ?? {};

  if (typeof table !== "string" || !allowedTables.includes(table)) {
    return { error: "table not allowed" };
  }

  // The `select` string is written by the model, so an embed is a live path to
  // partner rows on any table: select("*, partners(name)") on
  // capital_raise_engagements returns our own record's name just as readily as
  // an outside firm's. Reject rather than rewrite — stripping an embed means
  // correctly parsing nested PostgREST select syntax, and a strip that gets it
  // slightly wrong silently returns the wrong columns instead of failing loudly.
  // The error text tells the model what to do instead.
  if (hasPartnersEmbed(select)) {
    return { error: PARTNERS_EMBED_ERROR };
  }

  let q = supabase.from(table).select(String(select)).limit(Math.min(Number(limit) || 25, 200));

  // Unconditional, and applied before the model's own filters so no combination
  // of them can drop it. A model-supplied is_internal filter can only narrow
  // this further (PostgREST ANDs conditions), never widen it.
  if (needsInternalPartnerFilter(table)) {
    q = q.eq("is_internal", false);
  }

  for (const [col, val] of Object.entries(filters || {})) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const v = val as Record<string, unknown>;
      if ("ilike" in v) q = q.ilike(col, v.ilike);
      else if ("eq" in v) q = q.eq(col, v.eq);
      else if ("neq" in v) q = q.neq(col, v.neq);
      else if ("gt" in v) q = q.gt(col, v.gt);
      else if ("gte" in v) q = q.gte(col, v.gte);
      else if ("lt" in v) q = q.lt(col, v.lt);
      else if ("lte" in v) q = q.lte(col, v.lte);
      else if ("in" in v) q = q.in(col, v.in);
    } else {
      q = q.eq(col, val);
    }
  }

  if (order_by) q = q.order(order_by, { ascending });

  const { data, error } = (await q) as unknown as { data: unknown[] | null; error: unknown };
  if (error) {
    console.error("[chat] query_table", error);
    return { error: "query failed" };
  }
  return { rows: data ?? [], count: data?.length ?? 0 };
}
