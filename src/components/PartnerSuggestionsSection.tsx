import { Link } from "react-router-dom";
import { usePartnerSuggestions, useApplySuggestion, useRejectSuggestion, useAnalyzePartnerEmails, type PartnerSuggestion } from "@/hooks/usePartnerSuggestions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Sparkles, Check, X, Lock } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  warmth_change: "Warmth",
  partner_field: "Partner field",
  avoided_market_add: "Avoided market",
  stage_change: "Raise stage",
  contact_add: "New contact",
  contact_update: "Contact update",
};

function fmt(v: any): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ContactProposal({ s }: { s: PartnerSuggestion }) {
  const pv: any = s.proposed_value || {};
  if (s.type === "contact_add") {
    const fields = ["email","phone","role","linkedin_url","firm_location"] as const;
    return (
      <div className="text-xs rounded bg-muted/40 p-2 space-y-0.5">
        <div className="text-sm font-medium">{pv.name}</div>
        {fields.map((f) => pv[f] ? (
          <div key={f}><span className="text-muted-foreground">{f}:</span> <span className="font-mono">{pv[f]}</span></div>
        ) : null)}
      </div>
    );
  }
  // contact_update
  const fills: Record<string, string> = pv.fills || {};
  const changes: Record<string, { old: any; new: string }> = pv.changes || {};
  return (
    <div className="text-xs rounded bg-muted/40 p-2 space-y-1">
      <div className="text-sm font-medium">{pv.contact_name || "Existing contact"}</div>
      {Object.entries(fills).map(([f, v]) => (
        <div key={f}>
          <span className="text-muted-foreground">{f}:</span>{" "}
          <span className="italic text-muted-foreground">was blank</span>
          {" → "}
          <span className="font-mono text-foreground">{v}</span>
        </div>
      ))}
      {Object.entries(changes).map(([f, obj]) => (
        <div key={f}>
          <span className="text-muted-foreground">{f}:</span>{" "}
          <span className="font-mono">{fmt(obj.old)}</span>
          {" → "}
          <span className="font-mono text-foreground">{obj.new}</span>
        </div>
      ))}
    </div>
  );
}

export function PartnerSuggestionsSection({ partnerId, manualFields }: { partnerId: string; manualFields: string[] }) {
  const { data: pending } = usePartnerSuggestions({ partnerId, status: "pending" });
  const apply = useApplySuggestion();
  const reject = useRejectSuggestion();
  const analyze = useAnalyzePartnerEmails();

  const handleApprove = async (s: PartnerSuggestion, override = false) => {
    const res = await apply.mutateAsync({ suggestion: s, overrideLocked: override });
    if (res.ok === true) { toast.success("Applied"); return; }
    const fail = res as Exclude<typeof res, { ok: true }>;
    if (fail.reason === "locked_field") {
      if (window.confirm("This field is locked (set manually). Override?")) handleApprove(s, true);
    } else if (fail.reason === "value_changed") {
      toast.error(`Value changed since suggestion. Live: ${fmt(fail.liveValue)}`);
    } else if (fail.reason === "error") {
      toast.error(fail.message || "Failed");
    }
  };

  if (!pending) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">
          Suggested Changes {pending.length > 0 && <Badge variant="secondary" className="ml-1">{pending.length}</Badge>}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => analyze.mutate({ partner_id: partnerId })} disabled={analyze.isPending}>
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            {analyze.isPending ? "Analyzing…" : "Analyze"}
          </Button>
          <Link to="/suggestions" className="text-xs text-primary hover:underline">View all</Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.length === 0 && (
          <div className="text-xs text-muted-foreground">No pending suggestions for this partner.</div>
        )}
        {pending.map((s) => {
          const locked = !!s.field && manualFields.includes(s.field);
          const conf = typeof s.confidence === "number" ? s.confidence : 0;
          const lowConf = conf > 0 && conf < 0.7;
          return (
            <div key={s.id} className={`border rounded p-3 space-y-2 ${lowConf ? "border-dashed opacity-90 bg-muted/20" : ""}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-[10px]">{TYPE_LABEL[s.type] || s.type}</Badge>
                {s.field && <Badge variant="outline" className="text-[10px] font-mono">{s.field}</Badge>}
                {locked && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/60 bg-amber-500/10 text-amber-700">
                    <Lock className="h-3 w-3" /> locked
                  </span>
                )}
                {typeof s.confidence === "number" && (
                  <span className={`text-[10px] ${lowConf ? "text-amber-700" : "text-muted-foreground"}`}>
                    {Math.round(s.confidence * 100)}% conf
                  </span>
                )}
                {s.type === "stage_change" && s.deal_id && (
                  <Badge variant="outline" className="text-[10px]">deal linked</Badge>
                )}
              </div>
              <div className="text-sm">{s.summary}</div>
              {(s.type === "contact_add" || s.type === "contact_update") ? (
                <ContactProposal s={s} />
              ) : (
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{fmt(s.current_value)}</span>
                  {" → "}
                  <span className="font-mono text-foreground">{fmt(s.proposed_value)}</span>
                </div>
              )}
              {s.rationale && <div className="text-xs italic text-muted-foreground">{s.rationale}</div>}
              {s.type === "warmth_change" && s.signals && (
                <div className="text-[11px] rounded bg-muted/40 p-2 space-y-0.5">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>in: {s.signals.inbound_90d ?? 0}</span>
                    <span>out: {s.signals.outbound_90d ?? 0}</span>
                    {s.signals.avg_response_hours != null && <span>resp: {Math.round(s.signals.avg_response_hours)}h</span>}
                    {s.signals.meetings_scheduled != null && <span>mtgs: {s.signals.meetings_scheduled}</span>}
                  </div>
                  {Array.isArray(s.signals.rationale) && (
                    <div className="text-muted-foreground">{s.signals.rationale.join(" • ")}</div>
                  )}
                </div>
              )}
              {s.evidence?.quote && (
                <div className="text-xs border-l-2 border-primary/40 pl-2 text-muted-foreground">"{s.evidence.quote}"</div>
              )}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => handleApprove(s, locked)} disabled={apply.isPending}>
                  <Check className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => reject.mutate(s.id)} disabled={reject.isPending}>
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
