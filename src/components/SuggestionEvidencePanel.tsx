import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { safeExternalUrl } from "@/lib/safeUrl";
import { useSuggestionEvidence, type EvidenceMessage } from "@/hooks/usePartnerSuggestions";

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
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Locate the quote in the body ignoring whitespace differences. Returns char indices or null. */
function findQuote(body: string, quote: string): [number, number] | null {
  const q = norm(quote);
  if (q.length < 8) return null;
  // Build a map from normalized index -> original index.
  const map: number[] = [];
  let normalized = "";
  let prevSpace = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (/\s/.test(ch)) {
      if (prevSpace || normalized.length === 0) continue;
      normalized += " "; map.push(i); prevSpace = true;
    } else {
      normalized += ch.toLowerCase(); map.push(i); prevSpace = false;
    }
  }
  const at = normalized.indexOf(q);
  if (at < 0) return null;
  const start = map[at];
  const end = (map[at + q.length - 1] ?? body.length - 1) + 1;
  return [start, end];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function MessageBody({ text, quote }: { text: string; quote?: string }) {
  const [full, setFull] = useState(false);
  const hit = quote ? findQuote(text, quote) : null;
  const needsCap = text.length > BODY_CAP && !(hit && hit[1] > BODY_CAP);
  const shown = full || !needsCap ? text : text.slice(0, BODY_CAP) + "…";
  const localHit = quote ? findQuote(shown, quote) : null;

  return (
    <div>
      <div className="whitespace-pre-wrap text-xs leading-relaxed">
        {localHit ? (
          <>
            <span>{shown.slice(0, localHit[0])}</span>
            <mark className="bg-primary/15 text-foreground rounded-sm px-0.5">
              {shown.slice(localHit[0], localHit[1])}
            </mark>
            <span>{shown.slice(localHit[1])}</span>
          </>
        ) : (
          shown
        )}
      </div>
      {needsCap && (
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

export function SuggestionEvidencePanel({
  messageIds,
  quote,
}: {
  messageIds?: string[] | null;
  quote?: string;
}) {
  const ids = (messageIds || []).filter(Boolean);
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useSuggestionEvidence(ids, open);

  if (ids.length === 0) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {ids.length} source email{ids.length > 1 ? "s" : ""}
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
          {(data || []).map((m) => {
            const body = toPlainText(m);
            const found = quote ? !!findQuote(body, quote) : true;
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
                {quote && !found && (
                  <div className="border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">
                    "{quote}"
                    <div className="text-[10px] italic">Quote not found verbatim in the stored body</div>
                  </div>
                )}
                <MessageBody text={body} quote={found ? quote : undefined} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
