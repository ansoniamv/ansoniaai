/**
 * Atlas Inbox → Unattributed: atlas@ emails with no partner, shown as a
 * two-pane reader matching the Acquisitions Inbox — full email on the right,
 * with partner and deal tagging above it.
 *
 * Tags are staged, not saved on click: pick the partner and any deals, then
 * "Save tags" writes them together. (Saving on each pick dropped the email out
 * of the list, or moved on, before the rest could be tagged.)
 *
 * The partner is saved through useAssignMessagePartner, which also clears
 * analyzed_at so the Atlas analyzer re-reads the email against that partner.
 * The email then leaves this list and the reader moves on to the next one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Inbox, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailMessageDetail, EmailMessageRow } from "@/components/EmailReader";
import { DealMultiLink } from "@/components/DealMultiLink";
import { LinkCombobox } from "@/components/LinkCombobox";
import { useUnattributedAtlasMessages, useAssignMessagePartner } from "@/hooks/usePartnerSuggestions";
import { usePartners } from "@/hooks/usePartners";
import { useDeals } from "@/hooks/useDeals";
import { useMessageDeals, useSetMessageDeals, type OutlookMessage } from "@/hooks/useOutlook";

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function StagedTagging({
  msg,
  partners,
  deals,
  onSaved,
}: {
  msg: OutlookMessage;
  partners: Array<{ id: string; name: string }>;
  deals: Array<{ id: string; property_name: string }>;
  /** Called after a save; `partnerTagged` means the email has left the list. */
  onSaved: (partnerTagged: boolean) => void;
}) {
  const { data: linked, isSuccess: linkedLoaded } = useMessageDeals(msg.id);
  const assign = useAssignMessagePartner();
  const setDeals = useSetMessageDeals();
  const saved = useMemo(
    () => (linked && linked.length > 0 ? linked : msg.deal_id ? [msg.deal_id] : []),
    [linked, msg.deal_id],
  );
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [dealIds, setDealIds] = useState<string[]>([]);
  // Seed the staged deals from what is already saved, once it has loaded.
  const seeded = useRef(false);
  useEffect(() => {
    if (linkedLoaded && !seeded.current) {
      seeded.current = true;
      setDealIds(saved);
    }
  }, [linkedLoaded, saved]);

  const dealsChanged = !sameSet(dealIds, saved);
  const dirty = !!partnerId || dealsChanged;
  const saving = assign.isPending || setDeals.isPending;

  const save = async () => {
    try {
      if (dealsChanged) await setDeals.mutateAsync({ id: msg.id, dealIds });
      if (partnerId) await assign.mutateAsync({ id: msg.id, partnerId });
      const parts = [
        partnerId && (partners.find((p) => p.id === partnerId)?.name ?? "partner"),
        dealsChanged && `${dealIds.length} deal${dealIds.length === 1 ? "" : "s"}`,
      ].filter(Boolean);
      toast.success(
        partnerId
          ? `Tagged to ${parts.join(" + ")}. Atlas will analyze it on the next run.`
          : `Saved ${parts.join("")}. Still unattributed until a partner is tagged.`,
      );
      onSaved(!!partnerId);
    } catch (e) {
      toast.error((e as Error).message || "Couldn’t save tags");
    }
  };

  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <LinkCombobox
          kind="partner"
          items={partners.map((p) => ({ id: p.id, label: p.name }))}
          value={partnerId}
          onChange={setPartnerId}
          disabled={saving}
          placeholder="Tag partner"
        />
        <DealMultiLink
          messageId={msg.id}
          fallbackDealId={msg.deal_id}
          deals={deals}
          value={dealIds}
          onChange={setDealIds}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save tags
        </Button>
        {dirty && !saving && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPartnerId(null);
              setDealIds(saved);
            }}
          >
            Reset
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {dirty ? "Unsaved tags." : "Pick a partner and any deals, then save."} Saving a partner moves the email out of Unattributed.
        </span>
      </div>
    </div>
  );
}

export function AtlasUnattributedInbox() {
  const { data, isLoading, isError, error } = useUnattributedAtlasMessages();
  const { data: partners } = usePartners();
  const { data: deals } = useDeals();
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

  const onSaved = (partnerTagged: boolean) => {
    // A tagged email drops out of the list, so the same index is already the
    // next email; a deals-only save stays listed, so step past it.
    if (partnerTagged) setSelectedId(null);
    else setSelectedId(filtered[index + 1]?.id ?? selected?.id ?? null);
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
              linking={false}
              tagging={
                <StagedTagging
                  key={selected.id}
                  msg={selected}
                  partners={partners || []}
                  deals={deals || []}
                  onSaved={onSaved}
                />
              }
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
