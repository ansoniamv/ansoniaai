import { useState } from "react";
import { Link } from "react-router-dom";
import { safeExternalUrl } from "@/lib/safeUrl";
import {
  usePartnerSuggestions,
  useApplySuggestion,
  useRejectSuggestion,
  useAnalyzePartnerEmails,
  useUnattributedAtlasMessages,
  useAssignMessagePartner,
  useBulkApproveHighConfidence,
  useComputePartnerWarmth,
  type PartnerSuggestion,
} from "@/hooks/usePartnerSuggestions";
import { usePartners } from "@/hooks/usePartners";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Lock, Sparkles, X, Pencil, Zap, Activity } from "lucide-react";
import { AtlasAutomationCard } from "@/components/AtlasAutomationCard";
import { SuggestionEvidencePanel } from "@/components/SuggestionEvidencePanel";

const TYPE_LABEL: Record<string, string> = {
  warmth_change: "Warmth",
  partner_field: "Partner field",
  avoided_market_add: "Avoided market",
  stage_change: "Raise stage",
  contact_add: "Add contact",
  contact_update: "Update contact",
  partner_add: "Create partner",
  deal_add: "Create deal",
  attach_email: "Attach email chain",
  capital_status_change: "Capital status",
  profile_fact_add: "Profile fact",
};


function fmt(v: any): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fmtDay(d?: string | null): string {
  if (!d) return "";
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function CapitalStatusProposal({ s }: { s: PartnerSuggestion }) {
  const pv: any = s.proposed_value || {};
  const cur: any = s.current_value;
  const current = typeof cur === "object" && cur ? cur.status : cur;
  return (
    <div className="rounded border bg-muted/20 p-3 space-y-1">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Capital status</div>
      <div className="text-sm">
        <span className="text-muted-foreground">{current || "Not established"}</span>
        <span className="mx-2 text-muted-foreground">→</span>
        <span className="font-semibold">{pv.status}</span>
        {pv.available_from && (
          <span className="ml-2 tabular-nums text-xs text-muted-foreground">
            until {fmtDay(pv.available_from)}
          </span>
        )}
      </div>
      {pv.detail && <div className="text-xs italic text-muted-foreground">{pv.detail}</div>}
    </div>
  );
}

function ProfileFactProposal({ s }: { s: PartnerSuggestion }) {
  const pv: any = s.proposed_value || {};
  return (
    <div className="rounded border bg-muted/20 p-3 space-y-1.5">
      <div className="text-sm leading-relaxed">{pv.fact}</div>
      <div className="flex items-center gap-2">
        <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {pv.category || "other"}
        </span>
        {pv.fact_date && (
          <span className="tabular-nums text-[11px] text-muted-foreground">{fmtDay(pv.fact_date)}</span>
        )}
      </div>
    </div>
  );
}


function CreateAttachPreview({ s }: { s: PartnerSuggestion }) {
  const pv: any = s.proposed_value || {};
  if (s.type === "partner_add") {
    const rows: [string, any][] = [
      ["Name", pv.name],
      ["Firm type", pv.firm_type],
      ["Investor type", pv.investor_type],
      ["Geography", pv.geography],
      ["HQ", pv.headquarters],
      ["Website", pv.website],
      ["Warmth", pv.relationship_strength],
      ["Ansonia POC", pv.ansonia_poc],
    ] as [string, any][];
    const shown = rows.filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0) && v !== "");

    return (
      <div className="rounded border border-primary/40 bg-primary/5 p-3 text-xs">
        <div className="text-[10px] uppercase text-primary mb-1">New partner to create</div>
        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
          {shown.map(([k, v]) => (
            <div key={k} className="contents">
              <div className="text-muted-foreground">{k}</div>
              <div className="font-mono break-words">{fmt(v)}</div>
            </div>
          ))}

        </div>
      </div>
    );
  }
  if (s.type === "deal_add") {
    const rows = ([
      ["Property", pv.property_name || pv.name],
      ["Address", pv.address],
      ["City", pv.city],
      ["State", pv.state],
      ["MSA", pv.msa],
      ["Broker", pv.broker],
      ["Units", pv.unit_count],
      ["Vintage", pv.vintage_year],
    ] as [string, any][]).filter(([, v]) => v != null && v !== "");
    return (
      <div className="rounded border border-primary/40 bg-primary/5 p-3 text-xs">
        <div className="text-[10px] uppercase text-primary mb-1">New deal to create</div>
        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <div className="text-muted-foreground">{k}</div>
              <div className="font-mono break-words">{fmt(v)}</div>
            </div>
          ))}

        </div>
      </div>
    );
  }
  // attach_email
  const partnerId = pv.partner_id || s.partner_id;
  const dealId = pv.deal_id || s.deal_id;
  const targets: string[] = [];
  if (partnerId) targets.push("existing partner"); else targets.push("(no partner)");
  if (dealId) targets.push("existing deal");
  const link = safeExternalUrl(pv.web_link);
  return (
    <div className="rounded border border-primary/40 bg-primary/5 p-3 text-xs space-y-2">
      <div className="text-[10px] uppercase text-primary">Attach email chain to {targets.join(" + ")}</div>
      <div>
        {partnerId && (
          <Link to={`/partners/${partnerId}`} className="text-primary hover:underline mr-2">
            → Partner
          </Link>
        )}
        {dealId && (
          <Link to={`/deals/${dealId}`} className="text-primary hover:underline mr-2">
            → Deal
          </Link>
        )}
      </div>
      <div className="font-medium">{pv.subject || "(no subject)"}</div>
      {pv.preview && <div className="text-muted-foreground line-clamp-3">{pv.preview}</div>}
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">
          <ExternalLink className="h-3 w-3" /> Open source email
        </a>
      )}
    </div>
  );
}


