// What led to a partner change: the quote from the note, the source email, or
// the deal pass. Renders nothing when the change carries no reference.
import { Link } from "react-router-dom";
import { SuggestionEvidencePanel } from "@/components/SuggestionEvidencePanel";
import type { ChangeRef } from "@/lib/partnerFeed";

function noteLabel(id: string | undefined): string {
  if (id === "__additional_notes__") return "imported partner notes (undated)";
  if (id?.startsWith("__interaction_")) return "partner note";
  return "note";
}

const shortDate = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
};

export function ChangeSourceRef({ refInfo }: { refInfo: ChangeRef | null | undefined }) {
  if (!refInfo) return null;
  const { quote, quote_note_id, quote_note_date, note_ids, message_ids, deal_id } = refInfo;
  const hasEmail = !!message_ids?.length;
  if (!quote && !hasEmail && !deal_id && !note_ids?.length) return null;
  const date = shortDate(quote_note_date);

  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      {quote && (
        <div className="border-l-2 border-hairline pl-2 leading-snug">
          <span className="italic">“{quote}”</span>
          <span className="whitespace-nowrap"> from {noteLabel(quote_note_id)}{date ? `, ${date}` : ""}</span>
        </div>
      )}
      {!quote && !hasEmail && !deal_id && (
        <div>From {noteLabel(note_ids![0])}; no quote was saved for this change.</div>
      )}
      {hasEmail && <SuggestionEvidencePanel messageIds={message_ids} quote={quote} />}
      {deal_id && (
        <Link to={`/deals/${deal_id}`} className="text-primary hover:underline">
          From the pass on this deal
        </Link>
      )}
    </div>
  );
}
