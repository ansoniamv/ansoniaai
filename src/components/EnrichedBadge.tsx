import { Sparkles, Check, X, Lightbulb } from "lucide-react";
import { Link } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SuggestionEvidencePanel } from "@/components/SuggestionEvidencePanel";
import { matchQuote } from "../../supabase/functions/_shared/quoteMatch";
import { readProvenance, isStale, ageLabel, SOURCE_LABEL } from "@/lib/fieldProvenance";
import { userMessage } from "@/lib/errors";

export type EnrichmentSuggestion = {
  value: any;
  source_note_ids?: string[];
  extracted_at?: string;
};

export type EnrichmentMeta = {
  source_note_ids?: string[];
  extracted_at?: string;
  suggested?: EnrichmentSuggestion;
};

export type EnrichedFieldsMap = Record<string, EnrichmentMeta>;

type NoteLite = {
  id: string;
  content: string;
  content_format: string;
  created_at: string;
  author?: string | null;
  team_members?: { full_name?: string | null } | null;
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(note: NoteLite | undefined, id: string): string {
  if (id === "__additional_notes__") return "Imported partner notes";
  if (id === "__organized_notes__") return "Organized notes";
  if (id.startsWith("__interaction_")) return "Interaction note";
  if (!note) return "Note removed";
  const text = note.content_format === "html" ? stripHtml(note.content ?? "") : (note.content ?? "");
  return text.slice(0, 160) + (text.length > 160 ? "…" : "");
}

function formatValue(val: any): string {
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val ?? "");
}

