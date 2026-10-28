/**
 * Pro forma model panel: generate the deal's model from its rent roll, T12 and
 * OM with the full-underwrite skill, watch the run, and download the model with
 * its QC report.
 *
 * The run happens in an Anthropic Managed Agents session (generate-model). It
 * takes about 20 minutes, so the panel shows the agent's latest progress line
 * and keeps checking on the run until it ends.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download, FileSpreadsheet, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AtlasMarkdown } from "@/components/atlas/AtlasMarkdown";
import { useAuth } from "@/hooks/useAuth";
import { useDealDocuments, type DealDocument } from "@/hooks/useDealDocuments";
import {
  getDealModelUrl,
  isOpen,
  useCancelDealModel,
  useCheckOpenModels,
  useDealModels,
  useModelSetupStatus,
  useProbeReport,
  useSetUpModelAgent,
  useStartDealModel,
  useStartProbe,
  type DealModel,
} from "@/hooks/useDealModels";
import {
  pickModelInputs,
  RENOVATION_LEVELS,
  type ModelInputPick,
  type ModelInputRole,
  type RenovationLevel,
} from "../../supabase/functions/_shared/dealModel";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const NONE = "none";

const ROLE_LABEL: Record<ModelInputRole, string> = {
  t12: "T12",
  rent_roll: "Rent roll",
  om: "OM",
  comps: "HelloData comps",
};
const ROLE_ORDER: ModelInputRole[] = ["t12", "rent_roll", "om", "comps"];
const REQUIRED: ModelInputRole[] = ["t12", "rent_roll"];

const RENO_LABEL: Record<RenovationLevel, string> = {
  unknown: "Read it from the OM",
  classic: "Classic (no renovations)",
  partial: "Partially renovated",
  full: "Fully renovated",
  mixed: "Mixed (read the split from the OM and rent roll)",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

const minutesSince = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : 0);

export function DealModelPanel({ dealId }: { dealId: string }) {
  const { data: models = [] } = useDealModels(dealId);
  const { data: docs = [] } = useDealDocuments(dealId);
  useCheckOpenModels(dealId, models);
  const cancel = useCancelDealModel(dealId);
  const { isAdmin } = useAuth();
  const { data: setup } = useModelSetupStatus();
  const [dialogOpen, setDialogOpen] = useState(false);
  const notSetUp = setup !== undefined && !setup.ready;

  const open = models.find(isOpen);
  const finished = models.filter((m) => !isOpen(m));
  const defaults = useMemo(() => pickModelInputs(docs), [docs]);
  // Any document will do: the dialog lets the user pick a file the reader filed
  // under the wrong type, and it insists on a T12 and a rent roll.
  const ready = docs.length > 0;

  return (
    <Card className="surface-card border-hairline">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 gap-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display">
          Pro forma model
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)} disabled={!!open || !ready || notSetUp}>
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          Generate model
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && setup && <SetupBox ready={setup.ready} upToDate={setup.up_to_date} probeStarted={!!setup.probe_started_at} />}
        {!isAdmin && notSetUp && (
          <p className="text-xs text-muted-foreground">Model generation isn't set up yet. An admin can set it up here.</p>
        )}
        {open && (
          <div className="rounded-md border border-hairline p-3 flex items-start gap-3">
            <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm">{open.progress || (open.status === "starting" ? "Uploading the files" : "Working")}</p>
              <p className="text-xs text-muted-foreground">
                Started {minutesSince(open.created_at)} min ago. A run takes about 20 minutes; you can leave this page.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(open.id, { onError: (e) => toast.error(`Could not cancel: ${errMsg(e)}`) })}
            >
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </div>
        )}

        {!open && models.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {ready
              ? "Build the deal's pro forma from its rent roll, T12 and OM, using the template in Brain. The model comes with a QC report listing every judgment call to review."
              : "Upload the deal's rent roll and T12 above first; a model needs both."}
          </p>
        )}

        {finished.length > 0 && (
          <div className="divide-y divide-hairline">
            {finished.map((m, i) => (
              <ModelRow key={m.id} model={m} defaultOpen={i === 0 && !open} />
            ))}
          </div>
        )}
      </CardContent>

      {dialogOpen && <GenerateDialog dealId={dealId} docs={docs} defaults={defaults} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

/**
 * Admin only: create or update the agent on Anthropic (with the platform's own
 * key, server-side) and run the $2 container check, with its report.
 */
