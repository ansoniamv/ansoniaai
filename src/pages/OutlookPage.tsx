import { useMemo, useState } from "react";
import { Mail, RefreshCw, Search, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { useOutlookMessages, useSyncOutlook, useLinkMessage } from "@/hooks/useOutlook";
import { usePartners } from "@/hooks/usePartners";
import { useDeals } from "@/hooks/useDeals";
import { EmailMessageDetail, EmailMessageRow } from "@/components/EmailReader";
import { LinkCombobox } from "@/components/LinkCombobox";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export default function OutlookPage() {
  const [filter, setFilter] = useState<"all" | "unread" | "linked" | "unlinked">("all");
  const [search, setSearch] = useState("");
  const [partnerFilter, setPartnerFilter] = useState<string | null>(null);
  const [dealFilter, setDealFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: messages, isLoading, isError, error } = useOutlookMessages({ unreadOnly: filter === "unread" });
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
          <div className="h-full overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : isError ? (
              <LoadFailed error={error as Error} />
            ) : filtered.length === 0 ? (
              <EmptyList onSync={handleSync} syncing={sync.isPending} />
            ) : (
              <ul className="divide-y">
                {filtered.map((m) => (
                  <EmailMessageRow
                    key={m.id}
                    msg={m}
                    active={selected?.id === m.id}
                    onClick={() => setSelectedId(m.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden min-h-0">
          {selected ? (
            <EmailMessageDetail
              msg={selected}
              partners={partners || []}
              deals={deals || []}
              onPartnerChange={(partnerId) => link.mutate({ id: selected.id, partnerId })}
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

/**
 * The list query failed outright — a distinct state from "the mailbox is quiet".
 *
 * Load-bearing, not decoration: a failed query leaves `messages` undefined, which
 * is indistinguishable from an empty inbox by length alone. Falling through to
 * EmptyList told the reader "Sync to pull the latest emails" while the sync was
 * working perfectly and the *read* was broken — which is how a column dropped
 * by a migration read as a mailbox outage.
 */
function LoadFailed({ error }: { error: Error }) {
  return (
    <div className="p-10 text-center space-y-4">
      <div className="mx-auto w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
        <X className="h-6 w-6 text-destructive" />
      </div>
      <div>
        <h3 className="font-semibold">Couldn't load messages</h3>
        <p className="text-sm text-muted-foreground mt-1">
          The inbox is reachable but the query failed, so syncing again will not help.
        </p>
        <p className="text-xs text-muted-foreground mt-2 font-mono break-words">{error?.message}</p>
      </div>
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
