import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Award } from "lucide-react";
import { useUpdateDeal } from "@/hooks/useDeals";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const GRADES = ["A", "B", "C", "Pass"] as const;
type Grade = (typeof GRADES)[number];

const styles: Record<Grade, string> = {
  A: "bg-tier-strong-fg/15 border-tier-strong-fg/40 text-tier-strong-fg",
  B: "bg-tier-medium-fg/15 border-tier-medium-fg/40 text-tier-medium-fg",
  C: "bg-muted text-muted-foreground border-border",
  Pass: "bg-destructive/10 border-destructive/40 text-destructive",
};

export function AnalystGradeCard({ dealId, value }: { dealId: string; value: Grade | null }) {
  const updateDeal = useUpdateDeal();

  const setGrade = (g: Grade | null) => {
    updateDeal.mutate(
      { id: dealId, analyst_grade: g as any },
      {
        onSuccess: () => toast.success(g ? `Graded ${g}` : "Grade cleared"),
        onError: (err) => toast.error("Failed to save grade: " + err.message),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Award className="h-4 w-4 text-primary" />
          Analyst Grade
          <span className="text-xs font-normal text-muted-foreground">— ground truth for score calibration</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-2 flex-wrap">
        {GRADES.map((g) => {
          const active = value === g;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(g)}
              className={cn(
                "h-9 min-w-[56px] px-3 rounded border text-sm font-semibold transition-colors",
                active ? styles[g] : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              {g}
            </button>
          );
        })}
        {value ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 text-xs text-muted-foreground"
            onClick={() => setGrade(null)}
          >
            Clear
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
