// Capital Feed: the team's news wire for capital partners. Notes people write
// and changes to what partners will invest in, so teammates who weren't in the
// meeting still see it.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { usePartners } from "@/hooks/usePartners";
import { useCapitalFeed, useFeedSocial } from "@/hooks/useCapitalFeed";
import { dayLabel } from "@/lib/partnerFeed";
import { ALL_CATEGORIES, CATEGORY_LABEL, buildStories, storySearchText, type Story, type StoryCategory } from "@/lib/capitalFeed";
import { StoryCard } from "@/components/capital-feed/StoryCard";
import { CATEGORY_TONE } from "@/components/capital-feed/tone";
import { cn } from "@/lib/utils";

const PERIODS = [7, 30, 90, 180, 365] as const;
const LAST_SEEN_KEY = "capital-feed-last-seen";
const PAGE = 60;

function readLastSeen(): number | null {
  try {
    const v = localStorage.getItem(LAST_SEEN_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export default function CapitalFeedPage() {
  const { user } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<Set<StoryCategory>>(new Set(ALL_CATEGORIES));
  const [partnerFilter, setPartnerFilter] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  // Captured once, before this visit is recorded, so "New" marks what arrived
  // since the previous visit.
  const [lastSeen] = useState(readLastSeen);

  const { data, isLoading, error } = useCapitalFeed(days);
  const { data: social } = useFeedSocial(days);
  const { data: partners = [], isLoading: partnersLoading } = usePartners({ includeArchived: true });

  useEffect(() => {
    if (!data) return;
    try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch { /* private mode */ }
  }, [data]);

  const partnerName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of partners) m[p.id] = p.name;
    return m;
  }, [partners]);

  const stories = useMemo(
    () => (data ? buildStories(data, (id) => partnerName[id] ?? "Unknown partner") : []),
    [data, partnerName],
  );
  const base = useMemo(
    () => stories.filter((s) => !partnerFilter || s.partnerId === partnerFilter),
    [stories, partnerFilter],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(ALL_CATEGORIES.map((k) => [k, 0])) as Record<StoryCategory, number>;
    for (const s of base) c[s.category]++;
    return c;
  }, [base]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => base.filter((s) => cats.has(s.category) && (!q || storySearchText(s).includes(q))),
    [base, cats, q],
  );
  useEffect(() => setLimit(PAGE), [days, q, cats, partnerFilter]);

  const isNew = (s: Story) => lastSeen != null && new Date(s.at).getTime() > lastSeen;
  const newCount = lastSeen == null ? 0 : stories.filter(isNew).length;

  const groups: { day: string; items: Story[] }[] = [];
  for (const s of shown.slice(0, limit)) {
    const day = dayLabel(s.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(s);
    else groups.push({ day, items: [s] });
  }

  const toggleCat = (k: StoryCategory) =>
    setCats((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next.size === 0 ? new Set(ALL_CATEGORIES) : next;
    });

  const topPartners = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stories) m.set(s.partnerId, (m.get(s.partnerId) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [stories]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap border-b border-hairline pb-5">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">Capital Formation</div>
          <h1 className="mt-1 text-3xl font-display font-semibold tracking-tight text-foreground">Capital Feed</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            New partner notes and investment criteria changes across the Ansonia platform
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div className="uppercase tracking-[0.14em] font-semibold">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </div>
          {newCount > 0 && <div className="mt-1 text-foreground font-medium">{newCount} new since your last visit</div>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search partners and notes" className="h-9 pl-8 text-sm" />
            </div>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="h-9 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((d) => <SelectItem key={d} value={String(d)}>Last {d} days</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {ALL_CATEGORIES.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleCat(k)}
                className={cn(
                  "h-7 rounded-full border px-3 text-xs inline-flex items-center gap-1.5 transition-colors",
                  cats.has(k) ? "border-foreground/20 bg-foreground/[0.04] text-foreground" : "border-hairline text-muted-foreground hover:text-foreground",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", cats.has(k) ? CATEGORY_TONE[k].dot : "bg-muted-foreground/40")} />
                {CATEGORY_LABEL[k]}
                <span className="tabular-nums text-muted-foreground">{counts[k]}</span>
              </button>
            ))}
            {partnerFilter && (
              <button
                type="button"
                onClick={() => setPartnerFilter(null)}
                className="h-7 rounded-full bg-primary px-3 text-xs text-primary-foreground inline-flex items-center gap-1"
              >
                {partnerName[partnerFilter] ?? "Partner"}
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {isLoading || partnersLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <p className="text-sm text-destructive text-center py-8">Couldn't load the feed: {(error as Error).message}</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              {base.length === 0 ? `No new notes or criteria changes in the last ${days} days.` : "Nothing matches these filters."}
            </p>
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.day} className="space-y-2.5">
                  <div className="flex items-center gap-3 pt-2">
                    <h2 className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted-foreground whitespace-nowrap">{g.day}</h2>
                    <div className="h-px flex-1 bg-hairline" />
                  </div>
                  {g.items.map((s) => (
                    <StoryCard
                      key={s.key}
                      story={s}
                      partnerName={partnerName[s.partnerId] ?? "Unknown partner"}
                      isNew={isNew(s)}
                      comments={social?.commentsByKey.get(s.key) ?? []}
                      reactions={social?.reactionsByKey.get(s.key) ?? []}
                      socialAvailable={!!social?.available}
                      userId={user?.id}
                      onPartnerClick={setPartnerFilter}
                    />
                  ))}
                </section>
              ))}
              {shown.length > limit && (
                <div className="flex justify-center pt-2">
                  <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="text-sm text-primary hover:underline">
                    Show more ({shown.length - limit} older)
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-4 self-start">
          <RailSection title={`At a glance · ${days} days`}>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hairline bg-hairline">
              {ALL_CATEGORIES.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCats(new Set([k]))}
                  className="bg-card p-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="text-2xl font-display font-semibold tabular-nums">{counts[k]}</div>
                  <div className={cn("text-[11px] uppercase tracking-[0.12em] font-semibold", CATEGORY_TONE[k].text)}>{CATEGORY_LABEL[k]}</div>
                </button>
              ))}
            </div>
          </RailSection>

          {topPartners.length > 0 && (
            <RailSection title="Most active partners">
              <ol className="space-y-1">
                {topPartners.map(([id, n], idx) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setPartnerFilter(id)}
                      className={cn(
                        "w-full flex items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted/60",
                        partnerFilter === id && "bg-muted",
                      )}
                    >
                      <span className="w-4 text-xs tabular-nums text-muted-foreground">{idx + 1}</span>
                      <span className="flex-1 truncate">{partnerName[id] ?? "Unknown partner"}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </RailSection>
          )}
        </aside>
      </div>
    </div>
  );
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 border-b border-foreground/80 pb-1.5 text-[11px] uppercase tracking-[0.16em] font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}
