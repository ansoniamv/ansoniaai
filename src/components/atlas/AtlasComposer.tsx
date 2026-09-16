import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AtlasFollowUps } from "@/components/atlas/AtlasEmptyState";

export type AtlasComposerHandle = { focus: () => void };

/**
 * Textarea + send button, pinned to the bottom of whichever panel hosts it.
 *
 * The textarea stays ENABLED while a response is in flight so the next question
 * can be drafted; only the send button is disabled. Locking the whole composer
 * meant waiting out a 20-second tool call before you could type.
 */
export const AtlasComposer = forwardRef<
  AtlasComposerHandle,
  {
    value: string;
    onChange: (v: string) => void;
    onSend: () => void;
    isPending: boolean;
    showFollowUps?: boolean;
    onSuggestion?: (prompt: string) => void;
    /** Aborts the open stream; swaps Send for Stop while one is running. */
    onStop?: () => void;
  }
>(function AtlasComposer(
  { value, onChange, onSend, isPending, showFollowUps = false, onSuggestion, onStop },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  // Auto-grow from one row up to the max-h-40 ceiling, then scroll internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Whitespace-only input is not a message. A stray "/" used to be sent and
  // answered as one.
  const canSend = value.trim().length > 0 && !isPending;

  return (
    <div className="border-t border-border px-4 py-3">
      {/*
        pl-10 = the message row's gutter (w-7 avatar + gap-3), so the composer's
        left edge lands on the same vertical line as every message BODY — the
        spine the acceptance criteria describe. Without it the composer would
        align to the avatar column instead, 2.5rem to the left.
      */}
      <div className="max-w-3xl mx-auto pl-10 space-y-3">
        {showFollowUps && onSuggestion && <AtlasFollowUps onSelect={onSuggestion} />}

        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            placeholder="Ask about deals, partners, or the buy box…"
            rows={1}
            // Overrides the primitive's min-h-[80px]; rows={1} plus the
            // auto-grow effect above set the real height.
            className="min-h-0 max-h-40 resize-none text-sm"
          />
          {isPending && onStop ? (
            <Button
              onClick={onStop}
              size="icon"
              variant="secondary"
              className="shrink-0"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              onClick={onSend}
              disabled={!canSend}
              size="icon"
              className="shrink-0"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
});
