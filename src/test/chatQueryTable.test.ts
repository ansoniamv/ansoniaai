import { describe, it, expect } from "vitest";
import { runQueryTable } from "../../supabase/functions/_shared/chatQueryTable";

/**
 * The chat agent's query_table tool takes a model-written table and select
 * string, so the table allowlist and the row cap are the two things that must
 * hold no matter what the model asks for.
 */

const ALLOWED = [
  "deals", "partners", "partner_contacts", "partner_interactions",
  "capital_raise_entries", "notes",
] as const;

type Call = [string, ...unknown[]];

/**
 * Records every builder call and resolves like a PostgREST query. `then` makes
 * it awaitable, which is how runQueryTable consumes it.
 */
function fakeClient(rows: unknown[] = []) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  for (const m of ["select", "limit", "order", "eq", "neq", "ilike", "gt", "gte", "lt", "lte", "in"]) {
    builder[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return builder;
    };
  }
  return {
    calls,
    client: {
      from: (table: string) => {
        calls.push(["from", table]);
        return builder as never;
      },
    },
  };
}

describe("query_table — guards", () => {
  it("refuses a table outside the allowlist", async () => {
    const { client, calls } = fakeClient();

    const result = await runQueryTable(client, { table: "profiles" }, ALLOWED);

    expect(result).toEqual({ error: "table not allowed" });
    expect(calls).toEqual([]);
  });

  it("caps the limit at 200", async () => {
    const { client, calls } = fakeClient();

    await runQueryTable(client, { table: "deals", limit: 5000 }, ALLOWED);

    expect(calls).toContainEqual(["limit", 200]);
  });

  it("reads partners directly without a scoping filter", async () => {
    const { client, calls } = fakeClient();

    await runQueryTable(client, { table: "partners" }, ALLOWED);

    expect(calls).toContainEqual(["from", "partners"]);
    expect(calls.filter((c) => c[0] === "eq")).toEqual([]);
  });
});
