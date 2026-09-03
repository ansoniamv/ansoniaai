import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ColumnManagerColumn {
  key: string;
  label: string;
}

interface ColumnManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: ColumnManagerColumn[];
  /** Full reconciled order, including hidden columns. */
  order: string[];
  visible: string[];
  /** Move `sourceKey` to the position currently held by `targetKey`. */
  onMove: (sourceKey: string, targetKey: string) => void;
  onToggle: (key: string) => void;
  onReset: () => void;
  /** Column pinned first; cannot be moved or hidden. */
  pinnedKey: string;
}

export function ColumnManagerDialog({
  open,
  onOpenChange,
  columns,
  order,
  visible,
  onMove,
  onToggle,
  onReset,
  pinnedKey,
}: ColumnManagerDialogProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const labelFor = (key: string) => columns.find((c) => c.key === key)?.label ?? key;
  const movable = order.filter((k) => k !== pinnedKey && columns.some((c) => c.key === k));

  const move = (key: string, dir: -1 | 1) => {
    const idx = movable.indexOf(key);
    const targetIdx = idx + dir;
    if (idx === -1 || targetIdx < 0 || targetIdx >= movable.length) return;
    onMove(key, movable[targetIdx]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage columns</DialogTitle>
          <DialogDescription>
            Drag or use the arrows to reorder. Uncheck to hide — hidden columns stay in the
            list so you can still position them. Changes apply immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto pr-1 -mr-1 space-y-1">
          {/* Pinned column */}
          <div className="flex items-center gap-2 rounded-md border border-hairline bg-muted/40 px-2 py-1.5 text-sm">
            <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Checkbox checked disabled />
            <span className="flex-1 truncate font-medium">{labelFor(pinnedKey)}</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Pinned
            </span>
          </div>

          {movable.map((key, i) => {
            const isVisible = visible.includes(key);
            return (
              <div
                key={key}
                draggable
                onDragStart={(e) => {
                  setDragKey(key);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", key);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (key !== dragKey) setOverKey(key);
                }}
                onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
                onDrop={(e) => {
                  e.preventDefault();
                  const source = e.dataTransfer.getData("text/plain") || dragKey;
                  setDragKey(null);
                  setOverKey(null);
                  if (source && source !== key) onMove(source, key);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setOverKey(null);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:bg-muted/50",
                  dragKey === key && "opacity-50",
                  overKey === key && "border-primary bg-primary/5",
                )}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab shrink-0" />
                <Checkbox checked={isVisible} onCheckedChange={() => onToggle(key)} />
                <span
                  className={cn(
                    "flex-1 truncate",
                    !isVisible && "text-muted-foreground line-through",
                  )}
                >
                  {labelFor(key)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={`Move ${labelFor(key)} up`}
                  disabled={i === 0}
                  onClick={() => move(key, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={`Move ${labelFor(key)} down`}
                  disabled={i === movable.length - 1}
                  onClick={() => move(key, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset to default
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
