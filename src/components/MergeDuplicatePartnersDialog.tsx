import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowRight, AlertTriangle, Merge, Users } from "lucide-react";
import type { Partner } from "@/hooks/usePartners";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partners: Partner[];
  initialPrimaryId?: string;
  initialDuplicateId?: string;
};

type ChildCounts = {
  contacts: number;
  interactions: number;
  attachments: number;
  engagements: number;
  suggestions: number;
  tasks: number;
  notes: number;
  outlook_messages: number;
};

async function fetchChildCounts(partnerId: string): Promise<ChildCounts> {
  const tables: Array<[keyof ChildCounts, string, Record<string, any>]> = [
    ["contacts", "partner_contacts", { partner_id: partnerId }],
    ["interactions", "partner_interactions", { partner_id: partnerId }],
    ["attachments", "partner_attachments", { partner_id: partnerId }],
    ["engagements", "capital_raise_engagements", { partner_id: partnerId }],
    ["suggestions", "partner_suggestions", { partner_id: partnerId }],
    ["tasks", "partner_tasks", { partner_id: partnerId }],
    ["notes", "notes", { entity_type: "partner", entity_id: partnerId }],
    ["outlook_messages", "outlook_messages", { partner_id: partnerId }],
  ];
  const out: any = {};
  await Promise.all(
    tables.map(async ([k, t, filter]) => {
      let q = supabase.from(t as any).select("id", { count: "exact", head: true });
      Object.entries(filter).forEach(([col, val]) => { q = q.eq(col, val); });
      const { count } = await q;
      out[k] = count ?? 0;
    }),
  );
  return out as ChildCounts;
}

function fieldPreview(primary: Partner | undefined, duplicate: Partner | undefined) {
  if (!primary || !duplicate) return [] as Array<{ label: string; primary: string; duplicate: string; result: string }>;
  const joinArr = (a?: string[] | null) => (a && a.length ? a.join(", ") : "—");
  const or = (a?: boolean | null, b?: boolean | null) => (a || b ? "Yes" : "No");
  const first = (a: any, b: any) => (a == null || a === "" ? b ?? "—" : a);
  const union = (a?: string[] | null, b?: string[] | null) =>
    Array.from(new Set([...(a || []), ...(b || [])])).join(", ") || "—";
  const notes = () => {
    const p = (primary.additional_notes || "").trim();
    const d = (duplicate.additional_notes || "").trim();
    if (!d) return p || "—";
    if (!p) return d;
    return `${p}\n\n--- merged from duplicate ---\n\n${d}`;
  };

  return [
    { label: "Firm type", primary: primary.firm_type || "—", duplicate: duplicate.firm_type || "—", result: first(primary.firm_type, duplicate.firm_type) },
    { label: "Warmth", primary: primary.relationship_strength || "—", duplicate: duplicate.relationship_strength || "—", result: first(primary.relationship_strength, duplicate.relationship_strength) },
    { label: "Headquarters", primary: primary.headquarters || "—", duplicate: duplicate.headquarters || "—", result: first(primary.headquarters, duplicate.headquarters) },
    { label: "Website", primary: primary.website || "—", duplicate: duplicate.website || "—", result: first(primary.website, duplicate.website) },
    { label: "Ansonia POC", primary: primary.ansonia_poc || "—", duplicate: duplicate.ansonia_poc || "—", result: first(primary.ansonia_poc, duplicate.ansonia_poc) },
    { label: "Min equity ($M)", primary: primary.min_equity_m?.toString() ?? "—", duplicate: duplicate.min_equity_m?.toString() ?? "—", result: (primary.min_equity_m ?? duplicate.min_equity_m ?? "—").toString() },
    { label: "Max equity ($M)", primary: primary.max_equity_m?.toString() ?? "—", duplicate: duplicate.max_equity_m?.toString() ?? "—", result: (primary.max_equity_m ?? duplicate.max_equity_m ?? "—").toString() },
    { label: "Investor type", primary: joinArr(primary.investor_type), duplicate: joinArr(duplicate.investor_type), result: union(primary.investor_type, duplicate.investor_type) },
    { label: "Geography", primary: joinArr(primary.geography), duplicate: joinArr(duplicate.geography), result: union(primary.geography, duplicate.geography) },
    { label: "Geography avoid", primary: joinArr(primary.geography_avoid), duplicate: joinArr(duplicate.geography_avoid), result: union(primary.geography_avoid, duplicate.geography_avoid) },
    { label: "Hold period", primary: joinArr(primary.hold_period), duplicate: joinArr(duplicate.hold_period), result: union(primary.hold_period, duplicate.hold_period) },
    { label: "Product types", primary: joinArr(primary.product_types), duplicate: joinArr(duplicate.product_types), result: union(primary.product_types, duplicate.product_types) },
    { label: "Urban infill", primary: primary.urban_infill ? "Yes" : "No", duplicate: duplicate.urban_infill ? "Yes" : "No", result: or(primary.urban_infill, duplicate.urban_infill) },
    { label: "Suburban", primary: primary.suburban ? "Yes" : "No", duplicate: duplicate.suburban ? "Yes" : "No", result: or(primary.suburban, duplicate.suburban) },
    { label: "Value-add", primary: primary.strategy_value_add ? "Yes" : "No", duplicate: duplicate.strategy_value_add ? "Yes" : "No", result: or(primary.strategy_value_add, duplicate.strategy_value_add) },
    { label: "Core+", primary: primary.strategy_core_plus ? "Yes" : "No", duplicate: duplicate.strategy_core_plus ? "Yes" : "No", result: or(primary.strategy_core_plus, duplicate.strategy_core_plus) },
    { label: "Workforce", primary: primary.strategy_workforce ? "Yes" : "No", duplicate: duplicate.strategy_workforce ? "Yes" : "No", result: or(primary.strategy_workforce, duplicate.strategy_workforce) },
    { label: "Affordable", primary: primary.strategy_affordable ? "Yes" : "No", duplicate: duplicate.strategy_affordable ? "Yes" : "No", result: or(primary.strategy_affordable, duplicate.strategy_affordable) },
    { label: "Additional notes", primary: (primary.additional_notes || "—").slice(0, 240), duplicate: (duplicate.additional_notes || "—").slice(0, 240), result: notes().slice(0, 240) },
  ];
}

