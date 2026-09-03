import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Save, RefreshCw, Sparkles, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type LearnedRow = {
  id: string;
  content: string;
  example_count: number;
  updated_at: string;
  updated_by: string | null;
};

type Feedback = {
  category: string | null;
  reason_text: string | null;
  snapshot: any;
  created_at: string;
};

export function PartnerLearningPanel() {
  const [row, setRow] = useState<LearnedRow | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: ls }, { data: fb }, { data: { user } }] = await Promise.all([
      (supabase as any).from("learned_partner_strategy").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from("capital_partner_feedback").select("category, reason_text, snapshot, created_at").order("created_at", { ascending: false }).limit(200),
      supabase.auth.getUser(),
    ]);
    setRow(ls as LearnedRow | null);
    setFeedback((fb ?? []) as Feedback[]);
    setDraft(ls?.content ?? "");
    if (user) {
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      setIsAdmin((roles ?? []).some((r: any) => r.role === "admin"));
    }
  };

  useEffect(() => { load(); }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("learn-from-partner-feedback", { body: {} });
      if (error) throw error;
      if (data && data.ok === false) {
        toast.error(data.error ?? "Failed to refresh learning");
        return;
      }
      await load();
      toast.success("Partner learning refreshed");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  };

  const save = async () => {
    if (!row) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("learned_partner_strategy").update({
        content: draft,
        updated_at: new Date().toISOString(),
        updated_by: "manual-edit",
      }).eq("id", row.id);
      if (error) throw error;
      await load();
      setEditing(false);
      toast.success("Partner strategy saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const patterns = useMemo(() => {
    const byCat = new Map<string, number>();
    const byState = new Map<string, number>();
    const byFirm = new Map<string, number>();
    for (const f of feedback) {
      const cat = f.category ?? "Other";
      byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
      const st = f.snapshot?.deal?.state;
      if (st) byState.set(st, (byState.get(st) ?? 0) + 1);
      const ft = f.snapshot?.partner?.firm_type;
      if (ft) byFirm.set(ft, (byFirm.get(ft) ?? 0) + 1);
    }
    const top = (m: Map<string, number>, n = 5) =>
      Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
    return { cats: top(byCat), states: top(byState), firms: top(byFirm), total: feedback.length };
  }, [feedback]);

  return (
    <section className="rounded-[8px] border border-[#E4E7EC] bg-white p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#002752]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5B6472]">
            Capital Partner Learning
          </span>
          {row && (
            <Badge variant="outline" className="ml-2 text-[10px] tabular-nums border-[#E4E7EC] text-[#5B6472]">
              {row.example_count} passes · updated {new Date(row.updated_at).toLocaleDateString()}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="outline"
            onClick={refresh} disabled={refreshing}
            className="h-8 px-3 border-[#E4E7EC] text-[#1A1F2B] shadow-none"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshing && "animate-spin")} />
            Refresh learning
          </Button>
          {isAdmin && !editing && (
            <Button
              size="sm" variant="outline"
              onClick={() => setEditing(true)}
              className="h-8 px-3 border-[#002752] text-[#002752] hover:bg-[#002752] hover:text-white shadow-none"
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      <p className="text-[12px] text-[#5B6472] mb-3 leading-relaxed">
        Distilled from capital partner passes — themes about check size, geography, strategy, pricing and timing.
        Shown as guidance in the partner-matching panel; does <strong>not</strong> change scoring logic.
      </p>

      {editing ? (
        <div className="space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            className="text-[13px] leading-[1.6] bg-[#F7F8FA] font-mono"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setDraft(row?.content ?? ""); setEditing(false); }}>
              <X className="h-3.5 w-3.5 mr-1.5" /> Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="bg-[#002752] hover:bg-[#001a3a] text-white">
              <Save className="h-3.5 w-3.5 mr-1.5" /> Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-[6px] bg-[#F7F8FA] border border-[#E4E7EC] p-4 max-h-[420px] overflow-auto">
          {row?.content ? (
            <pre className="text-[13px] leading-[1.6] text-[#1A1F2B] whitespace-pre-wrap font-sans">{row.content}</pre>
          ) : (
            <p className="text-[12px] text-[#5B6472] italic">
              No partner learning yet. After a few partners pass with categorized reasons, click "Refresh learning" to distill them.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 pt-6 border-t border-[#E4E7EC]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5B6472]">Patterns</span>
          <span className="text-[11px] text-[#5B6472] tabular-nums">{patterns.total} passes analyzed</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PatternList title="Top reasons" rows={patterns.cats} />
          <PatternList title="Markets passed on" rows={patterns.states} />
          <PatternList title="Partner types passing" rows={patterns.firms} />
        </div>
      </div>
    </section>
  );
}

function PatternList({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div className="rounded-[6px] border border-[#E4E7EC] bg-white p-3">
      <div className="text-[10px] uppercase tracking-wider text-[#5B6472] mb-2">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-[#5B6472] italic">No data</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(([key, n]) => (
            <li key={key} className="flex items-center justify-between text-[12px]">
              <span className="text-[#1A1F2B] truncate pr-2">{key}</span>
              <span className="tabular-nums font-semibold text-[#002752]">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
