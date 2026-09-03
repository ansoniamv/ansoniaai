import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { RichTextEditorProps } from "@/components/RichTextEditorImpl";

export type { RichTextEditorProps };

/**
 * Lazy wrapper: keeps TipTap (~370 KB) out of the initial bundle.
 * The editor chunk only downloads when an editor is actually rendered.
 */
const Impl = lazy(() =>
  import("@/components/RichTextEditorImpl").then((m) => ({ default: m.RichTextEditor })),
);

export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense fallback={<Skeleton className="h-28 w-full rounded-md" />}>
      <Impl {...props} />
    </Suspense>
  );
}
