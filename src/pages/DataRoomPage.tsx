import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FileUp,
  Folder,
  Globe,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  brainCanRead,
  briefIsStale,
  categoryLabel,
  changedInSharePoint,
  DATA_ROOM_CATEGORIES,
  getDataRoomFileUrl,
  SHAREPOINT_SITE_LABELS,
  sourceState,
  useAddDataRoomWebsite,
  useAddSharePointSource,
  useBuildDataRoomBrief,
  useCheckBrainSources,
  useDataRoomBrief,
  useDataRoomSources,
  useDeleteDataRoomSource,
  useReprocessDataRoomSource,
  useSaveDataRoomBrief,
  useSaveDataRoomNote,
  useSharePointFolder,
  useSharePointSearch,
  useUpdateDataRoomSource,
  type DataRoomCategory,
  type DataRoomSource,
  type SharePointEntry,
  type SharePointSiteKey,
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
    <div className="w-full space-y-8">
      <header>
        <h1 className="text-2xl font-serif-display">Brain</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Ansonia's SharePoint is the Brain. Ask Atlas searches and reads the Acquisitions and Asset Management sites
          directly, so every deal file, model and report there is already within reach. Add the documents that define
          the firm (strategy, the investor deck, underwriting templates) to the Company Brief, which Ask Atlas, deal
          scoring and the inbox screen read before they judge anything.
          {!isAdmin && " Only admins can change what goes into the brief."}
        </p>
      </header>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Could not load the Brain: {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      <SharePointCard sources={sources} />
      <BriefCard sources={sources} />
      <SourcesCard sources={sources} loading={isLoading} />
    </div>
  );
}

// ------------------------------------------------------------------ SharePoint

const SITES = Object.keys(SHAREPOINT_SITE_LABELS) as SharePointSiteKey[];
const pinKey = (site: string | null, itemId: string | null) => `${site}:${itemId}`;

