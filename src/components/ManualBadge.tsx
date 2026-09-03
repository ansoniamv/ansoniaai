import { Lock } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/**
 * Shown next to a summary field whose value was entered by a human via the
 * pencil-edit UI on the partner profile. Manual values are locked from the
 * AI enricher — see `enrich-partner-from-notes` (skips any key present in
 * `partners.manual_fields`).
 *
 * This badge takes visual precedence over the "from notes" EnrichedBadge:
 * if a key is in both `manual_fields` and `enriched_fields`, render only
 * this one.
 */
export function ManualBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-0.5 text-[9px] font-medium uppercase tracking-wide px-1 py-[1px] rounded border border-primary/60 bg-primary/10 text-primary cursor-help ml-1 align-middle"
          onClick={(e) => e.stopPropagation()}
        >
          <Lock className="h-2.5 w-2.5" />
          manual
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        Set manually. Locked from AI enrichment — the enricher will never overwrite this value.
      </TooltipContent>
    </Tooltip>
  );
}
