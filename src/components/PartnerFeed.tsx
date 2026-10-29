// Capital Partners activity feed: recent conversations and changes across every
// firm, newest first, to jog memory of who we've talked to and what changed.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Building2, Loader2, Mail, MessageSquare, Pencil, Search, Send, StickyNote, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NoteContent } from "@/components/NoteContent";
import { ChangeSourceRef } from "@/components/ChangeSourceRef";
import { usePartners } from "@/hooks/usePartners";
import { usePartnerFeed } from "@/hooks/usePartnerFeed";
import { FEED_KIND_LABEL, dayLabel, feedSearchText, type FeedItem, type FeedKind } from "@/lib/partnerFeed";

const ALL_KINDS = Object.keys(FEED_KIND_LABEL) as FeedKind[];
const PERIODS = [7, 30, 90] as const;

function FeedIcon({ item }: { item: FeedItem }) {
  const Icon =
    item.kind === "email" ? (item.sent ? Send : Mail)
    : item.kind === "note" ? StickyNote
    : item.kind === "logged" ? MessageSquare
    : item.kind === "new_partner" ? Building2
    : item.kind === "new_contact" ? UserPlus
    : Pencil;
  return (
    <div className="h-7 w-7 rounded-full border bg-background flex items-center justify-center shrink-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

export function PartnerFeed() {
  const [days, setDays] = useState<number>(30);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<FeedKind>>(new Set(ALL_KINDS));
  // Background jobs (warmth recompute, enrichment) write far more than people
  // do; off by default so the feed reads as what the team did.
  const [showAutomated, setShowAutomated] = useState(false);

  const { data: items = [], isLoading, error } = usePartnerFeed(days);
  const { data: partners = [] } = usePartners({ includeArchived: true });
  const partnerName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of partners) m[p.id] = p.name;
    return m;
  }, [partners]);

  const visible = useMemo(() => items.filter((i) => showAutomated || !i.automated), [items, showAutomated]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<FeedKind, number>;
    for (const i of visible) c[i.kind]++;
    return c;
  }, [visible]);

  const q = query.trim().toLowerCase();
  const shown = visible.filter((i) =>
    kinds.has(i.kind) && (!q || feedSearchText(i, partnerName[i.partnerId] ?? "").includes(q)));

  const groups: { day: string; items: FeedItem[] }[] = [];
  for (const i of shown) {
    const day = dayLabel(i.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(i);
    else groups.push({ day, items: [i] });
  }

  const toggle = (k: FeedKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next.size === 0 ? new Set(ALL_KINDS) : next;
    });

  return (
    <Card className="border-hairline shadow-none">
      <CardContent className="pt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search feed" className="h-8 pl-8 text-sm" />
          </div>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map((d) => <SelectItem key={d} value={String(d)}>Last {d} days</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <Switch checked={showAutomated} onCheckedChange={setShowAutomated} />
            Show automatic updates
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_KINDS.map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={kinds.has(k) ? "secondary" : "outline"}
              className="h-7 text-xs"
              onClick={() => toggle(k)}
            >
              {FEED_KIND_LABEL[k]} ({counts[k]})
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="text-sm text-destructive text-center py-6">Couldn't load the feed: {(error as Error).message}</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {visible.length === 0 ? `No partner activity in the last ${days} days.` : "Nothing matches."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.day} className="space-y-2">
              <div className="text-sm font-medium">{g.day}</div>
              {g.items.map((i) => (
                <div key={i.key} className="flex gap-3">
                  <FeedIcon item={i} />
                  <div className="flex-1 min-w-0 rounded-md border p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 text-sm truncate">
                        <Link to={`/partners/${i.partnerId}`} className="font-semibold text-primary hover:underline">
                          {partnerName[i.partnerId] ?? "Unknown partner"}
                        </Link>
                        <span className="text-muted-foreground"> · </span>
                        <span className="font-medium">{i.title}</span>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(i.at), "h:mm a")}</span>
                    </div>
                    {i.byline && <div className="text-xs text-muted-foreground truncate">{i.byline}</div>}
                    {i.snippet && <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">{i.snippet}</p>}
                    {i.note && <NoteContent content={i.note.content} format={i.note.format} className="text-sm line-clamp-4" />}
                    {i.changes && (
                      <ul className="space-y-0.5">
                        {i.changes.map((c) => (
                          <li key={c.field} className="text-sm">
                            <span className="text-muted-foreground">{c.label}:</span>{" "}
                            {c.from ? (
                              <><span className="line-through text-muted-foreground">{c.from}</span> → <span className="font-medium">{c.to}</span></>
                            ) : (
                              <span className="font-medium">{c.to}</span>
                            )}
                            <ChangeSourceRef refInfo={c.ref} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
