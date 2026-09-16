import { describe, it, expect } from "vitest";
import {
  runQueryTable,
  hasPartnersEmbed,
  PARTNERS_EMBED_ERROR,
} from "../../supabase/functions/_shared/chatQueryTable";

/**
 * The chat agent's query_table tool takes a model-written table and select
 * string. Ansonia's own record lives in `partners` and is not a capital source,
 * so two things must hold no matter what the model asks for:
 *   1. a read of `partners` always carries is_internal = false;
 *   2. no select on any table can reach partner rows through an embed.
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

const eqCalls = (calls: Call[]) => calls.filter((c) => c[0] === "eq").map((c) => [c[1], c[2]]);

describe("query_table — partners always carries the internal filter", () => {
  it("emits is_internal = false on a plain partners read", async () => {
    const { client, calls } = fakeClient();

    await runQueryTable(client, { table: "partners" }, ALLOWED);

    expect(eqCalls(calls)).toContainEqual(["is_internal", false]);
  });

  it("emits it even when the model supplies its own filters", async () => {
    const { client, calls } = fakeClient();

    await runQueryTable(
      client,
      { table: "partners", filters: { relationship_strength: "Warm" } },
      ALLOWED,
    );

    expect(eqCalls(calls)).toContainEqual(["is_internal", false]);
  });

  it("emits it even when the model explicitly asks for internal rows", async () => {
    // PostgREST ANDs conditions, so the model's eq can only narrow ours to the
    // empty set — it can never widen it back to include the internal record.
    const { client, calls } = fakeClient();

    await runQueryTable(
      client,
      { table: "partners", filters: { is_internal: { eq: true } } },
      ALLOWED,
    );

    expect(eqCalls(calls)).toContainEqual(["is_internal", false]);
  });

  it("emits it before any model-supplied filter", async () => {
    const { client, calls } = fakeClient();

    await runQueryTable(client, { table: "partners", filters: { name: "Ansonia" } }, ALLOWED);

    const eqs = eqCalls(calls);
    expect(eqs.findIndex((e) => e[0] === "is_internal")).toBeLessThan(
      eqs.findIndex((e) => e[0] === "name"),
    );
  });

  it("does not add the filter to other tables", async () => {
    const { client, calls } = fakeClient();

    await runQueryTable(client, { table: "deals" }, ALLOWED);

    expect(eqCalls(calls).some((e) => e[0] === "is_internal")).toBe(false);
  });
});

describe("query_table — embedded partners selects are rejected", () => {
  it("rejects an embed on another table and never touches the database", async () => {
    const { client, calls } = fakeClient();

    const result = await runQueryTable(
      client,
      { table: "capital_raise_entries", select: "*, partners(name)" },
      ALLOWED,
    );

    expect(result).toEqual({ error: PARTNERS_EMBED_ERROR });
    expect(calls).toEqual([]);
  });

  it("rejects an aliased embed", async () => {
    const { client } = fakeClient();

    const result = await runQueryTable(
      client,
      { table: "notes", select: "id, p:partners(name)" },
      ALLOWED,
    );

    expect(result).toEqual({ error: PARTNERS_EMBED_ERROR });
  });

  it("rejects an embed with whitespace before the paren", async () => {
    const { client } = fakeClient();

    const result = await runQueryTable(
      client,
      { table: "deals", select: "*, partners (name, min_equity_m)" },
      ALLOWED,
    );

    expect(result).toEqual({ error: PARTNERS_EMBED_ERROR });
  });

  it("tells the model what to do instead", () => {
    expect(PARTNERS_EMBED_ERROR).toMatch(/query the `partners` table directly/i);
  });

  it("allows partner_contacts and partner_interactions embeds", async () => {
    // These hold contacts and touchpoints, not the partner profile, so blocking
    // them would break legitimate questions for no privacy gain.
    const { client, calls } = fakeClient();

    const result = await runQueryTable(
      client,
      { table: "deals", select: "*, partner_contacts(name), partner_interactions(content)" },
      ALLOWED,
    );

    expect(result).not.toHaveProperty("error");
    expect(calls[0]).toEqual(["from", "deals"]);
  });

  it("allows a plain select on partners itself", async () => {
    const { client, calls } = fakeClient();

    const result = await runQueryTable(
      client,
      { table: "partners", select: "id, name, min_equity_m" },
      ALLOWED,
    );

    expect(result).not.toHaveProperty("error");
    expect(eqCalls(calls)).toContainEqual(["is_internal", false]);
  });
});

describe("hasPartnersEmbed", () => {
  it("matches embed forms and not lookalikes", () => {
    expect(hasPartnersEmbed("*, partners(name)")).toBe(true);
    expect(hasPartnersEmbed("p:partners(name)")).toBe(true);
    expect(hasPartnersEmbed("partners (name)")).toBe(true);

    expect(hasPartnersEmbed("*")).toBe(false);
    expect(hasPartnersEmbed("id, name, partner_id")).toBe(false);
    expect(hasPartnersEmbed("*, partner_contacts(name)")).toBe(false);
    expect(hasPartnersEmbed(undefined)).toBe(false);
  });
});

describe("query_table — unchanged guards", () => {
  it("still refuses a table outside the allowlist", async () => {
    const { client, calls } = fakeClient();

    const result = await runQueryTable(client, { table: "profiles" }, ALLOWED);

    expect(result).toEqual({ error: "table not allowed" });
    expect(calls).toEqual([]);
  });

  it("still caps the limit at 200", async () => {
    const { client, calls } = fakeClient();

    await runQueryTable(client, { table: "deals", limit: 5000 }, ALLOWED);

    expect(calls).toContainEqual(["limit", 200]);
  });
});
