// The proof behind a Capital Feed criteria change: the email with the passage
// highlighted, the pass reason someone typed, the partner note or logged call
// it was read from, or who set it by hand. Says so plainly when nothing was
// recorded, so a teammate can tell a sourced change from an unsourced one.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SuggestionEvidencePanel } from "@/components/SuggestionEvidencePanel";
import { supabase } from "@/integrations/supabase/client";
import type { FieldChange, ChangeRef } from "@/lib/partnerFeed";
import { matchQuote } from "../../../supabase/functions/_shared/quoteMatch";

const ADDITIONAL = "__additional_notes__";
const interactionId = (id: string) => id.match(/^__interaction_(.+)__$/)?.[1] ?? null;
const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
/** The notes a change cites: the one holding the quote, else all it names (old stamps use source_note_ids). */
const citedNoteIds = (r: ChangeRef | null | undefined): string[] =>
  r?.quote_note_id ? [r.quote_note_id] : (r?.note_ids ?? r?.source_note_ids ?? []);
const hasSource = (r: ChangeRef | null | undefined) => !!r && (!!r.source || !!r.message_ids?.length || citedNoteIds(r).length > 0);

const day = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? format(d, "MMM d, yyyy") : null;
};

const plain = (html: string) =>
  html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();

type NoteText = { label: string; author: string | null; date: string | null; text: string; message_ids: string[] };

/** The text of every note the changes cite: partner notes, logged calls, and the imported notes field. */
function useCitedNotes(partnerId: string, refs: (ChangeRef | null | undefined)[], enabled: boolean) {
  const ids = [...new Set(refs.flatMap(citedNoteIds))];
  return useQuery({
    queryKey: ["cited_notes", partnerId, ids],
    enabled: enabled && ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const db = supabase as any;
      const noteIds = ids.filter(isUuid);
      const interactionIds = ids.map(interactionId).filter(Boolean) as string[];
      const [notes, interactions, partner] = await Promise.all([
        noteIds.length
          ? db.from("notes").select("id, content, content_format, author, created_at, team_members(full_name)").in("id", noteIds)
          : { data: [] },
        interactionIds.length
          ? db.from("partner_interactions").select("id, content, author, interaction_date, interaction_type, source_message_ids").in("id", interactionIds)
          : { data: [] },
        ids.includes(ADDITIONAL) ? db.from("partners").select("additional_notes").eq("id", partnerId).maybeSingle() : { data: null },
      ]);
      const out = new Map<string, NoteText>();
      for (const n of notes.data ?? []) {
        out.set(n.id, {
          label: "Partner note",
          author: n.team_members?.full_name ?? n.author ?? null,
          date: n.created_at,
          text: n.content_format === "html" ? plain(n.content ?? "") : (n.content ?? ""),
          message_ids: [],
        });
      }
      for (const i of interactions.data ?? []) {
        out.set(`__interaction_${i.id}__`, {
          label: i.interaction_type ? `Logged ${String(i.interaction_type).replace(/_/g, " ")}` : "Logged interaction",
          author: i.author && i.author !== "User" ? i.author : null,
          date: i.interaction_date,
          text: i.content ?? "",
          message_ids: i.source_message_ids ?? [],
        });
      }
      if (partner.data?.additional_notes) {
        out.set(ADDITIONAL, { label: "Imported partner notes (undated)", author: null, date: null, text: plain(partner.data.additional_notes), message_ids: [] });
      }
      return out;
    },
  });
}

function Highlighted({ text, quote }: { text: string; quote?: string }) {
  const hit = matchQuote(text, quote);
  if (!hit) return <div className="whitespace-pre-wrap text-xs leading-relaxed">{text.slice(0, 800)}{text.length > 800 && "…"}</div>;
  const from = Math.max(0, hit.start - 300);
  const to = Math.min(text.length, hit.end + 300);
  return (
    <div className="whitespace-pre-wrap text-xs leading-relaxed">
      {from > 0 && "…"}
      {text.slice(from, hit.start)}
      <mark className="bg-amber-200/70 text-foreground rounded-sm px-0.5 dark:bg-amber-500/30">{text.slice(hit.start, hit.end)}</mark>
      {text.slice(hit.end, to)}
      {to < text.length && "…"}
    </div>
  );
}

