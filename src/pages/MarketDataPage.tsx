import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubmarketPicker } from "@/components/SubmarketPicker";
import type { CostarExport } from "@/lib/costarExport";
import {
  COMBINED,
  formatSignal,
  importCostarExport,
  useAllSignals,
  useCurrentImport,
  useMarketImports,
  type ImportProgress,
  type SubmarketSignals,
} from "@/lib/marketData";
import { persistDealScore } from "@/lib/persistDealScore";
import { cn } from "@/lib/utils";

export default function MarketDataPage() {
  const { isAdmin } = useAuth();
  const { data: current } = useCurrentImport();

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-serif-display">Market Data</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Submarket supply, occupancy, concessions and CoStar's rent forecast, loaded from the quarterly CoStar export.
          Each deal is linked to its submarket once; its New Supply figure and supply-cycle panel then follow every new
          upload.
          {current
            ? ` Showing CoStar ${current.as_of}, loaded ${new Date(current.completed_at ?? current.created_at).toLocaleDateString()}.`
            : " Nothing loaded yet."}
        </p>
      </header>

      {isAdmin && <ImportCard />}
      {current && <DealAssignments />}
      {current && <Screener />}
    </div>
  );
}

// ------------------------------------------------------------------ import

type ParseState =
  | { status: "idle" }
  | { status: "parsing"; file: File; bytesRead: number; rows: number }
  | { status: "parsed"; file: File; result: CostarExport }
  | { status: "loading"; file: File; result: CostarExport; progress: ImportProgress }
  | { status: "error"; message: string };

