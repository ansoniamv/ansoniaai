import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
  Upload,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  briefIsStale,
  categoryLabel,
  DATA_ROOM_ACCEPT,
  DATA_ROOM_CATEGORIES,
  getDataRoomFileUrl,
  MAX_DATA_ROOM_FILE_BYTES,
  sourceState,
  useAddDataRoomFile,
  useAddDataRoomWebsite,
  useBuildDataRoomBrief,
  useDataRoomBrief,
  useDataRoomSources,
  useDeleteDataRoomSource,
  useReprocessDataRoomSource,
  useSaveDataRoomBrief,
  useSaveDataRoomNote,
  useSearchDataRoom,
  useUpdateDataRoomSource,
  type DataRoomCategory,
  type DataRoomSource,
} from "@/hooks/useDataRoom";
import { AtlasMarkdown } from "@/components/atlas/AtlasMarkdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export default function DataRoomPage() {
  const { isAdmin } = useAuth();
  const { data: sources = [], isLoading, error } = useDataRoomSources();

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-serif-display">Brain</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          What the platform knows about Ansonia: the website, investor deck, pro formas, strategy memos and team
          notes. Each source is read and summarised, and the summaries compile into the Company Brief that Ask Atlas,
          deal scoring and the inbox screen read before they judge anything.
          {!isAdmin && " Only admins can add or change sources."}
        </p>
      </header>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Could not load the Brain: {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      <BriefCard sources={sources} />
      <SourcesCard sources={sources} loading={isLoading} />
      <SearchCard />
    </div>
  );
}

// ------------------------------------------------------------------ brief

function BriefCard({ sources }: { sources: DataRoomSource[] }) {
  const { isAdmin, user } = useAuth();
  const { data: brief, isLoading } = useDataRoomBrief();
  const build = useBuildDataRoomBrief();
  const save = useSaveDataRoomBrief();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const stale = briefIsStale(brief, sources);
  const ready = sources.filter((s) => s.status === "ready" && s.include_in_brief).length;
  const reading = sources.some((s) => sourceState(s) === "reading");

  const rebuild = () =>
    build.mutate(undefined, {
      onSuccess: () => toast.success("Company Brief rebuilt"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not build the brief"),
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4" /> Company Brief
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {brief?.built_at
              ? `Built ${new Date(brief.built_at).toLocaleString()} from ${brief.source_ids.length} source${brief.source_ids.length === 1 ? "" : "s"}` +
                (brief.edited_at ? ` · edited by hand ${new Date(brief.edited_at).toLocaleString()}` : "")
              : "Not built yet. Add sources, then build the brief."}
          </p>
        </div>
        {isAdmin && draft === null && (
          <div className="flex gap-2 shrink-0">
            {brief && (
              <Button variant="outline" size="sm" onClick={() => setDraft(brief.content)}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
              </Button>
            )}
            <Button size="sm" onClick={rebuild} disabled={build.isPending || ready === 0}>
              {build.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              {brief ? "Rebuild" : "Build brief"}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {stale && brief && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Sources have changed since this brief was built{reading ? " (and some are still being read)" : ""}. The AI
              is still reading the version below{isAdmin ? "; rebuild to bring it up to date" : ""}.
              {brief.edited_at && isAdmin && " Rebuilding replaces your hand edits."}
            </span>
          </div>
        )}
        {build.isPending && <p className="text-xs text-muted-foreground">Compiling the brief from {ready} sources. This takes up to a minute.</p>}

        {draft !== null ? (
          <div className="space-y-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[420px] font-mono text-xs" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={save.isPending || !draft.trim()}
                onClick={() =>
                  save.mutate(
                    { content: draft, userId: user?.id },
                    {
                      onSuccess: () => {
                        setDraft(null);
                        toast.success("Brief saved");
                      },
                      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
                    },
                  )
                }
              >
                Save brief
              </Button>
            </div>
          </div>
        ) : isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : brief ? (
          <div>
            <div className={cn("relative overflow-hidden", !expanded && "max-h-80")}>
              <AtlasMarkdown content={brief.content} />
              {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />}
            </div>
            <Button variant="link" size="sm" className="px-0" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : "Show the full brief"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The AI features run on the buy box alone until a brief exists.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ sources

const KIND_ICON = { file: FileText, website: Globe, note: StickyNote } as const;

function SourcesCard({ sources, loading }: { sources: DataRoomSource[]; loading: boolean }) {
  const { isAdmin } = useAuth();
  const [filter, setFilter] = useState<DataRoomCategory | "all">("all");
  const [dialog, setDialog] = useState<null | "upload" | "website" | { note: DataRoomSource | null }>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sources) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return m;
  }, [sources]);
  const shown = filter === "all" ? sources : sources.filter((s) => s.category === filter);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Sources</CardTitle>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog("upload")}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload files
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("website")}>
              <Globe className="h-3.5 w-3.5 mr-1.5" /> Add website
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog({ note: null })}>
              <StickyNote className="h-3.5 w-3.5 mr-1.5" /> Write note
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={sources.length} />
            {DATA_ROOM_CATEGORIES.filter((c) => counts.has(c.value)).map((c) => (
              <FilterChip
                key={c.value}
                active={filter === c.value}
                onClick={() => setFilter(c.value)}
                label={c.label}
                count={counts.get(c.value) ?? 0}
              />
            ))}
          </div>
        )}

        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : sources.length === 0 ? (
          <div className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            Nothing here yet.{" "}
            {isAdmin
              ? "Start with the company website and the investor deck, then add pro formas and anything else that explains how Ansonia invests."
              : "An admin can add the firm's website, decks and pro formas."}
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {shown.map((s) => (
              <SourceRow key={s.id} source={s} onEditNote={() => setDialog({ note: s })} />
            ))}
          </ul>
        )}
      </CardContent>

      <UploadDialog open={dialog === "upload"} onClose={() => setDialog(null)} />
      <WebsiteDialog open={dialog === "website"} onClose={() => setDialog(null)} />
      <NoteDialog
        open={typeof dialog === "object" && dialog !== null}
        note={typeof dialog === "object" && dialog !== null ? dialog.note : null}
        onClose={() => setDialog(null)}
      />
    </Card>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}

