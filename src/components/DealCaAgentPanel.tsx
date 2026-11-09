/**
 * The CA agent's card on the deal page: whether the deal's confidentiality
 * agreement was signed, as whom, what the agent thought of its terms, and the
 * documents it brought back. A CA with flagged clauses waits here for a person
 * to approve it; nothing is signed past a flag without that click.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, FileSignature, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { getDealDocumentUrl } from "@/hooks/useDealDocuments";
import { OPEN_RUN_STATUSES, type CaRun, useCaRunAction, useLatestCaRun } from "@/hooks/useDealAgents";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STATUS: Record<CaRun["status"], { label: string; tone: "muted" | "busy" | "warn" | "ok" | "bad" }> = {
  starting: { label: "Starting", tone: "busy" },
  running: { label: "Working", tone: "busy" },
  needs_approval: { label: "Needs approval", tone: "warn" },
  needs_attention: { label: "Needs attention", tone: "warn" },
  done: { label: "Signed", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "muted" },
  disabled: { label: "Signing off", tone: "muted" },
  no_link: { label: "No CA link", tone: "muted" },
};

const TONE_CLASS = {
  muted: "bg-muted text-muted-foreground",
  busy: "bg-primary/10 text-primary",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  bad: "bg-destructive/15 text-destructive",
};

export function DealCaAgentPanel({ dealId }: { dealId: string }) {
  const { data: run, isLoading } = useLatestCaRun(dealId);
  const act = useCaRunAction(dealId);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const open = async (path: string | null) => {
    if (!path) return;
    try {
      window.open(await getDealDocumentUrl(path), "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(`Could not open the file: ${errMsg(e)}`);
    }
  };

  const startRun = () =>
    act.mutate({ action: "start" }, {
      onSuccess: (r) => r && toast.success(r.status === "running" || r.status === "starting" ? "CA agent started" : STATUS[r.status].label),
      onError: (e) => toast.error(errMsg(e)),
    });

  const isOpen = !!run && OPEN_RUN_STATUSES.includes(run.status);
  const s = run ? STATUS[run.status] : null;

  return (
    <Card className="surface-card border-hairline">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 gap-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-display flex items-center gap-2">
          <FileSignature className="h-3.5 w-3.5" /> Confidentiality agreement
          {s && <Badge variant="outline" className={`border-0 ${TONE_CLASS[s.tone]}`}>{s.label}</Badge>}
        </CardTitle>
        {!isOpen && (
          <Button size="sm" variant="outline" onClick={startRun} disabled={act.isPending || isLoading}>
            {act.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5 mr-1.5" />}
            {run ? "Run again" : "Sign CA"}
          </Button>
        )}
        {isOpen && run && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => act.mutate({ action: "cancel", runId: run.id }, { onError: (e) => toast.error(errMsg(e)) })}
            disabled={act.isPending}
          >
            Stop
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!run && !isLoading && (
          <p className="text-muted-foreground">
            When a deal is added from the inbox, the CA agent signs its confidentiality agreement and brings the OM, rent
            roll and T12 into the documents below. CAs with unusual terms wait here for approval.
          </p>
        )}

        {run && (run.status === "starting" || run.status === "running") && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{run.progress ?? "Working"}…</span>
          </div>
        )}

        {run?.attention && (
          <div className="flex gap-2 rounded-md bg-amber-500/10 p-2.5 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{run.attention}</span>
          </div>
        )}
        {run?.status === "failed" && run.error && (
          <div className="flex gap-2 rounded-md bg-destructive/10 p-2.5 text-destructive">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{run.error}</span>
          </div>
        )}

        {run?.ca_summary && <p>{run.ca_summary}</p>}

        {run && run.ca_flags.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 font-medium">
              <ShieldAlert className="h-4 w-4 text-amber-600" /> Flagged clauses
            </div>
            {run.ca_flags.map((f, i) => (
              <div key={i} className="rounded-md border border-hairline p-2.5 space-y-1">
                <div className="font-medium">{f.clause}</div>
                <blockquote className="border-l-2 border-amber-500/60 pl-2 text-muted-foreground italic">“{f.quote}”</blockquote>
                {f.why && <div className="text-xs text-muted-foreground">{f.why}</div>}
              </div>
            ))}
          </div>
        )}

        {run?.status === "needs_approval" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirmApprove(true)} disabled={act.isPending}>
              Approve and sign
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => act.mutate({ action: "cancel", runId: run.id }, { onError: (e) => toast.error(errMsg(e)) })}
              disabled={act.isPending}
            >
              Don't sign
            </Button>
          </div>
        )}

        {run?.signed_at && run.signed_as && (
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Signed as {run.signed_as.name}
              {run.signed_as.title ? `, ${run.signed_as.title}` : ""}, {run.signed_as.company} on{" "}
              {new Date(run.signed_at).toLocaleDateString()}
              {run.approved_at ? " (flagged terms approved)" : ""}.
            </span>
          </div>
        )}

        {run && (run.documents_added > 0 || run.documents_found > 0) && (
          <p className="text-muted-foreground">
            {run.documents_added} document{run.documents_added === 1 ? "" : "s"} added from the deal room
            {run.documents_found > run.documents_added ? ` (${run.documents_found - run.documents_added} already on the deal)` : ""}.
          </p>
        )}

        {run && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {run.ca_url && (
              <a href={run.ca_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                CA page <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {run.ca_text_path && (
              <button type="button" onClick={() => open(run.ca_text_path)} className="text-primary hover:underline">
                Agreement text
              </button>
            )}
            {run.signed_copy_path && (
              <button type="button" onClick={() => open(run.signed_copy_path)} className="text-primary hover:underline">
                Signed copy
              </button>
            )}
            {run.cost_usd != null && <span className="text-muted-foreground">${Number(run.cost_usd).toFixed(2)}</span>}
          </div>
        )}
        {run?.agent_notes && run.status !== "failed" && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Agent notes</summary>
            <p className="mt-1 whitespace-pre-wrap">{run.agent_notes}</p>
          </details>
        )}
      </CardContent>

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign this CA with the flagged terms?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent will sign as the firm's signer, accepting the clauses quoted on the card. This binds Ansonia to
              them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!run) return;
                act.mutate({ action: "approve", runId: run.id }, {
                  onSuccess: () => toast.success("Approved. The agent is signing."),
                  onError: (e) => toast.error(errMsg(e)),
                });
              }}
            >
              Approve and sign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
