import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, Send, Trash2, MessageSquare, Bot, User as UserIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  useThreads,
  useThreadMessages,
  useCreateThread,
  useDeleteThread,
  useSendMessage,
  type ChatMessage,
} from "@/hooks/useChat";

export default function ChatPage() {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: threads = [] } = useThreads();
  const createThread = useCreateThread();
  const deleteThread = useDeleteThread();
  const { data: storedMessages = [] } = useThreadMessages(threadId);
  const send = useSendMessage();

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Bootstrap: if no thread in URL, pick most recent or create
  useEffect(() => {
    if (threadId) return;
    if (threads.length > 0) {
      navigate(`/chat/${threads[0].id}`, { replace: true });
    }
  }, [threadId, threads, navigate]);

  // Clear pending when stored messages arrive
  useEffect(() => {
    setPending([]);
  }, [storedMessages.length, threadId]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [storedMessages, pending, send.isPending]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId, send.isPending]);

  // Consume a prefill from navigation state (e.g. "Ask Atlas" launcher on the Pipeline).
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill;
    if (prefill) {
      setDraft(prefill);
      textareaRef.current?.focus();
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const allMessages: ChatMessage[] = [...storedMessages, ...pending];

  const handleNewThread = async () => {
    const t = await createThread.mutateAsync();
    navigate(`/chat/${t.id}`);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteThread.mutateAsync(id);
    if (id === threadId) navigate("/chat", { replace: true });
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    let activeId = threadId;
    if (!activeId) {
      const t = await createThread.mutateAsync();
      activeId = t.id;
      navigate(`/chat/${t.id}`, { replace: true });
    }
    const userMsg: ChatMessage = { role: "user", content: text };
    setDraft("");
    setPending([userMsg]);
    await send.mutateAsync({ threadId: activeId!, messages: [...allMessages, userMsg] });
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-4">
      {/* Thread sidebar */}
      <div className="w-64 flex flex-col border border-border rounded-lg bg-card">
        <div className="p-3 border-b border-border">
          <Button onClick={handleNewThread} className="w-full" size="sm">
            <Plus className="h-4 w-4" /> New chat
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {threads.map((t) => (
              <div
                key={t.id}
                onClick={() => navigate(`/chat/${t.id}`)}
                className={cn(
                  "group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer text-sm hover:bg-accent",
                  t.id === threadId && "bg-accent text-accent-foreground",
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{t.title}</span>
                <button
                  onClick={(e) => handleDelete(t.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  aria-label="Delete chat"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {threads.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">No chats yet.</p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col border border-border rounded-lg bg-card min-w-0">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-display text-base tracking-tight">Ask Atlas</h2>
          <p className="text-xs text-muted-foreground">
            Ask about deals, partners, the buy box, market data — or anything else.
          </p>
        </div>

        <ScrollArea className="flex-1" ref={scrollRef as any}>
          <div className="p-4 space-y-6 max-w-3xl mx-auto">
            {allMessages.length === 0 && !send.isPending && (
              <div className="text-center py-24">
                <Bot className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p className="font-display text-lg text-foreground">Meet Atlas</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
                  Your guide to the acquisitions platform. Ask how something works, or ask about your deals, partners, and pipeline.
                </p>
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                  {[
                    "How does deal scoring work?",
                    "Give me a tour of the platform",
                    "What deals are in LOI right now?",
                    "How do I add a capital partner?",
                  ].map((p) => (
                    <button
                      key={p}
                      onClick={() => setDraft(p)}
                      className="text-left text-sm px-4 py-2.5 rounded-md border border-border/60 hover:border-primary/40 hover:bg-accent transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {allMessages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}
            {send.isPending && (
              <div className="flex gap-3 items-start">
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-border">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
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
              placeholder="Ask anything…"
              rows={1}
              className="min-h-[44px] max-h-40 resize-none"
              disabled={send.isPending}
            />
            <Button onClick={handleSend} disabled={!draft.trim() || send.isPending} size="icon">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3 items-start", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center shrink-0",
          isUser ? "bg-primary text-primary-foreground" : "bg-primary/10",
        )}
      >
        {isUser ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4 text-primary" />}
      </div>
      <div
        className={cn(
          "rounded-lg text-sm max-w-[85%]",
          isUser ? "bg-primary text-primary-foreground px-3 py-2" : "bg-muted/40 px-4 py-3 leading-relaxed",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-p:leading-relaxed prose-pre:my-2 [&_code]:tabular-nums prose-table:my-3 prose-table:border-collapse prose-table:w-auto prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-3 prose-th:py-1.5 prose-th:text-left prose-th:font-semibold prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-1.5 prose-td:align-top">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ node, ...props }) => (
                  <div className="overflow-x-auto my-3">
                    <table {...props} />
                  </div>
                ),
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
