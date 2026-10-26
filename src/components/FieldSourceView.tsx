import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { getDealDocumentUrl, type DealDocument } from "@/hooks/useDealDocuments";
import type { FieldSource } from "../../supabase/functions/_shared/fieldSources";

/**
 * What one Key Stats box shows when it is opened: where its figure came from.
 * The entries are deals.field_sources (see supabase/functions/_shared/fieldSources.ts).
 */

/** One figure behind a stat. A computed stat (rent vs market) has several. */
export type SourcedFigure = {
  /** Names the figure when a stat has more than one. */
  name?: string;
  /** The figure as the page formats it. */
  value?: string | null;
  /** A source built on the page (CoStar), used in place of a stored entry. */
  source: FieldSource | null;
};

const fmtDate = (iso: string | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export function FieldSourceView({
  title,
  figures,
  formula,
  documents,
}: {
  title: string;
  figures: SourcedFigure[];
  /** How the stat is worked out from its figures, for a computed stat. */
  formula?: string;
  documents: DealDocument[];
}) {
  return (
    <div className="space-y-3 text-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Source · {title}
      </div>
      {formula && <p className="text-xs text-muted-foreground">{formula}</p>}
      {figures.map((f, i) => (
        <div key={i} className="space-y-1.5">
          {(f.name || f.value) && (
            <div className="flex items-baseline justify-between gap-2 text-xs">
              {f.name && <span className="font-medium">{f.name}</span>}
              {f.value && <span className="tabular-nums">{f.value}</span>}
            </div>
          )}
          <SourceBody source={f.source} documents={documents} />
        </div>
      ))}
    </div>
  );
}

function SourceBody({ source, documents }: { source: FieldSource | null; documents: DealDocument[] }) {
  if (!source) {
    return (
      <p className="text-xs text-muted-foreground">
        No source recorded. Either it was entered or edited by hand, or it was set before sources were
        tracked.
      </p>
    );
  }

  const recorded = fmtDate(source.recorded_at);

  if (source.kind === "document") {
    const doc = source.document_id ? documents.find((d) => d.id === source.document_id) : undefined;
    const open = async () => {
      if (!doc) return;
      try {
        window.open(await getDealDocumentUrl(doc.storage_path), "_blank", "noopener,noreferrer");
      } catch (e) {
        toast.error("Could not open the document: " + (e as Error).message);
      }
    };
    return (
      <div className="space-y-1.5">
        {source.quote && source.quote_verified ? (
          <>
            <blockquote className="border-l-2 border-primary/40 pl-3 font-serif-display text-[15px] leading-snug">
              “{source.quote}”
            </blockquote>
            {/* A computed figure quotes what it was computed from; say how. */}
            {source.note?.startsWith("computed:") && <p className="text-xs">{source.note}</p>}
          </>
        ) : (
          <div className="space-y-1">
            {source.note && <p className="text-xs">{source.note}</p>}
            <p className="text-[11px] text-muted-foreground">
              {source.quote
                ? "The parser's quote was not found word for word in the document's text, so it is not shown as a quote."
                : "No word-for-word quote was recorded. Re-parse the document to get one."}
            </p>
          </div>
        )}
        <div className="text-[11px] text-muted-foreground">
          {[source.label, source.location, source.as_of].filter(Boolean).join(" · ")}
        </div>
        {source.file_name && (
          doc ? (
            <button
              type="button"
              onClick={open}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {source.file_name} <ExternalLink className="h-3 w-3" />
            </button>
          ) : (
            <div className="text-[11px] text-muted-foreground">{source.file_name} (no longer on the deal)</div>
          )
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs">{source.label}</p>
      <div className="text-[11px] text-muted-foreground">
        {[source.provider, recorded && `recorded ${recorded}`].filter(Boolean).join(" · ")}
      </div>
      {source.backfilled && (
        <p className="text-[11px] text-muted-foreground">
          Recorded before sources were tracked, so the exact series and period aren't known.{" "}
          {source.provider === "HelloData"
            ? "Refresh market data to record them."
            : "They are recorded the next time market metrics run for this deal."}
        </p>
      )}
    </div>
  );
}
