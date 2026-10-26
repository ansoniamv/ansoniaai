import { cn } from "@/lib/utils";

// One hue, warmest darkest: the navy the score bars use, so warmth reads as a
// scale rather than five unrelated colours.
const warmthConfig: Record<string, { bg: string; text: string; border: string; rank: number }> = {
  "Existing Partner": { bg: "bg-primary", text: "text-primary-foreground", border: "border-primary", rank: 1 },
  "Very Warm": { bg: "bg-primary/15", text: "text-primary dark:text-foreground", border: "border-primary/30", rank: 2 },
  "Warm": { bg: "bg-primary/5", text: "text-primary dark:text-foreground", border: "border-primary/20", rank: 3 },
  "Tepid": { bg: "bg-muted/60", text: "text-muted-foreground", border: "border-border", rank: 4 },
  "Cold": { bg: "bg-transparent", text: "text-muted-foreground", border: "border-dashed border-border", rank: 5 },
};

export function WarmthBadge({ strength }: { strength: string | null }) {
  if (!strength) return <span className="text-muted-foreground text-xs">—</span>;
  const config = warmthConfig[strength] || warmthConfig["Cold"];
  return (
    <span className={cn("inline-flex items-center text-[10px] font-medium tabular-nums px-2 py-0.5 rounded-full border", config.bg, config.text, config.border)}>
      {config.rank}. {strength}
    </span>
  );
}
