import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ExternalLink, NotebookPen } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { safeExternalUrl } from "@/lib/safeUrl";
import { useSuggestionEvidence, type EvidenceMessage } from "@/hooks/usePartnerSuggestions";
import { matchQuote, type QuoteMatch } from "../../supabase/functions/_shared/quoteMatch";

const BODY_CAP = 1200;

function toPlainText(m: EvidenceMessage): string {
  if (m.body_text?.trim()) return m.body_text;
  const html = m.body_html || "";
  if (!html) return m.preview || "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Characters of context kept before and after the highlight in a long email. */
const CONTEXT_BEFORE = 250;
const CONTEXT_AFTER = 500;

function MessageBody({ text, hit }: { text: string; hit: QuoteMatch | null }) {
  const [full, setFull] = useState(false);
  const long = text.length > BODY_CAP;
  // A long email opens on the highlighted passage, which in a reply is often
  // deep in the quoted thread; otherwise on its first BODY_CAP characters.
  let from = 0;
  let to = text.length;
  if (long && !full) {
    if (hit) {
      from = Math.max(0, hit.start - CONTEXT_BEFORE);
      to = Math.min(text.length, hit.end + CONTEXT_AFTER);
    } else {
      to = BODY_CAP;
    }
  }
  const head = from > 0 ? "…" : "";
  const tail = to < text.length ? "…" : "";

  return (
    <div>
      <div className="whitespace-pre-wrap text-xs leading-relaxed">
        {hit && hit.start >= from && hit.end <= to ? (
          <>
            {head}
            <span>{text.slice(from, hit.start)}</span>
            <mark className="bg-amber-200/70 text-foreground rounded-sm px-0.5 dark:bg-amber-500/30">
              {text.slice(hit.start, hit.end)}
            </mark>
            <span>{text.slice(hit.end, to)}</span>
            {tail}
          </>
        ) : (
          head + text.slice(from, to) + tail
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setFull((f) => !f)}
          className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          {full ? "Show less" : "Show full email"}
        </button>
      )}
    </div>
  );
}

function HitLabel({ hit }: { hit: QuoteMatch }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.12em] text-amber-700">
      {hit.exact ? "Highlighted: the quoted words" : "Highlighted: closest sentence to the quote (not word for word)"}
    </div>
  );
}

function fmtDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;
}

/** A pass reason typed in Capital Raise: the source when an edit quotes it. */
export type PassNoteSource = {
  notes: string;
  typed_by?: string | null;
  typed_at?: string | null;
  deal_id?: string | null;
};

/** The pass reason a suggestion's or field's evidence cites, if any. */
export function passNoteFrom(ev: any): PassNoteSource | null {
  if (ev?.quote_from !== "pass_notes") return null;
  return { notes: ev.notes ?? "", typed_by: ev.typed_by ?? null, typed_at: ev.typed_at ?? null, deal_id: ev.deal_id ?? null };
}

