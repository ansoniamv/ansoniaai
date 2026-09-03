import { usePartnerWarmthSignals, useComputePartnerWarmth } from "@/hooks/usePartnerSuggestions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Activity } from "lucide-react";
import { toast } from "sonner";

export function WarmthSignalsPanel({ partnerId, currentLevel }: { partnerId: string; currentLevel?: string | null }) {
  const { data: sig, isLoading } = usePartnerWarmthSignals(partnerId);
  const compute = useComputePartnerWarmth();

  const onRefresh = async () => {
    try {
      const r = await compute.mutateAsync({ partner_id: partnerId });
      toast.success(`Warmth recomputed — ${r.suggestions} suggestion(s)`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to recompute");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Warmth Signals
        </CardTitle>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={compute.isPending}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${compute.isPending ? "animate-spin" : ""}`} />
          {compute.isPending ? "Recomputing…" : "Recompute"}
        </Button>
      </CardHeader>
      <CardContent className="text-xs space-y-2">
        {isLoading && <div className="text-muted-foreground">Loading…</div>}
        {!isLoading && !sig && (
          <div className="text-muted-foreground">No signals yet — click Recompute to build.</div>
        )}
        {sig && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">Computed: {sig.computed_level || "—"}</Badge>
              {currentLevel && sig.computed_level && currentLevel !== sig.computed_level && (
                <Badge variant="outline" className="text-amber-700 border-amber-500/60">
                  differs from current ({currentLevel})
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div><span className="text-muted-foreground">Inbound (90d):</span> {sig.inbound_90d}</div>
              <div><span className="text-muted-foreground">Outbound (90d):</span> {sig.outbound_90d}</div>
              <div><span className="text-muted-foreground">Avg response:</span> {sig.avg_response_hours != null ? `${Math.round(sig.avg_response_hours)}h` : "—"}</div>
              <div><span className="text-muted-foreground">Meetings:</span> {sig.meetings_scheduled}</div>
              <div><span className="text-muted-foreground">Deals engaged:</span> {sig.deals_engaged}</div>
              <div><span className="text-muted-foreground">Last inbound:</span> {sig.last_inbound_at ? new Date(sig.last_inbound_at).toLocaleDateString() : "—"}</div>
            </div>
            <div className="text-[10px] text-muted-foreground pt-1">
              Updated {sig.computed_at ? new Date(sig.computed_at).toLocaleString() : "—"}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
