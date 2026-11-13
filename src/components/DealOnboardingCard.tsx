/**
 * What the server pulled for a new deal: one line per source, with what came
 * back. Hidden for deals created before onboarding existed.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, MinusCircle, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  useDealOnboarding,
  useRerunOnboarding,
} from "@/hooks/useDealOnboarding";

function StepIcon({ step, busy }: { step?: OnboardingStep; busy: boolean }) {
  if (!step) {
    return busy
      ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-label="Working" />
      : <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-label="Not run" />;
  }
  if (step.status === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="Done" />;
  if (step.status === "skipped") return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" aria-label="Skipped" />;
  return <XCircle className="h-3.5 w-3.5 text-destructive" aria-label="Failed" />;
}

export function DealOnboardingCard({ dealId }: { dealId: string }) {
  const { data: run } = useDealOnboarding(dealId);
  const rerun = useRerunOnboarding(dealId);
  const qc = useQueryClient();

  // When a run finishes, the deal it filled has changed underneath the page.
  const lastStatus = useRef(run?.status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = run?.status;
    if ((was === "running" || was === "queued") && (run?.status === "done" || run?.status === "failed")) {
      qc.invalidateQueries({ queryKey: ["deals", dealId] });
      qc.invalidateQueries({ queryKey: ["deals"] });
    }
  }, [run?.status, dealId, qc]);

  if (!run) return null;
  const busy = run.status === "queued" || run.status === "running";

  return (
    <Card className="surface-card border-hairline">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold">
          New-deal data
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {busy ? "Pulling…" : run.status === "failed" ? "Finished with failures" : "Finished"}
          </span>
        </CardTitle>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || rerun.isPending}
          onClick={() =>
            rerun.mutate(undefined, {
              onSuccess: () => toast.success("Pulling the deal's data again"),
              onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
            })
          }
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${rerun.isPending ? "animate-spin" : ""}`} />
          Run again
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-1.5">
          {ONBOARDING_STEPS.map(({ key, label }) => {
            const step = run.steps?.[key];
            return (
              <li key={key} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0"><StepIcon step={step} busy={busy} /></span>
                <span className="font-medium shrink-0">{label}</span>
                {step?.detail && <span className="text-muted-foreground break-words min-w-0">— {step.detail}</span>}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
