import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { safeExternalUrl } from "@/lib/safeUrl";
import { Mail, RefreshCw, ExternalLink, Paperclip, Search, Link2, Loader2, ChevronsUpDown, Check, X, Building2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useOutlookMessages, useOutlookMessageBody, useSyncOutlook, useLinkMessage, useMessageDeals, useSetMessageDeals, type OutlookMessage } from "@/hooks/useOutlook";
import { usePartners } from "@/hooks/usePartners";
import { useDeals } from "@/hooks/useDeals";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";

export default function OutlookPage() {
  const [filter, setFilter] = useState<"all" | "unread" | "linked" | "unlinked">("all");
  const [search, setSearch] = useState("");
  const [partnerFilter, setPartnerFilter] = useState<string | null>(null);
  const [dealFilter, setDealFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: messages, isLoading } = useOutlookMessages({ unreadOnly: filter === "unread" });
  const sync = useSyncOutlook();
  const link = useLinkMessage();
  const { data: partners } = usePartners();
  const { data: deals } = useDeals();

  // All message->deal links, used for the deal filter (respects multi-link junction).
  const { data: allDealLinks } = useQuery({
    queryKey: ["outlook_message_deals", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outlook_message_deals")
        .select("message_id, deal_id");
      if (error) throw error;
      return (data ?? []) as Array<{ message_id: string; deal_id: string }>;
    },
    staleTime: 30_000,
  });

  const dealLinkMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of allDealLinks ?? []) {
      if (!map.has(row.message_id)) map.set(row.message_id, new Set());
      map.get(row.message_id)!.add(row.deal_id);
    }
    return map;
  }, [allDealLinks]);

  const filtered = useMemo(() => {
    let list = messages || [];
    if (filter === "linked") list = list.filter((m) => m.partner_id || m.deal_id);
    if (filter === "unlinked") list = list.filter((m) => !m.partner_id && !m.deal_id);
    if (partnerFilter) list = list.filter((m) => m.partner_id === partnerFilter);
    if (dealFilter) {
      list = list.filter((m) => {
        if (m.deal_id === dealFilter) return true;
        const set = dealLinkMap.get(m.id);
        return set?.has(dealFilter) ?? false;
      });
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.subject?.toLowerCase().includes(s) ||
          m.from_email?.toLowerCase().includes(s) ||
          m.from_name?.toLowerCase().includes(s) ||
          m.preview?.toLowerCase().includes(s),
      );
    }
    return list;
  }, [messages, filter, search, partnerFilter, dealFilter, dealLinkMap]);

  const selected = filtered.find((m) => m.id === selectedId) || filtered[0];

  const handleSync = async () => {
    try {
      const res = await sync.mutateAsync({ top: 100 });
      toast({
        title: "Inbox synced",
        description: `Fetched ${res.fetched} messages, ${res.matched} auto-linked to partners.`,
      });
    } catch (e) {
      toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Acquisitions Inbox</h1>
          <p className="text-sm text-muted-foreground">
            acquisitions@ansoniaproperties.com — emails auto-linked to partner contacts
          </p>
        </div>
        <Button onClick={handleSync} disabled={sync.isPending}>
          {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync now
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread</TabsTrigger>
            <TabsTrigger value="linked">Linked</TabsTrigger>
            <TabsTrigger value="unlinked">Unlinked</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search subject, sender, body…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <LinkCombobox
          kind="partner"
          items={(partners || []).map((p) => ({ id: p.id, label: p.name }))}
          value={partnerFilter}
          onChange={(v) => setPartnerFilter(v)}
          placeholder="Filter by partner"
        />
        <LinkCombobox
          kind="deal"
          items={(deals || []).map((d) => ({ id: d.id, label: d.property_name }))}
          value={dealFilter}
          onChange={(v) => setDealFilter(v)}
          placeholder="Filter by deal"
        />
        <Badge variant="outline">{filtered.length} messages</Badge>
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 h-[calc(100vh-260px)] min-h-0">
        <Card className="overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyList onSync={handleSync} syncing={sync.isPending} />
            ) : (
              <ul className="divide-y">
                {filtered.map((m) => (
                  <MessageRow
                    key={m.id}
                    msg={m}
                    active={selected?.id === m.id}
                    onClick={() => setSelectedId(m.id)}
                  />
                ))}
              </ul>
            )}
          </ScrollArea>
        </Card>

        <Card className="overflow-hidden min-h-0">
          {selected ? (
            <MessageDetail
              msg={selected}
              partners={partners || []}
              deals={deals || []}
              onLink={(updates) => link.mutate({ id: selected.id, ...updates })}
              linking={link.isPending}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Select a message
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function MessageRow({ msg, active, onClick }: { msg: OutlookMessage; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${active ? "bg-muted" : ""} ${!msg.is_read ? "border-l-2 border-l-primary" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-sm truncate ${!msg.is_read ? "font-semibold" : "font-medium"}`}>
                {msg.from_name || msg.from_email || "Unknown"}
              </span>
              {msg.has_attachments && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
            </div>
            <div className="text-sm truncate mt-0.5">{msg.subject}</div>
            <div className="text-xs text-muted-foreground truncate mt-0.5">{msg.preview}</div>
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {msg.received_at ? formatDistanceToNow(new Date(msg.received_at), { addSuffix: false }) : ""}
          </div>
        </div>
        {(msg.partner_id || msg.deal_id) && (
          <div className="flex gap-1 mt-2">
            {msg.partner_id && <Badge variant="secondary" className="text-[10px]"><Link2 className="h-2.5 w-2.5 mr-1" />Partner</Badge>}
            {msg.deal_id && <Badge variant="secondary" className="text-[10px]"><Link2 className="h-2.5 w-2.5 mr-1" />Deal</Badge>}
          </div>
        )}
      </button>
    </li>
  );
}

function MessageDetail({
  msg, partners, deals, onLink, linking,
}: {
  msg: OutlookMessage;
  partners: Array<{ id: string; name: string }>;
  deals: Array<{ id: string; property_name: string }>;
  onLink: (u: { partnerId?: string | null; dealId?: string | null }) => void;
  linking: boolean;
}) {
  const { data: bodyRow, isLoading: bodyLoading } = useOutlookMessageBody(msg.id);
  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold leading-tight">{msg.subject}</h2>
          {safeExternalUrl(msg.web_link) && (
            <Button asChild variant="outline" size="sm">
              <a href={safeExternalUrl(msg.web_link)!} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Open
              </a>
            </Button>
          )}
        </div>
        <div className="text-sm">
          <span className="font-medium">{msg.from_name}</span>{" "}
          <span className="text-muted-foreground">&lt;{msg.from_email}&gt;</span>
        </div>
        <div className="text-xs text-muted-foreground">
          To: {(msg.to_recipients as Array<{ emailAddress?: { address?: string } }> | null)
            ?.map((r) => r.emailAddress?.address)
            .filter(Boolean)
            .join(", ") || "—"}
        </div>
        <div className="text-xs text-muted-foreground">
          {msg.received_at && format(new Date(msg.received_at), "PPp")}
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <LinkCombobox
            kind="partner"
            items={partners.map((p) => ({ id: p.id, label: p.name }))}
            value={msg.partner_id}
            onChange={(v) => onLink({ partnerId: v })}
            disabled={linking}
            placeholder="Link partner"
          />
          <DealMultiLink
            messageId={msg.id}
            fallbackDealId={msg.deal_id}
            deals={deals}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <CardContent className="pt-4 overflow-x-auto">
          {bodyLoading ? (
            <div className="text-sm text-muted-foreground">Loading message…</div>
          ) : bodyRow?.body_html ? (
            <div
              className="prose prose-sm max-w-none dark:prose-invert break-words"
              // Email HTML is attacker-controlled — sanitize with DOMPurify before rendering.
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(bodyRow.body_html, { ADD_ATTR: ["target", "rel"] }),
              }}
              style={{ maxWidth: "100%" }}
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm font-sans break-words">{bodyRow?.body_text || msg.preview}</pre>
          )}
        </CardContent>
      </ScrollArea>
    </div>
  );
}

function DealMultiLink({
  messageId,
  fallbackDealId,
  deals,
}: {
  messageId: string;
  fallbackDealId: string | null | undefined;
  deals: Array<{ id: string; property_name: string }>;
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
          <span className="max-w-[140px] truncate">{d.property_name}</span>
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

function LinkCombobox({
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

function EmptyList({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="p-10 text-center space-y-4">
      <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
        <Mail className="h-6 w-6 text-primary" />
      </div>
      <div>
        <h3 className="font-semibold">No messages yet</h3>
        <p className="text-sm text-muted-foreground mt-1">Sync to pull the latest emails from the connected inbox.</p>
      </div>
      <Button onClick={onSync} disabled={syncing}>
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Sync now
      </Button>
    </div>
  );
}
