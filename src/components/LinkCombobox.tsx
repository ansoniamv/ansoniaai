/**
 * Searchable partner / deal picker. Moved out of OutlookPage.tsx so the Atlas
 * Inbox's Unattributed reader tags emails with the same control.
 */
import { useState } from "react";
import { ChevronsUpDown, Check, X, Building2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export function LinkCombobox({
  kind,
  items,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  kind: "partner" | "deal";
  items: Array<{ id: string; label: string }>;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value);
  const Icon = kind === "partner" ? Users : Building2;
  const width = kind === "partner" ? "w-[220px]" : "w-[240px]";
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            size="sm"
            disabled={disabled}
            className={cn("h-8 justify-between text-xs font-normal", width)}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{selected ? selected.label : placeholder}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
          <Command>
            <CommandInput placeholder={`Search ${kind}s…`} className="h-9" />
            <CommandList>
              <CommandEmpty>No {kind}s found.</CommandEmpty>
              <CommandGroup>
                {items.map((it) => (
                  <CommandItem
                    key={it.id}
                    value={`${it.label} ${it.id}`}
                    onSelect={() => {
                      onChange(it.id);
                      setOpen(false);
                    }}
                  >
                    <Icon className="mr-2 h-3.5 w-3.5" />
                    <span className="truncate">{it.label}</span>
                    <Check className={cn("ml-auto h-4 w-4", value === it.id ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={disabled}
          onClick={() => onChange(null)}
          aria-label={`Clear ${kind}`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
