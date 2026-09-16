/**
 * "Coming In" — recent broker deal flow from the inbox, for the internal desk.
 *
 * Read-only: triage still happens on /pipeline. This is a scannable window onto
 * the last 30 days so the desk shows what has actually been arriving.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Inbox, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { TIER_LABEL, tierChip, tierKey } from "@/lib/tier";

/** Rows older than this are not "coming in" any more. */
const WINDOW_DAYS = 30;
const MAX_ROWS = 25;

type ComingInRow = {
  id: string;
  property_name: string | null;
  address: string | null;
  location_city: string | null;
  location_state: string | null;
  units: number | null;
  year_built: number | null;
  asking_price: string | null;
  fit_score: number | null;
  fit_tier: string | null;
  fit_rationale: string | null;
  email_subject: string | null;
  email_received_at: string | null;
  reviewed: boolean;
  denied: boolean;
  accepted_deal_id: string | null;
};

function useComingIn() {
  // Recomputed per render is fine — the value only changes the query key once a
  // day, and react-query dedupes within a session.
  const since = useMemo(
    () => new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString(),
    [],
  );

  return useQuery({
    queryKey: ["internal_desk_coming_in", WINDOW_DAYS],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_deals")
        .select(
          "id, property_name, address, location_city, location_state, units, year_built, asking_price, fit_score, fit_tier, fit_rationale, email_subject, email_received_at, reviewed, denied, accepted_deal_id",
        )
        // Denied rows are decided — they are not deal flow any more.
        .eq("denied", false)
        .gte("email_received_at", since)
        .order("email_received_at", { ascending: false, nullsFirst: false })
        .limit(MAX_ROWS);
      if (error) throw error;
      return (data ?? []) as ComingInRow[];
    },
  });
}

const locationLine = (r: ComingInRow) => {
  const place = [r.location_city, r.location_state].filter(Boolean).join(", ");
  return place || r.address || null;
};

/** "112 units · built 1998 · $14.5M" — only the parts we actually have. */
const factLine = (r: ComingInRow) =>
  [
    r.units != null ? `${r.units} units` : null,
    r.year_built != null ? `built ${r.year_built}` : null,
    r.asking_price || null,
  ]
    .filter(Boolean)
    .join(" · ");

function ComingInRowItem({ row }: { row: ComingInRow }) {
  // An accepted row has a real deal record; everything else lives on the board.
  const href = row.accepted_deal_id ? `/deals/${row.accepted_deal_id}` : "/pipeline";
  const tier = tierKey(row.fit_tier);
  const place = locationLine(row);
  const facts = factLine(row);

  return (
    <Link
      to={href}
      className="block rounded border bg-card px-3 py-2.5 hover:border-[#6aa3d8] hover:bg-muted/40 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm truncate">
              {row.property_name || row.email_subject || "(untitled)"}
            </span>
            {row.accepted_deal_id && (
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-[#002752]">
                In pipeline
              </span>
            )}
            {!row.reviewed && !row.accepted_deal_id && (
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                Unreviewed
              </span>
            )}
          </div>
          {place && <div className="text-xs text-muted-foreground mt-0.5 truncate">{place}</div>}
          {facts && (
            <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums truncate">{facts}</div>
          )}
          {row.fit_rationale && (
            <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{row.fit_rationale}</div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {row.fit_tier && (
            <span className={tierChip(tier)}>
              {TIER_LABEL[tier]}
              {row.fit_score != null && <span className="ml-1 tabular-nums">{row.fit_score}</span>}
            </span>
          )}
          {row.email_received_at && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatDistanceToNow(new Date(row.email_received_at), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function InternalComingInCard() {
  const { data: rows, isLoading, error } = useComingIn();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Inbox className="h-4 w-4 text-[#002752]" />
          Coming In
          <span className="text-xs font-normal text-muted-foreground">last {WINDOW_DAYS} days</span>
        </CardTitle>
        <Link
          to="/pipeline"
          className="text-xs text-[#002752] hover:underline inline-flex items-center gap-1"
        >
          View all <ArrowUpRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading && (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        )}
        {error && (
          <p className="text-sm text-destructive py-2">
            Could not load deal flow: {(error as Error).message}
          </p>
        )}
        {!isLoading && !error && (rows ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nothing new in the last {WINDOW_DAYS} days.
          </p>
        )}
        {(rows ?? []).map((r) => (
          <ComingInRowItem key={r.id} row={r} />
        ))}
        {(rows ?? []).length === MAX_ROWS && (
          <p className="text-[11px] text-muted-foreground text-center pt-1">
            Showing the {MAX_ROWS} most recent —{" "}
            <Link to="/pipeline" className="text-[#002752] hover:underline">
              view all on the pipeline
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