function SharePointCard({ sources }: { sources: DataRoomSource[] }) {
  const [site, setSite] = useState<SharePointSiteKey>("acquisitions");
  const [path, setPath] = useState("");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const searching = query.trim().length >= 2;

  const folder = useSharePointFolder(site, path);
  const search = useSharePointSearch(query, null);
  const pinned = useMemo(
    () => new Map(sources.filter((s) => s.kind === "sharepoint").map((s) => [pinKey(s.sp_site, s.sp_item_id), s])),
    [sources],
  );

  const openFolder = (s: SharePointSiteKey, p: string) => {
    setSite(s);
    setPath(p);
    setQuery("");
    setInput("");
  };
  const crumbs = path ? path.split("/") : [];
  const active = searching ? search : folder;
  const entries = (searching ? search.data?.results : folder.data?.entries) ?? [];

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Folder className="h-4 w-4" /> SharePoint
          </CardTitle>
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="SharePoint site">
            {SITES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={!searching && site === s}
                onClick={() => openFolder(s, "")}
                className={cn(
                  "rounded px-3 py-1 text-xs transition-colors",
                  !searching && site === s ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {SHAREPOINT_SITE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(input);
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search both sites: a property, “rent roll”, “investor deck”…"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline" disabled={input.trim().length < 2}>
            {search.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
          {searching && (
            <Button type="button" variant="ghost" onClick={() => { setQuery(""); setInput(""); }} aria-label="Clear search">
              <X className="h-4 w-4" />
            </Button>
          )}
        </form>
        {!searching && (
          <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="Folder path">
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => setPath("")}>
              {SHAREPOINT_SITE_LABELS[site]}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                <button
                  type="button"
                  className={cn("hover:text-foreground hover:underline", i === crumbs.length - 1 && "text-foreground font-medium")}
                  onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
                >
                  {c}
                </button>
              </span>
            ))}
          </nav>
        )}
      </CardHeader>
      <CardContent>
        {active.error ? (
          <p className="text-sm text-destructive">
            {active.error instanceof Error ? active.error.message : "Could not reach SharePoint"}
          </p>
        ) : active.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {searching ? `Nothing in SharePoint matches “${query}”.` : "This folder is empty."}
          </p>
        ) : (
          <ul className="max-h-[480px] divide-y overflow-auto rounded-md border">
            {entries.map((e) => (
              <SharePointRow
                key={`${e.site}:${e.item_id}`}
                entry={e}
                showLocation={searching}
                pinned={pinned.get(pinKey(e.site, e.item_id)) ?? null}
                onOpenFolder={() =>
                  openFolder(e.site, [e.folder === "(top level)" ? "" : e.folder, e.name].filter(Boolean).join("/"))
                }
              />
            ))}
          </ul>
        )}
        {searching && !search.isLoading && (search.data?.errors?.length ?? 0) > 0 && (
          <p className="mt-2 text-xs text-amber-600">{search.data?.errors?.join(" · ")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function SharePointRow({
  entry: e,
  showLocation,
  pinned,
  onOpenFolder,
}: {
  entry: SharePointEntry;
  showLocation: boolean;
  pinned: DataRoomSource | null;
  onOpenFolder: () => void;
}) {
  const { isAdmin } = useAuth();
  const add = useAddSharePointSource();
  const isFolder = e.kind === "folder";
  const readable = !isFolder && brainCanRead(e.name);
  const location = `${SHAREPOINT_SITE_LABELS[e.site]}${e.folder && e.folder !== "(top level)" ? ` / ${e.folder}` : ""}`;

  const addToBrain = () =>
    add.mutate(
      { entry: e, category: "other" },
      {
        onSuccess: () => toast.success(`Added “${e.name}”. Reading it now.`),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add the file"),
      },
    );

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <button
        type="button"
        disabled={!isFolder}
        onClick={onOpenFolder}
        className={cn("flex min-w-0 flex-1 items-start gap-2.5 text-left", isFolder && "hover:text-primary")}
      >
        {isFolder ? (
          <Folder className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        ) : (
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm">{e.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {showLocation && `${location} · `}
            {e.modified && `Modified ${new Date(e.modified).toLocaleDateString()}`}
            {e.modified_by && ` by ${e.modified_by}`}
            {isFolder && e.items != null && ` · ${e.items} item${e.items === 1 ? "" : "s"}`}
            {!isFolder && e.size_kb != null && ` · ${e.size_kb >= 1024 ? `${(e.size_kb / 1024).toFixed(1)} MB` : `${e.size_kb} KB`}`}
          </span>
          {e.snippet && <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">{e.snippet}</span>}
        </span>
      </button>
      {pinned ? (
        <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
          <Check className="h-3 w-3" /> In the Brain
        </Badge>
      ) : (
        isAdmin && readable && (
          <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={addToBrain} disabled={add.isPending}>
            {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            {!add.isPending && "Add to Brain"}
          </Button>
        )
      )}
      {e.link && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={e.link}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Open ${e.name} in SharePoint`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent>Open in SharePoint</TooltipContent>
        </Tooltip>
      )}
    </li>
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

const KIND_ICON = { sharepoint: FileText, file: FileUp, website: Globe, note: StickyNote } as const;

/** Re-check SharePoint on open when the last check is older than this. */
const SHAREPOINT_RECHECK_MS = 15 * 60_000;

function SourcesCard({ sources, loading }: { sources: DataRoomSource[]; loading: boolean }) {
  const { isAdmin } = useAuth();
  const [filter, setFilter] = useState<DataRoomCategory | "all">("all");
  const [dialog, setDialog] = useState<null | "website" | { note: DataRoomSource | null }>(null);
  const check = useCheckBrainSources();
  const checkedOnce = useRef(false);

  // Look for SharePoint edits when the page opens, at most every 15 minutes:
  // the check is one Graph lookup per pinned file, and it only flags changes.
  useEffect(() => {
    if (checkedOnce.current || loading) return;
    const pinned = sources.filter((s) => s.kind === "sharepoint");
    if (!pinned.length) return;
    checkedOnce.current = true;
    const oldest = Math.min(...pinned.map((s) => (s.sp_checked_at ? new Date(s.sp_checked_at).getTime() : 0)));
    if (Date.now() - oldest > SHAREPOINT_RECHECK_MS) check.mutate();
  }, [sources, loading, check]);

  const changed = sources.filter(changedInSharePoint).length;
  const runCheck = () =>
    check.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(
          `Checked ${r.checked ?? 0} SharePoint file${r.checked === 1 ? "" : "s"}` +
            (r.missing ? `; ${r.missing} no longer in SharePoint` : ""),
        ),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not check SharePoint"),
    });

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sources) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return m;
  }, [sources]);
  const shown = filter === "all" ? sources : sources.filter((s) => s.category === filter);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">In the Company Brief</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Files added from SharePoint above, plus the website and the team's notes.
            {changed > 0 && ` ${changed} changed in SharePoint since they were read.`}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={runCheck} disabled={check.isPending}>
              {check.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Check SharePoint
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
              ? "Find the investor deck, strategy memos and underwriting templates in SharePoint above and add them, then add the company website."
              : "An admin can add the firm's key SharePoint documents and website."}
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {shown.map((s) => (
              <SourceRow key={s.id} source={s} onEditNote={() => setDialog({ note: s })} />
            ))}
          </ul>
        )}
      </CardContent>

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

  const changed = changedInSharePoint(s);
  const openOriginal = async () => {
    try {
      if (s.kind === "sharepoint" && s.sp_web_url) window.open(s.sp_web_url, "_blank", "noopener");
      else if (s.kind === "website" && s.url) window.open(s.url, "_blank", "noopener");
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
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{s.title}</span>
            {s.kind === "sharepoint" && s.sp_site && (
              <span className="block truncate text-xs text-muted-foreground">
                {SHAREPOINT_SITE_LABELS[s.sp_site]}
                {s.sp_folder && ` / ${s.sp_folder}`}
              </span>
            )}
          </span>
          <Badge variant="secondary" className="shrink-0 font-normal">{categoryLabel(s.category)}</Badge>
          {s.kind === "file" && (
            <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">Uploaded</Badge>
          )}
          {s.sp_missing && <span className="shrink-0 text-xs text-destructive">Not in SharePoint</span>}
          {changed && state !== "reading" && <span className="shrink-0 text-xs text-amber-600">Changed in SharePoint</span>}
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
                <ExternalLink className="h-3.5 w-3.5 mr-2" />{" "}
                {s.kind === "website" ? "Visit site" : s.kind === "sharepoint" ? "Open in SharePoint" : "Open file"}
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
                  <RefreshCw className="h-3.5 w-3.5 mr-2" /> {changed ? "Read the new version" : "Read again"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> {s.kind === "sharepoint" ? "Remove from Brain" : "Delete"}
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
            <AlertDialogTitle>{s.kind === "sharepoint" ? "Remove" : "Delete"} “{s.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {s.kind === "sharepoint"
                ? "Its summary and searchable text are removed from the Brain. The file stays in SharePoint, where Atlas can still find it."
                : `The ${s.kind === "file" ? "file, its" : "source, its"} summary and its searchable text are removed.`}{" "}
              The Company Brief keeps what it learned from it until you rebuild it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                remove.mutate(s, {
                  onSuccess: () => toast.success(s.kind === "sharepoint" ? "Removed from the Brain" : "Source deleted"),
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
        {s.sp_modified && ` · SharePoint version of ${new Date(s.sp_modified).toLocaleString()}`}
        {changedInSharePoint(s) && s.sp_current_modified && ` (edited ${new Date(s.sp_current_modified).toLocaleString()}; read it again to update)`}
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
