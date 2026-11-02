/**
 * Every Atlas suggestion must carry a source a person can check, or it is not
 * filed. Pure: shared by the writers (to refuse) and the inbox (to label).
 *
 * The sources, as they appear in partner_suggestions.evidence:
 * - an email: message_ids (Outlook ids) and the quote from it;
 * - a pass reason typed in Capital Raise: quote_from "pass_notes", the
 *   engagement it was typed on, the notes, and who typed them when;
 * - a partner note: note_ids and the quote from one of them.
 */

export type PassNoteCitation = {
  quote_from: "pass_notes";
  engagement_id: string;
  deal_id?: string | null;
  notes: string;
  typed_by: string | null;
  typed_at: string | null;
};

const nonEmpty = (xs: unknown) => Array.isArray(xs) && xs.some((x) => typeof x === "string" && x.length > 0);

export function hasCitation(evidence: any): boolean {
  if (!evidence || typeof evidence !== "object") return false;
  if (nonEmpty(evidence.message_ids)) return true;
  const quote = typeof evidence.quote === "string" ? evidence.quote.trim() : "";
  if (quote.length < 8) return false;
  if (evidence.quote_from === "pass_notes") return !!evidence.engagement_id && typeof evidence.notes === "string";
  return nonEmpty(evidence.note_ids);
}
