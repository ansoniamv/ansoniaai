import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SourceInfo } from "@/lib/dataSources";
import { cn } from "@/lib/utils";

/** A (?) that explains a label on hover. Carries its own provider so it works anywhere. */
export function InfoTip({ children, label, className }: { children: React.ReactNode; label: string; className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`What is ${label}?`}
            onClick={(e) => e.stopPropagation()}
            className={cn("inline-flex text-muted-foreground hover:text-foreground shrink-0 align-middle", className)}
          >
            <HelpCircle className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs font-normal normal-case tracking-normal leading-relaxed">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Small vendor pill: "CoStar", "Esri", ... with the exact geography on hover. */
export function SourceBadge({ source, className }: { source: SourceInfo; className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center rounded border border-hairline bg-muted/40 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap cursor-default",
              className,
            )}
          >
            {source.vendor}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">Source: {source.detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
