/**
 * "Atlas Feed" — what we forwarded to atlas@, as a working surface.
 *
 * Sourced by mailbox, not by partner_id: outlook-sync strips every
 * @ansoniaproperties.com address before matching, so our own forwards never
 * carry a partner_id. See useAtlasMessages for the full note.
 *
 * Deal linking goes through the shared DealMultiLink control (useMessageDeals /
 * useSetMessageDeals) so there is exactly one linking mechanism in the app.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Mail, Pin, PinOff, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmailReaderDialog } from "@/components/EmailReaderDialog";
import { DealMultiLink } from "@/components/DealMultiLink";
import { useAtlasMessages, useSetMessagePinned, useAtlasSyncStatus, type OutlookMessage } from "@/hooks/useOutlook";
import { useDeals } from "@/hooks/useDeals";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

const MAX_ROWS = 50;

/** How long since the last successful sync before the feed is called stale. */
const STALE_AFTER_HOURS = 24;

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function describeAge(iso: string): string {
  const h = hoursSince(iso);
  if (h < 48) return `${Math.floor(h)} hours ago`;
  return `${Math.floor(h / 24)} days ago`;
}

type FeedFilter = "all" | "linked" | "pinned" | "unread";

const FILTER_LABEL: Record<FeedFilter, string> = {
  all: "All",
  linked: "Has deal link",
  pinned: "Pinned",
  unread: "Unread",
};

/**
 * Which Atlas messages have a row in the outlook_message_deals join table.
 *
 * One query for the whole feed rather than useMessageDeals per row: the
 * "Has deal link" filter needs to know before a row is expanded, and N
 * per-row queries would be N round trips just to render the segmented control.
 * DealMultiLink still owns reading and writing the links for a given row.
 */
function useLinkedMessageIds(messageIds: string[]) {
  const key = [...new Set(messageIds)].filter(Boolean).sort();
  return useQuery({
    queryKey: ["outlook_message_deals", "by_message", key],
    enabled: key.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outlook_message_deals")
        .select("message_id")
        .in("message_id", key);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.message_id));
    },
  });
}

function AtlasRow({
  message,
  deals,
  onOpen,
}: {
  message: OutlookMessage;
  deals: Array<{ id: string; property_name: string }>;
  onOpen: (m: OutlookMessage) => void;
}) {
  const setPinned = useSetMessagePinned();
  const pinned = !!message.pinned_at;

  return (
    <div className="rounded border bg-card px-3 py-2.5 hover:border-[#6aa3d8] transition-colors">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onOpen(message)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            {!message.is_read && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#002752] shrink-0"
                aria-label="Unread"
              />
            )}
            <span className="font-medium text-sm truncate">{message.subject || "(no subject)"}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {message.from_name || message.from_email || "Unknown sender"}
            {message.received_at && (
              <>
                {" · "}
                {formatDistanceToNow(new Date(message.received_at), { addSuffix: true })}
              </>
            )}
          </div>
          {message.preview && (
            <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{message.preview}</div>
          )}
        </button>

        <button
          type="button"
          onClick={() =>
            setPinned.mutate(
              { id: message.id, pinned: !pinned },
              // There is no global mutation error handler, so without this the
              // guard in useSetMessagePinned would throw into a state nothing
              // renders — detectable in devtools, still silent on screen.
              { onError: (e: Error) => toast.error(e.message) },
            )
          }
          disabled={setPinned.isPending}
          aria-label={pinned ? "Unpin message" : "Pin message"}
          aria-pressed={pinned}
          className={`shrink-0 rounded p-1.5 transition-colors ${
            pinned
              ? "text-[#002752] hover:bg-muted"
              : "text-muted-foreground hover:text-[#002752] hover:bg-muted"
          }`}
        >
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Deal linkage — chips link out to the deal, the control edits the links. */}
      <div className="mt-2 pt-2 border-t">
        <DealMultiLink
          messageId={message.id}
          fallbackDealId={message.deal_id}
          deals={deals}
          chipTo={(dealId) => `/deals/${dealId}`}
        />
      </div>
    </div>
  );
}

