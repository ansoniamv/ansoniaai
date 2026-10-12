import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COMBINED, useAllSignals, type SubmarketSignals } from "@/lib/marketData";
import { cn } from "@/lib/utils";

/**
 * Picks a CoStar submarket for a deal. The export carries no boundaries, so
 * this can't be a spatial join. Instead the list opens with the submarkets
 * whose market shares the deal's state and city at the top, and the analyst
 * picks one. Nothing is assigned until they do.
 */
export function SubmarketPicker({
  value,
  onChange,
  city,
  state,
  msa,
  disabled,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  city?: string | null;
  state?: string | null;
  msa?: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: all = [], isLoading } = useAllSignals(COMBINED);

  const { suggested, rest, selected } = useMemo(() => {
    const st = state?.trim().toUpperCase();
    // "Chicago-Naperville-Elgin, IL" → "chicago"; "Austin" → "austin"
    const words = [city, msa?.split(/[-,]/)[0]]
      .filter(Boolean)
      .map((w) => w!.trim().toLowerCase())
      .filter((w) => w.length > 2);
    const score = (s: SubmarketSignals) => {
      if (!st || s.state !== st) return 0;
      const name = (s.geography_name ?? "").toLowerCase();
      return 1 + (words.some((w) => name.includes(w)) ? 2 : 0);
    };
    const sorted = [...all].sort((a, b) => (a.geography_name ?? "").localeCompare(b.geography_name ?? ""));
    const best = Math.max(0, ...sorted.map(score));
    return {
      suggested: best > 0 ? sorted.filter((s) => score(s) === best) : [],
      rest: best > 0 ? sorted.filter((s) => score(s) !== best) : sorted,
      selected: all.find((s) => s.geography_code === value) ?? null,
    };
  }, [all, city, state, msa, value]);

  const item = (s: SubmarketSignals) => (
    <CommandItem
      key={s.geography_code}
      value={`${s.geography_name} ${s.geography_code}`}
      onSelect={() => {
        onChange(s.geography_code);
        setOpen(false);
      }}
    >
      <Check className={cn("mr-2 h-3.5 w-3.5", value === s.geography_code ? "opacity-100" : "opacity-0")} />
      <span className="truncate">{s.geography_name}</span>
      <span className="ml-auto pl-2 text-[10px] text-muted-foreground tabular-nums">
        {s.inventory != null ? `${Math.round(s.inventory).toLocaleString()} u` : ""}
      </span>
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className="justify-between font-normal w-full max-w-md"
        >
          <span className="truncate">
            {selected?.geography_name ?? (value ? value : isLoading ? "Loading submarkets…" : "Pick CoStar submarket…")}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(32rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search market or submarket…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No submarket matches.</CommandEmpty>
            {suggested.length > 0 && <CommandGroup heading="Same state / city">{suggested.map(item)}</CommandGroup>}
            <CommandGroup heading={suggested.length ? "All submarkets" : undefined}>{rest.map(item)}</CommandGroup>
            {value && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  Clear submarket
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
