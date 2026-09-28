/**
 * Atlas Inbox → Unattributed: atlas@ emails with no partner, shown as a
 * two-pane reader matching the Acquisitions Inbox — full email on the right,
 * with partner and deal tagging above it.
 *
 * Tagging a partner goes through useAssignMessagePartner, which also clears
 * analyzed_at so the Atlas analyzer re-reads the email against that partner.
 * The email then leaves this list and the reader moves on to the next one.
 */
import { useMemo, useRef, useState } from "react";
import { Inbox, Search } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailMessageDetail, EmailMessageRow } from "@/components/EmailReader";
import { useUnattributedAtlasMessages, useAssignMessagePartner } from "@/hooks/usePartnerSuggestions";
import { usePartners } from "@/hooks/usePartners";
import { useDeals } from "@/hooks/useDeals";
import type { OutlookMessage } from "@/hooks/useOutlook";

export function AtlasUnattributedInbox() {
  const { data, isLoading, isError, error } = useUnattributedAtlasMessages();
  const { data: partners } = usePartners();
  const { data: deals } = useDeals();
  const assign = useAssignMessagePartner();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Where the last selection sat, so tagging an email away advances to its neighbour.
  const lastIndex = useRef(0);

  const messages = useMemo(() => (data || []) as OutlookMessage[], [data]);
  const filtered = useMemo(() => {
    if (!search) return messages;
    const s = search.toLowerCase();
    return messages.filter(
      (m) =>
        m.subject?.toLowerCase().includes(s) ||
        m.from_email?.toLowerCase().includes(s) ||
        m.from_name?.toLowerCase().includes(s) ||
        m.preview?.toLowerCase().includes(s),
    );
  }, [messages, search]);

  let index = filtered.findIndex((m) => m.id === selectedId);
  if (index < 0) index = Math.min(lastIndex.current, filtered.length - 1);
  const selected = index >= 0 ? filtered[index] : undefined;
  if (index >= 0) lastIndex.current = index;

  const tagPartner = async (partnerId: string | null) => {
    if (!selected || !partnerId) return;
    const name = partners?.find((p) => p.id === partnerId)?.name ?? "partner";
    try {
      await assign.mutateAsync({ id: selected.id, partnerId });
      setSelectedId(null);
      toast.success(`Tagged to ${name}. Atlas will analyze it on the next run.`);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't tag the email");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search subject, sender, body…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Badge variant="outline">{filtered.length} unattributed</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 h-[calc(100vh-240px)] min-h-[520px]">
        <Card className="overflow-hidden min-h-0">
          <div className="h-full overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : isError ? (
              <div className="p-6 text-sm">
                <div className="font-semibold">Couldn't load Atlas emails</div>
                <div className="text-xs text-muted-foreground mt-1 font-mono break-words">{(error as Error)?.message}</div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Inbox className="h-6 w-6 text-primary" />
                </div>
                <div className="text-sm text-muted-foreground">
                  {search ? "No emails match that search." : "Every Atlas email is tagged to a partner."}
                </div>
              </div>
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
              onPartnerChange={tagPartner}
              linking={assign.isPending}
              partnerPlaceholder="Tag partner"
              notice="Tagging a partner moves this email out of Unattributed and queues it for Atlas to analyze."
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              {isLoading ? "Loading…" : "Nothing to review"}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