function NoteCitation({ id, note, quote }: { id: string; note: NoteText | undefined; quote?: string }) {
  if (!note) {
    return (
      <div className="rounded border bg-muted/20 p-2 text-xs text-muted-foreground">
        The cited note ({id === ADDITIONAL ? "imported partner notes" : "partner note"}) is no longer available.
        {quote && <div className="mt-1 italic text-foreground">“{quote}”</div>}
      </div>
    );
  }
  const d = day(note.date);
  return (
    <div className="space-y-2">
      <div className="rounded border bg-muted/20 p-2 space-y-1">
        <div className="text-xs font-medium">{note.label}</div>
        <div className="text-[11px] text-muted-foreground">
          {note.author ? `By ${note.author}` : "Author not recorded"}{d ? ` · ${d}` : ""}
        </div>
        <Highlighted text={note.text} quote={quote} />
      </div>
      {note.message_ids.length > 0 && (
        <SuggestionEvidencePanel messageIds={note.message_ids} quote={quote} defaultOpen />
      )}
    </div>
  );
}

/** The suggestion field an approved change came from; capital-status companions share capital_status. */
const suggestionField = (field: string) =>
  field === "capital_status_detail" || field === "capital_available_from" ? "capital_status" : field;

/**
 * For approvals logged before sources were copied onto changes: the applied
 * suggestion for the same partner and field, reviewed within ten minutes of
 * the change, still holds its evidence.
 */
function useApprovedSuggestions(partnerId: string, fields: string[], at: string, enabled: boolean) {
  const wanted = [...new Set(fields.map(suggestionField))];
  return useQuery({
    queryKey: ["approved_suggestion_evidence", partnerId, wanted, at],
    enabled: enabled && wanted.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const t = new Date(at).getTime();
      const { data, error } = await (supabase as any)
        .from("partner_suggestions")
        .select("field, evidence, reviewed_by, reviewed_at")
        .eq("partner_id", partnerId)
        .eq("status", "applied")
        .in("field", wanted)
        .gte("reviewed_at", new Date(t - 10 * 60_000).toISOString())
        .lte("reviewed_at", new Date(t + 10 * 60_000).toISOString());
      if (error) throw error;
      const out = new Map<string, ChangeRef>();
      for (const s of data ?? []) {
        if (!s.evidence || out.has(s.field)) continue;
        out.set(s.field, { ...s.evidence, source: s.evidence.quote_from ? "deal_pass" : "email", set_by: s.reviewed_by, written_at: s.reviewed_at });
      }
      return out;
    },
  });
}

