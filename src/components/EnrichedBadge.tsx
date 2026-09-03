import { Sparkles, Check, X, Lightbulb } from "lucide-react";
import { Link } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SuggestionEvidencePanel } from "@/components/SuggestionEvidencePanel";
import { readProvenance, isStale, ageLabel, SOURCE_LABEL } from "@/lib/fieldProvenance";

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
    if (rErr) return toast.error("Failed to load: " + rErr.message);
    const current = (p?.enriched_fields ?? {}) as EnrichedFieldsMap;
    delete current[fieldKey];
    const { data: rows, error } = await supabase.from("partners").update({ enriched_fields: current }).eq("id", partnerId).select("id");
    if (error) return toast.error("Failed to accept: " + error.message);
    if (!rows || rows.length === 0) return toast.error("No rows updated — permission denied?");
    toast.success("Marked as reviewed");
    qc.invalidateQueries({ queryKey: ["partners", partnerId] });
    qc.invalidateQueries({ queryKey: ["partners"] });
  };

  const acceptSuggestion = async () => {
    if (!suggested) return;
    const { data: p, error: rErr } = await supabase.from("partners").select("enriched_fields").eq("id", partnerId).single();
    if (rErr) return toast.error("Failed to load: " + rErr.message);
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
    if (error) return toast.error("Failed: " + error.message);
    if (!rows || rows.length === 0) return toast.error("No rows updated — permission denied?");
    toast.success("Applied suggested update");
    qc.invalidateQueries({ queryKey: ["partners", partnerId] });
    qc.invalidateQueries({ queryKey: ["partners"] });
  };

  const dismissSuggestion = async () => {
    const { data: p, error: rErr } = await supabase.from("partners").select("enriched_fields").eq("id", partnerId).single();
    if (rErr) return toast.error("Failed to load: " + rErr.message);
    const current = (p?.enriched_fields ?? {}) as EnrichedFieldsMap;
    const entry = { ...(current[fieldKey] ?? {}) };
    delete entry.suggested;
    if (entry.source_note_ids || entry.extracted_at) current[fieldKey] = entry;
    else delete current[fieldKey];
    const { data: rows, error } = await supabase.from("partners").update({ enriched_fields: current }).eq("id", partnerId).select("id");
    if (error) return toast.error("Failed: " + error.message);
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
  notes: "Extracted from notes",
  import: "Loaded from an import",
};

/**
 * Quiet "as of" chip: SOURCE · age, amber when the field has decayed past its
 * per-field staleness window. Renders nothing when we have no provenance —
 * an absent chip honestly means "we don't know when this was set".
 */
export function ProvenanceChip({
  enrichedFields,
  fieldKey,
  notes,
}: {
  enrichedFields: any;
  fieldKey: string;
  notes?: NoteLite[] | undefined;
}) {
  const prov = readProvenance(enrichedFields, fieldKey);
  if (!prov) return null;

  const stale = isStale(prov, fieldKey);
  const notesById = new Map((notes ?? []).map((n) => [n.id, n]));
  const lagDays = Math.round(
    (new Date(prov.written_at).getTime() - new Date(prov.as_of).getTime()) / 86_400_000,
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          className={`ml-1 align-middle cursor-pointer text-[10px] uppercase tracking-[0.1em] ${
            stale ? "text-amber-700" : "text-muted-foreground/70"
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
        {prov.message_ids && prov.message_ids.length > 0 && (
          <SuggestionEvidencePanel messageIds={prov.message_ids} />
        )}
        {prov.deal_id && (
          <Link to={`/deals/${prov.deal_id}`} className="text-primary hover:underline block">
            from the pass on this deal
          </Link>
        )}
        {prov.note_ids && prov.note_ids.length > 0 && (
          <ul className="space-y-1.5">
            {prov.note_ids.slice(0, 4).map((id) => (
              <li key={id} className="leading-snug border-l-2 border-amber-400/60 pl-2">
                {snippet(notesById.get(id), id)}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
