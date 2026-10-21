/**
 * Deal documents panel: upload the OM / rent roll / T12, watch them get read,
 * and review what was found before any of it reaches the deal.
 *
 * Nothing is applied automatically. Each proposed value sits next to the
 * deal's current value and the quote it was read from; a person ticks what
 * they trust and applies it. Blank fields are preticked, replacements are not:
 * overwriting a number someone typed should be a deliberate click.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, FileSpreadsheet, FileText, Loader2, RotateCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { DealDocumentSummary } from "@/components/DealDocumentSummary";
import { blocksApply, checkDocumentAgainstDeal, type DocumentIssue } from "@/lib/documentMatch";
import {
  MAX_DEAL_DOCUMENT_BYTES,
  getDealDocumentUrl,
  readState,
  useApplyDealProposals,
  useDealDocuments,
  useDeleteDealDocument,
  useDismissDealProposals,
  usePendingDealProposals,
  useReparseDealDocument,
  useUploadDealDocument,
  type DealDocument,
  type DealDocumentProposal,
} from "@/hooks/useDealDocuments";

const ACCEPT = ".pdf,.xlsx,.xlsm,.xls,.csv";

const DOC_TYPE_LABEL: Record<string, string> = { om: "OM", rent_roll: "Rent roll", t12: "T12", other: "Other" };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

/** Labels and formats in the deals table's own units (asking_price is $M). */
const FIELDS: Record<string, { label: string; fmt: (v: number) => string }> = {
  unit_count: { label: "Units", fmt: (v) => v.toLocaleString() },
  vintage_year: { label: "Year built", fmt: (v) => String(v) },
  total_sqft: { label: "Rentable SF", fmt: (v) => Math.round(v).toLocaleString() },
  occupancy_pct: { label: "Occupancy", fmt: (v) => `${v.toFixed(1)}%` },
  in_place_avg_rent: { label: "In-place avg rent", fmt: (v) => `${money(v)}/mo` },
  gross_scheduled_rent: { label: "Gross sched. rent (yr)", fmt: money },
  t12_noi: { label: "T-12 NOI", fmt: money },
  t12_opex: { label: "T-12 OpEx", fmt: money },
  expense_ratio: { label: "Expense ratio", fmt: (v) => `${v.toFixed(1)}%` },
  asking_price: { label: "Asking price", fmt: (v) => `$${v.toFixed(2)}M` },
};
const FIELD_ORDER = Object.keys(FIELDS);

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function fmtField(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return isNum(n) && FIELDS[field] ? FIELDS[field].fmt(n) : String(v);
}

