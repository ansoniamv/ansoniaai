import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, ClipboardCopy, Inbox, Link2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useChangeRequests, type ChangeRequest, type ChangeRequestStatus } from "@/hooks/useChangeRequests";
import { buildClaudePrompt } from "@/lib/changeRequestPrompt";
import { ChangeRequestDialog } from "@/components/roadmap/ChangeRequestDialog";

const STATUS_META: Record<ChangeRequestStatus, { label: string; chip: string }> = {
  new: { label: "New", chip: "bg-primary/10 text-primary border-primary/25" },
  queued: { label: "Queued", chip: "bg-tier-medium-bg text-[hsl(28_85%_26%)] border-tier-medium-fg/40" },
  in_progress: { label: "In Progress", chip: "bg-primary/10 text-primary border-primary/25" },
  done: { label: "Done", chip: "bg-tier-strong-bg text-tier-strong-fg border-tier-strong-fg/25" },
  declined: { label: "Declined", chip: "bg-muted text-muted-foreground border-hairline" },
};
const STATUS_ORDER: ChangeRequestStatus[] = ["new", "queued", "in_progress", "done", "declined"];
const OPEN_STATUSES = new Set<ChangeRequestStatus>(["new", "queued", "in_progress"]);

const TYPE_CHIP: Record<ChangeRequest["request_type"], string> = {
  bug: "Bug",
  change: "Change",
  feature: "Feature",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Prompt copied — paste it into Claude Code.");
  } catch {
    toast.error("Couldn't copy. Select the prompt text and copy it by hand.");
  }
}

