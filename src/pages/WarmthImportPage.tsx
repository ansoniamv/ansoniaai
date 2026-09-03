import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePartners, type Partner } from "@/hooks/usePartners";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WarmthBadge } from "@/components/WarmthBadge";
import { ShieldOff, Loader2, Download, Undo2 } from "lucide-react";
import * as XLSX from "xlsx-js-style";

const CANONICAL = ["Existing Partner", "Very Warm", "Warm", "Tepid", "Cold"] as const;
type Canonical = (typeof CANONICAL)[number];

const CANON_LOOKUP: Record<string, Canonical> = {};
for (const c of CANONICAL) CANON_LOOKUP[c.toLowerCase()] = c;
// aliases
const ALIASES: Record<string, Canonical> = {
  "existing": "Existing Partner",
  "existing partner": "Existing Partner",
  "very warm": "Very Warm",
  "warm": "Warm",
  "tepid": "Tepid",
  "lukewarm": "Tepid",
  "cold": "Cold",
};

function stripNumberPrefix(s: string): string {
  return s.replace(/^\s*\d+\s*[.)]\s*/, "").trim();
}

function canonicalizeWarmth(raw: string): Canonical | null {
  if (!raw) return null;
  const stripped = stripNumberPrefix(raw).toLowerCase().trim();
  if (!stripped) return null;
  return CANON_LOOKUP[stripped] ?? ALIASES[stripped] ?? null;
}

const ENTITY_SUFFIXES = ["llc", "l.l.c", "lp", "l.p", "inc", "incorporated", "corp", "corporation", "ltd", "co", "company", "reit", "group", "management", "mgmt", "capital", "partners", "holdings"];

function normalizeName(s: string): string {
  let n = s.toLowerCase().trim();
  n = n.replace(/[.,'&/()\[\]]/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  // strip trailing entity suffixes iteratively
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of ENTITY_SUFFIXES) {
      if (n.endsWith(" " + suf)) {
        n = n.slice(0, -suf.length - 1).trim();
        changed = true;
      } else if (n === suf) {
        n = "";
        changed = true;
      }
    }
  }
  return n;
}

function extractParenPair(firm: string): string[] {
  const m = firm.match(/^(.*?)\s*\((.+?)\)\s*$/);
  if (m) return [m[1].trim(), m[2].trim()];
  return [firm];
}

type Bucket = "change" | "noop" | "review" | "unmatched" | "unmappable" | "blank";

type ParsedRow = {
  key: string;
  firm: string;
  warmthRaw: string;
  warmthCanonical: Canonical | null;
  matches: Partner[]; // possible candidates
  chosenPartnerId: string | null; // for ambiguous, user-picked
  matchedBy: "exact" | "normalized" | "paren-alias" | "ambiguous" | "none";
  bucket: Bucket;
  include: boolean;
};

