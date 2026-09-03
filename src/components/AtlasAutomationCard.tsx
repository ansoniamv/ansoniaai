import { useAtlasAutomation, useUpdateAtlasAutomation } from "@/hooks/usePartnerSuggestions";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const STATUS_STYLES: Record<string, string> = {
  ok: "border-border text-muted-foreground",
  degraded: "border-amber-400 text-amber-700",
  failed: "border-destructive text-destructive",
  disabled: "border-border text-muted-foreground",
};

function fmt(iso?: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function elapsed(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AtlasAutomationCard() {
  const { data } = useAtlasAutomation();
  const update = useUpdateAtlasAutomation();
  if (!data) return null;
  const config = (data.config || {}) as any;
  const lastRun: string | null = config.last_run_at ?? null;
  const lastSuccess: string | null = config.last_success_at ?? null;
  const lastError: string | null = config.last_error ?? null;
  const counts = config.last_counts;

  const status: string = data.enabled ? (config.last_status || "ok") : "disabled";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const successStale =
    !!lastRun &&
    (!lastSuccess || new Date(lastRun).getTime() - new Date(lastSuccess).getTime() > DAY_MS);

  const needsReconnect = !!lastError && /\b(401|403)\b/.test(lastError);

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">Scheduled Atlas Analysis</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                  STATUS_STYLES[status] || STATUS_STYLES.ok
                }`}
              >
                {status}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Runs Atlas sync → analyze → warmth. Files suggestions only.
            </div>
          </div>
          <Switch
            checked={!!data.enabled}
            onCheckedChange={async (v) => {
              await update.mutateAsync({ enabled: v });
              toast.success(v ? "Automation enabled" : "Automation disabled");
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-border pt-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Last run
            </div>
            <div className="text-xs tabular-nums">{fmt(lastRun)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Last success
            </div>
            <div className={`text-xs tabular-nums ${successStale ? "text-amber-700" : ""}`}>
              {fmt(lastSuccess)}
              {successStale && lastSuccess ? ` · ${elapsed(lastSuccess)}` : ""}
            </div>
          </div>
        </div>

        {lastError && (
          <div className="text-xs text-destructive">
            {lastError}
            {needsReconnect && " Reconnect the Atlas mailbox in Lovable → Integrations."}
          </div>
        )}

        {counts && Object.keys(counts).length > 0 && (
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer uppercase tracking-[0.12em]">Run detail</summary>
            <pre className="mt-1 whitespace-pre-wrap font-mono">
              {JSON.stringify(counts, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
