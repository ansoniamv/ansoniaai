import { EyeOff, Eye } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type DealStatus = Database["public"]["Enums"]["deal_status"];

/** Statuses treated as past/inactive and hidden by default in every deal view. */
export const INACTIVE_STATUSES: DealStatus[] = ["Under Contract", "Pass"];

export function isInactiveDeal(d: { status: DealStatus | string }) {
  return (INACTIVE_STATUSES as string[]).includes(d.status as string);
}

/** Shared preference key so List View and Dashboard View stay in sync. */
export const SHOW_INACTIVE_PREF_KEY = "pipeline.showInactive";

interface Props {
  hiddenCount: number;
  showInactive: boolean;
  onToggle: (next: boolean) => void;
  className?: string;
}

/**
 * Persistent inline indicator shown whenever a view is suppressing rows,
 * so hiding is never silent.
 */
export function HiddenDealsNotice({ hiddenCount, showInactive, onToggle, className }: Props) {
  if (!showInactive && hiddenCount === 0) return null;

  return (
    <div
      className={
        "flex items-center gap-2 rounded-sm border border-hairline bg-muted/40 px-3 py-2 text-sm text-muted-foreground " +
        (className ?? "")
      }
    >
      {showInactive ? (
        <>
          <Eye className="h-3.5 w-3.5 shrink-0" />
          <span>Showing past/inactive deals (status “Under Contract” or “Pass”).</span>
          <button
            type="button"
            onClick={() => onToggle(false)}
            className="font-semibold text-primary underline underline-offset-2 hover:opacity-80"
          >
            Hide
          </button>
        </>
      ) : (
        <>
          <EyeOff className="h-3.5 w-3.5 shrink-0" />
          <span>
            {hiddenCount} closed/passed deal{hiddenCount === 1 ? "" : "s"} hidden
          </span>
          <button
            type="button"
            onClick={() => onToggle(true)}
            className="font-semibold text-primary underline underline-offset-2 hover:opacity-80"
          >
            Show
          </button>
        </>
      )}
    </div>
  );
}
