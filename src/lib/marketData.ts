import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { CostarExport } from "@/lib/costarExport";

export type SubmarketSignals = Database["public"]["Views"]["costar_submarket_signals_v"]["Row"];
export type MarketImport = Database["public"]["Tables"]["market_data_imports"]["Row"];

/** Scopes the signals view publishes. 'Combined' sums every star slice in the export. */
export const COMBINED = "Combined";

export type Direction = "lower" | "higher";

/**
 * The six cyclical signals, in the order the panel shows them. `pct` is the
 * favourability percentile column (1 = best for rent growth), so a bar that
 * fills to the right is always good news, whichever way the raw number points.
 */
export const CYCLICAL_SIGNALS: Array<{
  key: keyof SubmarketSignals;
  pct: keyof SubmarketSignals;
  label: string;
  better: Direction;
  format: "pct" | "pp" | "pctSigned";
  help: string;
}> = [
  {
    key: "uc_pct",
    pct: "pct_uc",
    label: "Under construction",
    better: "lower",
    format: "pct",
    help: "Units under construction today ÷ existing units. Delivers over the next 12–24 months, so this is the only measured forward supply.",
  },
  {
    key: "fwd_deliveries_2y_pct",
    pct: "pct_fwd_supply",
    label: "Deliveries, next 2 yrs",
    better: "lower",
    format: "pct",
    help: "CoStar's forecast net deliveries over the next two calendar years ÷ existing units. Includes projects not yet started.",
  },
  {
    key: "demand_gap_t12_pct",
    pct: "pct_demand_gap",
    label: "Absorption − deliveries",
    better: "higher",
    format: "pctSigned",
    help: "Trailing-12-month absorption minus deliveries, ÷ existing units. Positive means demand is outrunning new supply.",
  },
  {
    key: "occupancy_gap",
    pct: "pct_occupancy_gap",
    label: "Occupancy vs 10-yr mean",
    better: "higher",
    format: "pp",
    help: "Current occupancy minus this submarket's own average since 2016. Below its norm, landlords lose pricing power regardless of demand.",
  },
  {
    key: "concession_change",
    pct: "pct_concession_change",
    label: "Concession change, 1 yr",
    better: "lower",
    format: "pp",
    help: "Change in (asking − effective) ÷ asking rent over the past year. Concessions burning off lead headline rent recovery.",
  },
  {
    key: "rent_forecast_3y_cagr",
    pct: "pct_rent_forecast",
    label: "CoStar rent forecast, 3-yr CAGR",
    better: "higher",
    format: "pctSigned",
    help: "CoStar's base-case effective rent growth, annualised over the next three years. A benchmark, not ours.",
  },
];