export function DealDocumentsPanel({ deal }: { deal: Record<string, unknown> & { id: string; property_name: string } }) {
  const dealId = deal.id;
  const qc = useQueryClient();
  const { data: docs = [] } = useDealDocuments(dealId);
  const { data: proposals = [] } = usePendingDealProposals(dealId);
  const upload = useUploadDealDocument(dealId);
  const reparse = useReparseDealDocument(dealId);
  const del = useDeleteDealDocument(dealId);
  const apply = useApplyDealProposals(dealId);
  const dismiss = useDismissDealProposals(dealId);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<DealDocument | null>(null);

  // A read that dies changes nothing in the row, so polling alone never redraws
  // the card; "stopped" is a matter of time passing. Redraw on a timer while
  // anything is reading so the card turns to "stopped" without a reload.
  const [, setTick] = useState(0);
  const anyReading = docs.some((d) => {
    const s = readState(d);
    return s === "reading" || s === "breakdown";
  });
  useEffect(() => {
    if (!anyReading) return;
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [anyReading]);

  // A document finishing its parse is what creates proposals, so refresh them then.
  const parsedSignature = docs.map((d) => `${d.id}:${d.parse_status}:${d.parsed_at}`).join("|");
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["deal_document_proposals", dealId] });
  }, [parsedSignature, dealId, qc]);

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_DEAL_DOCUMENT_BYTES) {
        toast.error(`${file.name} is over 50 MB and was skipped`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        await upload.mutateAsync(file);
        toast.success(`Uploaded ${file.name}. Reading it now.`);
      } catch (e: unknown) {
        toast.error(`${file.name}: ${errMsg(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const openDoc = async (doc: DealDocument) => {
    try {
      window.open(await getDealDocumentUrl(doc.storage_path), "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      toast.error(`Could not open ${doc.file_name}: ${errMsg(e)}`);
    }
  };

  const docsById = useMemo(() => Object.fromEntries(docs.map((d) => [d.id, d])), [docs]);

  // Documents that look like another property are held: their figures cannot be
  // ticked until someone confirms the document. Session-only on purpose — the
  // confirmation is a judgement about this document today, not a setting.
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const issuesById = useMemo(
    () =>
      Object.fromEntries(
        docs.map((d) => [d.id, d.parse_status === "parsed" ? checkDocumentAgainstDeal(d, deal) : []]),
      ) as Record<string, DocumentIssue[]>,
    [docs, deal],
  );
  const heldDocIds = useMemo(
    () => new Set(docs.filter((d) => blocksApply(issuesById[d.id] ?? []) && !confirmed.has(d.id)).map((d) => d.id)),
    [docs, issuesById, confirmed],
  );

  return (
    <Card
      className={cn("surface-card border-hairline transition-colors", dragging && "border-primary bg-primary/5")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 gap-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display">
          OM · Rent roll · T12
        </CardTitle>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
          Upload
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Drop the OM, rent roll or T12 here (PDF, Excel or CSV). Figures found in them are offered below for
            review; nothing changes on the deal until you apply it.
          </p>
        ) : (
          <div className="divide-y divide-hairline">
            {docs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                issues={issuesById[doc.id] ?? []}
                held={heldDocIds.has(doc.id)}
                onConfirm={() => setConfirmed((s) => new Set(s).add(doc.id))}
                unitCount={typeof deal.unit_count === "number" && deal.unit_count > 0 ? deal.unit_count : null}
                onOpen={() => openDoc(doc)}
                onReparse={() =>
                  reparse.mutate(doc.id, { onError: (e: unknown) => toast.error(`Could not re-read: ${errMsg(e)}`) })
                }
                onDelete={() => setConfirmDelete(doc)}
              />
            ))}
          </div>
        )}

        {proposals.length > 0 && (
          <ProposalReview
            deal={deal}
            proposals={proposals}
            docsById={docsById}
            heldDocIds={heldDocIds}
            applying={apply.isPending}
            dismissing={dismiss.isPending}
            onApply={(ids) =>
              apply.mutate(ids, {
                onSuccess: (n) => toast.success(`Applied ${n} update${n === 1 ? "" : "s"} and rescored the deal`),
                onError: (e: unknown) => toast.error(`Apply failed: ${errMsg(e)}`),
              })
            }
            onDismiss={(ids) =>
              dismiss.mutate(ids, { onError: (e: unknown) => toast.error(`Dismiss failed: ${errMsg(e)}`) })
            }
          />
        )}
      </CardContent>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.file_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The file and any updates from it that are still waiting for review are removed. Values already applied
              to the deal stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmDelete) return;
                del.mutate(confirmDelete, { onError: (e: unknown) => toast.error(`Delete failed: ${errMsg(e)}`) });
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function DocumentRow({
  doc,
  issues,
  held,
  onConfirm,
  unitCount,
  onOpen,
  onReparse,
  onDelete,
}: {
  doc: DealDocument;
  issues: DocumentIssue[];
  held: boolean;
  onConfirm: () => void;
  unitCount: number | null;
  onOpen: () => void;
  onReparse: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const state = readState(doc);
  // Re-reading is allowed while only the breakdown runs: the figures are saved,
  // and a newer read takes the row over from the older one.
  const busy = state === "reading";
  const isSheet = /\.(xlsx|xlsm|xls|csv)$/i.test(doc.file_name);
  const blocking = issues.filter((i) => i.severity === "block");
  const warnings = issues.filter((i) => i.severity === "warn");
  return (
    <div className="py-2 flex items-start gap-3">
      {isSheet ? (
        <FileSpreadsheet className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      ) : (
        <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={onOpen} className="text-sm truncate hover:underline text-left max-w-full">
            {doc.file_name}
          </button>
          {doc.doc_type && (
            <Badge variant="outline" className="text-[10px] uppercase">
              {DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}
            </Badge>
          )}
          {doc.doc_as_of && <span className="text-xs text-muted-foreground">{doc.doc_as_of}</span>}
        </div>
        {busy && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading…
          </p>
        )}
        {state === "stopped" && (
          <p className="text-xs text-destructive">Reading stopped before it finished. Read it again to retry.</p>
        )}
        {state === "failed" && <p className="text-xs text-destructive">{doc.parse_error ?? "Parsing failed."}</p>}
        {blocking.length > 0 && (
          <div
            className={cn(
              "text-xs flex items-start gap-1.5",
              held ? "text-destructive" : "text-amber-600 dark:text-amber-400",
            )}
          >
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>
                {held
                  ? `This may be another property's document. ${blocking.map((i) => i.message).join(" ")}`
                  : `Confirmed for this deal. ${blocking.map((i) => i.message).join(" ")}`}
                {held && " Its figures are held back from the review below."}
              </p>
              {held && (
                <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onConfirm}>
                  It belongs to this deal
                </Button>
              )}
            </div>
          </div>
        )}
        {warnings.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            {warnings.map((i) => i.message).join(" ")} Check it before applying anything.
          </p>
        )}
        {doc.parse_status === "parsed" && doc.parse_notes && (
          <p className="text-xs text-muted-foreground">{doc.parse_notes}</p>
        )}
        {state === "breakdown" && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Figures read. Reading the full breakdown…
          </p>
        )}
        {state === "breakdown_stopped" && (
          <p className="text-xs text-muted-foreground">
            The full breakdown stopped before it finished; the figures above are unaffected. Read it again to retry.
          </p>
        )}
        {doc.parse_status === "parsed" && doc.summary && (
          <>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-xs font-medium text-primary flex items-center gap-1 hover:underline"
              aria-expanded={open}
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {open ? "Hide details" : "Show details"}
              {!open && doc.summary.checks.length > 0 && (
                <span className="ml-1 text-amber-700 dark:text-amber-400 font-normal">
                  · {doc.summary.checks.length} check{doc.summary.checks.length === 1 ? "" : "s"} to review
                </span>
              )}
            </button>
            {open && <DealDocumentSummary summary={doc.summary} unitCount={unitCount} />}
          </>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Read again" disabled={busy} onClick={onReparse}>
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ProposalReview({
  deal,
  proposals,
  docsById,
  heldDocIds,
  applying,
  dismissing,
  onApply,
  onDismiss,
}: {
  deal: Record<string, unknown>;
  proposals: DealDocumentProposal[];
  docsById: Record<string, DealDocument>;
  heldDocIds: Set<string>;
  applying: boolean;
  dismissing: boolean;
  onApply: (ids: string[]) => void;
  onDismiss: (ids: string[]) => void;
}) {
  // Candidates per field, best first: rank, then the newest document.
  const groups = useMemo(() => {
    const by: Record<string, DealDocumentProposal[]> = {};
    for (const p of proposals) (by[p.field] ??= []).push(p);
    for (const list of Object.values(by)) {
      list.sort((a, b) => b.rank - a.rank || b.created_at.localeCompare(a.created_at));
    }
    return FIELD_ORDER.filter((f) => by[f]).map((f) => ({ field: f, candidates: by[f] }));
  }, [proposals]);

  const defaultSelection = useMemo(() => {
    const sel: Record<string, string | null> = {};
    for (const { field, candidates } of groups) {
      const blank = deal[field] === null || deal[field] === undefined || deal[field] === "";
      const best = candidates.find((c) => !heldDocIds.has(c.document_id));
      sel[field] = blank && best ? best.id : null;
    }
    return sel;
  }, [groups, deal, heldDocIds]);

  // field -> chosen proposal id (one per field at most)
  const [selected, setSelected] = useState<Record<string, string | null>>(defaultSelection);
  const proposalKey = proposals.map((p) => p.id).join(",");
  const heldKey = [...heldDocIds].sort().join(",");
  useEffect(() => setSelected(defaultSelection), [proposalKey, heldKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered again here, so a document held after a box was ticked cannot slip through.
  const heldProposal = (id: string) => heldDocIds.has(proposals.find((p) => p.id === id)?.document_id ?? "");
  const chosen = Object.values(selected).filter((v): v is string => !!v && !heldProposal(v));

  return (
    <div className="space-y-2 rounded-md border border-hairline p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-medium">Review updates from documents</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={dismissing || applying} onClick={() => onDismiss(proposals.map((p) => p.id))}>
            Dismiss all
          </Button>
          <Button size="sm" disabled={chosen.length === 0 || applying} onClick={() => onApply(chosen)}>
            {applying && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Apply {chosen.length || ""} selected
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Field</TableHead>
              <TableHead>Current</TableHead>
              <TableHead>From document</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.flatMap(({ field, candidates }) =>
              candidates.map((p, i) => {
                const doc = docsById[p.document_id];
                const held = heldDocIds.has(p.document_id);
                const checked = !held && selected[field] === p.id;
                const current = deal[field];
                const replaces = current !== null && current !== undefined && current !== "";
                return (
                  <TableRow key={p.id} className={cn(i > 0 && "border-t-0")}>
                    <TableCell className="align-top">
                      <Checkbox
                        checked={checked}
                        disabled={held}
                        aria-label={`Apply ${FIELDS[field]?.label ?? field} from ${doc?.file_name ?? "document"}`}
                        onCheckedChange={(v) => setSelected((s) => ({ ...s, [field]: v ? p.id : null }))}
                      />
                    </TableCell>
                    <TableCell className="align-top text-sm whitespace-nowrap">
                      {i === 0 ? FIELDS[field]?.label ?? field : ""}
                    </TableCell>
                    <TableCell className="align-top text-sm whitespace-nowrap text-muted-foreground">
                      {i === 0 ? fmtField(field, current) : ""}
                    </TableCell>
                    <TableCell className={cn("align-top", held && "opacity-60")}>
                      <div className="text-sm font-medium tabular-nums">
                        {fmtField(field, p.value)}
                        {replaces && checked && (
                          <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">replaces current</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {doc ? `${DOC_TYPE_LABEL[doc.doc_type ?? "other"] ?? "Document"} · ${doc.file_name}` : "Document"}
                      </div>
                      {held && (
                        <div className="text-xs text-destructive">
                          Held: this document may be for another property. Confirm it above to apply.
                        </div>
                      )}
                      {p.evidence && <div className="text-xs text-muted-foreground italic break-words">{p.evidence}</div>}
                    </TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
