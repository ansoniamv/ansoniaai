/**
 * The deal-linking control for an Outlook message.
 *
 * Extracted verbatim from OutlookPage.tsx so the Atlas feed on the internal
 * desk links deals through the same mechanism (useMessageDeals /
 * useSetMessageDeals) rather than a second one. The only addition is the
 * optional `chipTo` prop.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronsUpDown, Check, X, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useMessageDeals, useSetMessageDeals } from "@/hooks/useOutlook";

export function DealMultiLink({
  messageId,
  fallbackDealId,
  deals,
  chipTo,
}: {
  messageId: string;
  fallbackDealId: string | null | undefined;
  deals: Array<{ id: string; property_name: string }>;
  /**
   * When given, each linked-deal chip becomes a link to this route. Omitted on
   * the Outlook page, where the chip is a label next to the message body rather
   * than a way out of the page.
   */
  chipTo?: (dealId: string) => string;
}) {
  const { data: linked } = useMessageDeals(messageId);
  const setDeals = useSetMessageDeals();
  const [open, setOpen] = useState(false);

  // Fall back to legacy single deal_id if link table hasn't been populated yet
  const effective =
    linked && linked.length > 0
      ? linked
      : fallbackDealId
      ? [fallbackDealId]
      : [];

  const selectedDeals = effective
    .map((id) => deals.find((d) => d.id === id))
    .filter((d): d is { id: string; property_name: string } => !!d);

  const toggle = (id: string) => {
    const next = effective.includes(id)
      ? effective.filter((x) => x !== id)
      : [...effective, id];
    setDeals.mutate(
      { id: messageId, dealIds: next },
      {
        onError: (e: unknown) =>
          toast({
            title: "Failed to update deals",
            description: (e as Error).message,
            variant: "destructive",
          }),
      },
    );
  };

  const clearOne = (id: string) => {
    setDeals.mutate({ id: messageId, dealIds: effective.filter((x) => x !== id) });
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            size="sm"
            disabled={setDeals.isPending}
            className="h-8 min-w-[240px] justify-between text-xs font-normal"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {selectedDeals.length === 0
                  ? "Link deals"
                  : `${selectedDeals.length} deal${selectedDeals.length === 1 ? "" : "s"}`}
              </span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
          <Command>
            <CommandInput placeholder="Search deals…" className="h-9" />
            <CommandList>
              <CommandEmpty>No deals found.</CommandEmpty>
              <CommandGroup>
                {deals.map((d) => {
                  const checked = effective.includes(d.id);
                  return (
                    <CommandItem
                      key={d.id}
                      value={`${d.property_name} ${d.id}`}
                      onSelect={() => toggle(d.id)}
                    >
                      <Building2 className="mr-2 h-3.5 w-3.5" />
                      <span className="truncate">{d.property_name}</span>
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4",
                          checked ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedDeals.map((d) => (
        <Badge
          key={d.id}
          variant="secondary"
          className="h-7 gap-1 pl-2 pr-1 text-xs font-normal"
        >
          {chipTo ? (
            <Link to={chipTo(d.id)} className="max-w-[140px] truncate hover:underline">
              {d.property_name}
            </Link>
          ) : (
            <span className="max-w-[140px] truncate">{d.property_name}</span>
          )}
          <button
            type="button"
            onClick={() => clearOne(d.id)}
            disabled={setDeals.isPending}
            className="ml-0.5 rounded-sm p-0.5 hover:bg-muted-foreground/20"
            aria-label={`Unlink ${d.property_name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
