import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useChangeRequests, type ChangeRequestType } from "@/hooks/useChangeRequests";

const TYPES: { value: ChangeRequestType; label: string }[] = [
  { value: "bug", label: "Something's broken" },
  { value: "change", label: "Change how it works" },
  { value: "feature", label: "New feature" },
];

type Draft = {
  request_type: ChangeRequestType;
  title: string;
  page_label: string;
  current_behavior: string;
  desired_behavior: string;
  reason: string;
};

function emptyDraft(pageLabel: string): Draft {
  return { request_type: "change", title: "", page_label: pageLabel, current_behavior: "", desired_behavior: "", reason: "" };
}

/** pageLabel/pagePath describe where the user opened the dialog from, so they don't have to. */
export function ChangeRequestDialog({
  open,
  onOpenChange,
  pageLabel,
  pagePath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageLabel: string;
  pagePath: string | null;
}) {
  const { submitRequest } = useChangeRequests();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(pageLabel));

  // Re-point the page each time the dialog opens; keep whatever else was typed.
  useEffect(() => {
    if (open) setDraft(d => ({ ...d, page_label: pageLabel }));
  }, [open, pageLabel]);

  const canSubmit = draft.title.trim() && draft.desired_behavior.trim() && !submitRequest.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const trimmedOrNull = (s: string) => s.trim() || null;
    submitRequest.mutate(
      {
        request_type: draft.request_type,
        title: draft.title.trim(),
        page_label: trimmedOrNull(draft.page_label),
        page_path: pagePath,
        current_behavior: trimmedOrNull(draft.current_behavior),
        desired_behavior: draft.desired_behavior.trim(),
        reason: trimmedOrNull(draft.reason),
      },
      {
        onSuccess: () => {
          toast.success("Request sent — an admin will review it.");
          setDraft(emptyDraft(pageLabel));
          onOpenChange(false);
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  const isBug = draft.request_type === "bug";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a change</DialogTitle>
          <DialogDescription>Tell us what you'd like changed. The admins review every request.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="inline-flex rounded border border-hairline p-0.5 bg-card w-full">
            {TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setDraft({ ...draft, request_type: t.value })}
                className={`flex-1 px-2 py-1 text-[11px] uppercase tracking-[0.08em] font-medium rounded ${draft.request_type === t.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Input
            placeholder="Short title, e.g. “Sort the inbox by date received”"
            value={draft.title}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
          />
          <div>
            <label className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Which page</label>
            <Input
              placeholder="e.g. Capital Partners"
              value={draft.page_label}
              onChange={e => setDraft({ ...draft, page_label: e.target.value })}
            />
          </div>
          <Textarea
            placeholder={isBug ? "What happened? Steps to reproduce help a lot." : "How does it work today? (optional)"}
            value={draft.current_behavior}
            onChange={e => setDraft({ ...draft, current_behavior: e.target.value })}
          />
          <Textarea
            placeholder={isBug ? "What should have happened?" : "What do you want it to do instead?"}
            value={draft.desired_behavior}
            onChange={e => setDraft({ ...draft, desired_behavior: e.target.value })}
          />
          <Textarea
            placeholder="Why does it matter? (optional)"
            value={draft.reason}
            onChange={e => setDraft({ ...draft, reason: e.target.value })}
            className="min-h-[60px]"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitRequest.isPending ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
