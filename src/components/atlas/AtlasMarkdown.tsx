import { Component, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Cells that are purely numeric / currency read better right-aligned. */
const NUMERIC_CELL = /^[\s$€£]*-?[\d,]+(\.\d+)?\s*%?\s*$/;

function cellText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(cellText).join("");
  return "";
}

const isNumericCell = (children: ReactNode) => {
  const t = cellText(children).trim();
  return t.length > 0 && NUMERIC_CELL.test(t);
};

const ATLAS_PROSE = cn(
  "prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed",
  "prose-p:my-2 prose-p:leading-relaxed",
  "prose-headings:font-display prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-5 prose-headings:mb-2",
  "prose-ul:my-2 prose-ol:my-2 prose-li:my-0 [&_li]:my-0 [&_ul]:space-y-1 [&_ol]:space-y-1",
  "prose-code:text-[0.85em] prose-code:tabular-nums prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:rounded-md prose-pre:border prose-pre:border-border prose-pre:bg-muted/40 prose-pre:p-3 prose-pre:text-xs prose-pre:overflow-x-auto",
  "prose-a:text-primary prose-a:underline prose-a:underline-offset-2",
);

/**
 * A half-written markdown table arriving mid-stream can throw inside
 * react-markdown's renderer. Falling back to preformatted text keeps the stream
 * visible instead of blanking the panel; `resetKey` lets the boundary recover
 * once the stream completes and the markdown is well-formed again.
 */
class MarkdownBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey: unknown },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: { resetKey: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // The wrapper scrolls, not the page — a wide table must never make the
        // whole screen scroll sideways.
        table: ({ node, ...props }) => (
          <div className="overflow-x-auto my-3">
            <table className="w-full border-collapse text-xs" {...props} />
          </div>
        ),
        thead: ({ node, ...props }) => <thead className="bg-muted" {...props} />,
        th: ({ node, children, ...props }) => (
          <th
            className={cn(
              "border border-border px-2 py-1.5 font-medium tabular-nums",
              isNumericCell(children) ? "text-right" : "text-left",
            )}
            {...props}
          >
            {children}
          </th>
        ),
        td: ({ node, children, ...props }) => (
          <td
            className={cn(
              "border border-border px-2 py-1.5 align-top tabular-nums",
              isNumericCell(children) && "text-right",
            )}
            {...props}
          >
            {children}
          </td>
        ),
        a: ({ node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function AtlasMarkdown({
  content,
  streaming = false,
}: {
  content: string;
  /** Appends a blinking caret and arms the mid-stream fallback. */
  streaming?: boolean;
}) {
  return (
    <div className={ATLAS_PROSE}>
      <MarkdownBoundary
        resetKey={streaming}
        fallback={
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{content}</pre>
        }
      >
        <Markdown content={content} />
      </MarkdownBoundary>
      {streaming && (
        <span
          className="inline-block h-4 w-[2px] translate-y-0.5 bg-foreground/70 animate-pulse"
          aria-hidden
        />
      )}
    </div>
  );
}
