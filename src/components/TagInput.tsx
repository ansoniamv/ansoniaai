import { useState, KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Lightweight chip input for `text[]` fields. Add on Enter or comma; remove
 * with the X or Backspace when the input is empty.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  chipVariant = "default",
  className,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** "destructive" for Avoided Markets, "default" for everything else. */
  chipVariant?: "default" | "destructive";
  className?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const t = draft.trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const chipClass =
    chipVariant === "destructive"
      ? "border-destructive/60 text-destructive bg-destructive/10 hover:bg-destructive/15"
      : "border-hairline bg-muted";

  return (
    <div className={cn("flex flex-wrap gap-1 items-center", className)}>
      {value.map((v) => (
        <Badge
          key={v}
          variant="outline"
          className={cn("text-[10px] gap-1 pr-1", chipClass)}
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== v))}
            className="rounded hover:bg-background/40 p-[1px]"
            aria-label={`Remove ${v}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        placeholder={placeholder ?? "Add…"}
        className="h-6 text-xs px-1.5 flex-1 min-w-[80px] border-0 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
