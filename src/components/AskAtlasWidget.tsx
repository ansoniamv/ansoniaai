import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Loader2, Send, Sparkles, Maximize2, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  useCreateThread,
  useSendMessage,
  useThreadMessages,
  type ChatMessage,
} from "@/hooks/useChat";

const SUGGESTIONS = [
  "How does deal scoring work?",
  "Give me a tour of the platform",
  "What deals are in LOI right now?",
  "How do I add a capital partner?",
];

export function AskAtlasWidget() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const navigate = useNavigate();
  const createThread = useCreateThread();
  const send = useSendMessage();
  const { data: storedMessages = [] } = useThreadMessages(threadId);

  const all: ChatMessage[] = [...storedMessages, ...pending];

  useEffect(() => setPending([]), [storedMessages.length, threadId]);

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [storedMessages, pending, send.isPending, open]);

  const handleSend = async (text?: string) => {
    const content = (text ?? draft).trim();
    if (!content || send.isPending) return;
    let activeId = threadId;
    if (!activeId) {
      const t = await createThread.mutateAsync();
      activeId = t.id;
      setThreadId(activeId);
    }
    const userMsg: ChatMessage = { role: "user", content };
    setDraft("");
    setPending([userMsg]);
    await send.mutateAsync({ threadId: activeId!, messages: [...all, userMsg] });
  };

  const openFullPage = () => {
    setOpen(false);
    navigate(threadId ? `/chat/${threadId}` : "/chat");
  };

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
          <SheetHeader className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <SheetTitle className="font-display text-sm tracking-tight">Ask Atlas</SheetTitle>
                  <SheetDescription className="text-xs">
                    Deals, partners, buy box, market data
                  </SheetDescription>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 mr-6"
                onClick={openFullPage}
                title="Open full page"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1" ref={scrollRef as any}>
            <div className="px-4 py-4 space-y-5">
              {all.length === 0 && !send.isPending && (
                <div className="py-12 text-center">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <p className="font-display text-base text-foreground">Meet Atlas</p>
                  <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
                    Your guide to the acquisitions platform. Ask how something works, or ask about your deals, partners, and pipeline.
                  </p>
                  <div className="mt-6 grid grid-cols-1 gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleSend(s)}
                        className="text-left text-sm px-4 py-2.5 rounded-md border border-border/60 hover:border-primary/40 hover:bg-accent transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {all.map((m, i) => (
                <Bubble key={i} message={m} />
              ))}
              {send.isPending && (
                <div className="flex gap-2.5 items-start">
                  <Avatar role="assistant" />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-3 border-t border-border bg-card">
            <div className="flex gap-2 items-end">
              <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask Atlas…"
                rows={1}
                className="min-h-[42px] max-h-32 resize-none text-sm"
                disabled={send.isPending}
              />
              <Button
                onClick={() => handleSend()}
                disabled={!draft.trim() || send.isPending}
                size="icon"
                className="shrink-0"
              >
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Enter to send · Shift+Enter for newline
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "h-7 w-7 rounded-full flex items-center justify-center shrink-0",
        isUser ? "bg-primary text-primary-foreground" : "bg-primary/10",
      )}
    >
      {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5 text-primary" />}
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2.5 items-start", isUser && "flex-row-reverse")}>
      <Avatar role={message.role} />
      <div
        className={cn(
          "text-sm max-w-[85%] leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3.5 py-2"
            : "bg-muted/60 text-foreground rounded-2xl rounded-tl-sm px-4 py-3",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-p:leading-relaxed prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-pre:bg-muted/30 [&_code]:tabular-nums prose-code:text-[0.85em] prose-code:bg-muted/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-table:my-2 prose-table:text-xs prose-table:border-collapse prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-2 prose-th:py-1 prose-th:text-left prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-a:text-primary hover:prose-a:underline">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ node, ...props }) => (
                  <div className="overflow-x-auto"><table {...props} /></div>
                ),
                a: ({ node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
