import { cn } from "@/lib/utils";
import { RichTextContent } from "@/components/RichTextContent";

export interface NoteContentProps {
  content: string;
  format?: string | null;
  className?: string;
}

const HTML_RE = /<[a-z][\s\S]*?>/i;

/**
 * Backward-compatible note renderer.
 * Prefers explicit `format`; otherwise falls back to HTML sniffing for legacy notes.
 */
export function NoteContent({ content, format, className }: NoteContentProps) {
  if (format === "html" || (!format && HTML_RE.test(content))) {
    return <RichTextContent content={content} format="html" className={className} />;
  }
  return (
    <p className={cn("text-sm whitespace-pre-wrap", className)}>{content}</p>
  );
}
