import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSetPartnerBlacklist, type Partner } from "@/hooks/usePartners";

type BlacklistFields = Pick<Partner, "blacklisted_at" | "blacklist_reason" | "blacklisted_by_label">;

/** Lowercased firm name without punctuation or a trailing LLC/Inc/LP, for loose matching. */
export function normalizeFirmName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(llc|inc|lp|llp|ltd|co|corp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Small red tag shown next to a blacklisted firm's name wherever it is listed. */
export function BlacklistBadge({ partner, className }: { partner: BlacklistFields; className?: string }) {
  if (!partner.blacklisted_at) return null;
  return (
    <span
      title={partner.blacklist_reason ? `Blacklisted: ${partner.blacklist_reason}` : "Blacklisted"}
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive",
        className,
      )}
    >
      <Ban className="h-3 w-3" /> Blacklisted
    </span>
  );
}

/** The do-not-engage notice at the top of a partner's record. */
export function BlacklistBanner({ partner, className }: { partner: BlacklistFields; className?: string }) {
  if (!partner.blacklisted_at) return null;
  const when = new Date(partner.blacklisted_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <div role="alert" className={cn("rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm", className)}>
      <div className="flex items-center gap-1.5 font-semibold text-destructive">
        <Ban className="h-4 w-4 shrink-0" /> Blacklisted: do not engage
      </div>
      {partner.blacklist_reason && <p className="mt-1 whitespace-pre-wrap text-foreground">{partner.blacklist_reason}</p>}
      <p className="mt-1 text-xs text-muted-foreground">
        {partner.blacklisted_by_label ? `${partner.blacklisted_by_label}, ` : ""}{when}
      </p>
    </div>
  );
}

/** Blacklist a firm with a required reason, or lift an existing blacklist. */
export function BlacklistPartnerDialog({
  partner,
  open,
  onOpenChange,
}: {
  partner: Pick<Partner, "id" | "name"> & BlacklistFields;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setBlacklist = useSetPartnerBlacklist();
  const [reason, setReason] = useState("");
  const lifting = !!partner.blacklisted_at;

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const submit = () => {
    const trimmed = reason.trim();
    if (!lifting && !trimmed) return;
    setBlacklist.mutate(
      { id: partner.id, reason: lifting ? null : trimmed },
      {
        onSuccess: () => {
          toast.success(lifting ? `${partner.name} removed from the blacklist` : `${partner.name} blacklisted`);
          onOpenChange(false);
        },
        onError: (err: any) => toast.error("Update failed: " + (err?.message ?? err)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lifting ? `Remove ${partner.name} from the blacklist?` : `Blacklist ${partner.name}?`}</DialogTitle>
          <DialogDescription>
            {lifting
              ? "The team will no longer be warned off this firm, and it will show up in deal matching again."
              : "The firm stays in the CRM with a red Blacklisted tag and your reason, so anyone who comes across it knows not to engage. It is left out of deal matching."}
          </DialogDescription>
        </DialogHeader>
        {lifting ? (
          partner.blacklist_reason && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap">{partner.blacklist_reason}</p>
          )
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="blacklist-reason">Why (required)</Label>
            <Textarea
              id="blacklist-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Retraded us at the last minute on a prior deal; not worth the time."
              rows={4}
              autoFocus
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={lifting ? "default" : "destructive"}
            onClick={submit}
            disabled={setBlacklist.isPending || (!lifting && !reason.trim())}
          >
            {lifting ? "Remove from blacklist" : "Blacklist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
