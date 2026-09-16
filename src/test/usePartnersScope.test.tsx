import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * usePartners() is safe by default: it excludes internal (Ansonia) records
 * unless a caller explicitly opts in. The two options are independent — asking
 * for archived rows must not silently hand back internal ones, which is exactly
 * the mistake this inversion exists to prevent.
 */

type Call = [string, ...unknown[]];
const calls: Call[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  for (const m of ["select", "order", "is", "eq"]) {
    builder[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return builder;
    };
  }
  return {
    supabase: {
      from: (table: string) => {
        calls.push(["from", table]);
        return builder;
      },
    },
  };
});

const { usePartners } = await import("@/hooks/usePartners");

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function runHook(options?: { includeArchived?: boolean; includeInternal?: boolean }) {
  calls.length = 0;
  const { result } = renderHook(() => usePartners(options), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  return calls;
}

const emitted = (name: string, ...args: unknown[]) =>
  calls.some((c) => c[0] === name && args.every((a, i) => c[i + 1] === a));

describe("usePartners — internal partners excluded by default", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("filters internal partners with no options passed", async () => {
    await runHook();
    expect(emitted("eq", "is_internal", false)).toBe(true);
  });

  it("still filters internal partners when archived are requested", async () => {
    // The regression this guards: WarmthImportPage asks for archived rows and
    // must not get the internal record back as a matchable import target.
    await runHook({ includeArchived: true });
    expect(emitted("eq", "is_internal", false)).toBe(true);
    expect(emitted("is", "archived_at", null)).toBe(false);
  });

  it("includes internal partners only on explicit opt-in", async () => {
    await runHook({ includeInternal: true });
    expect(emitted("eq", "is_internal", false)).toBe(false);
  });

  it("keeps the archived filter working independently of the internal one", async () => {
    await runHook({ includeInternal: true });
    expect(emitted("is", "archived_at", null)).toBe(true);
  });

  it("applies both filters by default", async () => {
    await runHook();
    expect(emitted("is", "archived_at", null)).toBe(true);
    expect(emitted("eq", "is_internal", false)).toBe(true);
  });

  it("caches the two option sets separately", async () => {
    // A shared query key would serve the filtered list to an includeInternal
    // caller, or worse, the unfiltered list to everyone else.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const w = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const a = renderHook(() => usePartners(), { wrapper: w });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));

    calls.length = 0;
    const b = renderHook(() => usePartners({ includeInternal: true }), { wrapper: w });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    // A fresh fetch happened rather than a cache hit on the filtered list.
    expect(calls.some((c) => c[0] === "from")).toBe(true);
  });
});
