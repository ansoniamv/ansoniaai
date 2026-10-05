/**
 * Renders an email body in full, formatted the way its sender wrote it.
 *
 * HTML bodies go into a sandboxed iframe rather than a `dangerouslySetInnerHTML`
 * div. Three things broke when email HTML was injected straight into the page:
 *   - the email's own <style> blocks leaked into the app (and the app's `prose`
 *     styles reflowed the email), so layouts came out mangled;
 *   - fixed-width tables (600px newsletters, Outlook signatures) forced the
 *     container wider than the card, which clipped the right-hand side;
 *   - head styles were thrown away, so Outlook's MsoNormal formatting was lost.
 * The iframe isolates the email's CSS, sizes itself to its content (so the
 * surrounding pane does the scrolling and nothing is cut off), and lets a
 * genuinely wide email scroll sideways inside its own frame.
 *
 * Security: the HTML is still sanitized with DOMPurify first, and the sandbox
 * omits `allow-scripts`, so nothing in the email can execute. `allow-same-origin`
 * is only there so the parent can measure the document height.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

const FRAME_CSS = `
  html, body { margin: 0; padding: 0; background: #ffffff; }
  /* Height must follow content, never the frame: the frame is sized from it. */
  html, body { height: auto !important; min-height: 0 !important; }
  body {
    padding: 20px 24px;
    color: #1f2937;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; }
  a { color: #0b5cad; }
  blockquote {
    margin: 8px 0 8px 4px;
    padding-left: 12px;
    border-left: 3px solid #d1d5db;
    color: #4b5563;
  }
  p { margin: 0 0 0.6em; }
  p.MsoNormal, div.MsoNormal { margin: 0; }
`;

function buildDocument(rawHtml: string): string {
  const clean = DOMPurify.sanitize(rawHtml, { WHOLE_DOCUMENT: true, ADD_TAGS: ["style"] });
  const doc = new DOMParser().parseFromString(clean, "text/html");

  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  const base = doc.createElement("base");
  base.setAttribute("target", "_blank");
  const style = doc.createElement("style");
  style.textContent = FRAME_CSS;
  // Ours go first so the email's own styles still win where it sets them.
  doc.head.prepend(meta, base, style);

  // Inline attachments (cid:) aren't stored, so they'd only render as broken images.
  doc.querySelectorAll('img[src^="cid:"]').forEach((img) => img.remove());

  doc.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });

  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

function HtmlFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const srcDoc = useMemo(() => buildDocument(html), [html]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;

    const measure = () => {
      const d = frame.contentDocument;
      if (!d?.documentElement) return;
      const el = d.documentElement;
      // The <html> box, not scrollHeight: scrollHeight never drops below the
      // frame itself, so feeding it back into the frame height only ever grows.
      const content = Math.ceil(el.getBoundingClientRect().height);
      // Leave room for the frame's own horizontal scrollbar on wide emails.
      const scrollbar = el.scrollWidth > el.clientWidth ? 16 : 0;
      const next = content + scrollbar;
      setHeight((h) => (Math.abs(h - next) > 1 ? next : h));
    };

    const onLoad = () => {
      measure();
      const win = frame.contentWindow as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
      const RO = win?.ResizeObserver ?? window.ResizeObserver;
      const body = frame.contentDocument?.body;
      if (RO && body) {
        observer?.disconnect();
        observer = new RO(measure);
        observer.observe(body);
      }
    };

    frame.addEventListener("load", onLoad);
    // The srcdoc can finish loading before this effect attaches the listener.
    if (frame.contentDocument?.readyState === "complete") onLoad();
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block w-full border-0 bg-white"
      style={{ height }}
    />
  );
}

// ---------------------------------------------------------------------------
// Plain-text bodies: split into the latest message plus each earlier message in
// the thread, and set quoted ("> ") lines apart, instead of one flat <pre>.

const THREAD_BREAK =
  /^(-{2,}\s*(original message|forwarded message)\s*-{2,}|_{10,}|begin forwarded message:?|on .{4,200} wrote:)\s*$/i;

type Segment = { header: string | null; lines: string[] };

function splitThread(text: string): Segment[] {
  const segments: Segment[] = [{ header: null, lines: [] }];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (THREAD_BREAK.test(line.trim())) {
      segments.push({ header: line.trim().replace(/^[-_\s]+|[-_\s]+$/g, "") || null, lines: [] });
    } else {
      segments[segments.length - 1].lines.push(line);
    }
  }
  return segments.filter((s) => s.header || s.lines.some((l) => l.trim()));
}

function TextBlock({ lines }: { lines: string[] }) {
  // Group consecutive quoted lines so they render as one blockquote.
  const groups: { quoted: boolean; text: string }[] = [];
  for (const line of lines) {
    const quoted = /^\s*>/.test(line);
    const clean = quoted ? line.replace(/^\s*>\s?/, "") : line;
    const last = groups[groups.length - 1];
    if (last && last.quoted === quoted) last.text += `\n${clean}`;
    else groups.push({ quoted, text: clean });
  }
  return (
    <>
      {groups.map((g, i) =>
        g.quoted ? (
          <blockquote key={i} className="my-2 border-l-[3px] border-border pl-3 text-muted-foreground whitespace-pre-wrap">
            {g.text.trim()}
          </blockquote>
        ) : (
          <div key={i} className="whitespace-pre-wrap">{g.text.replace(/^\n+|\n+$/g, "")}</div>
        ),
      )}
    </>
  );
}

function TextBody({ text }: { text: string }) {
  const segments = splitThread(text);
  return (
    <div className="px-6 py-5 text-sm leading-relaxed break-words [overflow-wrap:anywhere] space-y-4">
      {segments.map((s, i) => (
        <div key={i} className={cn(i > 0 && "border-t pt-4")}>
          {s.header && (
            <div className="mb-2 text-xs font-medium text-muted-foreground">{s.header}</div>
          )}
          <TextBlock lines={s.lines} />
        </div>
      ))}
    </div>
  );
}

export function EmailBody({
  html,
  text,
  title = "Email message",
  className,
}: {
  html?: string | null;
  text?: string | null;
  title?: string;
  className?: string;
}) {
  const hasHtml = !!html?.trim();
  return (
    <div className={cn("overflow-hidden rounded-md border bg-white", !hasHtml && "bg-card", className)}>
      {hasHtml ? (
        <HtmlFrame html={html!} title={title} />
      ) : text?.trim() ? (
        <TextBody text={text} />
      ) : (
        <div className="px-6 py-5 text-sm text-muted-foreground">(empty message)</div>
      )}
    </div>
  );
}
