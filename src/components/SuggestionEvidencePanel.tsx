import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
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

export function SuggestionEvidencePanel({
  messageIds,
  quote,
  notes,
  defaultOpen = false,
  requireSource = false,
}: {
  messageIds?: string[] | null;
  quote?: string;
  /** Set when the quote is from the pass notes typed on a deal, not an email:
   *  the emails are then the partner's thread about that deal. */
  notes?: string | null;
  defaultOpen?: boolean;
  /** Say so when there is nothing to review against, rather than showing nothing. */
  requireSource?: boolean;
}) {
  const ids = (messageIds || []).filter(Boolean);
  const [open, setOpen] = useState(defaultOpen);
  const { data, isLoading, isError } = useSuggestionEvidence(ids, open);
  const fromNotes = notes != null;

  const notesBlock = fromNotes && (
    <div className="rounded border bg-muted/20 p-2 space-y-1">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        Quote is from the pass notes typed on the deal
      </div>
      <MessageBody text={notes} hit={matchQuote(notes, quote)} />
    </div>
  );

  if (ids.length === 0) {
    if (fromNotes) {
      return (
        <div className="space-y-2">
          {notesBlock}
          <div className="text-xs text-amber-700">
            No email about this deal is synced for this partner. The pass notes are the only source.
          </div>
        </div>
      );
    }
    return requireSource ? (
      <div className="text-xs text-amber-700">No source email is attached to this suggestion.</div>
    ) : null;
  }

  return (
    <div className="space-y-2">
      {notesBlock}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {fromNotes
          ? `${ids.length} email${ids.length > 1 ? "s" : ""} about this deal`
          : `${ids.length} source email${ids.length > 1 ? "s" : ""}`}
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
              {(data?.length ?? 0)} of {ids.length} source emails no longer available
            </div>
          )}
          {fromNotes && data && data.length > 0 && !data.some((m) => matchQuote(toPlainText(m), quote)) && (
            <div className="text-xs text-amber-700">
              None of these emails contains the quote. The pass notes are the only source for it.
            </div>
          )}
          {(data || []).map((m) => {
            const body = toPlainText(m);
            const hit = matchQuote(body, quote);
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
                {quote && !hit && !fromNotes && (
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
