import { Bot } from "lucide-react";
import { ATLAS_SUGGESTIONS, ATLAS_FOLLOW_UPS } from "@/components/atlas/suggestions";

/**
 * Shared so the page and the widget offer the same starting points. Clicking a
 * chip SENDS it — filling the draft and making the user press Enter again was an
 * extra step with no purpose.
 */

export function AtlasEmptyState({
  onSelect,
  columns = 2,
}: {
  onSelect: (prompt: string) => void;
  /** The widget is a narrow rail, so it stacks to one column. */
  columns?: 1 | 2;
}) {
  return (
    <div className="flex flex-col items-center text-center py-12">
      <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
        <Bot className="h-5 w-5" />
      </div>
      <p className="font-display text-base font-semibold tracking-tight">Meet Atlas</p>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm leading-relaxed">
        Your guide to the acquisitions platform. Ask how something works, or ask about your deals,
        partners, and pipeline.
      </p>
      <div
        className={`mt-6 grid gap-2 w-full ${columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}
      >
        {ATLAS_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className="px-4 py-2.5 text-sm text-left rounded-md border border-border/60 hover:border-primary/40 hover:bg-accent/40 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Compact follow-up row shown above the composer once a thread has content. */
export function AtlasFollowUps({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ATLAS_FOLLOW_UPS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          className="px-3 py-1.5 text-xs rounded-md border border-border/60 text-muted-foreground hover:border-primary/40 hover:bg-accent/40 hover:text-foreground transition-colors"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
