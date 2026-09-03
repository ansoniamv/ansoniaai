import { useEffect, useRef, useState, type ReactNode } from "react";
import { GripHorizontal, Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingPanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  storageKey?: string;
  className?: string;
}

type Pos = { x: number; y: number };
type Size = { w: number; h: number };

function loadState<T>(key: string | undefined, fallback: T): T {
  if (!key || typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

export function FloatingPanel({
  open,
  onClose,
  title,
  children,
  defaultWidth = 480,
  defaultHeight = 600,
  storageKey,
  className,
}: FloatingPanelProps) {
  const posKey = storageKey ? `${storageKey}:pos` : undefined;
  const sizeKey = storageKey ? `${storageKey}:size` : undefined;
  const minKey = storageKey ? `${storageKey}:min` : undefined;

  const [pos, setPos] = useState<Pos>(() => {
    if (typeof window === "undefined") return { x: 100, y: 100 };
    const initial = {
      x: Math.max(16, window.innerWidth - defaultWidth - 32),
      y: Math.max(16, window.innerHeight - defaultHeight - 32),
    };
    return loadState<Pos>(posKey, initial);
  });
  const [size, setSize] = useState<Size>(() =>
    loadState<Size>(sizeKey, { w: defaultWidth, h: defaultHeight }),
  );
  const [minimized, setMinimized] = useState<boolean>(() =>
    typeof window !== "undefined" && minKey
      ? localStorage.getItem(minKey) === "1"
      : false,
  );

  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Persist position/size/minimized
  useEffect(() => {
    if (posKey) localStorage.setItem(posKey, JSON.stringify(pos));
  }, [pos, posKey]);
  useEffect(() => {
    if (sizeKey) localStorage.setItem(sizeKey, JSON.stringify(size));
  }, [size, sizeKey]);
  useEffect(() => {
    if (minKey) localStorage.setItem(minKey, minimized ? "1" : "0");
  }, [minimized, minKey]);

  // Track resize (ResizeObserver on the panel)
  useEffect(() => {
    if (!open || minimized) return;
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!panelRef.current) return;
      const w = panelRef.current.offsetWidth;
      const h = panelRef.current.offsetHeight;
      setSize((prev) => {
        if (w === prev.w && h === prev.h) return prev;
        return { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, minimized]);

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    // Don't drag when clicking controls
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.preventDefault();
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const nx = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dragRef.current.dx));
      const ny = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dragRef.current.dy));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed z-40 flex flex-col rounded-lg border border-border bg-card shadow-2xl",
        !minimized && "resize overflow-hidden",
        className,
      )}
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? "auto" : size.h,
        minWidth: 320,
        minHeight: minimized ? undefined : 240,
        maxWidth: "95vw",
        maxHeight: "95vh",
      }}
    >
      <div
        onMouseDown={onHeaderMouseDown}
        className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 cursor-move select-none"
      >
        <GripHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0 text-sm font-semibold truncate">{title}</div>
        <div data-no-drag className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setMinimized((m) => !m)}
            className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted"
            title={minimized ? "Restore" : "Minimize"}
            aria-label={minimized ? "Restore" : "Minimize"}
          >
            {minimized ? <Square className="h-3 w-3" /> : <Minus className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted"
            title="Close"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {!minimized && <div className="flex-1 min-h-0 overflow-auto">{children}</div>}
    </div>
  );
}