function parseInput(text: string): { firm: string; warmthRaw: string }[] {
  const rows: { firm: string; warmthRaw: string }[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // header skip
    if (/^(firm|name|partner)[\s,\t]+(warmth|relationship\s*strength)/i.test(line)) continue;
    // split on tab or comma (last comma is separator)
    let firm = "", warmth = "";
    if (line.includes("\t")) {
      const parts = line.split("\t");
      firm = parts[0].trim();
      warmth = parts.slice(1).join(" ").trim();
    } else if (line.includes(",")) {
      // split at last comma to preserve firm names containing commas
      const idx = line.lastIndexOf(",");
      firm = line.slice(0, idx).trim();
      warmth = line.slice(idx + 1).trim();
    } else {
      firm = line;
      warmth = "";
    }
    // strip surrounding quotes
    firm = firm.replace(/^["']|["']$/g, "").trim();
    warmth = warmth.replace(/^["']|["']$/g, "").trim();
    if (firm) rows.push({ firm, warmthRaw: warmth });
  }
  return rows;
}

function parseCSV(text: string): { firm: string; warmthRaw: string }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  // naive CSV: header-driven
  const splitCsv = (l: string) => {
    const out: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = splitCsv(lines[0]).map((h) => h.toLowerCase());
  const firmIdx = header.findIndex((h) => /^(firm|name|partner|company)$/.test(h));
  const warmthIdx = header.findIndex((h) => /warmth|relationship\s*strength/.test(h));
  if (firmIdx === -1 || warmthIdx === -1) {
    // fallback: assume 2-column, no header
    return parseInput(text);
  }
  const rows: { firm: string; warmthRaw: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsv(lines[i]);
    const firm = (cols[firmIdx] || "").trim();
    const warmth = (cols[warmthIdx] || "").trim();
    if (firm) rows.push({ firm, warmthRaw: warmth });
  }
  return rows;
}

export default function WarmthImportPage() {
  const { isAdmin, profile } = useAuth();
  const { data: partners = [] } = usePartners({ includeArchived: true });
  const qc = useQueryClient();
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [applying, setApplying] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const partnerIndex = useMemo(() => {
    const exact = new Map<string, Partner[]>();
    const norm = new Map<string, Partner[]>();
    for (const p of partners) {
      const e = p.name.toLowerCase().trim();
      (exact.get(e) ?? exact.set(e, []).get(e)!).push(p);
      const n = normalizeName(p.name);
      if (n) (norm.get(n) ?? norm.set(n, []).get(n)!).push(p);
    }
    return { exact, norm };
  }, [partners]);

  const buildRows = (raw: { firm: string; warmthRaw: string }[]): ParsedRow[] => {
    // dedupe by normalized firm; keep first occurrence
    const seen = new Set<string>();
    const out: ParsedRow[] = [];
    for (const r of raw) {
      const key = normalizeName(r.firm) || r.firm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const canon = canonicalizeWarmth(r.warmthRaw);
      let matches: Partner[] = [];
      let matchedBy: ParsedRow["matchedBy"] = "none";

      const exactHit = partnerIndex.exact.get(r.firm.toLowerCase().trim());
      if (exactHit && exactHit.length) {
        matches = exactHit;
        matchedBy = "exact";
      } else {
        // try normalized
        const candidates = extractParenPair(r.firm);
        for (const cand of candidates) {
          const nk = normalizeName(cand);
          if (!nk) continue;
          const hit = partnerIndex.norm.get(nk);
          if (hit && hit.length) {
            matches = hit;
            matchedBy = cand === candidates[0] ? "normalized" : "paren-alias";
            break;
          }
        }
      }

      let bucket: Bucket;
      let chosen: string | null = null;
      if (!r.warmthRaw.trim()) {
        bucket = "blank";
      } else if (!canon) {
        bucket = "unmappable";
      } else if (matches.length === 0) {
        bucket = "unmatched";
      } else if (matches.length > 1) {
        bucket = "review";
        matchedBy = "ambiguous";
      } else {
        chosen = matches[0].id;
        if ((matches[0].relationship_strength || "") === canon) bucket = "noop";
        else bucket = "change";
      }

      out.push({
        key: key + ":" + out.length,
        firm: r.firm,
        warmthRaw: r.warmthRaw,
        warmthCanonical: canon,
        matches,
        chosenPartnerId: chosen,
        matchedBy,
        bucket,
        include: bucket === "change" || bucket === "review",
      });
    }
    return out;
  };

  const runParse = () => {
    const parsed = parseInput(pasteText);
    if (!parsed.length) { toast.error("No rows parsed"); return; }
    setRows(buildRows(parsed));
  };

  const parseXlsxBuffer = (buf: ArrayBuffer): { firm: string; warmthRaw: string }[] => {
    const wb = XLSX.read(buf, { type: "array" });
    const out: { firm: string; warmthRaw: string }[] = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
      if (!grid.length) continue;
      // Find header row containing both a firm-like column and a warmth-like column
      let headerRow = -1, firmCol = -1, warmthCol = -1;
      for (let i = 0; i < Math.min(grid.length, 30); i++) {
        const row = grid[i] || [];
        let fCol = -1, wCol = -1;
        for (let j = 0; j < row.length; j++) {
          const cell = String(row[j] ?? "").trim().toLowerCase();
          if (!cell) continue;
          if (fCol === -1 && /^(firm|name|partner|company)$/.test(cell)) fCol = j;
          if (wCol === -1 && /warmth|relationship\s*strength/.test(cell)) wCol = j;
        }
        if (fCol !== -1 && wCol !== -1) { headerRow = i; firmCol = fCol; warmthCol = wCol; break; }
      }
      if (headerRow === -1) continue;
      for (let i = headerRow + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const firm = String(row[firmCol] ?? "").trim();
        const warmth = String(row[warmthCol] ?? "").trim();
        if (firm) out.push({ firm, warmthRaw: warmth });
      }
    }
    return out;
  };

  const handleFile = (f: File) => {
    const isXlsx = /\.xlsx?$/i.test(f.name) || f.type.includes("sheet") || f.type.includes("excel");
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: { firm: string; warmthRaw: string }[] = [];
      if (isXlsx) {
        parsed = parseXlsxBuffer(reader.result as ArrayBuffer);
        if (!parsed.length) { toast.error("Could not find Firm + Warmth/Relationship Strength columns in the XLSX"); return; }
      } else {
        parsed = parseCSV(String(reader.result || ""));
        if (!parsed.length) { toast.error("Could not parse CSV"); return; }
      }
      setRows(buildRows(parsed));
      toast.success(`Parsed ${parsed.length} row${parsed.length === 1 ? "" : "s"}`);
    };
    if (isXlsx) reader.readAsArrayBuffer(f);
    else reader.readAsText(f);
  };


  const setChosen = (rowKey: string, partnerId: string | null) => {
    setRows((rs) => rs.map((r) => {
      if (r.key !== rowKey) return r;
      if (!partnerId) return { ...r, chosenPartnerId: null };
      const p = r.matches.find((m) => m.id === partnerId);
      if (!p) return r;
      const bucket: Bucket = (p.relationship_strength || "") === r.warmthCanonical ? "noop" : "change";
      return { ...r, chosenPartnerId: partnerId, bucket, matchedBy: "ambiguous" };
    }));
  };

  const toggleInclude = (rowKey: string) => {
    setRows((rs) => rs.map((r) => r.key === rowKey ? { ...r, include: !r.include } : r));
  };

  const counts = useMemo(() => {
    const c = { change: 0, noop: 0, review: 0, unmatched: 0, unmappable: 0, blank: 0, total: rows.length };
    for (const r of rows) c[r.bucket]++;
    return c;
  }, [rows]);

  const toApply = useMemo(
    () => rows.filter((r) => r.include && r.bucket === "change" && r.chosenPartnerId && r.warmthCanonical),
    [rows]
  );

  const apply = async () => {
    if (!toApply.length) return;
    setApplying(true);
    const batchId = crypto.randomUUID();
    const appliedBy = profile?.email || "unknown";
    let ok = 0, fail = 0;
    for (const r of toApply) {
      const partner = partners.find((p) => p.id === r.chosenPartnerId);
      const oldW = partner?.relationship_strength || null;
      const { error } = await supabase
        .from("partners")
        .update({ relationship_strength: r.warmthCanonical! })
        .eq("id", r.chosenPartnerId!);
      if (error) { fail++; continue; }
      await supabase.from("warmth_import_log").insert({
        batch_id: batchId,
        partner_id: r.chosenPartnerId,
        partner_name: partner?.name || r.firm,
        old_warmth: oldW,
        new_warmth: r.warmthCanonical,
        matched_by: r.matchedBy,
        applied_by: appliedBy,
      } as any);
      ok++;
    }
    setApplying(false);
    toast.success(`Applied ${ok} update${ok === 1 ? "" : "s"}${fail ? ` (${fail} failed)` : ""}`);
    qc.invalidateQueries({ queryKey: ["partners"] });
    qc.invalidateQueries({ queryKey: ["warmth-import-batches"] });
    // clear applied rows from preview
    const appliedKeys = new Set(toApply.map((r) => r.key));
    setRows((rs) => rs.filter((r) => !appliedKeys.has(r.key)));
  };

  const lastBatch = useQuery({
    queryKey: ["warmth-import-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warmth_import_log")
        .select("*")
        .order("applied_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as any[];
    },
  });

  const latestBatchRows = useMemo(() => {
    const data = lastBatch.data;
    if (!data || !data.length) return [];
    const bid = data[0].batch_id;
    return data.filter((r) => r.batch_id === bid);
  }, [lastBatch.data]);

  const downloadRollback = () => {
    if (!latestBatchRows.length) return;
    const header = "partner_id,partner_name,old_warmth,new_warmth,applied_at";
    const rows = latestBatchRows.map((r) =>
      [r.partner_id, JSON.stringify(r.partner_name || ""), JSON.stringify(r.old_warmth || ""), JSON.stringify(r.new_warmth || ""), r.applied_at].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `warmth-rollback-${latestBatchRows[0].batch_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const undoLast = async () => {
    if (!latestBatchRows.length) return;
    if (!confirm(`Undo last import of ${latestBatchRows.length} row(s)?`)) return;
    setUndoing(true);
    const undoBatchId = crypto.randomUUID();
    const appliedBy = profile?.email || "unknown";
    let ok = 0, fail = 0;
    for (const r of latestBatchRows) {
      if (!r.partner_id) continue;
      const { error } = await supabase
        .from("partners")
        .update({ relationship_strength: r.old_warmth })
        .eq("id", r.partner_id);
      if (error) { fail++; continue; }
      await supabase.from("warmth_import_log").insert({
        batch_id: undoBatchId,
        partner_id: r.partner_id,
        partner_name: r.partner_name,
        old_warmth: r.new_warmth,
        new_warmth: r.old_warmth,
        matched_by: "undo",
        applied_by: appliedBy,
      } as any);
      ok++;
    }
    setUndoing(false);
    toast.success(`Reverted ${ok} row(s)${fail ? ` (${fail} failed)` : ""}`);
    qc.invalidateQueries({ queryKey: ["partners"] });
    qc.invalidateQueries({ queryKey: ["warmth-import-batches"] });
  };

  if (!isAdmin) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <ShieldOff className="h-10 w-10 text-destructive mx-auto mb-2" />
            <CardTitle>Admins only</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            You need admin access to import partner warmth.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Partner Warmth Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bulk-update relationship warmth for existing partners. Paste rows or upload a CSV, review the match preview, then apply.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Input</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"Firm, Warmth\nBasis Investment Group, 3. Warm\nCarlyle Group, Existing Partner\n..."}
            className="min-h-[160px] font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={runParse} disabled={!pasteText.trim()}>Parse pasted rows</Button>
            <div className="text-xs text-muted-foreground">or</div>
            <Input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              className="max-w-xs"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Accepted warmth values: {CANONICAL.join(" · ")}. Numeric prefixes like "3. Warm" are stripped automatically.
          </p>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Review</CardTitle>
            <div className="flex flex-wrap gap-3 text-xs mt-2">
              <span className="px-2 py-1 rounded bg-primary/10 text-primary font-medium">{counts.change} to change</span>
              <span className="px-2 py-1 rounded bg-muted">{counts.noop} no-op</span>
              <span className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">{counts.review} needs review</span>
              <span className="px-2 py-1 rounded bg-destructive/10 text-destructive">{counts.unmatched} unmatched</span>
              <span className="px-2 py-1 rounded bg-destructive/10 text-destructive">{counts.unmappable} unmappable warmth</span>
              <span className="px-2 py-1 rounded bg-muted">{counts.blank} blank</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Firm (input)</TableHead>
                    <TableHead>Matched partner</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Current → New</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const chosen = r.matches.find((m) => m.id === r.chosenPartnerId);
                    const canChange = r.bucket === "change" || r.bucket === "review";
                    return (
                      <TableRow key={r.key} className={r.bucket === "change" ? "" : "opacity-70"}>
                        <TableCell>
                          <Checkbox checked={r.include} onCheckedChange={() => toggleInclude(r.key)} disabled={!canChange} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.firm}<div className="text-[10px] text-muted-foreground">warmth: {r.warmthRaw || "—"}</div></TableCell>
                        <TableCell>
                          {r.bucket === "review" ? (
                            <Select value={r.chosenPartnerId || ""} onValueChange={(v) => setChosen(r.key, v)}>
                              <SelectTrigger className="h-8 text-xs w-64"><SelectValue placeholder="Pick a partner…" /></SelectTrigger>
                              <SelectContent>
                                {r.matches.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : chosen ? (
                            <Link to={`/partners/${chosen.id}`} className="text-primary hover:underline text-xs">{chosen.name}</Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">— no match —</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border">{r.matchedBy}</span>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{r.bucket}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <WarmthBadge strength={chosen?.relationship_strength || null} />
                            <span className="text-muted-foreground">→</span>
                            {r.warmthCanonical ? (
                              <span className={r.bucket === "change" ? "ring-2 ring-primary/40 rounded-full" : ""}>
                                <WarmthBadge strength={r.warmthCanonical} />
                              </span>
                            ) : <span className="text-xs text-destructive">unmappable</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={apply} disabled={applying || toApply.length === 0}>
                {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Apply {toApply.length} change{toApply.length === 1 ? "" : "s"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Last import</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {latestBatchRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No prior imports.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Batch <span className="font-mono">{latestBatchRows[0].batch_id.slice(0, 8)}</span> ·
                {" "}{latestBatchRows.length} row(s) ·
                {" "}{new Date(latestBatchRows[0].applied_at).toLocaleString()} ·
                {" "}by {latestBatchRows[0].applied_by || "—"}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={downloadRollback}>
                  <Download className="h-4 w-4 mr-1.5" /> Download rollback CSV
                </Button>
                <Button variant="outline" size="sm" onClick={undoLast} disabled={undoing}>
                  {undoing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1.5" />}
                  Undo last import
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