function SourceRow({ source: s, onEditNote }: { source: DataRoomSource; onEditNote: () => void }) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateDataRoomSource();
  const reprocess = useReprocessDataRoomSource();
  const remove = useDeleteDataRoomSource();
  const state = sourceState(s);
  const Icon = KIND_ICON[s.kind];

  const openOriginal = async () => {
    try {
      if (s.kind === "website" && s.url) window.open(s.url, "_blank", "noopener");
      else if (s.storage_path) window.open(await getDataRoomFileUrl(s.storage_path), "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the file");
    }
  };
  const reread = () =>
    reprocess.mutate(s.id, { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start reading") });

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{s.title}</span>
          <Badge variant="secondary" className="shrink-0 font-normal">{categoryLabel(s.category)}</Badge>
          {state === "reading" && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Reading…
            </span>
          )}
          {state === "stopped" && <span className="shrink-0 text-xs text-amber-600">Stopped. Read again</span>}
          {state === "failed" && <span className="shrink-0 text-xs text-destructive">Failed</span>}
        </button>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex shrink-0 items-center gap-1.5">
              <Switch
                checked={s.include_in_brief}
                disabled={!isAdmin || update.isPending}
                onCheckedChange={(v) => update.mutate({ id: s.id, include_in_brief: v })}
                aria-label="Include in the Company Brief"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {s.include_in_brief ? "In the Company Brief" : "Left out of the brief (still searchable by Atlas)"}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Source actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {s.kind !== "note" && (
              <DropdownMenuItem onClick={openOriginal}>
                <ExternalLink className="h-3.5 w-3.5 mr-2" /> {s.kind === "website" ? "Visit site" : "Open file"}
              </DropdownMenuItem>
            )}
            {isAdmin && (
              <>
                {s.kind === "note" && (
                  <DropdownMenuItem onClick={onEditNote}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Edit note
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={state === "reading"} onClick={reread}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" /> Read again
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && <SourceDetail source={s} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{s.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The {s.kind === "file" ? "file, its" : "source, its"} summary and its searchable text are removed. The
              Company Brief keeps what it learned from it until you rebuild it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                remove.mutate(s, {
                  onSuccess: () => toast.success("Source deleted"),
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete"),
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function SourceDetail({ source: s }: { source: DataRoomSource }) {
  const { isAdmin } = useAuth();
  const update = useUpdateDataRoomSource();
  const [title, setTitle] = useState(s.title);

  return (
    <div className="mt-3 space-y-3 pl-9 text-sm">
      {s.error && <p className="text-destructive">{s.error}</p>}
      {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}

      {isAdmin && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== s.title && update.mutate({ id: s.id, title: title.trim() })}
              className="h-8"
            />
          </div>
          <div className="w-48">
            <Label className="text-xs">Category</Label>
            <CategorySelect value={s.category} onChange={(category) => update.mutate({ id: s.id, category })} />
          </div>
        </div>
      )}

      {s.kind === "note" && s.body && <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3">{s.body}</p>}
      {s.summary && <AtlasMarkdown content={s.summary} />}
      {s.key_facts?.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Key facts</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {s.key_facts.map((f, i) => (
              <li key={i}>
                {f.fact}
                {f.where && <span className="text-xs text-muted-foreground"> · {f.where}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.pages_read?.length ? (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pages read</p>
          <ul className="space-y-0.5 text-xs">
            {s.pages_read.map((p) => (
              <li key={p.url}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                  {p.title || p.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Added {new Date(s.created_at).toLocaleDateString()}
        {s.processed_at && ` · read ${new Date(s.processed_at).toLocaleString()}`}
        {s.char_count != null && ` · ${s.char_count.toLocaleString()} characters searchable`}
      </p>
    </div>
  );
}

function CategorySelect({ value, onChange }: { value: DataRoomCategory; onChange: (c: DataRoomCategory) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DataRoomCategory)}>
      <SelectTrigger className="h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DATA_ROOM_CATEGORIES.map((c) => (
          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ------------------------------------------------------------------ add dialogs

function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<DataRoomCategory>("other");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const add = useAddDataRoomFile();

  const close = () => {
    setFiles([]);
    setCategory("other");
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    let ok = 0;
    for (const file of files) {
      try {
        await add.mutateAsync({ file, category });
        ok++;
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
    }
    setBusy(false);
    if (ok) toast.success(`${ok} file${ok === 1 ? "" : "s"} added. Reading now.`);
    close();
  };
  const tooBig = files.filter((f) => f.size > MAX_DATA_ROOM_FILE_BYTES);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">PDF, Word, PowerPoint, Excel, CSV or text, up to 50 MB each.</p>
          <div>
            <Label className="text-xs">Category</Label>
            <CategorySelect value={category} onChange={setCategory} />
            <p className="mt-1 text-xs text-muted-foreground">Leave as Other and the AI will pick one.</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={DATA_ROOM_ACCEPT}
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <Button variant="outline" className="w-full" onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> {files.length ? `${files.length} file${files.length === 1 ? "" : "s"} chosen` : "Choose files"}
          </Button>
          {files.length > 0 && (
            <ul className="max-h-40 overflow-auto text-xs text-muted-foreground">
              {files.map((f) => (
                <li key={f.name} className={cn(f.size > MAX_DATA_ROOM_FILE_BYTES && "text-destructive")}>
                  {f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || files.length === 0 || tooBig.length > 0}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add to Brain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WebsiteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<DataRoomCategory>("company");
  const add = useAddDataRoomWebsite();
  const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : url.trim() ? `https://${url.trim()}` : "";
  const valid = (() => {
    try {
      return !!normalized && !!new URL(normalized).hostname.includes(".");
    } catch {
      return false;
    }
  })();

  const close = () => {
    setUrl("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !add.isPending && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a website</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Reads the page you give and up to nine more on the same site, with about, team, strategy and portfolio pages
            first. Read it again any time the site changes.
          </p>
          <div>
            <Label className="text-xs">Address</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ansoniaproperties.com" autoFocus />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <CategorySelect value={category} onChange={setCategory} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={add.isPending}>Cancel</Button>
          <Button
            disabled={!valid || add.isPending}
            onClick={() =>
              add.mutate(
                { url: normalized, category },
                {
                  onSuccess: () => {
                    toast.success("Website added. Reading now.");
                    close();
                  },
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add the website"),
                },
              )
            }
          >
            {add.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add website
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({ open, note, onClose }: { open: boolean; note: DataRoomSource | null; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        {/* Keyed so the form starts from the note being edited each time it opens. */}
        {open && <NoteForm key={note?.id ?? "new"} note={note} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function NoteForm({ note, onClose }: { note: DataRoomSource | null; onClose: () => void }) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [category, setCategory] = useState<DataRoomCategory>(note?.category ?? "strategy");
  const save = useSaveDataRoomNote();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{note ? "Edit note" : "Write a note"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Guidance in the team's own words: what you won't buy and why, how you think about a market, which assumptions
          are firm policy. Notes go into the brief as written.
        </p>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Why we avoid student housing" />
          </div>
          <div className="w-44">
            <Label className="text-xs">Category</Label>
            <CategorySelect value={category} onChange={setCategory} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Note</Label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[220px]" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button
          disabled={!title.trim() || !body.trim() || save.isPending}
          onClick={() =>
            save.mutate(
              { id: note?.id, title: title.trim(), body: body.trim(), category },
              {
                onSuccess: () => {
                  toast.success(note ? "Note updated" : "Note added");
                  onClose();
                },
                onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the note"),
              },
            )
          }
        >
          {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save note
        </Button>
      </DialogFooter>
    </>
  );
}

// ------------------------------------------------------------------ search

function SearchCard() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const { data: hits = [], isFetching, error } = useSearchDataRoom(query);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4" /> Search the Brain
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The same search Ask Atlas uses for detail beyond the brief. All words must match; use OR for alternatives and
          "quotes" for phrases.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(input);
          }}
        >
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="exit cap OR reversion" />
          <Button type="submit" variant="outline" disabled={input.trim().length < 2}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Search failed"}</p>}
        {query.trim().length >= 2 && !isFetching && !error && hits.length === 0 && (
          <p className="text-sm text-muted-foreground">No passages match “{query}”.</p>
        )}
        {hits.length > 0 && (
          <ul className="space-y-2">
            {hits.map((h, i) => (
              <li key={`${h.source_id}-${i}`} className="rounded-md border px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{h.title}</span> · {categoryLabel(h.category)}
                  {h.locator && ` · ${h.locator}`}
                </p>
                <p className="mt-1 text-sm">
                  <Highlighted text={h.headline} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** ts_headline marks matches with <b>…</b>. Split on the markers; React escapes the rest. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(<b>.*?<\/b>)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("<b>") && p.endsWith("</b>") ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 dark:bg-amber-900/50">{p.slice(3, -4)}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
