/**
 * One message row, shared by the full page and the docked widget.
 *
 * Both roles render LEFT-ALIGNED in a single column. That is the whole point of
 * the layout: markdown tables get the full column width, and the body's left
 * edge is identical for user and assistant, which makes one vertical spine that
 * the header text and the composer also sit on. Opposing chat bubbles would
 * break that spine and halve the width available to a table.
 */
import { useState } from "react";
import { Bot, User as UserIcon, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AtlasMarkdown } from "@/components/atlas/AtlasMarkdown";
import type { AtlasMessage as AtlasMessageType } from "@/hooks/useChat";
import { relativeTime } from "@/components/atlas/relativeTime";

export function AtlasAvatar({ role }: { role: "user" | "assistant" }) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "h-7 w-7 rounded-full flex items-center justify-center shrink-0",
        isUser ? "bg-secondary text-secondary-foreground" : "bg-primary/10 text-primary",
      )}
    >
      {isUser ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
    </div>
  );
}

/** The 2-column shell every row uses: fixed w-7 gutter, then the body. */
export function AtlasRow({
  role,
  label,
  timestamp,
  action,
  children,
}: {
  role: "user" | "assistant";
  label: string;
  timestamp?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="group grid grid-cols-[1.75rem_1fr] gap-3">
      <AtlasAvatar role={role} />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span className="flex items-center gap-1">
            {action}
            {timestamp && (
              <span className="text-xs text-muted-foreground/70 tabular-nums">{timestamp}</span>
            )}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Copy message"
      className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      onClick={() => {
        // Copies the raw markdown, not the rendered text — pasting into a doc
        // should keep the table.
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

export function AtlasMessage({ message }: { message: AtlasMessageType }) {
  const isUser = message.role === "user";
  const timestamp = message.created_at ? relativeTime(message.created_at) : undefined;

  if (isUser) {
    return (
      <AtlasRow role="user" label="You" timestamp={timestamp}>
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </AtlasRow>
    );
  }

  return (
    <AtlasRow
      role="assistant"
      label="Atlas"
      timestamp={timestamp}
      action={<CopyButton text={message.content} />}
    >
      {/*
        No background fill and no border on the assistant body — the distinction
        between roles is the subtle card on the USER's message, not colour on
        ours. Answers read as prose on the canvas.
      */}
      <AtlasMarkdown content={message.content} />
    </AtlasRow>
  );
}

/** The in-flight answer: same row, live markdown, blinking caret. */
export function AtlasStreamingMessage({
  text,
  incomplete = false,
}: {
  text: string;
  /** Set when the user pressed Stop — the text stands but is flagged. */
  incomplete?: boolean;
}) {
  return (
    <AtlasRow role="assistant" label="Atlas">
      <AtlasMarkdown content={text} streaming={!incomplete} />
      {incomplete && (
        <p className="text-xs text-muted-foreground mt-2">Stopped — response incomplete.</p>
      )}
    </AtlasRow>
  );
}
