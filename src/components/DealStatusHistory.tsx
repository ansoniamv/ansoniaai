import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealFieldEvents } from "@/hooks/useDealFieldEvents";
import { useTeamMembers } from "@/hooks/useTeamMembers";

const FIELD_LABEL: Record<string, string> = {
  status: "Status",
  pipeline_stage: "Stage",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  function: "Automated",
  baseline: "Baseline",
};

function fmt(v: string | null) {
  return v == null || v === "" ? "—" : v;
}

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DealStatusHistory({ dealId }: { dealId: string }) {
  const { data: events, isLoading } = useDealFieldEvents(dealId);
  const { data: members } = useTeamMembers();

  const nameFor = (id: string | null) => {
    if (!id) return null;
    const m = (members ?? []).find((x: any) => x.id === id);
    return m?.full_name ?? null;
  };

  return (
    <Card className="surface-card border-hairline">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground font-display flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" />
          Status History
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : !events || events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded changes yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {events.map((e) => {
              const who = nameFor(e.changed_by);
              const isBaseline = e.source === "baseline";
              return (
                <li key={e.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                        {FIELD_LABEL[e.field] ?? e.field}
                      </span>
                      {isBaseline ? (
                        <span className="tabular-nums">Recorded as {fmt(e.to_value)}</span>
                      ) : (
                        <>
                          <span className="text-muted-foreground">{fmt(e.from_value)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium">{fmt(e.to_value)}</span>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtWhen(e.created_at)}
                      {who ? ` · ${who}` : e.changed_by ? " · user" : ""}
                      {e.reason ? ` · ${e.reason}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {SOURCE_LABEL[e.source] ?? e.source}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
