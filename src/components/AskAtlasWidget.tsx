import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Sparkles, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AtlasMessageList } from "@/components/atlas/AtlasMessageList";
import { AtlasComposer, type AtlasComposerHandle } from "@/components/atlas/AtlasComposer";
import {
  useCreateThread,
  useSendMessage,
  useThreadMessages,
  formatModelName,
  type AtlasMessage,
} from "@/hooks/useChat";

export function AskAtlasWidget() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<AtlasMessage[]>([]);
  const [lastAttempt, setLastAttempt] = useState<string | null>(null);
  const [stoppedText, setStoppedText] = useState<string | null>(null);
  const composerRef = useRef<AtlasComposerHandle>(null);
  // Captured at the moment Stop is pressed, before the hook clears its state.
  const streamingTextRef = useRef("");

  const navigate = useNavigate();
  const createThread = useCreateThread();
  const { send, stop, isStreaming, streamingText, streamingStatus, error, setError, model } =
    useSendMessage();
  const { data: storedMessages = [] } = useThreadMessages(threadId);

  const all: AtlasMessage[] = [...storedMessages, ...pending];

  useEffect(() => setPending([]), [storedMessages.length, threadId]);

  useEffect(() => {
    if (open) setTimeout(() => composerRef.current?.focus(), 100);
  }, [open]);

  const submit = async (text: string) => {
    const content = text.trim();
    if (!content || isStreaming) return;
    let activeId = threadId;
    if (!activeId) {
      const t = await createThread.mutateAsync();
      activeId = t.id;
      setThreadId(activeId);
    }
    const userMsg: AtlasMessage = { role: "user", content, created_at: new Date().toISOString() };
    setDraft("");
    setError(null);
    setStoppedText(null);
    setLastAttempt(content);
    setPending([userMsg]);
    try {
      const res = await send({ threadId: activeId!, messages: [...all, userMsg] });
      if (res?.aborted) setStoppedText(streamingTextRef.current);
    } catch {
      // Nothing was persisted; the reason is in `error` and renders inline.
      setPending([]);
    }
  };

  const handleStop = () => {
    streamingTextRef.current = streamingText;
    stop();
  };

  const openFullPage = () => {
    setOpen(false);
    navigate(threadId ? `/chat/${threadId}` : "/chat");
  };

  const modelLabel = formatModelName(model);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center ring-2 ring-primary/20"
        aria-label="Ask Atlas"
        title="Ask Atlas (⌘/)"
      >
        <Sparkles className="h-5 w-5" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0">
          <SheetHeader className="px-4 py-3 border-b border-border space-y-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="min-w-0 text-left">
                  <SheetTitle className="font-display text-sm font-semibold tracking-tight">
                    Ask Atlas
                  </SheetTitle>
                  <SheetDescription className="text-xs truncate">
                    Deals, partners, buy box, and market data
                  </SheetDescription>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 mr-6">
                {modelLabel && (
                  <Badge variant="secondary" className="font-normal text-xs">
                    {modelLabel}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={openFullPage}
                  title="Open full page"
                  aria-label="Open full page"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </SheetHeader>

          <AtlasMessageList
            messages={all}
            isPending={isStreaming}
            error={error}
            onRetry={() => lastAttempt && submit(lastAttempt)}
            onSuggestion={(p) => submit(p)}
            emptyStateColumns={1}
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
            showFollowUps={all.length > 0}
            onSuggestion={(p) => submit(p)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