function SetupBox({ ready, upToDate, probeStarted }: { ready: boolean; upToDate: boolean; probeStarted: boolean }) {
  const setUp = useSetUpModelAgent();
  const startProbe = useStartProbe();
  const { data: report, isFetching } = useProbeReport(probeStarted);
  const [showReport, setShowReport] = useState(false);
  const probing = probeStarted && report !== undefined && !report.over;
  const verdict = report?.messages.join("\n").match(/RECALC:\s*([^\n]+)/i)?.[1];

  return (
    <div className="rounded-md border border-dashed border-hairline p-3 space-y-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">Admin:</span>
        <span className="text-muted-foreground">
          {!ready ? "Model generation isn't set up." : upToDate ? "Agent set up." : "The skill or agent changed since setup."}
        </span>
        {(!ready || !upToDate) && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={setUp.isPending}
            onClick={() =>
              setUp.mutate(undefined, {
                onSuccess: (r) => toast.success(r.created.length ? `Created: ${r.created.join(", ")}` : "Already up to date"),
                onError: (e) => toast.error(`Setup failed: ${errMsg(e)}`),
              })}
          >
            {setUp.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {ready ? "Update" : "Set up"}
          </Button>
        )}
        {ready && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={startProbe.isPending || probing}
            onClick={() =>
              startProbe.mutate(undefined, {
                onSuccess: () => {
                  toast.success("Container check started (capped at $2).");
                  setShowReport(true);
                },
                onError: (e) => toast.error(`Could not start the check: ${errMsg(e)}`),
              })}
          >
            {(startProbe.isPending || probing) && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Check container
          </Button>
        )}
      </div>
      {report && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowReport((v) => !v)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showReport ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Container check: {report.over ? verdict ?? `ended (${report.stop_reason ?? report.status})` : "running"}
            {report.cost_usd != null && ` · $${report.cost_usd.toFixed(2)}`}
            {isFetching && !report.over && <Loader2 className="h-3 w-3 animate-spin" />}
          </button>
          {showReport && (
            <div className="rounded border border-hairline p-2 max-h-80 overflow-y-auto space-y-2">
              {report.errors.map((e) => (
                <p key={e} className="text-destructive">{e}</p>
              ))}
              {report.messages.length === 0 ? (
                <p className="text-muted-foreground">No messages yet.</p>
              ) : (
                report.messages.map((m, i) => <pre key={i} className="whitespace-pre-wrap font-sans">{m}</pre>)
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModelRow({ model, defaultOpen }: { model: DealModel; defaultOpen: boolean }) {
  const [showQc, setShowQc] = useState(defaultOpen);
  const download = async () => {
    if (!model.storage_path || !model.file_name) return;
    try {
      window.location.href = await getDealModelUrl(model.storage_path, model.file_name);
    } catch (e) {
      toast.error(`Could not download the model: ${errMsg(e)}`);
    }
  };
  return (
    <div className="py-2 space-y-2">
      <div className="flex items-start gap-3">
        <FileSpreadsheet className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            {model.status === "done" ? (
              <button type="button" onClick={download} className="text-sm truncate hover:underline text-left max-w-full">
                {model.file_name}
              </button>
            ) : (
              <span className="text-sm text-muted-foreground">Model run</span>
            )}
            {model.status === "done" && model.complete === false && (
              <Badge variant="outline" className="text-[10px] uppercase">Partial</Badge>
            )}
            {model.status === "failed" && (
              <Badge variant="outline" className="text-[10px] uppercase text-destructive">Failed</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {when(model.finished_at ?? model.created_at)}
              {model.cost_usd != null && ` · $${Number(model.cost_usd).toFixed(2)}`}
            </span>
          </div>
          {model.error && (
            <p className={model.status === "failed" ? "text-xs text-destructive" : "text-xs text-amber-600 dark:text-amber-400"}>
              {model.error}
            </p>
          )}
          {model.skipped && model.skipped.length > 0 && (
            <p className="text-xs text-muted-foreground">Skipped: {model.skipped.join("; ")}</p>
          )}
        </div>
        {model.status === "done" && (
          <Button size="sm" variant="ghost" onClick={download} aria-label="Download model">
            <Download className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {model.qc_report && (
        <div className="pl-7">
          <button
            type="button"
            onClick={() => setShowQc((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showQc ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            QC report
          </button>
          {showQc && (
            <div className="mt-2 rounded-md border border-hairline p-3 max-h-[32rem] overflow-y-auto">
              <AtlasMarkdown content={model.qc_report} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GenerateDialog({
  dealId,
  docs,
  defaults,
  onClose,
}: {
  dealId: string;
  docs: DealDocument[];
  defaults: ModelInputPick;
  onClose: () => void;
}) {
  const start = useStartDealModel(dealId);
  const [picks, setPicks] = useState<ModelInputPick>(defaults);
  const [reno, setReno] = useState<RenovationLevel>("unknown");
  const [notes, setNotes] = useState("");
  const missing = REQUIRED.filter((r) => !picks[r]);

  const submit = () =>
    start.mutate(
      {
        // Every role is sent, a cleared one as null, so the function does not
        // fill it back in with its own default.
        inputs: Object.fromEntries(ROLE_ORDER.map((r) => [r, picks[r] ?? null])) as ModelInputPick,
        options: { renovation_level: reno, notes },
      },
      {
        onSuccess: () => {
          toast.success("Generating the model. It takes about 20 minutes.");
          onClose();
        },
        onError: (e) => toast.error(errMsg(e)),
      },
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate pro forma model</DialogTitle>
          <DialogDescription>
            Builds a new copy of the pro forma template in Brain from these files. It takes about 20 minutes and has a
            fixed cost cap per run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {ROLE_ORDER.map((role) => (
            <div key={role} className="grid grid-cols-[7rem_1fr] items-center gap-3">
              <Label className="text-sm">
                {ROLE_LABEL[role]}
                {!REQUIRED.includes(role) && <span className="text-muted-foreground font-normal"> (optional)</span>}
              </Label>
              <Select
                value={picks[role] ?? NONE}
                onValueChange={(v) => setPicks((p) => ({ ...p, [role]: v === NONE ? undefined : v }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {docs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.file_name}
                      {d.doc_as_of ? ` · ${d.doc_as_of}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}

          <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
            <Label className="text-sm">Renovation</Label>
            <Select value={reno} onValueChange={(v) => setReno(v as RenovationLevel)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RENOVATION_LEVELS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {RENO_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Notes for the run (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything the model should know, e.g. unit codes ending in Y are the townhomes."
              className="text-sm"
            />
          </div>

          {missing.length > 0 && (
            <p className="text-xs text-destructive">Pick the {missing.map((r) => ROLE_LABEL[r]).join(" and ")}.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={missing.length > 0 || start.isPending}>
            {start.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