function SuggestionCard({ s, partnerName, manualFields }: { s: PartnerSuggestion; partnerName?: string; manualFields: string[] }) {
  const apply = useApplySuggestion();
  const reject = useRejectSuggestion();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState<string>(() =>
    typeof s.proposed_value === "string" ? s.proposed_value : JSON.stringify(s.proposed_value ?? ""),
  );

  const isLocked = !!s.field && manualFields.includes(s.field);

  const submitApprove = async (override = false) => {
    let editedValue: any = undefined;
    if (editing) {
      try {
        editedValue = editValue.trim().startsWith("[") || editValue.trim().startsWith("{")
          ? JSON.parse(editValue)
          : editValue;
      } catch {
        editedValue = editValue;
      }
    }
    const res = await apply.mutateAsync({ suggestion: s, overrideLocked: override, editedValue });
    if (res.ok === true) {
      toast.success("Change applied");
      return;
    }
    const fail = res as Exclude<typeof res, { ok: true }>;
    if (fail.reason === "locked_field") {
      if (window.confirm("This field was set manually and is locked from AI. Override and apply anyway?")) {
        submitApprove(true);
      }
    } else if (fail.reason === "value_changed") {
      toast.error(`Value changed since this suggestion. Live value: ${fmt(fail.liveValue)}`);
    } else if (fail.reason === "error") {
      toast.error(fail.message || "Failed to apply");
    }
  };

  const conf = typeof s.confidence === "number" ? s.confidence : 0;
  const lowConf = conf > 0 && conf < 0.7;
  const pv = (s.proposed_value ?? {}) as any;
  const syncDetected = s.type === "contact_add" && pv?.detected_by === "sync";
  let editedName: string | null = null;
  if (editing) {
    try {
      const parsed = JSON.parse(editValue);
      editedName = typeof parsed?.name === "string" && parsed.name.trim() ? parsed.name.trim() : null;
    } catch { /* free text edit — not a contact payload */ }
  }
  const nameMissing = syncDetected && pv?.name_source === "unknown" && !editedName;
  const alarming =
    s.type === "capital_status_change" &&
    ["Out of Capital", "Constrained"].includes((s.proposed_value as any)?.status);

  return (
    <Card
      className={`mb-3 ${lowConf ? "border-dashed opacity-90" : ""} ${
        alarming ? "border-l-2 border-l-amber-500" : ""
      }`}
    >
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {partnerName && (
                <Link to={`/partners/${s.partner_id}`} className="text-sm font-semibold hover:underline">
                  {partnerName}
                </Link>
              )}
              <Badge variant="secondary" className="text-[10px]">{TYPE_LABEL[s.type] || s.type}</Badge>
              {s.field && <Badge variant="outline" className="text-[10px] font-mono">{s.field}</Badge>}
              {isLocked && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500/60 bg-amber-500/10 text-amber-700">
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
            <div className="mt-1 text-sm">{s.summary}</div>
          </div>
        </div>

        {(s.type === "partner_add" || s.type === "deal_add" || s.type === "attach_email") ? (
          <CreateAttachPreview s={s} />
        ) : s.type === "capital_status_change" && !editing ? (
          <CapitalStatusProposal s={s} />
        ) : s.type === "profile_fact_add" && !editing ? (
          <ProfileFactProposal s={s} />
        ) : (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded border bg-muted/30 p-2">
              <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Current</div>
              <div className="font-mono break-words">{fmt(s.current_value)}</div>
            </div>
            <div className="rounded border border-primary/40 bg-primary/5 p-2">
              <div className="text-[10px] uppercase text-primary mb-0.5">Proposed</div>
              {editing ? (
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="text-xs font-mono h-16"
                />
              ) : (
                <div className="font-mono break-words">{fmt(s.proposed_value)}</div>
              )}
            </div>
          </div>
        )}

        {s.rationale && (
          <div className="text-xs text-muted-foreground italic">{s.rationale}</div>
        )}


        {s.type === "warmth_change" && s.signals && (
          <div className="text-xs rounded bg-muted/40 p-2 space-y-0.5">
            <div className="text-[10px] uppercase text-muted-foreground">Signals</div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span>in: {s.signals.inbound_90d ?? 0}</span>
              <span>out: {s.signals.outbound_90d ?? 0}</span>
              {s.signals.avg_response_hours != null && <span>resp: {Math.round(s.signals.avg_response_hours)}h</span>}
              {s.signals.meetings_scheduled != null && <span>mtgs: {s.signals.meetings_scheduled}</span>}
              {s.signals.deals_engaged != null && <span>deals: {s.signals.deals_engaged}</span>}
            </div>
            {Array.isArray(s.signals.rationale) && (
              <div className="text-muted-foreground italic">{s.signals.rationale.join(" • ")}</div>
            )}
          </div>
        )}

        {s.evidence?.quote && (
          <div className="text-xs border-l-2 border-primary/40 pl-2 text-muted-foreground">
            "{s.evidence.quote}"
          </div>
        )}

        {isLocked && (
          <div className="flex items-center gap-1 text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            This field was set manually. Approving will override the locked value.
          </div>
        )}

        {syncDetected && (
          <div className="space-y-0.5 text-[11px] uppercase tracking-[0.12em]">
            {pv.name_source === "inferred" && (
              <div className="text-amber-700">Name inferred from the email address — verify before approving.</div>
            )}
            {nameMissing && (
              <div className="text-amber-700">Enter a name to approve.</div>
            )}
            {pv.role_source === "signature_heuristic" && (
              <div className="text-muted-foreground">Title read from the signature block — unverified.</div>
            )}
          </div>
        )}

        <SuggestionEvidencePanel messageIds={s.evidence?.message_ids} quote={s.evidence?.quote} />

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => submitApprove(isLocked)} disabled={apply.isPending || nameMissing}>
            <Check className="h-3.5 w-3.5 mr-1" /> Approve
          </Button>

          <Button size="sm" variant="outline" onClick={() => reject.mutate(s.id)} disabled={reject.isPending}>
            <X className="h-3.5 w-3.5 mr-1" /> Reject
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> {editing ? "Cancel edit" : "Edit"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PartnerAssignRow({
  partners,
  value,
  onChange,
  onAssign,
  disabled,
}: {
  partners: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  onAssign: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedPartner = partners.find((p) => p.id === value);
  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-8 text-xs w-72 justify-between font-normal"
          >
            <span className={cn("truncate", !selectedPartner && "text-muted-foreground")}>
              {selectedPartner ? selectedPartner.name : "Assign to partner…"}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0 ml-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search partners…" className="h-9" />
            <CommandList>
              <CommandEmpty>No partners found.</CommandEmpty>
              <CommandGroup>
                {partners.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.name}
                    onSelect={() => {
                      onChange(p.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-3.5 w-3.5", value === p.id ? "opacity-100" : "opacity-0")} />
                    {p.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button size="sm" disabled={disabled} onClick={onAssign}>Assign</Button>
    </div>
  );
}

function UnattributedList() {
  const { data: messages, isLoading } = useUnattributedAtlasMessages();
  const { data: partners } = usePartners();
  const assign = useAssignMessagePartner();
  const [selected, setSelected] = useState<Record<string, string>>({});

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Loading…</div>;
  if (!messages || messages.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">No unattributed Atlas messages.</div>;
  }

  return (
    <div className="space-y-2">
      {messages.map((m: any) => (
        <Card key={m.id}>
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{m.subject || "(no subject)"}</div>
                <div className="text-xs text-muted-foreground">
                  From {m.from_name || m.from_email} • {new Date(m.received_at).toLocaleString()}
                </div>
                {m.preview && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.preview}</div>}
              </div>
              {safeExternalUrl(m.web_link) && (
                <a href={safeExternalUrl(m.web_link)!} target="_blank" rel="noreferrer" className="text-xs text-primary shrink-0">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <PartnerAssignRow
              partners={partners || []}
              value={selected[m.id] || ""}
              onChange={(v) => setSelected((s) => ({ ...s, [m.id]: v }))}
              onAssign={async () => {
                await assign.mutateAsync({ id: m.id, partnerId: selected[m.id] });
                toast.success("Assigned. Re-run analyzer to generate suggestions.");
              }}
              disabled={!selected[m.id] || assign.isPending}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function SuggestionsPage() {
  const [statusTab, setStatusTab] = useState<"pending" | "history" | "unattributed">("pending");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [partnerFilter, setPartnerFilter] = useState<string>("all");
  const [confFilter, setConfFilter] = useState<string>("all");
  const [dealFilter, setDealFilter] = useState<string>("all");

  const { data: partners } = usePartners();
  const partnerMap = new Map((partners || []).map((p) => [p.id, p]));

  const { data: pending } = usePartnerSuggestions({ status: "pending" });
  const { data: history } = usePartnerSuggestions({ limit: 300 });

  const analyze = useAnalyzePartnerEmails();
  const warmth = useComputePartnerWarmth();
  const bulk = useBulkApproveHighConfidence();

  const filterList = (list: PartnerSuggestion[] | undefined) =>
    (list || []).filter((s) => {
      if (typeFilter !== "all" && s.type !== typeFilter) return false;
      if (partnerFilter !== "all" && s.partner_id !== partnerFilter) return false;
      if (confFilter === "high" && (s.confidence ?? 0) < 0.8) return false;
      if (confFilter === "med" && ((s.confidence ?? 0) < 0.6 || (s.confidence ?? 0) >= 0.8)) return false;
      if (confFilter === "low" && (s.confidence ?? 0) >= 0.6) return false;
      if (dealFilter === "linked" && !s.deal_id) return false;
      if (dealFilter === "unlinked" && s.deal_id) return false;
      return true;
    });

  const filteredPending = filterList(pending);
  const filteredHistory = filterList(history).filter((s) => s.status !== "pending");

  const NEW_RECORDS_KEY = "__new_records__";
  const grouped = new Map<string, PartnerSuggestion[]>();
  for (const s of filteredPending) {
    const key = s.partner_id || NEW_RECORDS_KEY;
    const arr = grouped.get(key) || [];
    arr.push(s);
    grouped.set(key, arr);
  }


  const bulkApproveForPartner = async (pid: string) => {
    if (!window.confirm("Approve all high-confidence (≥80%) non-locked suggestions for this partner?")) return;
    const r = await bulk.mutateAsync({ partnerId: pid });
    toast.success(`Applied ${r.applied} of ${r.considered} (${r.failed} skipped)`);
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Atlas Inbox</h1>
          <p className="text-sm text-muted-foreground">
            AI-proposed updates from Atlas emails. Nothing is applied until you approve.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => warmth.mutate({})} disabled={warmth.isPending}>
            <Activity className="h-4 w-4 mr-1" />
            {warmth.isPending ? "Computing…" : "Recompute warmth"}
          </Button>
          <Button onClick={() => analyze.mutate({})} disabled={analyze.isPending}>
            <Sparkles className="h-4 w-4 mr-1" />
            {analyze.isPending ? "Analyzing…" : "Analyze new emails"}
          </Button>
        </div>
      </div>

      <AtlasAutomationCard />


      <div className="flex items-center gap-2 flex-wrap">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={partnerFilter} onValueChange={setPartnerFilter}>
          <SelectTrigger className="w-56 h-8 text-xs"><SelectValue placeholder="All partners" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All partners</SelectItem>
            {(partners || []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={confFilter} onValueChange={setConfFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Confidence" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any confidence</SelectItem>
            <SelectItem value="high">High (≥80%)</SelectItem>
            <SelectItem value="med">Medium (60-80%)</SelectItem>
            <SelectItem value="low">Low (&lt;60%)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dealFilter} onValueChange={setDealFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Deal link" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any deal link</SelectItem>
            <SelectItem value="linked">Deal linked</SelectItem>
            <SelectItem value="unlinked">Unlinked</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({filteredPending.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="unattributed">Unattributed</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="pt-4">
          {grouped.size === 0 && (
            <div className="text-sm text-muted-foreground text-center py-12">
              No pending suggestions. Click "Analyze new emails" to scan the Atlas inbox.
            </div>
          )}
          {[...grouped.entries()].map(([pid, items]) => {
            const isNewRecords = pid === NEW_RECORDS_KEY;
            const p = isNewRecords ? undefined : partnerMap.get(pid);
            const highNonLocked = items.filter(s => (s.confidence ?? 0) >= 0.8 && !(s.field && (p?.manual_fields || []).includes(s.field)));
            return (
              <div key={pid} className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">
                    {isNewRecords ? (
                      <span>New records &amp; email attachments</span>
                    ) : p ? (
                      <Link to={`/partners/${pid}`} className="hover:underline">{p.name}</Link>
                    ) : pid}
                    <span className="text-muted-foreground font-normal ml-2">({items.length})</span>
                  </div>
                  {!isNewRecords && highNonLocked.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => bulkApproveForPartner(pid)} disabled={bulk.isPending}>
                      <Zap className="h-3.5 w-3.5 mr-1" />
                      Approve {highNonLocked.length} high-confidence
                    </Button>
                  )}
                </div>
                {items.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    s={s}
                    partnerName={undefined}
                    manualFields={p?.manual_fields || []}
                  />
                ))}
              </div>
            );
          })}

        </TabsContent>
        <TabsContent value="history" className="pt-4">
          {filteredHistory.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-12">No history yet.</div>
          )}
          {filteredHistory.map((s) => {
            const p = s.partner_id ? partnerMap.get(s.partner_id) : undefined;
            return (
              <Card key={s.id} className="mb-2">
                <CardContent className="py-3 text-sm space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={s.status === "applied" ? "default" : "secondary"} className="text-[10px]">{s.status}</Badge>
                    <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[s.type] || s.type}</Badge>
                    {p && (
                      <Link to={`/partners/${p.id}`} className="text-xs font-semibold hover:underline">{p.name}</Link>
                    )}
                    {s.field && <span className="text-[10px] font-mono text-muted-foreground">{s.field}</span>}
                  </div>
                  <div className="text-xs">{s.summary}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {fmt(s.current_value)} → <span className="text-foreground">{fmt(s.proposed_value)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {s.reviewed_by || "—"} • {s.reviewed_at ? new Date(s.reviewed_at).toLocaleString() : ""}
                  </div>
                  <SuggestionEvidencePanel messageIds={s.evidence?.message_ids} quote={s.evidence?.quote} />
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
        <TabsContent value="unattributed" className="pt-4">
          <UnattributedList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
