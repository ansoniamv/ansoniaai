// One Capital Feed story: kicker, headline, standfirst, facts, and the team's
// reactions and comments underneath.
import { useState } from "react";
import { Link } from "react-router-dom";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ArrowUpRight, ChevronDown, MessageSquare, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NoteContent } from "@/components/NoteContent";
import { ChangeSourceRef } from "@/components/ChangeSourceRef";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, type Story } from "@/lib/capitalFeed";
import { CATEGORY_TONE } from "@/components/capital-feed/tone";
import {
  FEED_EMOJIS,
  useAddComment,
  useDeleteComment,
  useToggleReaction,
  type FeedComment,
  type FeedReaction,
} from "@/hooks/useCapitalFeed";

const initials = (name: string | null | undefined) =>
  (name ?? "?").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

type Props = {
  story: Story;
  partnerName: string;
  isNew: boolean;
  comments: FeedComment[];
  reactions: FeedReaction[];
  socialAvailable: boolean;
  userId: string | undefined;
  onPartnerClick: (partnerId: string) => void;
};

export function StoryCard({ story: s, partnerName, isNew, comments, reactions, socialAvailable, userId, onPartnerClick }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const tone = CATEGORY_TONE[s.category];

  return (
    <article className="relative rounded-md border border-hairline bg-card pl-5 pr-4 py-4">
      <span className={cn("absolute left-0 top-4 bottom-4 w-[3px] rounded-r", tone.rule)} aria-hidden />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] uppercase tracking-[0.14em] font-semibold">
          <span className={tone.text}>{CATEGORY_LABEL[s.category]}</span>
          <span className="text-muted-foreground/60">/</span>
          <button
            type="button"
            onClick={() => onPartnerClick(s.partnerId)}
            className="text-foreground hover:underline truncate max-w-[260px] text-left"
            title="Show only this partner"
          >
            {partnerName}
          </button>
          {isNew && <span className="rounded-sm bg-primary px-1.5 py-px text-[9px] tracking-[0.12em] text-primary-foreground">New</span>}
        </div>
        <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={s.at} title={format(new Date(s.at), "PPpp")}>
          {format(new Date(s.at), "h:mm a")}
        </time>
      </div>

      <Link to={`/partners/${s.partnerId}`} className="group mt-1.5 block">
        <h3 className="font-serif text-[17px] leading-snug font-semibold text-foreground group-hover:underline decoration-1 underline-offset-2">
          {s.headline}
          <ArrowUpRight className="inline h-3.5 w-3.5 ml-1 -mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </h3>
      </Link>

      {s.dek && !expanded && <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-clamp-3">{s.dek}</p>}

      {!!s.changes?.length && (
        <table className="mt-2.5 w-full text-sm">
          <tbody>
            {s.changes.map((c) => (
              <tr key={c.field} className="border-t border-hairline first:border-t-0">
                <td className="py-1 pr-4 text-xs text-muted-foreground whitespace-nowrap align-top w-[1%]">{c.label}</td>
                <td className="py-1">
                  {c.from ? (
                    <>
                      <span className="text-muted-foreground line-through">{c.from}</span>
                      <span className="mx-1.5 text-muted-foreground">→</span>
                      <span className="font-medium">{c.to}</span>
                    </>
                  ) : (
                    <span className="font-medium">{c.to}</span>
                  )}
                  <ChangeSourceRef refInfo={c.ref} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {expanded && s.note && (
        <div className="mt-2 rounded-md bg-muted/40 p-3">
          <NoteContent content={s.note.content} format={s.note.format} className="text-sm" />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground truncate">
          {s.byline}
          {s.note && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="ml-2 inline-flex items-center gap-0.5 text-foreground/80 hover:text-foreground">
              {expanded ? "Hide note" : "Read full note"}
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </div>
        {socialAvailable && (
          <SocialBar
            itemKey={s.key}
            reactions={reactions}
            commentCount={comments.length}
            userId={userId}
            onToggleComments={() => setShowComments((v) => !v)}
          />
        )}
      </div>

      {socialAvailable && showComments && <CommentThread itemKey={s.key} comments={comments} userId={userId} />}
    </article>
  );
}

function SocialBar({ itemKey, reactions, commentCount, userId, onToggleComments }: {
  itemKey: string;
  reactions: FeedReaction[];
  commentCount: number;
  userId: string | undefined;
  onToggleComments: () => void;
}) {
  const toggle = useToggleReaction();
  const [pickerOpen, setPickerOpen] = useState(false);
  const byEmoji = FEED_EMOJIS.map((e) => {
    const rs = reactions.filter((r) => r.emoji === e);
    return { emoji: e, count: rs.length, mine: rs.some((r) => r.user_id === userId), names: rs.map((r) => r.user_label ?? "Someone") };
  }).filter((r) => r.count > 0);

  const react = (emoji: string, on: boolean) => {
    if (!userId) return;
    toggle.mutate({ itemKey, emoji, userId, on }, { onError: (e) => toast.error(`Couldn't save reaction: ${(e as Error).message}`) });
  };

  return (
    <div className="flex items-center gap-1">
      {byEmoji.map((r) => (
        <Tooltip key={r.emoji}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => react(r.emoji, !r.mine)}
              className={cn(
                "h-7 rounded-full border px-2 text-xs inline-flex items-center gap-1 transition-colors",
                r.mine ? "border-primary/40 bg-primary/10 text-foreground" : "border-hairline hover:bg-muted",
              )}
            >
              <span>{r.emoji}</span>
              <span className="tabular-nums">{r.count}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px] text-xs">{r.names.join(", ")}</TooltipContent>
        </Tooltip>
      ))}
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" aria-label="Add reaction">
            <SmilePlus className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1 flex gap-0.5" align="end">
          {FEED_EMOJIS.map((e) => {
            const mine = reactions.some((r) => r.emoji === e && r.user_id === userId);
            return (
              <button
                key={e}
                type="button"
                className={cn("h-8 w-8 rounded text-lg hover:bg-muted", mine && "bg-primary/10")}
                onClick={() => { react(e, !mine); setPickerOpen(false); }}
              >
                {e}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1" onClick={onToggleComments}>
        <MessageSquare className="h-3.5 w-3.5" />
        {commentCount > 0 ? commentCount : "Comment"}
      </Button>
    </div>
  );
}

function CommentThread({ itemKey, comments, userId }: { itemKey: string; comments: FeedComment[]; userId: string | undefined }) {
  const [draft, setDraft] = useState("");
  const add = useAddComment();
  const del = useDeleteComment();

  const submit = () => {
    if (!draft.trim()) return;
    add.mutate({ itemKey, body: draft }, {
      onSuccess: () => setDraft(""),
      onError: (e) => toast.error(`Couldn't post comment: ${(e as Error).message}`),
    });
  };

  return (
    <div className="mt-3 border-t border-hairline pt-3 space-y-3">
      {comments.map((c) => (
        <div key={c.id} className="group flex gap-2.5">
          <div className="h-7 w-7 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center">
            {initials(c.author_label)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="font-semibold text-foreground">{c.author_label ?? "Teammate"}</span>
              <span className="text-muted-foreground" title={format(new Date(c.created_at), "PPpp")}>
                {formatDistanceToNowStrict(new Date(c.created_at), { addSuffix: true })}
              </span>
              {c.author_id === userId && (
                <button
                  type="button"
                  className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={() => del.mutate(c.id, { onError: (e) => toast.error(`Couldn't delete: ${(e as Error).message}`) })}
                  aria-label="Delete comment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          placeholder="Add a comment for the team…  (Ctrl+Enter to post)"
          className="min-h-[38px] h-[38px] text-sm resize-y"
          maxLength={4000}
        />
        <Button type="button" size="sm" className="h-[38px]" disabled={!draft.trim() || add.isPending} onClick={submit}>
          Post
        </Button>
      </div>
    </div>
  );
}
