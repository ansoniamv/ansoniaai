import { Check, X, MinusCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SCORE_HELP } from "@/lib/dealStages";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const FACTOR_LABELS: Record<string, string> = {
  rent_lag: "Rent Lag (vs market)",
  value_add_opportunity: "Value-Add Opportunity",
  occupancy_concessions: "Occupancy & Concessions",
  property_fundamentals: "Property Fundamentals",
  opex_benchmark: "Opex Benchmark",
  submarket_quality: "Submarket Quality",
  regulatory_tax: "Regulatory / Tax",
  capital_markets_exit: "Capital Markets / Exit",
};

const HARD_FILTER_LABELS: Record<string, string> = {
  new_supply: "New supply < 8% (target ≤ 5%)",
  growth: "Not in population & job decline",
  income_floor: "1-mi AMI ≥ $40K (target $55K+)",
  unit_count: "≥ 100 units (target 150+)",
  vintage: "Vintage 1980–2023 (sweet spot 1995–2012)",
};

const ALL_RULES = Object.keys(HARD_FILTER_LABELS);

export interface BuyboxFitCardProps {
  factorScores?: Record<string, number | null> | null;
  totalScore?: number | null;
  dealTier?: string | null;
  passesHardFilters?: boolean | null;
  hardFilterFailures?: Array<{ rule: string; detail: string }> | null;
  scoredAt?: string | null;
}

export function BuyboxFitCard({
  factorScores,
  totalScore,
  dealTier,
  passesHardFilters,
  hardFilterFailures,
  scoredAt,
}: BuyboxFitCardProps) {
  const failures = hardFilterFailures ?? [];
  const failedRules = new Set(failures.map((f) => f.rule));

  return (
    <Card className="md:col-span-2 surface-card border-hairline">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg font-display">Buybox Fit</CardTitle>
        <div className="flex items-center gap-2">
          {dealTier && (
            <Badge variant="outline" className="font-display" title={SCORE_HELP.deal_tier}>
              Buy Box Tier: {dealTier}
            </Badge>
          )}
          {totalScore != null && (
            <Badge variant="outline" className="font-serif-display tabular-nums" title={SCORE_HELP.total_score}>
              Buy Box Score {Math.round(totalScore)} / 100
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Hard filter checklist */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Hard Filters {passesHardFilters === false && <span className="text-destructive normal-case font-normal">— Disqualified</span>}
          </h4>
          <ul className="space-y-1.5">
            {ALL_RULES.map((rule) => {
              const failed = failedRules.has(rule);
              const failure = failures.find((f) => f.rule === rule);
              return (
                <li key={rule} className="flex items-start gap-2 text-sm">
                  {failed ? (
                    <X className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  ) : (
                    <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  <span className={failed ? "text-destructive" : "text-foreground"}>
                    {HARD_FILTER_LABELS[rule]}
                    {failed && failure?.detail && (
                      <span className="text-muted-foreground"> — {failure.detail}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Factor bars */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Factor Scores
          </h4>
          {!factorScores || Object.keys(factorScores).length === 0 ? (
            <p className="text-sm text-muted-foreground">Not yet scored.</p>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(FACTOR_LABELS).map(([key, label]) => {
                const v = factorScores[key];
                const missing = v == null || !Number.isFinite(v);
                return (
                  <div key={key} className="grid grid-cols-[1fr_auto] gap-x-3 items-center">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-foreground">{label}</span>
                        <span className="tabular-nums text-muted-foreground flex items-center gap-1">
                          {missing ? <MinusCircle className="h-3 w-3" /> : `${Math.round(v as number)}`}
                        </span>
                      </div>
                      <Progress value={missing ? 0 : (v as number)} className="h-1.5" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {scoredAt && (
          <p className="text-[11px] text-muted-foreground tabular-nums">
            Scored {new Date(scoredAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
