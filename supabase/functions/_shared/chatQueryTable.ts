/**
 * The chat agent's `query_table` execution.
 *
 * Extracted from chat/index.ts so it can be unit tested without a Deno runtime,
 * the same way _shared/hellodataClient is tested. chat/index.ts calls
 * `runQueryTable` and does nothing else with the tool's arguments.
 */

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

  let q = supabase.from(table).select(String(select)).limit(Math.min(Number(limit) || 25, 200));

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
