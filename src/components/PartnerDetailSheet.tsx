import { SuggestionEvidencePanel } from "@/components/SuggestionEvidencePanel";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Circle,
  Inbox,
  Mail,
  MapPin,
  Phone,
  Pencil,
  Plus,
  Save,
  StickyNote,
  Trash2,
  User2,
  CalendarClock,
  X,
} from "lucide-react";

import { toast } from "sonner";
import { RichTextEditor } from "@/components/RichTextEditor";
import { formatDistanceToNow, format, isPast, isToday } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WarmthBadge } from "@/components/WarmthBadge";
import type { Partner } from "@/hooks/usePartners";
import {
  usePartnerContacts,
  usePartnerInteractions,
  useCreateInteraction,
  useCreatePartnerContact,
  useUpdatePartnerContact,
  useDeletePartnerContact,
  type PartnerContact,
} from "@/hooks/usePartners";

import { useOutlookMessages } from "@/hooks/useOutlook";
import { useNotes } from "@/hooks/useNotes";
import {
  usePartnerTasks,
  useCreatePartnerTask,
  useUpdatePartnerTask,
  useDeletePartnerTask,
  type PartnerTask,
} from "@/hooks/usePartnerTasks";

type TimelineItem = {
  id: string;
  kind: "email" | "note" | "interaction" | "task";
  date: string;
  title: string;
  subtitle?: string;
  body?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  atlas?: boolean;
  factCategory?: string | null;
  sourceMessageIds?: string[] | null;
};

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const Icon = item.icon;
  const date = new Date(item.date);
  const rel = formatDistanceToNow(date, { addSuffix: true });
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`h-7 w-7 rounded-full border flex items-center justify-center shrink-0 ${item.accent}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="w-px flex-1 bg-border mt-1" />
      </div>
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium truncate">{item.title}</span>
          <span className="text-[10px] font-mono text-muted-foreground shrink-0" title={format(date, "PPpp")}>
            {rel}
          </span>
        </div>
        {item.subtitle && (
          <div className="text-[11px] text-muted-foreground truncate">{item.subtitle}</div>
        )}
        {(item.atlas || item.factCategory) && (
          <div className="mt-1 flex items-center gap-2">
            {item.atlas && (
              <span className="rounded border px-1 py-0.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                Atlas
              </span>
            )}
            {item.factCategory && (
              <span className="text-[10px] lowercase text-muted-foreground">{item.factCategory}</span>
            )}
          </div>
        )}
        {item.body && (
          <p className="text-xs text-muted-foreground leading-relaxed mt-1 line-clamp-3">{item.body}</p>
        )}
        {item.atlas && !!item.sourceMessageIds?.length && (
          <div className="mt-1">
            <SuggestionEvidencePanel messageIds={item.sourceMessageIds} />
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete }: {
  task: PartnerTask;
  onToggle: (t: PartnerTask) => void;
  onDelete: (t: PartnerTask) => void;
}) {
  const done = task.status === "done";
  const due = task.due_date ? new Date(task.due_date) : null;
  const overdue = due && !done && isPast(due) && !isToday(due);
  const dueToday = due && !done && isToday(due);
  return (
    <div className="flex items-start gap-2 rounded border bg-card p-2.5 group">
      <button
        onClick={() => onToggle(task)}
        className="mt-0.5 text-muted-foreground hover:text-primary transition-colors"
        aria-label={done ? "Mark open" : "Mark done"}
      >
        {done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${done ? "line-through text-muted-foreground" : "font-medium"}`}>{task.title}</div>
        {task.description && (
          <div className="text-xs text-muted-foreground mt-0.5">{task.description}</div>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {due && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
              overdue ? "border-destructive/40 bg-destructive/10 text-destructive"
              : dueToday ? "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "border-hairline bg-muted text-muted-foreground"
            }`}>
              <CalendarClock className="h-3 w-3" />
              {format(due, "MMM d")}
            </span>
          )}
          {task.priority === "high" && (
            <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">High</Badge>
          )}
          {task.assignee && (
            <span className="text-[10px] text-muted-foreground">@{task.assignee}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onDelete(task)}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1"
        aria-label="Delete task"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function PartnerDetailSheet({
  partner,
  open,
  onOpenChange,
}: {
  partner: Partner | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const partnerId = partner?.id;
  const { data: contacts } = usePartnerContacts(partnerId);
  const { data: interactions } = usePartnerInteractions(partnerId);
  const { data: emails } = useOutlookMessages({ partnerId });
  const { data: notes } = useNotes("partner", partnerId);
  const { data: tasks } = usePartnerTasks(partnerId);
  const createInteraction = useCreateInteraction();
  const createTask = useCreatePartnerTask();
  const updateTask = useUpdatePartnerTask();
  const deleteTask = useDeletePartnerTask();

  const [tab, setTab] = useState("activity");
  const [quickNote, setQuickNote] = useState("");
  const [newTask, setNewTask] = useState({ title: "", due_date: "", priority: "normal", assignee: "" });

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    for (const m of emails ?? []) {
      items.push({
        id: `email-${m.id}`,
        kind: "email",
        date: m.received_at || m.sent_at || new Date().toISOString(),
        title: m.subject || "(no subject)",
        subtitle: `From ${m.from_name || m.from_email || "unknown"}`,
        body: (m as any).preview || undefined,
        icon: Mail,
        accent: "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400",
      });
    }
    for (const n of notes ?? []) {
      items.push({
        id: `note-${n.id}`,
        kind: "note",
        date: n.created_at,
        title: n.author ? `Note by ${n.author}` : "Note",
        body: stripHtml(n.content).slice(0, 240),
        icon: StickyNote,
        accent: "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
      });
    }
    for (const i of interactions ?? []) {
      const isAtlas = i.source === "atlas";
      items.push({
        id: `int-${i.id}`,
        kind: "interaction",
        date: i.interaction_date,
        title: isAtlas && i.interaction_type === "email_fact"
          ? "Fact from email"
          : `${i.interaction_type} · ${i.author ?? "—"}`,
        body: i.content,
        icon: Inbox,
        accent: "bg-muted border-hairline text-muted-foreground",
        atlas: isAtlas,
        factCategory: (i as any).fact_category ?? null,
        sourceMessageIds: (i as any).source_message_ids ?? null,
      });
    }
    for (const t of tasks ?? []) {
      if (t.status !== "done" || !t.completed_at) continue;
      items.push({
        id: `task-${t.id}`,
        kind: "task",
        date: t.completed_at,
        title: `Completed: ${t.title}`,
        icon: CheckCircle2,
        accent: "bg-primary/10 border-primary/30 text-primary",
      });
    }
    return items.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [emails, notes, interactions, tasks]);

  const openTasks = (tasks ?? []).filter((t) => t.status !== "done");
  const doneTasks = (tasks ?? []).filter((t) => t.status === "done");

  const nextTouch = openTasks.find((t) => t.due_date)?.due_date;

  const addNote = () => {
    if (!quickNote.trim() || !partnerId) return;
    createInteraction.mutate(
      { partner_id: partnerId, interaction_type: "note", content: quickNote.trim(), author: "User" },
      {
        onSuccess: () => { setQuickNote(""); toast.success("Note added"); },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const addTask = () => {
    if (!newTask.title.trim() || !partnerId) return;
    createTask.mutate(
      {
        partner_id: partnerId,
        title: newTask.title.trim(),
        due_date: newTask.due_date ? new Date(newTask.due_date).toISOString() : null,
        priority: newTask.priority,
        assignee: newTask.assignee.trim() || null,
      },
      {
        onSuccess: () => {
          setNewTask({ title: "", due_date: "", priority: "normal", assignee: "" });
          toast.success("Task added");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const toggleTask = (t: PartnerTask) => {
    const done = t.status === "done";
    updateTask.mutate({
      id: t.id,
      status: done ? "open" : "done",
      completed_at: done ? null : new Date().toISOString(),
    });
  };

  if (!partner) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col gap-0 overflow-hidden">
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg leading-tight truncate">{partner.name}</SheetTitle>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {partner.firm_type && (
                  <Badge variant="outline" className="text-[10px] font-mono">{partner.firm_type}</Badge>
                )}
                <WarmthBadge strength={partner.relationship_strength} />
                {partner.ansonia_poc && (
                  <span className="text-[11px] text-muted-foreground">
                    <User2 className="inline h-3 w-3 mr-1" />
                    POC: {partner.ansonia_poc}
                  </span>
                )}
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link to={`/partners/${partner.id}`}>
                Full page <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Stat label="Contacts" value={contacts?.length ?? 0} />
            <Stat label="Emails" value={emails?.length ?? 0} />
            <Stat label="Open tasks" value={openTasks.length} tone={openTasks.some((t) => t.due_date && isPast(new Date(t.due_date))) ? "danger" : "default"} />
            <Stat
              label="Next touch"
              value={nextTouch ? format(new Date(nextTouch), "MMM d") : "—"}
              small
            />
          </div>
        </SheetHeader>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-5 mt-3 grid grid-cols-4 h-9">
            <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs">
              Tasks {openTasks.length > 0 && <span className="ml-1 text-[10px] text-primary">({openTasks.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="contacts" className="text-xs">Contacts</TabsTrigger>
            <TabsTrigger value="about" className="text-xs">About</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
            {/* ACTIVITY */}
            <TabsContent value="activity" className="mt-0 space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <RichTextEditor
                    value={quickNote}
                    onChange={setQuickNote}
                    placeholder="Log a quick note…"
                  />
                </div>
                <Button onClick={addNote} disabled={!quickNote.trim()} className="self-end">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div>
                {timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No activity yet. Emails, notes, and completed tasks will appear here.
                  </p>
                ) : (
                  <div>
                    {timeline.map((it) => <TimelineRow key={it.id} item={it} />)}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* TASKS */}
            <TabsContent value="tasks" className="mt-0 space-y-4">
              <div className="rounded border p-3 space-y-2 bg-muted/30">
                <Input
                  placeholder="New task title…"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter" && newTask.title.trim()) addTask(); }}
                  className="h-8 text-sm"
                />
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    type="date"
                    value={newTask.due_date}
                    onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })}
                    className="h-8 text-xs"
                  />
                  <Select value={newTask.priority} onValueChange={(v) => setNewTask({ ...newTask, priority: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Assignee"
                    value={newTask.assignee}
                    onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <Button size="sm" onClick={addTask} disabled={!newTask.title.trim()} className="w-full h-8">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add task
                </Button>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                  Open ({openTasks.length})
                </div>
                <div className="space-y-1.5">
                  {openTasks.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No open tasks. Add one above.</p>
                  )}
                  {openTasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      onToggle={toggleTask}
                      onDelete={(t) => deleteTask.mutate({ id: t.id, partner_id: t.partner_id })}
                    />
                  ))}
                </div>
              </div>

              {doneTasks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    Completed ({doneTasks.length})
                  </div>
                  <div className="space-y-1.5 opacity-70">
                    {doneTasks.slice(0, 20).map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onToggle={toggleTask}
                        onDelete={(t) => deleteTask.mutate({ id: t.id, partner_id: t.partner_id })}
                      />
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* CONTACTS */}
            <TabsContent value="contacts" className="mt-0 space-y-2">
              <ContactsEditor partnerId={partner.id} contacts={contacts ?? []} />
            </TabsContent>


            {/* ABOUT */}
            <TabsContent value="about" className="mt-0 space-y-3 text-sm">
              <AboutRow label="Equity Range" value={
                partner.min_equity_m != null || partner.max_equity_m != null
                  ? `$${partner.min_equity_m ?? "?"}M – $${partner.max_equity_m ?? "?"}M`
                  : "—"
              } />
              <AboutRow label="Investor Type" value={partner.investor_type?.join(", ") || "—"} />
              <AboutRow label="Hold Period" value={partner.hold_period?.join(", ") || "—"} />
              <AboutRow label="Geography" value={partner.geography?.join(", ") || "—"} />
              <AboutRow label="Product Types" value={partner.product_types?.join(", ") || "—"} />
              <Separator />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notes</div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {partner.additional_notes || "No notes on file."}
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, tone = "default", small = false }: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "danger";
  small?: boolean;
}) {
  return (
    <div className="rounded border bg-muted/30 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono tabular-nums ${small ? "text-xs" : "text-sm font-semibold"} ${tone === "danger" ? "text-destructive" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm border-b border-hairline pb-2 last:border-b-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-right truncate">{value}</span>
    </div>
  );
}

type ContactDraft = {
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin_url: string;
  firm_location: string;
};

const EMPTY_DRAFT: ContactDraft = {
  name: "",
  role: "",
  email: "",
  phone: "",
  linkedin_url: "",
  firm_location: "",
};

function ContactsEditor({ partnerId, contacts }: { partnerId: string; contacts: PartnerContact[] }) {
  const create = useCreatePartnerContact();
  const update = useUpdatePartnerContact();
  const del = useDeletePartnerContact();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<ContactDraft>(EMPTY_DRAFT);

  const startEdit = (c: PartnerContact) => {
    setEditingId(c.id);
    setDraft({
      name: c.name ?? "",
      role: c.role ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      linkedin_url: c.linkedin_url ?? "",
      firm_location: c.firm_location ?? "",
    });
  };

  const saveEdit = (id: string) => {
    if (!draft.name.trim()) { toast.error("Name is required"); return; }
    update.mutate(
      {
        id,
        name: draft.name.trim(),
        role: draft.role.trim() || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        linkedin_url: draft.linkedin_url.trim() || null,
        firm_location: draft.firm_location.trim() || null,
      },
      {
        onSuccess: () => { setEditingId(null); toast.success("Contact updated"); },
        onError: (e: any) => toast.error(e.message),
      },
    );
  };

  const saveNew = () => {
    if (!newDraft.name.trim()) { toast.error("Name is required"); return; }
    create.mutate(
      {
        partner_id: partnerId,
        name: newDraft.name.trim(),
        role: newDraft.role.trim() || null,
        email: newDraft.email.trim() || null,
        phone: newDraft.phone.trim() || null,
        linkedin_url: newDraft.linkedin_url.trim() || null,
        firm_location: newDraft.firm_location.trim() || null,
      },
      {
        onSuccess: () => { setNewDraft(EMPTY_DRAFT); setAdding(false); toast.success("Contact added"); },
        onError: (e: any) => toast.error(e.message),
      },
    );
  };

  const removeContact = (c: PartnerContact) => {
    if (!confirm(`Delete contact "${c.name}"?`)) return;
    del.mutate({ id: c.id, partner_id: c.partner_id }, {
      onSuccess: () => toast.success("Contact deleted"),
      onError: (e: any) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-2">
      {contacts.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground text-center py-6">No contacts on file.</p>
      )}

      {contacts.map((c) =>
        editingId === c.id ? (
          <ContactEditForm
            key={c.id}
            draft={draft}
            setDraft={setDraft}
            onSave={() => saveEdit(c.id)}
            onCancel={() => setEditingId(null)}
            saving={update.isPending}
          />
        ) : (
          <div key={c.id} className="flex items-center gap-3 p-2.5 rounded border bg-card group">
            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
              {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {c.name}
                {c.role && <span className="ml-2 text-[11px] font-normal text-muted-foreground">· {c.role}</span>}
              </div>
              <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap">
                {c.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                {c.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
                {c.firm_location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{c.firm_location}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEdit(c)} aria-label="Edit contact">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => removeContact(c)} aria-label="Delete contact">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ),
      )}

      {adding ? (
        <ContactEditForm
          draft={newDraft}
          setDraft={setNewDraft}
          onSave={saveNew}
          onCancel={() => { setAdding(false); setNewDraft(EMPTY_DRAFT); }}
          saving={create.isPending}
        />
      ) : (
        <Button variant="outline" size="sm" className="w-full h-8" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add contact
        </Button>
      )}
    </div>
  );
}

function ContactEditForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  saving,
}: {
  draft: ContactDraft;
  setDraft: (d: ContactDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="rounded border bg-muted/30 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Name *" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-8 text-sm" />
        <Input placeholder="Role / Title" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className="h-8 text-sm" />
        <Input placeholder="Email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="h-8 text-sm" />
        <Input placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="h-8 text-sm" />
        <Input placeholder="LinkedIn URL" value={draft.linkedin_url} onChange={(e) => setDraft({ ...draft, linkedin_url: e.target.value })} className="h-8 text-sm col-span-2" />
        <Input placeholder="Location" value={draft.firm_location} onChange={(e) => setDraft({ ...draft, firm_location: e.target.value })} className="h-8 text-sm col-span-2" />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-7" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancel
        </Button>
        <Button size="sm" className="h-7" onClick={onSave} disabled={saving || !draft.name.trim()}>
          <Save className="h-3.5 w-3.5 mr-1" /> Save
        </Button>
      </div>
    </div>
  );
}


