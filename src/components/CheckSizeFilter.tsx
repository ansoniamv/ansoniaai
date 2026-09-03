import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type CheckSizeFilterState = {
  target: string;
  includeUnknown: boolean;
};

export const DEFAULT_CHECK_SIZE_FILTER: CheckSizeFilterState = {
  target: "",
  includeUnknown: true,
};

export function isCheckSizeActive(state: CheckSizeFilterState) {
  const n = Number(state.target);
  return state.target.trim() !== "" && Number.isFinite(n);
}

export function matchesCheckSize(
  partner: { min_equity_m: number | null; max_equity_m: number | null },
  state: CheckSizeFilterState,
) {
  if (!isCheckSizeActive(state)) return true;
  const target = Number(state.target);
  const { min_equity_m: min, max_equity_m: max } = partner;
  if (min == null && max == null) return state.includeUnknown;
  return (min == null || target >= min) && (max == null || target <= max);
}

export function CheckSizeFilter({
  value,
  onChange,
}: {
  value: CheckSizeFilterState;
  onChange: (next: CheckSizeFilterState) => void;
}) {
  const active = isCheckSizeActive(value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={active ? "border-primary/50 text-primary" : ""}
        >
          <Filter className="h-3.5 w-3.5 mr-1.5" />
          Check size
          {active && (
            <span className="ml-1.5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-1.5">
              ${Number(value.target)}M
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Check size ($M)
          </span>
          {active && (
            <button
              className="text-[10px] text-primary hover:underline"
              onClick={() => onChange({ ...value, target: "" })}
            >
              Clear
            </button>
          )}
        </div>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="e.g. 25"
          value={value.target}
          onChange={(e) => onChange({ ...value, target: e.target.value })}
          className="h-8 text-sm"
        />
        <label className="flex items-start gap-2 text-xs mt-2.5 cursor-pointer">
          <Checkbox
            checked={value.includeUnknown}
            onCheckedChange={(c) => onChange({ ...value, includeUnknown: c === true })}
            className="h-3.5 w-3.5 mt-[1px]"
          />
          <span className="text-muted-foreground leading-snug">
            Include partners with no check size on file
          </span>
        </label>
      </PopoverContent>
    </Popover>
  );
}