function PartnerPicker({
  label,
  value,
  onChange,
  partners,
  excludeId,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  partners: Partner[];
  excludeId?: string;
}) {
  const [q, setQ] = useState("");
  const selected = partners.find((p) => p.id === value);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return partners
      .filter((p) => p.id !== excludeId)
      .filter((p) => !query || p.name.toLowerCase().includes(query))
      .slice(0, 20);
  }, [q, partners, excludeId]);

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {selected ? (
        <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
          <div className="min-w-0">
            <div className="font-medium truncate">{selected.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {selected.firm_type || "—"} · {selected.headquarters || "—"}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange("")}>Change</Button>
        </div>
      ) : (
        <>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search partners…" className="h-8" />
          <div className="max-h-40 overflow-auto rounded-md border">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onChange(p.id)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60"
                >
                  <div className="truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {p.firm_type || "—"} · {p.headquarters || "—"}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function MergeDuplicatePartnersDialog({
  open,
  onOpenChange,
  partners,
  initialPrimaryId,
  initialDuplicateId,
}: Props) {
  const queryClient = useQueryClient();
  const [primaryId, setPrimaryId] = useState<string>(initialPrimaryId ?? "");
  const [duplicateId, setDuplicateId] = useState<string>(initialDuplicateId ?? "");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setPrimaryId(initialPrimaryId ?? "");
      setDuplicateId(initialDuplicateId ?? "");
      setConfirmed(false);
    }
  }, [open, initialPrimaryId, initialDuplicateId]);

  const primary = partners.find((p) => p.id === primaryId);
  const duplicate = partners.find((p) => p.id === duplicateId);

  const primaryCounts = useQuery({
    queryKey: ["merge-child-counts", primaryId],
    enabled: !!primaryId && open,
    queryFn: () => fetchChildCounts(primaryId),
  });
  const duplicateCounts = useQuery({
    queryKey: ["merge-child-counts", duplicateId],
    enabled: !!duplicateId && open,
    queryFn: () => fetchChildCounts(duplicateId),
  });

  // Case-insensitive name groups with 2+ members
  const dupeGroups = useMemo(() => {
    const map = new Map<string, Partner[]>();
    partners.forEach((p) => {
      if (p.archived_at) return;
      const key = p.name.trim().toLowerCase();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    });
    return Array.from(map.values())
      .filter((g) => g.length > 1)
      .sort((a, b) => a[0].name.localeCompare(b[0].name));
  }, [partners]);

  const mergeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("merge_partners" as any, {
        _primary_id: primaryId,
        _duplicate_id: duplicateId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(`Merged into "${primary?.name}". Duplicate archived; same-deal engagements combined.`);
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["partner-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["partner-interactions"] });
      queryClient.invalidateQueries({ queryKey: ["capital-raise-engagements"] });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(e?.message || "Merge failed");
    },
  });

  const rows = fieldPreview(primary, duplicate);
  const canMerge = !!primary && !!duplicate && primaryId !== duplicateId && confirmed;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-4 w-4" /> Merge duplicate partners
          </DialogTitle>
          <DialogDescription>
            The primary record is kept. The duplicate is archived and all of its child records
            (contacts, interactions, engagements, notes, attachments, tasks, emails) move to the primary.
            Where both records are engaged on the same deal, the two engagements are combined into one —
            the live stage wins over a pass, dates widen to the earliest first touch and latest last contact,
            and both sets of notes are kept.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto space-y-5 pr-1">
          {dupeGroups.length > 0 && (
            <div className="rounded-md border p-3 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200 mb-2">
                <Users className="h-3.5 w-3.5" /> Possible duplicates by name ({dupeGroups.length})
              </div>
              <div className="space-y-1.5">
                {dupeGroups.slice(0, 8).map((g) => (
                  <div key={g[0].name.toLowerCase()} className="flex items-center gap-2 text-xs">
                    <span className="font-medium">{g[0].name}</span>
                    <Badge variant="outline" className="h-4 text-[10px]">{g.length} records</Badge>
                    {g.length === 2 && (
                      <Button
                        size="sm"
                        variant="link"
                        className="h-auto p-0 text-xs"
                        onClick={() => {
                          // pick older as primary, newer as duplicate
                          const sorted = [...g].sort((a, b) => a.created_at.localeCompare(b.created_at));
                          setPrimaryId(sorted[0].id);
                          setDuplicateId(sorted[1].id);
                        }}
                      >
                        Merge these →
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PartnerPicker
              label="PRIMARY (kept)"
              value={primaryId}
              onChange={(id) => { setPrimaryId(id); setConfirmed(false); }}
              partners={partners}
              excludeId={duplicateId}
            />
            <PartnerPicker
              label="DUPLICATE (folded in & archived)"
              value={duplicateId}
              onChange={(id) => { setDuplicateId(id); setConfirmed(false); }}
              partners={partners}
              excludeId={primaryId}
            />
          </div>

          {primaryId && duplicateId && primaryId === duplicateId && (
            <div className="text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Primary and duplicate must be different partners.
            </div>
          )}

          {primary && duplicate && primaryId !== duplicateId && (
            <>
              <div className="rounded-md border overflow-hidden">
                <div className="grid grid-cols-3 bg-muted/60 text-[11px] font-semibold uppercase tracking-wide">
                  <div className="p-2">Primary</div>
                  <div className="p-2">Duplicate</div>
                  <div className="p-2 flex items-center gap-1"><ArrowRight className="h-3 w-3" /> After merge</div>
                </div>
                <div className="max-h-[280px] overflow-auto text-xs">
                  {rows.map((r) => (
                    <div key={r.label} className="grid grid-cols-3 border-t">
                      <div className="p-2">
                        <div className="text-[10px] uppercase text-muted-foreground">{r.label}</div>
                        <div className="whitespace-pre-wrap break-words">{r.primary}</div>
                      </div>
                      <div className="p-2 border-l">
                        <div className="text-[10px] uppercase text-muted-foreground">{r.label}</div>
                        <div className="whitespace-pre-wrap break-words">{r.duplicate}</div>
                      </div>
                      <div className="p-2 border-l bg-muted/20">
                        <div className="text-[10px] uppercase text-muted-foreground">{r.label}</div>
                        <div className="whitespace-pre-wrap break-words font-medium">{r.result}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border p-3">
                <div className="text-xs font-semibold mb-2">Child records moving to primary</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {([
                    ["Contacts", "contacts"],
                    ["Interactions", "interactions"],
                    ["Engagements", "engagements"],
                    ["Notes", "notes"],
                    ["Attachments", "attachments"],
                    ["Suggestions", "suggestions"],
                    ["Tasks", "tasks"],
                    ["Emails", "outlook_messages"],
                  ] as const).map(([label, key]) => (
                    <div key={key} className="rounded border p-2">
                      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
                      <div className="font-mono">
                        {(duplicateCounts.data?.[key] ?? "…")} moving
                        <span className="text-muted-foreground"> · {(primaryCounts.data?.[key] ?? "…")} existing</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I confirm merging <strong>{duplicate.name}</strong> into <strong>{primary.name}</strong>.
                  The duplicate will be archived and can be restored later, but the child records will
                  remain on the primary.
                </span>
              </label>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canMerge || mergeMutation.isPending}
            onClick={() => mergeMutation.mutate()}
          >
            {mergeMutation.isPending ? "Merging…" : "Merge partners"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
