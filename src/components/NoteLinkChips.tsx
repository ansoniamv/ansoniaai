import { Link } from "react-router-dom";
import { Building2, Users, X, Plus, Check } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { useAddNoteLink, useRemoveNoteLink } from "@/hooks/useNoteLinks";
import type { NoteLinkLite } from "@/hooks/useNotes";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface NoteLinkChipsProps {
  noteId: string;
  ownerType: "deal" | "partner" | string;
  ownerId: string;
  links: NoteLinkLite[];
  /** entity to hide from the chip list (usually the record the note lives on) */
  hideEntity?: { entity_type: string; entity_id: string };
}

export function NoteLinkChips({ noteId, ownerType, ownerId, links, hideEntity }: NoteLinkChipsProps) {
  const { data: deals } = useDeals();
  const { data: partners } = usePartners();
  const addLink = useAddNoteLink();
  const removeLink = useRemoveNoteLink();
  const [open, setOpen] = useState(false);

  const dealMap = new Map((deals ?? []).map((d) => [d.id, d.property_name ?? "Untitled deal"]));
  const partnerMap = new Map((partners ?? []).map((p) => [p.id, p.name ?? "Unnamed partner"]));

  // Build display list: owner + secondary links, deduped, minus hideEntity
  type Chip = {
    key: string;
    entity_type: "deal" | "partner";
    entity_id: string;
    label: string;
    linkId?: string; // present if removable (secondary link)
    isOwner: boolean;
  };

  const chips: Chip[] = [];
  const seen = new Set<string>();
  const push = (c: Chip) => {
    const k = `${c.entity_type}:${c.entity_id}`;
    if (seen.has(k)) return;
    if (hideEntity && hideEntity.entity_type === c.entity_type && hideEntity.entity_id === c.entity_id) return;
    seen.add(k);
    chips.push(c);
  };

  if (ownerType === "deal" || ownerType === "partner") {
    const label =
      ownerType === "deal"
        ? dealMap.get(ownerId) ?? "Deal"
        : partnerMap.get(ownerId) ?? "Partner";
    push({
      key: `owner`,
      entity_type: ownerType,
      entity_id: ownerId,
      label,
      isOwner: true,
    });
  }
  for (const l of links) {
    const label =
      l.linked_type === "deal"
        ? dealMap.get(l.linked_id) ?? "Deleted deal"
        : partnerMap.get(l.linked_id) ?? "Deleted partner";
    push({
      key: l.id,
      entity_type: l.linked_type,
      entity_id: l.linked_id,
      label,
      linkId: l.id,
      isOwner: false,
    });
  }

  const isSelected = (t: "deal" | "partner", id: string) =>
    (ownerType === t && ownerId === id) || links.some((l) => l.linked_type === t && l.linked_id === id);

  const handleToggle = async (t: "deal" | "partner", id: string) => {
    if (ownerType === t && ownerId === id) return; // cannot remove owner via picker
    const existing = links.find((l) => l.linked_type === t && l.linked_id === id);
    try {
      if (existing) {
        await removeLink.mutateAsync(existing.id);
      } else {
        await addLink.mutateAsync({ note_id: noteId, linked_type: t, linked_id: id });
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((c) => {
        const href = c.entity_type === "deal" ? `/deals/${c.entity_id}` : `/partners/${c.entity_id}`;
        return (
          <Badge
            key={c.key}
            variant="secondary"
            className={cn("pl-1.5 pr-1 py-0.5 gap-1 text-[11px] font-normal")}
          >
            {c.entity_type === "deal" ? (
              <Building2 className="h-3 w-3" />
            ) : (
              <Users className="h-3 w-3" />
            )}
            <Link to={href} className="hover:underline truncate max-w-[160px]">
              {c.label}
            </Link>
            {!c.isOwner && c.linkId && (
              <button
                type="button"
                onClick={() => removeLink.mutate(c.linkId!)}
                className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${c.label}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </Badge>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground gap-0.5"
          >
            <Plus className="h-3 w-3" />
            Tag
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-72" align="start">
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
                        onSelect={() => handleToggle("deal", d.id)}
                      >
                        <Building2 className="mr-2 h-4 w-4" />
                        <span className="truncate">{label}</span>
                        <Check className={cn("ml-auto h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
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
                        onSelect={() => handleToggle("partner", p.id)}
                      >
                        <Users className="mr-2 h-4 w-4" />
                        <span className="truncate">{label}</span>
                        <Check className={cn("ml-auto h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
