import { useSearchParams } from "react-router-dom";
import { usePartnerCurrency, PROFILE_COMPLETENESS_FIELDS } from "@/hooks/usePartners";
import { countStale, readProvenance, isStale } from "@/lib/fieldProvenance";

/** Which `?highlight=` token owns a given profile field (see PartnerSummaryCards). */
const FIELD_TO_HIGHLIGHT: Record<string, string> = {
  min_equity_m: "equity",
  max_equity_m: "equity",
  geography: "geography",
  product_types: "product_types",
  strategy_value_add: "strategy",
  strategy_core_plus: "strategy",
  strategy_workforce: "strategy",
  strategy_affordable: "strategy",
};

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function relAge(iso: string): string {
  const d = daysSince(iso);
  if (d <= 0) return "today";
  if (d < 45) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 24) return `${m}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function PartnerCurrencyStrip({
  partnerId,
  enrichedFields,
}: {
  partnerId: string;
  enrichedFields?: any;
}) {
  const { data } = usePartnerCurrency(partnerId);
  const [, setSearchParams] = useSearchParams();
  if (!data) return null;

  const staleCount = enrichedFields ? countStale(enrichedFields, PROFILE_COMPLETENESS_FIELDS) : 0;
  const firstStaleField = enrichedFields
    ? PROFILE_COMPLETENESS_FIELDS.find((f) => isStale(readProvenance(enrichedFields, f), f))
    : undefined;

  const contactDays = data.lastContactAt ? daysSince(data.lastContactAt) : null;
  const contactTone =
    contactDays == null ? "" : contactDays > 120 ? "text-destructive" : contactDays > 60 ? "text-amber-700" : "";

  const Sep = () => <span className="text-border">·</span>;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.12em] tabular-nums text-muted-foreground">
      <span className={contactTone}>
        Last contact {data.lastContactAt ? relAge(data.lastContactAt) : "—"}
      </span>
      <Sep />
      <span>Last updated {data.lastUpdatedAt ? shortDate(data.lastUpdatedAt) : "—"}</span>
      {data.pendingSuggestions > 0 && (
        <>
          <Sep />
          <button
            type="button"
            onClick={() =>
              document.getElementById("partner-suggestions")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="uppercase tracking-[0.12em] text-primary hover:underline"
          >
            {data.pendingSuggestions} pending suggestion{data.pendingSuggestions > 1 ? "s" : ""}
          </button>
        </>
      )}
      <Sep />
      <span>
        Profile {data.fieldsFilled}/{data.fieldsTotal} fields
      </span>
      {staleCount > 0 && (
        <>
          <Sep />
          <button
            type="button"
            onClick={() => {
              const token = firstStaleField ? FIELD_TO_HIGHLIGHT[firstStaleField] : undefined;
              if (token) setSearchParams((prev) => { prev.set("highlight", token); return prev; }, { replace: true });
            }}
            className="uppercase tracking-[0.12em] text-amber-700 hover:underline"
          >
            {staleCount} field{staleCount > 1 ? "s" : ""} stale
          </button>
        </>
      )}
    </div>
  );
}
