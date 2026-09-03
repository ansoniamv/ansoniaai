import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

export interface RichTextContentProps {
  content: string;
  format?: string | null;
  className?: string;
}

export function RichTextContent({ content, format, className }: RichTextContentProps) {
  if (format === "html") {
    const clean = DOMPurify.sanitize(content, {
      ADD_ATTR: ["target", "rel"],
    });
    return (
      <div
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none text-sm",
          "prose-a:text-primary prose-a:underline",
          "prose-headings:mt-2 prose-headings:mb-1",
          "prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-blockquote:my-1",
          className
        )}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }
  return (
    <p className={cn("text-sm whitespace-pre-wrap", className)}>{content}</p>
  );
}