export function EnrichedBadge({
  partnerId,
  fieldKey,
  meta,
  notes,
}: {
  partnerId: string;
  fieldKey: string;
  meta: EnrichmentMeta;
  notes: NoteLite[] | undefined;
}) {
  const qc = useQueryClient();
  const notesById = new Map((notes ?? []).map((n) => [n.id, n]));
  const sourceIds = meta.source_note_ids ?? [];
  const suggested = meta.suggested;

  const accept = async () => {
    const { data: p, error: rErr } = await supabase.from("partners").select("enriched_fields").eq("id", partnerId).single();
    if (rErr) return toast.error(userMessage(rErr, "Could not load this field."));
    const current = (p?.enriched_fields ?? {}) as EnrichedFieldsMap;
    delete current[fieldKey];
    const { data: rows, error } = await supabase.from("partners").update({ enriched_fields: current }).eq("id", partnerId).select("id");
    if (error) return toast.error(userMessage(error, "Could not mark this as reviewed."));
    if (!rows || rows.length === 0) return toast.error("No rows updated — permission denied?");
    toast.success("Marked as reviewed");
    qc.invalidateQueries({ queryKey: ["partners", partnerId] });
    qc.invalidateQueries({ queryKey: ["partners"] });
  };

  const acceptSuggestion = async () => {
    if (!suggested) return;
    const { data: p, error: rErr } = await supabase.from("partners").select("enriched_fields").eq("id", partnerId).single();
    if (rErr) return toast.error(userMessage(rErr, "Could not load this field."));
    const current = (p?.enriched_fields ?? {}) as EnrichedFieldsMap;
    current[fieldKey] = {
      source_note_ids: suggested.source_note_ids ?? [],
      extracted_at: suggested.extracted_at,
    };
    const { data: rows, error } = await supabase
      .from("partners")
      .update({ [fieldKey]: suggested.value, enriched_fields: current } as any)
      .eq("id", partnerId)
      .select("id");
    if (error) return toast.error(userMessage(error, "Could not apply the suggestion."));
    if (!rows || rows.length === 0) return toast.error("No rows updated — permission denied?");
    toast.success("Applied suggested update");
    qc.invalidateQueries({ queryKey: ["partners", partnerId] });
    qc.invalidateQueries({ queryKey: ["partners"] });
  };

  const dismissSuggestion = async () => {
    const { data: p, error: rErr } = await supabase.from("partners").select("enriched_fields").eq("id", partnerId).single();
    if (rErr) return toast.error(userMessage(rErr, "Could not load this field."));
    const current = (p?.enriched_fields ?? {}) as EnrichedFieldsMap;
    const entry = { ...(current[fieldKey] ?? {}) };
    delete entry.suggested;
    if (entry.source_note_ids || entry.extracted_at) current[fieldKey] = entry;
    else delete current[fieldKey];
    const { data: rows, error } = await supabase.from("partners").update({ enriched_fields: current }).eq("id", partnerId).select("id");
    if (error) return toast.error(userMessage(error, "Could not dismiss the suggestion."));
    if (!rows || rows.length === 0) return toast.error("No rows updated — permission denied?");
    toast.success("Suggestion dismissed");
    qc.invalidateQueries({ queryKey: ["partners", partnerId] });
    qc.invalidateQueries({ queryKey: ["partners"] });
  };

  // If the only thing this meta holds is a suggested update on a human value, render the "suggests" pill.
  const isSuggestionOnly = !!suggested && !meta.extracted_at;
  const suggestionSourceIds = suggested?.source_note_ids ?? [];

  return (
    <>
      {!isSuggestionOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-medium uppercase tracking-wide px-1 py-[1px] rounded border border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 cursor-help ml-1 align-middle"
              onClick={(e) => e.stopPropagation()}
            >
              <Sparkles className="h-2.5 w-2.5" />
              from notes
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-500">
              Extracted from notes
            </div>
            {sourceIds.length > 0 ? (
              <ul className="space-y-1.5">
                {sourceIds.slice(0, 4).map((id) => (
                  <li key={id} className="text-xs leading-snug border-l-2 border-amber-400/60 pl-2">
                    {snippet(notesById.get(id), id)}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted-foreground">Source note no longer available.</div>
            )}
            <Button size="sm" variant="secondary" className="h-6 text-[10px] gap-1 w-full" onClick={accept}>
              <Check className="h-3 w-3" /> Accept value
            </Button>
          </TooltipContent>
        </Tooltip>
      )}

      {suggested && (
        <Popover>
          <PopoverTrigger asChild>
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-medium uppercase tracking-wide px-1 py-[1px] rounded border border-sky-400/60 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300 cursor-pointer ml-1 align-middle hover:bg-sky-100 dark:hover:bg-sky-950/50"
              onClick={(e) => e.stopPropagation()}
            >
              <Lightbulb className="h-2.5 w-2.5" />
              notes suggest an update
            </span>
          </PopoverTrigger>
          <PopoverContent side="top" className="max-w-sm space-y-2 text-xs">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-500">
              Notes suggest updating this value
            </div>
            <div className="rounded border border-sky-300/50 bg-sky-50/50 dark:bg-sky-950/20 p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Suggested value</div>
              <div className="font-medium text-foreground">{formatValue(suggested.value)}</div>
            </div>
            {suggestionSourceIds.length > 0 && (
              <ul className="space-y-1.5">
                {suggestionSourceIds.slice(0, 4).map((id) => (
                  <li key={id} className="text-xs leading-snug border-l-2 border-sky-400/60 pl-2">
                    {snippet(notesById.get(id), id)}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="default" className="h-7 text-[10px] gap-1 flex-1" onClick={acceptSuggestion}>
                <Check className="h-3 w-3" /> Accept
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 flex-1" onClick={dismissSuggestion}>
                <X className="h-3 w-3" /> Dismiss
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

function longDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const SOURCE_SENTENCE: Record<string, string> = {
  manual: "Set by hand",
  email: "Set from an Atlas email",
  denial: "Inferred from a pass on a deal",
  notes: "Extracted from partner notes",
  import: "Loaded from an import",
  pass: "Taken from a pass reason typed in Capital Raise",
  unknown: "Source not recorded",
};

/** The partner note a value was taken from, with its author, date and the quote highlighted. */
function NoteSource({ note, id, quote }: { note: NoteLite | undefined; id: string; quote?: string }) {
  if (!note) {
    return (
      <div className="leading-snug border-l-2 border-amber-400/60 pl-2">
        {snippet(note, id)}
        {quote && <div className="italic">“{quote}”</div>}
      </div>
    );
  }
  const text = note.content_format === "html" ? stripHtml(note.content ?? "") : (note.content ?? "");
  const hit = matchQuote(text, quote);
  const author = note.team_members?.full_name ?? note.author ?? null;
  // Keep the popover short: the highlighted sentence with a little context.
  const from = hit ? Math.max(0, hit.start - 160) : 0;
  const to = hit ? Math.min(text.length, hit.end + 160) : Math.min(text.length, 320);
  return (
    <div className="space-y-0.5 border-l-2 border-amber-400/60 pl-2">
      <div className="text-[11px] text-muted-foreground">
        Partner note · {author ? `by ${author}` : "author not recorded"} · {longDate(note.created_at)}
      </div>
      <div className="leading-snug whitespace-pre-wrap">
        {from > 0 && "…"}
        {hit ? (
          <>
            {text.slice(from, hit.start)}
            <mark className="bg-amber-200/70 text-foreground rounded-sm px-0.5 dark:bg-amber-500/30">{text.slice(hit.start, hit.end)}</mark>
            {text.slice(hit.end, to)}
          </>
        ) : text.slice(from, to)}
        {to < text.length && "…"}
      </div>
    </div>
  );
}

/**
 * Quiet "as of" chip: SOURCE · age, amber when the field has decayed past its
 * per-field staleness window. Its popover is the field's citation: the email,
 * pass reason or partner note it came from, or who set it by hand. A filled
 * field with no record at all says so, rather than showing nothing.
 */
export function ProvenanceChip({
  enrichedFields,
  fieldKey,
  notes,
  hasValue = false,
}: {
  enrichedFields: any;
  fieldKey: string;
  notes?: NoteLite[] | undefined;
  /** The field holds a value, so a missing record is worth flagging. */
  hasValue?: boolean;
}) {
  const prov = readProvenance(enrichedFields, fieldKey);
  if (!prov && !hasValue) return null;

  if (!prov) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <span
            className="ml-1 align-middle cursor-pointer text-[10px] uppercase tracking-[0.1em] text-amber-700"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-border mr-1">·</span>
            {SOURCE_LABEL.unknown}
          </span>
        </PopoverTrigger>
        <PopoverContent side="top" className="max-w-sm space-y-2 text-xs">
          <div className="leading-snug">No record of where this value came from.</div>
          <div className="text-muted-foreground">
            It was set before sources were tracked. Confirm it with the partner, then set it by hand so it is cited.
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  const stale = isStale(prov, fieldKey);
  const notesById = new Map((notes ?? []).map((n) => [n.id, n]));
  const lagDays = Math.round(
    (new Date(prov.written_at).getTime() - new Date(prov.as_of).getTime()) / 86_400_000,
  );
  const noteIds = prov.quote_note_id ? [prov.quote_note_id] : (prov.note_ids ?? []).slice(0, 3);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          className={`ml-1 align-middle cursor-pointer text-[10px] uppercase tracking-[0.1em] ${
            stale || prov.source === "unknown" ? "text-amber-700" : "text-muted-foreground/70"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-border mr-1">·</span>
          {SOURCE_LABEL[prov.source]} · {ageLabel(prov.as_of)}
          {stale && " ⚠"}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" className="max-w-sm space-y-2 text-xs">
        <div className="leading-snug">
          {SOURCE_SENTENCE[prov.source] ?? "Set"} · confirmed {longDate(prov.as_of)}
          {prov.set_by ? ` · by ${prov.set_by}` : ""}
        </div>
        {Number.isFinite(lagDays) && lagDays > 1 && (
          <div className="text-muted-foreground">
            Recorded {longDate(prov.written_at)} — {lagDays} days after the fact.
          </div>
        )}
        {stale && (
          <div className="text-amber-700">This value is older than we'd normally trust — worth re-confirming.</div>
        )}
        {prov.source === "unknown" && (
          <div className="text-amber-700">No email, note or pass reason is recorded for this value.</div>
        )}
        {(prov.pass_note || (prov.message_ids && prov.message_ids.length > 0)) && (
          <SuggestionEvidencePanel
            messageIds={prov.message_ids}
            quote={prov.quote}
            passNote={prov.pass_note ? { ...prov.pass_note, deal_id: prov.deal_id } : null}
            relatedIds={prov.related_message_ids}
          />
        )}
        {prov.deal_id && !prov.pass_note && (
          <Link to={`/deals/${prov.deal_id}`} className="text-primary hover:underline block">
            from the pass on this deal
          </Link>
        )}
        {prov.source === "notes" && noteIds.length > 0 && (
          <div className="space-y-1.5">
            {noteIds.map((id) => (
              <NoteSource key={id} id={id} note={notesById.get(id)} quote={id === prov.quote_note_id ? prov.quote : undefined} />
            ))}
          </div>
        )}
        {prov.quote && !prov.message_ids?.length && !prov.pass_note && prov.source !== "notes" && (
          <div className="leading-snug border-l-2 border-amber-400/60 pl-2 italic">“{prov.quote}”</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