export function ChangeRequestsPanel({
  phases,
  onAddToRoadmap,
}: {
  phases: string[];
  /** Creates a roadmap item from the request and resolves to its id. */
  onAddToRoadmap: (req: ChangeRequest, phase: string) => Promise<string>;
}) {
  const { isAdmin } = useAuth();
  const { requests, updateRequest, deleteRequest } = useChangeRequests();
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  const visible = useMemo(
    () => (showAll ? requests : requests.filter(r => OPEN_STATUSES.has(r.status))),
    [requests, showAll],
  );
  const newCount = requests.filter(r => r.status === "new").length;

  return (
    <div className="surface-card p-4">
      <div className="flex items-end justify-between mb-3 pb-2 border-b border-hairline gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-semibold text-foreground">Change Requests</h2>
          {newCount > 0 && (
            <span className="chip-tier bg-primary/10 text-primary border-primary/25 tabular-nums">{newCount} new</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded border border-hairline p-0.5 bg-card">
            {([false, true] as const).map(all => (
              <button
                key={String(all)}
                onClick={() => setShowAll(all)}
                className={`px-2.5 py-0.5 text-[10px] uppercase tracking-[0.08em] font-medium rounded ${showAll === all ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {all ? "All" : "Open"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => setSubmitOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Request a change
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">
          {showAll ? "No requests yet." : "No open requests."} Anyone can submit one from the Request change button at the top of any page.
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {visible.map(req => (
            <RequestRow
              key={req.id}
              req={req}
              isAdmin={isAdmin}
              phases={phases}
              expanded={expanded === req.id}
              onToggle={() => setExpanded(expanded === req.id ? null : req.id)}
              onStatus={status => updateRequest.mutate({ id: req.id, patch: { status } }, { onError: (e: Error) => toast.error(e.message) })}
              onNotes={admin_notes => updateRequest.mutate({ id: req.id, patch: { admin_notes } }, { onError: (e: Error) => toast.error(e.message) })}
              onDelete={() => deleteRequest.mutate(req.id, { onError: (e: Error) => toast.error(e.message) })}
              onAddToRoadmap={async phase => {
                try {
                  const itemId = await onAddToRoadmap(req, phase);
                  await updateRequest.mutateAsync({
                    id: req.id,
                    patch: { roadmap_item_id: itemId, status: req.status === "new" ? "queued" : req.status },
                  });
                  toast.success("Added to the roadmap as a planned item.");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            />
          ))}
        </ul>
      )}

      <ChangeRequestDialog open={submitOpen} onOpenChange={setSubmitOpen} pageLabel="" pagePath={null} />
    </div>
  );
}

function RequestRow({
  req, isAdmin, phases, expanded, onToggle, onStatus, onNotes, onDelete, onAddToRoadmap,
}: {
  req: ChangeRequest;
  isAdmin: boolean;
  phases: string[];
  expanded: boolean;
  onToggle: () => void;
  onStatus: (s: ChangeRequestStatus) => void;
  onNotes: (notes: string | null) => void;
  onDelete: () => void;
  onAddToRoadmap: (phase: string) => Promise<void>;
}) {
  const meta = STATUS_META[req.status];
  const prompt = useMemo(() => buildClaudePrompt(req), [req]);
  const [notes, setNotes] = useState(req.admin_notes ?? "");
  const [phase, setPhase] = useState(phases[0]);
  const [adding, setAdding] = useState(false);

  // Pick up notes saved by another admin (arrives via realtime).
  useEffect(() => { setNotes(req.admin_notes ?? ""); }, [req.admin_notes]);

  const saveNotes = () => {
    const next = notes.trim() || null;
    if (next !== (req.admin_notes ?? null)) onNotes(next);
  };

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <li className="py-2">
      <div className="flex items-center gap-2 text-xs">
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left" aria-expanded={expanded}>
          <Chevron className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="chip-tier bg-transparent text-foreground border-hairline shrink-0">{TYPE_CHIP[req.request_type]}</span>
          <span className="font-display font-medium text-foreground truncate">{req.title}</span>
          {req.page_label && <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground truncate hidden md:inline">{req.page_label}</span>}
        </button>
        {req.roadmap_item_id && (
          <span title="On the roadmap" className="text-muted-foreground"><Link2 className="h-3.5 w-3.5" /></span>
        )}
        <span className="text-muted-foreground truncate hidden sm:inline max-w-[160px]">{req.submitter_email}</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(req.created_at)}</span>
        {isAdmin ? (
          <>
            <Select value={req.status} onValueChange={v => onStatus(v as ChangeRequestStatus)}>
              <SelectTrigger className={`h-6 text-[11px] px-2 border w-auto gap-1 uppercase tracking-[0.06em] font-medium ${meta.chip}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => copyText(prompt)} title="Copy the Claude Code prompt">
              <ClipboardCopy className="h-3 w-3 mr-1" /> Copy prompt
            </Button>
          </>
        ) : (
          <span className={`chip-tier ${meta.chip}`}>{meta.label}</span>
        )}
      </div>

      {expanded && (
        <div className="mt-2 ml-5 space-y-3">
          {isAdmin ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Claude Code prompt</span>
                  <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => copyText(prompt)}>
                    <ClipboardCopy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                </div>
                <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words bg-muted/40 border border-hairline rounded p-3 max-h-[360px] overflow-auto font-mono text-foreground">
                  {prompt}
                </pre>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Admin notes — added to the prompt, visible to everyone</span>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  onBlur={saveNotes}
                  placeholder="Context for Claude: files to look at, constraints, decisions already made…"
                  className="min-h-[60px] text-xs"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {req.roadmap_item_id ? (
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Check className="h-3 w-3 text-tier-strong-fg" /> On the roadmap
                  </span>
                ) : (
                  <>
                    <Select value={phase} onValueChange={setPhase}>
                      <SelectTrigger className="h-7 text-xs w-[200px] border-hairline"><SelectValue /></SelectTrigger>
                      <SelectContent>{phases.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs" disabled={adding}
                      onClick={async () => { setAdding(true); await onAddToRoadmap(phase); setAdding(false); }}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add to roadmap
                    </Button>
                  </>
                )}
                <Button
                  size="sm" variant="ghost" className="h-7 text-xs ml-auto text-muted-foreground hover:text-destructive"
                  onClick={() => { if (confirm(`Delete “${req.title}”? This can't be undone.`)) onDelete(); }}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              </div>
            </>
          ) : (
            <dl className="text-xs space-y-2">
              {req.current_behavior && <Detail label="What happens now" text={req.current_behavior} />}
              <Detail label="What they want instead" text={req.desired_behavior} />
              {req.reason && <Detail label="Why it matters" text={req.reason} />}
              {req.admin_notes && <Detail label="Admin notes" text={req.admin_notes} />}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

function Detail({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="text-foreground whitespace-pre-wrap leading-relaxed">{text}</dd>
    </div>
  );
}
