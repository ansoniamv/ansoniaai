import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Plus, Trash2, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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
import { cn } from "@/lib/utils";
import { AtlasMessageList } from "@/components/atlas/AtlasMessageList";
import { AtlasComposer, type AtlasComposerHandle } from "@/components/atlas/AtlasComposer";
import { relativeTime, threadBucket, THREAD_BUCKET_ORDER } from "@/components/atlas/relativeTime";
import {
  useThreads,
  useThreadMessages,
  useCreateThread,
  useDeleteThread,
  useSendMessage,
  formatModelName,
  type AtlasMessage,
} from "@/hooks/useChat";

export default function ChatPage() {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: threads = [] } = useThreads();
  const createThread = useCreateThread();
  const deleteThread = useDeleteThread();
  const { data: storedMessages = [] } = useThreadMessages(threadId);
  const { send, stop, isStreaming, streamingText, streamingStatus, error, setError, model } =
    useSendMessage();

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<AtlasMessage[]>([]);
  const [lastAttempt, setLastAttempt] = useState<string | null>(null);
  const [stoppedText, setStoppedText] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const composerRef = useRef<AtlasComposerHandle>(null);
  // Captured at the moment Stop is pressed, before the hook clears its state.
  const streamingTextRef = useRef("");

  useEffect(() => {
    if (threadId) return;
    if (threads.length > 0) navigate(`/chat/${threads[0].id}`, { replace: true });
  }, [threadId, threads, navigate]);

  useEffect(() => {
    setPending([]);
  }, [storedMessages.length, threadId]);

  useEffect(() => {
    setError(null);
  }, [threadId, setError]);

  useEffect(() => {
    composerRef.current?.focus();
  }, [threadId, isStreaming]);

  // Consume a prefill from navigation state (e.g. "Ask Atlas" launcher on the Pipeline).
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill;
    if (prefill) {
      setDraft(prefill);
      composerRef.current?.focus();
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const allMessages: AtlasMessage[] = [...storedMessages, ...pending];

  // A thread still called "New conversation" with nothing in it is noise.
  const visibleThreads = useMemo(
    () => threads.filter((t: any) => !(t.title === "New conversation" && !t.updated_at)),
    [threads],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of visibleThreads) {
      const bucket = threadBucket((t as any).updated_at);
      if (!map.has(bucket)) map.set(bucket, []);
      map.get(bucket)!.push(t);
    }
    return THREAD_BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({
      bucket: b,
      items: map.get(b)!,
    }));
  }, [visibleThreads]);

  const handleNewThread = async () => {
    const t = await createThread.mutateAsync();
    setRailOpen(false);
    navigate(`/chat/${t.id}`);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    await deleteThread.mutateAsync(id);
    if (id === threadId) navigate("/chat", { replace: true });
  };

  const submit = async (text: string) => {
    const content = text.trim();
    if (!content || isStreaming) return;
    let activeId = threadId;
    if (!activeId) {
      const t = await createThread.mutateAsync();
      activeId = t.id;
      navigate(`/chat/${t.id}`, { replace: true });
    }
    const userMsg: AtlasMessage = { role: "user", content, created_at: new Date().toISOString() };
    setDraft("");
    setError(null);
    setStoppedText(null);
    setLastAttempt(content);
    setPending([userMsg]);
    try {
      const res = await send({ threadId: activeId!, messages: [...allMessages, userMsg] });
      // A stopped stream keeps its partial text on screen but persists nothing.
      if (res?.aborted) setStoppedText(streamingTextRef.current);
    } catch {
      // Nothing was persisted server-side, so drop the optimistic row. The
      // reason is already in `error` and renders inline; Retry re-sends.
      setPending([]);
    }
  };

  const handleStop = () => {
    streamingTextRef.current = streamingText;
    stop();
  };

  const modelLabel = formatModelName(model);

  const rail = (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-border">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Conversations
        </span>
      </div>
      <div className="px-3 py-3">
        <Button onClick={handleNewThread} className="w-full" size="sm">
          <Plus className="h-4 w-4" /> New chat
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 pb-2">
          {grouped.map(({ bucket, items }) => (
            <div key={bucket}>
              <div className="sticky top-0 z-10 bg-card px-1 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                {bucket}
              </div>
              <div className="space-y-1 pb-2">
                {items.map((t: any) => (
                  <div
                    key={t.id}
                    onClick={() => {
                      setRailOpen(false);
                      navigate(`/chat/${t.id}`);
                    }}
                    className={cn(
                      "group relative flex items-start gap-2 px-3 py-2 rounded-md cursor-pointer hover:bg-accent/40 transition-colors",
                      // A 2px left rule instead of a full-bleed fill, which
                      // swamped the rail.
                      t.id === threadId && "bg-accent/40 border-l-2 border-primary",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm" title={t.title}>
                        {t.title}
                      </div>
                      {t.updated_at && (
                        <div className="text-xs text-muted-foreground">
                          {relativeTime(t.updated_at)}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete({ id: t.id, title: t.title });
                      }}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive transition-opacity mt-0.5"
                      aria-label={`Delete ${t.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {visibleThreads.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">No chats yet.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="flex flex-1 min-h-0 gap-4">
      {/* Thread rail — hidden below sm, where it moves behind the header trigger. */}
      <div className="hidden sm:flex w-72 shrink-0 flex-col border border-border rounded-lg bg-card overflow-hidden">
        {rail}
      </div>

      <div className="flex-1 flex flex-col min-w-0 border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          {/* Same max-w-3xl wrapper as the messages and the composer, so the
              header text starts on the shared left spine rather than the panel edge. */}
          {/* pl-10 matches the message gutter (w-7 + gap-3) so the header text,
              every message body, and the composer share one left edge. */}
          <div className="max-w-3xl mx-auto pl-10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sheet open={railOpen} onOpenChange={setRailOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden shrink-0">
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0 bg-card">
                  {rail}
                </SheetContent>
              </Sheet>
              <div className="min-w-0">
                <h2 className="font-display text-sm font-semibold tracking-tight">Ask Atlas</h2>
                <p className="text-xs text-muted-foreground truncate">
                  Deals, partners, buy box, and market data
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {modelLabel && (
                <Badge variant="secondary" className="font-normal text-xs">
                  {modelLabel}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleNewThread}
                title="New chat"
                aria-label="New chat"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <AtlasMessageList
          messages={allMessages}
          isPending={isStreaming}
          error={error}
          onRetry={() => lastAttempt && submit(lastAttempt)}
          onSuggestion={(p) => submit(p)}
          streamingText={streamingText}
          streamingStatus={streamingStatus}
          stoppedText={stoppedText}
        />

        <AtlasComposer
          ref={composerRef}
          value={draft}
          onChange={setDraft}
          onSend={() => submit(draft)}
          isPending={isStreaming}
          onStop={handleStop}
          showFollowUps={allMessages.length > 0}
          onSuggestion={(p) => submit(p)}
        />
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmDelete?.title}” and all of its messages will be permanently removed. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