function PassNoteBlock({ note, quote }: { note: PassNoteSource; quote?: string }) {
  const day = fmtDay(note.typed_at);
  return (
    <div className="rounded border bg-muted/20 p-2 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <div className="inline-flex items-center gap-1 text-xs">
          <NotebookPen className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">Pass reason typed in Capital Raise</span>
        </div>
        {note.deal_id && (
          <Link to={`/deals/${note.deal_id}`} className="shrink-0 text-[11px] text-primary hover:underline">
            Open deal
          </Link>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {note.typed_by ? `By ${note.typed_by}` : "Author not recorded"}
        {day ? ` · ${day}` : " · date not recorded"}
      </div>
      <MessageBody text={note.notes} hit={matchQuote(note.notes, quote)} />
    </div>
  );
}

/** A collapsible list of synced emails, with the quote highlighted in each. */
function EmailList({
  ids,
  quote,
  label,
  defaultOpen,
  context = false,
  messages,
}: {
  ids: string[];
  quote?: string;
  label: string;
  defaultOpen: boolean;
  /** Context only: the emails are shown without claiming they hold the quote. */
  context?: boolean;
  /** Already loaded by the caller; skips the fetch. */
  messages?: EvidenceMessage[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const fetched = useSuggestionEvidence(ids, open && !messages);
  const { data, isLoading, isError } = messages ? { data: messages, isLoading: false, isError: false } : fetched;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {label}
      </button>

      {open && (
        <div className="space-y-2">
          {isLoading && (
            <>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </>
          )}
          {!isLoading && (isError || (data && data.length < ids.length)) && (
            <div className="text-[11px] text-muted-foreground">
              {(data?.length ?? 0)} of {ids.length} emails no longer available
            </div>
          )}
          {(data || []).map((m) => {
            const body = toPlainText(m);
            const hit = context ? null : matchQuote(body, quote);
            const link = safeExternalUrl(m.web_link);
            return (
              <div key={m.id} className="rounded border bg-muted/20 p-2 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0 text-xs">
                    <span className="font-medium">{m.from_name || m.from_email || "Unknown sender"}</span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="tabular-nums text-muted-foreground">{fmtDate(m.received_at)}</span>
                  </div>
                  {link && (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Open in Outlook
                    </a>
                  )}
                </div>
                <div className="text-xs font-medium">{m.subject || "(no subject)"}</div>
                {hit && <HitLabel hit={hit} />}
                {quote && !hit && !context && (
                  <div className="border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">
                    "{quote}"
                    <div className="text-[10px] italic">Quote not found in the stored body</div>
                  </div>
                )}
                <MessageBody text={body} hit={hit} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The source behind a suggestion or field value: the email(s) that hold the
 * quote, or the pass reason a person typed. Emails that only share a thread
 * with the deal are shown as context, never as the source.
 */
export function SuggestionEvidencePanel({
  messageIds,
  quote,
  passNote,
  relatedIds,
  defaultOpen = false,
  requireSource = false,
}: {
  messageIds?: string[] | null;
  quote?: string;
  /** Set when the quote is from a pass reason typed in Capital Raise. */
  passNote?: PassNoteSource | null;
  /** The partner's thread about the deal, when no email holds the quote. */
  relatedIds?: string[] | null;
  defaultOpen?: boolean;
  /** Say so when there is nothing to review against, rather than showing nothing. */
  requireSource?: boolean;
}) {
  const ids = (messageIds || []).filter(Boolean);
  const related = (relatedIds || []).filter(Boolean);

  if (!passNote && ids.length === 0) {
    return requireSource ? (
      <div className="text-xs text-amber-700">No source is attached to this suggestion. Do not approve it unchecked.</div>
    ) : null;
  }

  return (
    <div className="space-y-2">
      {passNote && <PassNoteBlock note={passNote} quote={quote} />}
      {passNote ? (
        <PassNoteEmails ids={[...ids, ...related]} quote={quote} note={passNote} defaultOpen={defaultOpen} />
      ) : (
        <EmailList
          ids={ids}
          quote={quote}
          defaultOpen={defaultOpen}
          label={`${ids.length} source email${ids.length > 1 ? "s" : ""}`}
        />
      )}
    </div>
  );
}

/**
 * Emails around a pass reason, checked here rather than trusted: one counts
 * as backing the reason only if it holds the quote (exactly or as the closest
 * sentence). The rest are the related thread, shown collapsed as context.
 */
function PassNoteEmails({
  ids,
  quote,
  note,
  defaultOpen,
}: {
  ids: string[];
  quote?: string;
  note: PassNoteSource;
  defaultOpen: boolean;
}) {
  const unique = [...new Set(ids)];
  const { data, isLoading } = useSuggestionEvidence(unique, unique.length > 0);
  if (unique.length > 0 && isLoading) return <Skeleton className="h-4 w-2/3" />;
  const all = data ?? [];
  const backing = all.filter((m) => matchQuote(toPlainText(m), quote));
  const related = all.filter((m) => !backing.includes(m));

  return (
    <div className="space-y-2">
      {backing.length > 0 ? (
        <EmailList
          ids={backing.map((m) => m.message_id)}
          messages={backing}
          quote={quote}
          defaultOpen={defaultOpen}
          label={`${backing.length} email${backing.length > 1 ? "s" : ""} backing the pass reason`}
        />
      ) : (
        <div className="text-xs text-amber-700">
          No synced email says this. The pass reason {note.typed_by ? `${note.typed_by} typed` : "typed in Capital Raise"} is the only source.
        </div>
      )}
      {related.length > 0 && (
        <EmailList
          ids={related.map((m) => m.message_id)}
          messages={related}
          defaultOpen={false}
          context
          label={`Related thread (${related.length}) · does not contain the quote`}
        />
      )}
    </div>
  );
}
