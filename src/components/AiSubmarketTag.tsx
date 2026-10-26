import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Marks a submarket assign-submarket picked and nobody has checked yet. Confirm
 * keeps the pick and makes it a person's decision. Shown while the auto-pick is
 * being tested, so analysts can tell which picks are still a model's guess.
 */
export function AiSubmarketTag({
  note,
  onConfirm,
  disabled,
}: {
  note?: string | null;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <Sparkles className="h-3 w-3" />
              AI estimated
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            Picked automatically from the address{note ? `: ${note}` : "."} Confirm it if it's right, or pick another.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={onConfirm} disabled={disabled}>
        <Check className="h-3 w-3 mr-1" />
        Confirm
      </Button>
    </span>
  );
}