function Citation({
  change,
  notes,
  recovered,
  changedBy,
  changeSource,
}: {
  change: FieldChange;
  notes: Map<string, NoteText> | undefined;
  recovered: Map<string, ChangeRef> | undefined;
  changedBy: string | null;
  changeSource?: "user" | "suggestion";
}) {
  const r = hasSource(change.ref) ? change.ref : recovered?.get(suggestionField(change.field));
  if (!r || !hasSource(r)) {
    if (changeSource === "user") {
      return (
        <div className="text-xs text-amber-700">
          Edited by hand{changedBy ? ` by ${changedBy}` : ""}, with no email or note attached. {changedBy ?? "The editor"} is the only source; ask them what it is based on.
        </div>
      );
    }
    return (
      <div className="text-xs text-amber-700">
        Approved from an Atlas suggestion{changedBy ? ` by ${changedBy}` : ""}, but the suggestion's source was not kept with the change.
      </div>
    );
  }
  if (r.quote_from === "pass_notes" || r.message_ids?.length) {
    return (
      <div className="space-y-2">
        <SuggestionEvidencePanel
          messageIds={r.message_ids}
          quote={r.quote}
          passNote={r.quote_from === "pass_notes" ? { notes: r.notes ?? "", typed_by: r.typed_by, typed_at: r.typed_at, deal_id: r.deal_id } : null}
          relatedIds={r.related_message_ids}
          defaultOpen
        />
        {r.set_by && <div className="text-[11px] text-muted-foreground">Approved by {r.set_by}{day(r.written_at) ? ` · ${day(r.written_at)}` : ""}</div>}
      </div>
    );
  }
  if (r.source === "manual") {
    return (
      <div className="text-xs">
        Set by hand{r.set_by ? ` by ${r.set_by}` : ""}{day(r.written_at ?? r.as_of) ? ` on ${day(r.written_at ?? r.as_of)}` : ""}. The person who entered it is the source.
      </div>
    );
  }
  const noteIds = citedNoteIds(r).slice(0, 3);
  if (noteIds.length) {
    return (
      <div className="space-y-2">
        {!r.quote && <div className="text-xs text-amber-700">No quote was saved with this change; the whole note is shown.</div>}
        {noteIds.map((id) => <NoteCitation key={id} id={id} note={notes?.get(id)} quote={id === r.quote_note_id ? r.quote : undefined} />)}
        {r.set_by && <div className="text-[11px] text-muted-foreground">Accepted by {r.set_by}</div>}
      </div>
    );
  }
  if (r.deal_id) {
    return <Link to={`/deals/${r.deal_id}`} className="text-xs text-primary hover:underline">From the pass on this deal</Link>;
  }
  return <div className="text-xs text-amber-700">No source was recorded with this change.</div>;
}

export function ChangeSourceSheet({
  partnerId,
  partnerName,
  headline,
  changes,
  byline,
  at,
  changedBy,
  changeSource,
}: {
  partnerId: string;
  partnerName: string;
  headline: string;
  changes: FieldChange[];
  byline?: string | null;
  at: string;
  changedBy?: string | null;
  changeSource?: "user" | "suggestion";
}) {
  const [open, setOpen] = useState(false);
  const unsourced = changes.filter((c) => !hasSource(c.ref)).map((c) => c.field);
  const approvals = useApprovedSuggestions(partnerId, unsourced, at, open && changeSource === "suggestion");
  const cited = useCitedNotes(partnerId, changes.map((c) => c.ref), open);
  const notes = cited.data;
  const isLoading = cited.isLoading || approvals.isLoading;
  // An approval can still be traced to its suggestion, so only a hand edit
  // with nothing attached is flagged before opening.
  const sourced = changeSource === "suggestion" || changes.some((c) => hasSource(c.ref));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 px-2 text-xs gap-1 ${sourced ? "text-muted-foreground" : "text-amber-700"}`}
          title={sourced ? "See what this change is based on" : "No source recorded for this change"}
        >
          <FileSearch className="h-4 w-4" />
          Source
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-serif text-lg leading-snug">{headline}</SheetTitle>
          <SheetDescription>
            What this change to {partnerName} is based on{byline ? ` · ${byline}` : ""}.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          {changes.map((c) => (
            <section key={c.field} className="space-y-2">
              <div className="text-sm">
                <span className="text-muted-foreground">{c.label}: </span>
                {c.from && <><span className="line-through text-muted-foreground">{c.from}</span><span className="mx-1.5 text-muted-foreground">→</span></>}
                <span className="font-medium">{c.to}</span>
              </div>
              {isLoading ? (
                <Skeleton className="h-4 w-2/3" />
              ) : (
                <Citation change={c} notes={notes} recovered={approvals.data} changedBy={changedBy ?? null} changeSource={changeSource} />
              )}
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