function ImportCard() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ParseState>({ status: "idle" });
  const { data: imports = [] } = useMarketImports();

  const parse = (file: File) => {
    setState({ status: "parsing", file, bytesRead: 0, rows: 0 });
    const worker = new Worker(new URL("../workers/costarParse.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "progress") setState({ status: "parsing", file, bytesRead: msg.bytesRead, rows: msg.rows });
      else if (msg.type === "done") {
        setState({ status: "parsed", file, result: msg.result });
        worker.terminate();
      } else if (msg.type === "error") {
        setState({ status: "error", message: msg.message });
        worker.terminate();
      }
    };
    worker.onerror = (e) => {
      setState({ status: "error", message: e.message || "The file couldn't be read." });
      worker.terminate();
    };
    worker.postMessage(file);
  };

  const load = async () => {
    if (state.status !== "parsed") return;
    const { file, result } = state;
    setState({ status: "loading", file, result, progress: { stage: "creating", done: 0, total: result.rows.length } });
    try {
      const out = await importCostarExport(result, file.name, (progress) =>
        setState({ status: "loading", file, result, progress }),
      );
      // Linked deals got a new supply figure in the database; rescore them so
      // total_score and tier move with it.
      if (out.deals_updated > 0) {
        const { data: linked } = await supabase.from("deals").select("*").not("costar_submarket_code", "is", null);
        for (const d of linked ?? []) await persistDealScore(d).catch((e) => console.error("rescore failed", d.id, e));
      }
      if (!out.finished) {
        toast.message(
          `CoStar ${result.asOf} is uploaded and verified. The database is still rebuilding submarket signals; reload this page in a minute.`,
        );
      } else {
        toast.success(
          `Loaded CoStar ${result.asOf}: ${out.rows.toLocaleString()} rows` +
            (out.replaced_imports ? ", replacing the earlier upload of the same quarter" : "") +
            (out.deals_updated ? `; ${out.deals_updated} deal(s) got a new supply figure` : ""),
        );
      }
      setState({ status: "idle" });
      queryClient.invalidateQueries({ queryKey: ["market_data_imports"] });
      queryClient.invalidateQueries({ queryKey: ["costar_signals"] });
      queryClient.invalidateQueries({ queryKey: ["costar_series"] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    } catch (e) {
      setState({ status: "error", message: `Nothing was loaded. ${(e as Error).message}` });
    }
  };

  const busy = state.status === "parsing" || state.status === "loading";
  const sameVintage =
    state.status === "parsed" && imports.some((i) => i.status === "complete" && i.as_of === state.result.asOf);

  return (
    <Card className="surface-card border-hairline">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quarterly CoStar upload</CardTitle>
        <p className="text-xs text-muted-foreground">
          In CoStar: Multifamily → Analytics → Data Export, geography <b>Submarket</b>, all submarkets, slices{" "}
          <b>1 &amp; 2 Star, 3 Star, 4 &amp; 5 Star</b>, annual periods with history and the base-case forecast. Upload the
          .xlsx as downloaded.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) parse(f);
            e.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()} className="gap-1.5">
          <Upload className="h-3.5 w-3.5" /> Choose export (.xlsx)
        </Button>

        {state.status === "parsing" && (
          <div className="space-y-1.5 max-w-md">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Reading {state.file.name}: {state.rows.toLocaleString()} rows,{" "}
              {Math.round(state.bytesRead / 1e6)} MB of sheet XML
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{state.message}</span>
          </div>
        )}

        {(state.status === "parsed" || state.status === "loading") && (
          <ParsedSummary result={state.result} fileName={state.file.name} />
        )}

        {state.status === "parsed" && (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={load} className="gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Load {state.result.rows.length.toLocaleString()} rows
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setState({ status: "idle" })}>
              Cancel
            </Button>
            {sameVintage && (
              <span className="text-xs text-muted-foreground">
                {state.result.asOf} is already loaded; this upload will replace it.
              </span>
            )}
          </div>
        )}

        {state.status === "loading" && (
          <div className="space-y-1.5 max-w-md">
            <Progress value={(state.progress.done / state.progress.total) * 100} />
            <div className="text-xs text-muted-foreground">
              {state.progress.stage === "uploading"
                ? `Uploading ${state.progress.done.toLocaleString()} of ${state.progress.total.toLocaleString()} rows`
                : state.progress.stage === "completing"
                ? "Handing off to the database…"
                : state.progress.stage === "finalizing"
                ? "Uploaded. The database checks the rows and rebuilds submarket signals within a minute…"
                : "Starting…"}
            </div>
          </div>
        )}

        {imports.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>As of</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Slices</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uploaded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.as_of}</TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[16rem]">{i.file_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.row_count.toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{i.slices.join(", ")}</TableCell>
                  <TableCell className={cn("text-xs", i.status !== "complete" && "text-amber-600")}>
                    {i.status === "complete"
                      ? "complete"
                      : i.status === "finalizing"
                      ? "uploaded, finishing within a minute"
                      : i.status === "failed"
                      ? `failed: ${i.error ?? "unknown reason"}`
                      : "incomplete (not used)"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(i.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ParsedSummary({ result, fileName }: { result: CostarExport; fileName: string }) {
  const { summary } = result;
  const thin = Object.entries(summary.coverage).filter(([, v]) => v < 0.5);
  const periods = summary.periods;
  return (
    <div className="rounded-md border border-hairline p-3 space-y-2 text-sm">
      <div className="font-medium">
        {fileName}: CoStar {result.asOf}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs">
        <span>
          <span className="text-muted-foreground">Rows </span>
          {result.rows.length.toLocaleString()}
        </span>
        <span>
          <span className="text-muted-foreground">Geographies </span>
          {summary.geographies.toLocaleString()} {summary.geographyTypes.join("/").toLowerCase()}s in {summary.cbsas} CBSAs
        </span>
        <span>
          <span className="text-muted-foreground">Slices </span>
          {summary.slices.join(", ")}
        </span>
        <span>
          <span className="text-muted-foreground">Periods </span>
          {periods[0]} → {periods[periods.length - 1]}
        </span>
      </div>
      {summary.warnings.map((w) => (
        <div key={w} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-500">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{w}</span>
        </div>
      ))}
      {thin.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Sparse columns (filled on under half the rows):{" "}
          {thin.map(([h, v]) => `${h} ${Math.round(v * 100)}%`).join(", ")}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ deals

type DealRow = {
  id: string;
  property_name: string | null;
  city: string | null;
  state: string | null;
  msa: string | null;
  status: string | null;
  costar_submarket_code: string | null;
  costar_submarket_source: string | null;
  costar_submarket_note: string | null;
  new_supply_pct_of_stock: number | null;
};

function DealAssignments() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState<{ assigned: number; declined: number } | null>(null);
  const { data: signals = [] } = useAllSignals(COMBINED);
  const byCode = useMemo(() => new Map(signals.map((s) => [s.geography_code, s])), [signals]);
  const { data: deals = [], error } = useQuery({
    queryKey: ["deals", "submarket-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select(
          "id, property_name, city, state, msa, status, costar_submarket_code, costar_submarket_source, costar_submarket_note, new_supply_pct_of_stock",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DealRow[];
    },
  });

  const shown = deals.filter((d) => !onlyMissing || !d.costar_submarket_code);
  const missing = deals.filter((d) => !d.costar_submarket_code).length;

  const assign = async (deal: DealRow, code: string | null) => {
    setSavingId(deal.id);
    try {
      const { data: fresh, error } = await supabase
        .from("deals")
        .update({ costar_submarket_code: code, costar_submarket_source: "manual", costar_submarket_note: null })
        .eq("id", deal.id)
        .select("*")
        .single();
      if (error) throw error;
      await persistDealScore(fresh).catch((e) => console.error("rescore failed", e));
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    } catch (e) {
      toast.error("Couldn't save: " + (e as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  // Backfill for deals that predate auto-assignment, in batches the function
  // can finish inside its time limit. Stops when a batch decides nothing: the
  // rows left are ones with no state or metro to narrow by, which a retry
  // would only skip again.
  const autoAssignMissing = async () => {
    const tally = { assigned: 0, declined: 0 };
    setAutoRunning({ ...tally });
    try {
      for (let batch = 0; batch < 50; batch++) {
        const { data, error } = await supabase.functions.invoke("assign-submarket", {
          body: { backfill: true, limit: 10 },
        });
        if (error) throw error;
        const results: Array<{ deal_id: string; status: string }> = data?.results ?? [];
        const assignedIds = results.filter((r) => r.status === "assigned").map((r) => r.deal_id);
        const declined = results.filter((r) => r.status === "declined").length;
        if (assignedIds.length) {
          const { data: fresh } = await supabase.from("deals").select("*").in("id", assignedIds);
          for (const row of fresh ?? []) {
            await persistDealScore(row).catch((e) => console.error("rescore failed", e));
          }
        }
        tally.assigned += assignedIds.length;
        tally.declined += declined;
        setAutoRunning({ ...tally });
        queryClient.invalidateQueries({ queryKey: ["deals"] });
        if (assignedIds.length + declined === 0) break;
      }
      toast.success(
        `Assigned ${tally.assigned} submarket${tally.assigned === 1 ? "" : "s"}` +
          (tally.declined ? `; ${tally.declined} too uncertain to pick, left for you` : ""),
      );
    } catch (e) {
      toast.error("Auto-assign stopped: " + (e as Error).message);
    } finally {
      setAutoRunning(null);
      queryClient.invalidateQueries({ queryKey: ["rent_growth_scores"] });
    }
  };

  return (
    <Card className="surface-card border-hairline">
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Pipeline deals → submarkets</CardTitle>
          <p className="text-xs text-muted-foreground">
            {missing} of {deals.length} deals have no submarket and still show Esri's housing-growth figure as New Supply.
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && missing > 0 && (
            <Button size="sm" variant="outline" onClick={autoAssignMissing} disabled={!!autoRunning}>
              {autoRunning ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {autoRunning.assigned} assigned…
                </>
              ) : (
                "Auto-assign missing"
              )}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setOnlyMissing((v) => !v)}>
            {onlyMissing ? "Show all deals" : "Only unassigned"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        <div className="max-h-[28rem] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="w-[40%]">CoStar submarket</TableHead>
                <TableHead className="text-right">Under constr.</TableHead>
                <TableHead className="text-right">Cyclical</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((d) => {
                const s = d.costar_submarket_code ? byCode.get(d.costar_submarket_code) : undefined;
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      <Link to={`/deals/${d.id}`} className="hover:underline">
                        {d.property_name || "Untitled"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[d.city, d.state].filter(Boolean).join(", ")}
                    </TableCell>
                    <TableCell>
                      <SubmarketPicker
                        value={d.costar_submarket_code}
                        onChange={(code) => assign(d, code)}
                        city={d.city}
                        state={d.state}
                        msa={d.msa}
                        disabled={savingId === d.id}
                      />
                      {d.costar_submarket_source === "ai" && (
                        <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2" title={d.costar_submarket_note ?? undefined}>
                          {d.costar_submarket_code ? "Auto-picked" : "Couldn't auto-pick"}
                          {d.costar_submarket_note ? `: ${d.costar_submarket_note}` : ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s ? formatSignal(s.uc_pct, "pct") : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{s?.cyclical_score ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    Every deal has a submarket.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ screener

type SortKey =
  | "cyclical_score"
  | "uc_pct"
  | "fwd_deliveries_2y_pct"
  | "occupancy_gap"
  | "concession_change"
  | "rent_forecast_3y_cagr"
  | "inventory";

const COLUMNS: Array<{ key: SortKey; label: string; format: (s: SubmarketSignals) => string; desc: boolean }> = [
  { key: "inventory", label: "Units", format: (s) => (s.inventory != null ? Math.round(s.inventory).toLocaleString() : "—"), desc: true },
  { key: "uc_pct", label: "Under constr.", format: (s) => formatSignal(s.uc_pct, "pct"), desc: false },
  { key: "fwd_deliveries_2y_pct", label: "Deliv. next 2y", format: (s) => formatSignal(s.fwd_deliveries_2y_pct, "pct"), desc: false },
  { key: "occupancy_gap", label: "Occ. vs 10y", format: (s) => formatSignal(s.occupancy_gap, "pp"), desc: true },
  { key: "concession_change", label: "Conc. Δ 1y", format: (s) => formatSignal(s.concession_change, "pp"), desc: false },
  { key: "rent_forecast_3y_cagr", label: "CoStar rent 3y", format: (s) => formatSignal(s.rent_forecast_3y_cagr, "pctSigned"), desc: true },
  { key: "cyclical_score", label: "Cyclical", format: (s) => (s.cyclical_score != null ? String(s.cyclical_score) : "—"), desc: true },
];

function Screener() {
  const [scope, setScope] = useState(COMBINED);
  const [state, setState] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "cyclical_score", desc: true });
  const [limit, setLimit] = useState(100);
  const { data: rows = [], isLoading } = useAllSignals(scope);
  const { data: scopes = [COMBINED] } = useQuery({
    queryKey: ["market_data_imports", "current-slices"],
    queryFn: async () => {
      const { data } = await supabase
        .from("market_data_imports")
        .select("slices")
        .eq("status", "complete")
        .order("as_of_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return [COMBINED, ...(data?.slices ?? [])];
    },
  });

  const states = useMemo(() => [...new Set(rows.map((r) => r.state).filter(Boolean) as string[])].sort(), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) => (state === "all" || r.state === state) && (!needle || (r.geography_name ?? "").toLowerCase().includes(needle)),
    );
    const val = (r: SubmarketSignals) => r[sort.key] as number | null;
    return list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // blanks last either way
      if (vb == null) return -1;
      return sort.desc ? vb - va : va - vb;
    });
  }, [rows, state, q, sort]);

  const downloadCsv = () => {
    const header = ["Submarket", "Market", "State", "CBSA", "Scope", ...COLUMNS.map((c) => c.label)];
    const lines = filtered.map((r) =>
      [r.submarket_name, r.market_name, r.state, r.cbsa_code, r.scope, ...COLUMNS.map((c) => r[c.key] ?? "")]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `costar-submarkets-${scope.replace(/\W+/g, "-").toLowerCase()}-${rows[0]?.as_of?.replace(" ", "") ?? ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="surface-card border-hairline">
      <CardHeader className="pb-3 space-y-3">
        <div>
          <CardTitle className="text-base">Submarket screener</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every CoStar submarket ranked on the six cyclical signals. A deal is never screened out by its metro: a strong
            submarket inside a weak market still ranks on its own numbers. Raw values (rates are of existing units); the
            cyclical score averages the national percentiles shown on each deal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Search submarket or market…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-56" />
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {states.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scopes.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === COMBINED ? "All classes" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 ml-auto" onClick={downloadCsv} disabled={!filtered.length}>
            <Download className="h-3.5 w-3.5" /> CSV ({filtered.length.toLocaleString()})
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submarket</TableHead>
                  {COLUMNS.map((c) => (
                    <TableHead key={c.key} className="text-right whitespace-nowrap">
                      <button
                        type="button"
                        className={cn("hover:text-foreground", sort.key === c.key && "text-foreground font-semibold")}
                        onClick={() =>
                          setSort((s) => (s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: c.desc }))
                        }
                      >
                        {c.label}
                        {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, limit).map((r) => (
                  <TableRow key={r.geography_code}>
                    <TableCell className="min-w-[14rem]">
                      <div className="font-medium">{r.submarket_name}</div>
                      <div className="text-[11px] text-muted-foreground">{r.market_name}</div>
                    </TableCell>
                    {COLUMNS.map((c) => (
                      <TableCell key={c.key} className="text-right tabular-nums">
                        {c.format(r)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length > limit && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit((l) => l + 200)}>
                Show more ({(filtered.length - limit).toLocaleString()} left)
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
