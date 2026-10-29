import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Partner } from "@/hooks/usePartners";
import { cn } from "@/lib/utils";

export const CAPITAL_STATUS_OPTIONS = [
  "Actively Deploying",
  "Selective",
  "Constrained",
  "Out of Capital",
] as const;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function longDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Display only; capital status is edited in the partner form. */
export function CapitalStatusCard({ partner }: { partner: Partner }) {
  const asOf = partner.capital_status_as_of;
  const stale = !!asOf && daysSince(asOf) > 90;
  const windowPassed =
    !!partner.capital_available_from &&
    new Date(`${partner.capital_available_from}T00:00:00`).getTime() < Date.now();
  const constrained =
    partner.capital_status === "Out of Capital" || partner.capital_status === "Constrained";
  const highlight = constrained && !windowPassed;

  return (
    <Card className={cn("border-hairline shadow-none", highlight && "border-l-2 border-l-amber-500")}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Capital status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!partner.capital_status ? (
          <>
            <div className="font-serif-display text-2xl leading-tight text-muted-foreground">Not established</div>
            <div className="text-xs text-muted-foreground">
              No capital availability on file — Atlas will propose one when a partner mentions it.
            </div>
          </>
        ) : (
          <>
            <div
              className={`font-serif-display text-2xl leading-tight ${
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
