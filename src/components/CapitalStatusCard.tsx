import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdatePartner, type Partner } from "@/hooks/usePartners";
import { useAuth } from "@/hooks/useAuth";

export const CAPITAL_STATUS_OPTIONS = [
  "Actively Deploying",
  "Selective",
  "Constrained",
  "Out of Capital",
] as const;

const NONE = "__none__";

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function longDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function CapitalStatusCard({ partner }: { partner: Partner }) {
  const update = useUpdatePartner();
  const { profile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<string>(partner.capital_status || NONE);
  const [from, setFrom] = useState<string>(partner.capital_available_from || "");
  const [detail, setDetail] = useState<string>(partner.capital_status_detail || "");

  const asOf = partner.capital_status_as_of;
  const stale = !!asOf && daysSince(asOf) > 90;
  const windowPassed =
    !!partner.capital_available_from &&
    new Date(`${partner.capital_available_from}T00:00:00`).getTime() < Date.now();
  const constrained =
    partner.capital_status === "Out of Capital" || partner.capital_status === "Constrained";
  const highlight = constrained && !windowPassed;

  const save = async () => {
    const nextStatus = status === NONE ? null : status;
    try {
      const manual = partner.manual_fields || [];
      const now = new Date().toISOString();
      const enriched: Record<string, any> = { ...(partner.enriched_fields || {}) };
      enriched.capital_status = { source: "manual", as_of: now, written_at: now, set_by: profile?.email ?? null };
      await update.mutateAsync({
        id: partner.id,
        capital_status: nextStatus,
        capital_available_from: from || null,
        capital_status_detail: detail.trim() || null,
        capital_status_as_of: now,
        manual_fields: manual.includes("capital_status") ? manual : [...manual, "capital_status"],
        enriched_fields: enriched,
      } as any);
      toast.success("Capital status updated");
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    }
  };

  return (
    <Card className={highlight ? "border-l-2 border-l-amber-500" : undefined}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
          Capital status
        </CardTitle>
        {!editing && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {editing ? (
          <div className="space-y-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not established</SelectItem>
                {CAPITAL_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 text-sm" />
            <Input
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Detail — their own words"
              className="h-9 text-sm"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={update.isPending}>
                <Check className="mr-1 h-3.5 w-3.5" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="mr-1 h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          </div>
        ) : !partner.capital_status ? (
          <>
            <div className="font-display text-xl font-semibold text-muted-foreground">Not established</div>
            <div className="text-xs text-muted-foreground">
              No capital availability on file — Atlas will propose one when a partner mentions it.
            </div>
          </>
        ) : (
          <>
            <div
              className={`font-display text-xl font-semibold ${
                highlight ? (partner.capital_status === "Out of Capital" ? "text-destructive" : "text-amber-700") : ""
              }`}
            >
              {partner.capital_status}
            </div>
            {partner.capital_available_from && (
              <div className="tabular-nums text-sm">
                Available from {longDate(partner.capital_available_from)}
              </div>
            )}
            {partner.capital_status_detail && (
              <div className="text-xs italic text-muted-foreground">{partner.capital_status_detail}</div>
            )}
            <div
              className={`text-[11px] uppercase tracking-[0.12em] tabular-nums ${
                stale || windowPassed ? "text-amber-700" : "text-muted-foreground"
              }`}
            >
              {asOf ? `Confirmed ${longDate(asOf)} · ${daysSince(asOf)}d ago` : "Confirmation date unknown"}
              {stale && " · stale"}
              {windowPassed && " · window passed, needs re-confirmation"}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
