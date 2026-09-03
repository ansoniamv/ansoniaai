import { useState } from "react";
import { Building2, Check, ChevronsUpDown, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useDeals } from "@/hooks/useDeals";
import { usePartners } from "@/hooks/usePartners";
import { cn } from "@/lib/utils";

export type EntityRef = {
  entity_type: "deal" | "partner";
  entity_id: string;
  label: string;
};

export interface EntityPickerProps {
  value: EntityRef[];
  onChange: (refs: EntityRef[]) => void;
  disabled?: boolean;
}

export function EntityPicker({ value, onChange, disabled }: EntityPickerProps) {
  const [open, setOpen] = useState(false);
  const { data: deals } = useDeals();
  const { data: partners } = usePartners();

  const isSelected = (type: EntityRef["entity_type"], id: string) =>
    value.some((v) => v.entity_type === type && v.entity_id === id);

  const toggle = (ref: EntityRef) => {
    if (isSelected(ref.entity_type, ref.entity_id)) {
      onChange(
        value.filter(
          (v) => !(v.entity_type === ref.entity_type && v.entity_id === ref.entity_id)
        )
      );
    } else {
      onChange([...value, ref]);
    }
  };

  const remove = (ref: EntityRef) => {
    onChange(
      value.filter(
        (v) => !(v.entity_type === ref.entity_type && v.entity_id === ref.entity_id)
      )
    );
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate text-muted-foreground">
              {value.length === 0
                ? "Select deals and/or partners…"
                : `${value.length} selected — click to add more`}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[var(--radix-popover-trigger-width)]"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search deals and partners…" />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              {deals && deals.length > 0 && (
                <CommandGroup heading="Deals">
                  {deals.map((d) => {
                    const label = d.property_name ?? "Untitled deal";
                    const selected = isSelected("deal", d.id);
                    return (
                      <CommandItem
                        key={`deal-${d.id}`}
                        value={`deal ${label}`}
                        onSelect={() =>
                          toggle({ entity_type: "deal", entity_id: d.id, label })
                        }
                      >
                        <Building2 className="mr-2 h-4 w-4" />
                        <span className="truncate">{label}</span>
                        <Check
                          className={cn(
                            "ml-auto h-4 w-4",
                            selected ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              {partners && partners.length > 0 && (
                <CommandGroup heading="Partners">
                  {partners.map((p) => {
                    const label = p.name ?? "Unnamed partner";
                    const selected = isSelected("partner", p.id);
                    return (
                      <CommandItem
                        key={`partner-${p.id}`}
                        value={`partner ${label}`}
                        onSelect={() =>
                          toggle({ entity_type: "partner", entity_id: p.id, label })
                        }
                      >
                        <Users className="mr-2 h-4 w-4" />
                        <span className="truncate">{label}</span>
                        <Check
                          className={cn(
                            "ml-auto h-4 w-4",
                            selected ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <Badge
              key={`${v.entity_type}-${v.entity_id}`}
              variant="secondary"
              className="pl-2 pr-1 py-1 gap-1"
            >
              {v.entity_type === "deal" ? (
                <Building2 className="h-3 w-3" />
              ) : (
                <Users className="h-3 w-3" />
              )}
              <span className="truncate max-w-[180px]">{v.label}</span>
              <button
                type="button"
                onClick={() => remove(v)}
                disabled={disabled}
                className="ml-1 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${v.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