export function InternalAtlasFeedCard() {
  const { data: messages, isLoading, error } = useAtlasMessages(MAX_ROWS);
  const { data: lastSyncedAt } = useAtlasSyncStatus();
  const { data: deals } = useDeals();
  const [openEmail, setOpenEmail] = useState<OutlookMessage | null>(null);
  const [filter, setFilter] = useState<FeedFilter>("all");

  const all = useMemo(() => messages ?? [], [messages]);
  const { data: linkedIds } = useLinkedMessageIds(all.map((m) => m.id));

  const dealOptions = useMemo(
    () => (deals ?? []).map((d) => ({ id: d.id, property_name: d.property_name ?? "(untitled deal)" })),
    [deals],
  );

  const visible = useMemo(() => {
    // A message counts as linked via either the join table or the legacy
    // deal_id column, matching how DealMultiLink resolves its own selection.
    const hasDealLink = (m: OutlookMessage) => !!m.deal_id || !!linkedIds?.has(m.id);
    switch (filter) {
      case "linked":
        return all.filter(hasDealLink);
      case "pinned":
        return all.filter((m) => !!m.pinned_at);
      case "unread":
        return all.filter((m) => !m.is_read);
      default:
        return all;
    }
  }, [all, filter, linkedIds]);

  // Pinned float to the top as their own block, most recently pinned first. The
  // "Pinned" filter is already showing only pinned, so it does not split.
  const splitPinned = filter !== "pinned";
  const pinned = splitPinned
    ? visible
        .filter((m) => !!m.pinned_at)
        .sort((a, b) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""))
    : [];
  const chronological = splitPinned ? visible.filter((m) => !m.pinned_at) : visible;

  const isEmptyFeed = !isLoading && !error && all.length === 0;

  // Only meaningful when there ARE rows: a zero-row feed already gets the
  // connector warning, and stacking both would say the same thing twice.
  const isStale =
    !isEmptyFeed &&
    !isLoading &&
    !error &&
    !!lastSyncedAt &&
    hoursSince(lastSyncedAt) >= STALE_AFTER_HOURS;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Mail className="h-4 w-4 text-[#002752]" />
          Atlas Feed
          <span className="text-xs font-normal text-muted-foreground">forwarded to atlas@</span>
        </CardTitle>
        {!isEmptyFeed && (
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => {
              if (v) setFilter(v as FeedFilter);
            }}
            className="justify-start border rounded-md w-fit"
          >
            {(Object.keys(FILTER_LABEL) as FeedFilter[]).map((k) => (
              <ToggleGroupItem key={k} value={k} className="h-7 px-2.5 text-xs">
                {FILTER_LABEL[k]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading && (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}

        {error && (
          <p className="text-sm text-destructive py-2">
            Could not load the Atlas feed: {(error as Error).message}
          </p>
        )}

        {/*
          A zero-row Atlas feed is ambiguous in a way that matters: it reads as
          "nothing forwarded", but the common cause is that the Atlas connection
          was authorized against the wrong mailbox — outlook-sync detects that
          key collision and returns 0 fetched for atlas (see the keysCollide
          branch in supabase/functions/outlook-sync/index.ts). Point at the
          connector rather than implying the mailbox is simply quiet.
        */}
        {/*
          The feed renders history whether or not the connector is still alive,
          so a healthy-looking page is NOT evidence of a healthy connector. Keyed
          on synced_at rather than received_at: a quiet mailbox is not a broken
          one, and only synced_at separates "nothing arrived" from "we stopped
          being able to ask".
        */}
        {isStale && lastSyncedAt && (
          <div className="flex items-start gap-2.5 rounded border border-amber-400/40 bg-amber-500/5 px-3 py-3">
            <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm">
              Atlas last synced {describeAge(lastSyncedAt)} (
              {new Date(lastSyncedAt).toLocaleString()}). Messages below are history — new
              mail may not be arriving. Check the Atlas mailbox connection on{" "}
              <Link to="/admin/connectors" className="text-[#002752] font-medium hover:underline">
                /admin/connectors
              </Link>
              .
            </p>
          </div>
        )}

        {isEmptyFeed && (
          <div className="flex items-start gap-2.5 rounded border border-amber-400/40 bg-amber-500/5 px-3 py-3">
            <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm">
              No Atlas mail synced yet — check the Atlas mailbox connection on{" "}
              <Link to="/admin/connectors" className="text-[#002752] font-medium hover:underline">
                /admin/connectors
              </Link>
              .
            </p>
          </div>
        )}

        {!isEmptyFeed && !isLoading && !error && visible.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No messages match this filter.
          </p>
        )}

        {pinned.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Pin className="h-3 w-3" /> Pinned ({pinned.length})
            </div>
            {pinned.map((m) => (
              <AtlasRow key={m.id} message={m} deals={dealOptions} onOpen={setOpenEmail} />
            ))}
          </div>
        )}

        {chronological.length > 0 && (
          <div className="space-y-1.5">
            {pinned.length > 0 && (
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">
                Everything else
              </div>
            )}
            {chronological.map((m) => (
              <AtlasRow key={m.id} message={m} deals={dealOptions} onOpen={setOpenEmail} />
            ))}
          </div>
        )}
      </CardContent>

      <EmailReaderDialog message={openEmail} onClose={() => setOpenEmail(null)} />
    </Card>
  );
}
