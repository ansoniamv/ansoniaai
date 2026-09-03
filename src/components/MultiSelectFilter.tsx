import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Shared outline-button + popover multiselect used by the partner filter bars.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const count = selected.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={count > 0 ? "border-primary/50 text-primary" : ""}
        >
          <Filter className="h-3.5 w-3.5 mr-1.5" />
          {label}
          {count > 0 && (
            <span className="ml-1.5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-1.5">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2 max-h-72 overflow-y-auto">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Filter {label}
          </span>
          {count > 0 && (
            <button
              className="text-[10px] text-primary hover:underline"
              onClick={onClear}
            >
              Clear
            </button>
          )}
        </div>
        <div className="space-y-0.5">
          {options.length === 0 && (
            <p className="text-[11px] text-muted-foreground px-1.5 py-1">No options</p>
          )}
          {options.map((val) => (
            <label
              key={val}
              className="flex items-center gap-2 text-xs py-1 px-1.5 rounded hover:bg-muted/50 cursor-pointer"
            >
              <Checkbox
                checked={selected.includes(val)}
                onCheckedChange={() => onToggle(val)}
                className="h-3.5 w-3.5"
              />
              <span className="truncate">{val}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