/** Fractions in, display text out. pp = percentage points. */
export function formatSignal(v: number | null | undefined, format: "pct" | "pp" | "pctSigned", digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = v * 100;
  if (format === "pct") return `${n.toFixed(digits)}%`;
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}${format === "pp" ? " pp" : "%"}`;
}

export const SUPPLY_SOURCE_LABEL: Record<string, string> = {
  costar_uc: "CoStar under construction ÷ inventory",
  esri_housing_units: "Esri 5-mi housing-unit growth (all housing, not a pipeline)",
};

// ---------------------------------------------------------------- queries

export function useCurrentImport() {
  return useQuery({
    queryKey: ["market_data_imports", "current"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("market_data_imports")
        .select("*")
        .eq("status", "complete")
        .contains("geography_types", ["Submarket"])
        .order("as_of_date", { ascending: false })
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useMarketImports() {
  return useQuery({
    queryKey: ["market_data_imports", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("market_data_imports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Every submarket at one scope: ~2,300 rows, fetched in pages because PostgREST caps a response at 1,000. */
export function useAllSignals(scope: string) {
  return useQuery({
    queryKey: ["costar_signals", "all", scope],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const out: SubmarketSignals[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("costar_submarket_signals_v")
          .select("*")
          .eq("scope", scope)
          .order("geography_code")
          .range(from, from + 999);
        if (error) throw error;
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
  });
}

export function useSubmarketSignals(code: string | null | undefined) {
  return useQuery({
    queryKey: ["costar_signals", "one", code],
    enabled: !!code,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("costar_submarket_signals_v")
        .select("*")
        .eq("geography_code", code!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type SeriesPoint = {
  period: string;
  year: number;
  kind: string;
  inventory: number | null;
  delivered: number | null;
  occupancy: number | null;
};

/**
 * One submarket's annual history and forecast, all slices summed, for the
 * charts. Year-to-date rows are left out: the full-year estimate stands for the
 * current year, so each year appears once.
 */
export function useSubmarketSeries(code: string | null | undefined, importId: string | null | undefined) {
  return useQuery({
    queryKey: ["costar_series", code, importId],
    enabled: !!code && !!importId,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<SeriesPoint[]> => {
      const { data, error } = await supabase
        .from("costar_series")
        .select("period, period_year, period_quarter, period_kind, slice, inventory_units, net_delivered_units_12mo, occupancy_rate")
        .eq("geography_code", code!)
        .eq("import_id", importId!)
        .neq("period_kind", "ytd");
      if (error) throw error;
      const byYear = new Map<number, typeof data>();
      for (const r of data ?? []) {
        const list = byYear.get(r.period_year) ?? [];
        list.push(r);
        byYear.set(r.period_year, list);
      }
      return [...byYear.entries()]
        .sort(([a], [b]) => a - b)
        .map(([year, rows]) => {
          // Latest quarter of the year only, in case the export is quarterly.
          const q = Math.max(...rows.map((r) => r.period_quarter));
          const latest = rows.filter((r) => r.period_quarter === q);
          const sum = (f: (r: (typeof latest)[number]) => number | null) =>
            latest.some((r) => f(r) != null) ? latest.reduce((a, r) => a + (f(r) ?? 0), 0) : null;
          const inventory = sum((r) => r.inventory_units);
          const occWeight = latest.reduce(
            (a, r) => a + (r.occupancy_rate != null && r.inventory_units ? r.inventory_units : 0),
            0,
          );
          const occupancy = occWeight
            ? latest.reduce((a, r) => a + (r.occupancy_rate ?? 0) * (r.occupancy_rate != null ? r.inventory_units ?? 0 : 0), 0) /
              occWeight
            : null;
          return {
            period: latest[0].period,
            year,
            kind: latest[0].period_kind,
            inventory,
            delivered: sum((r) => r.net_delivered_units_12mo),
            occupancy,
          };
        });
    },
  });
}

// ---------------------------------------------------------------- import

export type ImportProgress = {
  stage: "creating" | "uploading" | "completing" | "finalizing";
  done: number;
  total: number;
};

export type ImportResult = {
  rows: number;
  /** false when the background job hadn't finished by the time we stopped waiting; it still will. */
  finished: boolean;
  replaced_imports: number;
  deals_updated: number;
};

const BATCH = 500;
const PARALLEL = 3;

/**
 * Loads a parsed export. The import row is created as 'loading', every batch
 * is inserted against it, and complete_market_data_import() only flips it to
 * 'complete' if the database holds exactly as many rows as the file had. If
 * anything fails, the import row (and with it every loaded row) is deleted, so
 * a broken upload leaves nothing behind.
 */
export async function importCostarExport(
  parsed: CostarExport,
  fileName: string,
  onProgress: (p: ImportProgress) => void,
): Promise<ImportResult> {
  onProgress({ stage: "creating", done: 0, total: parsed.rows.length });
  const { data: imp, error: impErr } = await supabase
    .from("market_data_imports")
    .insert({
      source: "costar",
      as_of: parsed.asOf,
      as_of_date: parsed.asOfDate,
      file_name: fileName,
      geography_types: parsed.summary.geographyTypes,
      slices: parsed.summary.slices,
      row_count: parsed.rows.length,
    })
    .select("id")
    .single();
  if (impErr) throw impErr;

  try {
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < parsed.rows.length) {
        const start = next;
        next += BATCH;
        const batch = parsed.rows.slice(start, start + BATCH).map((r) => ({ ...r, import_id: imp.id }));
        const { error } = await supabase.from("costar_series").insert(batch);
        if (error) throw new Error(`Rows ${start + 1}–${start + batch.length}: ${error.message}`);
        done += batch.length;
        onProgress({ stage: "uploading", done, total: parsed.rows.length });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));

    onProgress({ stage: "completing", done, total: parsed.rows.length });
    const { error } = await supabase.rpc("complete_market_data_import", { p_import_id: imp.id });
    if (error) throw error;
  } catch (e) {
    // Only flag it: deleting 69k rows can outrun a signed-in request's 8 s
    // limit. The cron job deletes the rows of failed imports.
    await supabase.rpc("discard_market_data_import", {
      p_import_id: imp.id,
      p_reason: (e as Error).message?.slice(0, 500) ?? null,
    });
    throw e;
  }

  // Every row is uploaded. Checking the count and rebuilding the signals can
  // take longer than a signed-in request may run, so a once-a-minute pg_cron
  // job does both (finalize_market_data_imports) and either completes the
  // import or marks it failed with the reason. It does so whether or not this
  // page is still open.
  onProgress({ stage: "finalizing", done: parsed.rows.length, total: parsed.rows.length });
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const { data, error } = await supabase
      .from("market_data_imports")
      .select("status, error, replaced_imports, deals_updated")
      .eq("id", imp.id)
      .maybeSingle();
    if (error) continue; // a blip while polling isn't a failed import
    if (data?.status === "failed") throw new Error(data.error ?? "The database rejected the upload.");
    if (data?.status === "complete")
      return {
        rows: parsed.rows.length,
        finished: true,
        replaced_imports: data.replaced_imports ?? 0,
        deals_updated: data.deals_updated ?? 0,
      };
  }
  return { rows: parsed.rows.length, finished: false, replaced_imports: 0, deals_updated: 0 };
}
