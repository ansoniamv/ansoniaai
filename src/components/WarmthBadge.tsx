import { cn } from "@/lib/utils";

const warmthConfig: Record<string, { bg: string; text: string; border: string; rank: number }> = {
  "Existing Partner": { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/25", rank: 1 },
  "Very Warm": { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/25", rank: 2 },
  "Warm": { bg: "bg-blue-400/10", text: "text-blue-400", border: "border-blue-400/25", rank: 3 },
  "Tepid": { bg: "bg-slate-400/10", text: "text-slate-400", border: "border-slate-400/25", rank: 4 },
  "Cold": { bg: "bg-slate-600/20", text: "text-slate-500", border: "border-slate-600/40", rank: 5 },
};

export function WarmthBadge({ strength }: { strength: string | null }) {
  if (!strength) return <span className="text-muted-foreground text-xs">—</span>;
  const config = warmthConfig[strength] || warmthConfig["Cold"];
  return (
    <span className={cn("inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded-full border", config.bg, config.text, config.border)}>
      {config.rank}. {strength}
    </span>
  );
}
