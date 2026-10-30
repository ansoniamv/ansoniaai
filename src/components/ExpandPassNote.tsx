import { useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { notesToHtml } from "@/lib/partnerImport";
import { noteHtmlToText } from "../../supabase/functions/_shared/passNoteExpand";

/**
 * "Expand with AI" under a pass-feedback editor. Analysts write pass notes in a
 * few words; this offers a slightly fuller version (what the partner meant,
 * plus the deal facts that make it concrete) for them to use or ignore. It only
 * ever expands what was typed, so there is nothing to offer on an empty note.
 */
export function ExpandPassNote({
  engagementId,
  note,
  category,
  priceSurmountable,
  onUse,
}: {
  engagementId: string | null | undefined;
  note: string;
  category?: string | null;
  priceSurmountable?: boolean;
  onUse: (html: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  // The expansion and the note it was made from: once the note is edited the
  // expansion no longer describes it, so it stops showing.
  const [offer, setOffer] = useState<{ from: string; text: string } | null>(null);

  const noteText = noteHtmlToText(note);
  if (!engagementId || !noteText) return null;
  const shown = offer && offer.from === note ? offer.text : null;

  const expand = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("expand-pass-note", {
        body: { engagement_id: engagementId, note, category, price_surmountable: priceSurmountable },
      });
      if (error) {
        let msg = "Could not expand the note.";
        try {
          const body = await (error as { context?: Response }).context?.json?.();
          if (typeof body?.error === "string") msg = body.error;
        } catch { /* keep the generic message */ }
        throw new Error(msg);
      }
      const text = typeof data?.expanded === "string" ? data.expanded.trim() : "";
      if (!text) throw new Error("Could not expand the note.");
      setOffer({ from: note, text });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not expand the note.");
    } finally {
      setLoading(false);
    }
  };

  const use = () => {
    if (!shown) return;
    const before = note;
    onUse(notesToHtml(shown));
    setOffer(null);
    toast.success("Expanded note in place", {
      action: { label: "Undo", onClick: () => onUse(before) },
    });
  };

  if (shown) {
    return (
      <div className="rounded-sm border border-primary/30 bg-primary/5 p-2.5 space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> Expanded
        </div>
        <p className="text-sm leading-relaxed">{shown}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setOffer(null)}>
            <X className="h-3.5 w-3.5" /> Dismiss
          </Button>
          <Button type="button" size="sm" className="h-7 text-xs gap-1" onClick={use}>
            <Check className="h-3.5 w-3.5" /> Use this
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 text-xs gap-1 text-muted-foreground"
      onClick={expand}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {loading ? "Expanding…" : "Expand with AI"}
    </Button>
  );
}
