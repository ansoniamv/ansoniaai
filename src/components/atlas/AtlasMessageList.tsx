/**
 * The scrolling message column: rows, the thinking state, the inline error row,
 * and the scroll behaviour.
 *
 * Owns two things the old code got wrong:
 *  - Auto-scroll only when the user is already pinned to the bottom. Previously
 *    every new message yanked the view down while you were reading history.
 *  - The scroll target. Radix ScrollArea forwards its ref to the ROOT, which is
 *    overflow-hidden, so the old `ref.scrollTop = ...` silently did nothing.
 *    The scrollable element is the viewport, queried below.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AtlasMessage, AtlasRow, AtlasStreamingMessage } from "@/components/atlas/AtlasMessage";
import { AtlasEmptyState } from "@/components/atlas/AtlasEmptyState";
import type { AtlasMessage as AtlasMessageType } from "@/hooks/useChat";

/** How far from the bottom still counts as "pinned". */
const PIN_THRESHOLD_PX = 200;

function ThinkingRow({ status }: { status?: string | null }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <AtlasRow role="assistant" label="Atlas">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="flex gap-1" aria-hidden>
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        {/*
          A tool round says what it is doing ("Querying deals…"); before the
          first tool call there is nothing to name, so fall back to Thinking…
          with an elapsed counter after 3s rather than looking hung.
        */}
        <span className="tabular-nums">
          {status ?? (elapsed >= 3 ? `Thinking… ${elapsed}s` : "Thinking…")}
        </span>
      </div>
    </AtlasRow>
  );
}

function ErrorRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <AtlasRow role="assistant" label="Atlas">
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm">{message}</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-3 h-7" onClick={onRetry}>
            <RotateCcw className="h-3 w-3 mr-1.5" /> Retry
          </Button>
        )}
      </div>
    </AtlasRow>
  );
}

export function AtlasMessageList({
  messages,
  isPending,
  error,
  onRetry,
  onSuggestion,
  emptyStateColumns = 2,
  streamingText = "",
  streamingStatus,
  stoppedText,
}: {
  messages: AtlasMessageType[];
  isPending: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSuggestion: (prompt: string) => void;
  emptyStateColumns?: 1 | 2;
  /** Live text from the open stream; renders as an assistant row with a caret. */
  streamingText?: string;
  /** "Querying deals…" during a tool round. */
  streamingStatus?: string | null;
  /** Text kept after the user pressed Stop, marked incomplete. */
  stoppedText?: string | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const [pinned, setPinned] = useState(true);

  // Resolve the actual scrollable element once mounted.
  useLayoutEffect(() => {
    viewportRef.current =
      rootRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = viewportRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setPinned(distance < PIN_THRESHOLD_PX);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Only follow new content when the reader is already at the bottom — including
  // during streaming, where every token would otherwise yank the view down.
  useEffect(() => {
    if (pinned) scrollToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isPending, error, streamingText]);

  const isEmpty =
    messages.length === 0 && !isPending && !error && !streamingText && !stoppedText;

  return (
    <div className="relative flex-1 min-h-0" ref={rootRef}>
      <ScrollArea className="h-full">
        <div className="px-4 py-6 max-w-3xl mx-auto space-y-6 pb-4">
          {isEmpty && <AtlasEmptyState onSelect={onSuggestion} columns={emptyStateColumns} />}
          {messages.map((m, i) => (
            <AtlasMessage key={i} message={m} />
          ))}
          {/* Once the first token lands the live row replaces the status row. */}
          {streamingText && <AtlasStreamingMessage text={streamingText} />}
          {stoppedText && <AtlasStreamingMessage text={stoppedText} incomplete />}
          {isPending && !streamingText && <ThinkingRow status={streamingStatus} />}
          {error && <ErrorRow message={error} onRetry={onRetry} />}
        </div>
      </ScrollArea>

      {!pinned && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => scrollToBottom()}
            className="pointer-events-auto h-8 rounded-full border border-border shadow-sm"
          >
            <ArrowDown className="h-3.5 w-3.5 mr-1.5" /> Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}
