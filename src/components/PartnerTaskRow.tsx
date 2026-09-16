/**
 * One partner task row.
 *
 * Extracted verbatim from PartnerDetailSheet.tsx so the internal-partner desk
 * (InternalPartnerDetail) shows tasks exactly the way the sheet does, from one
 * implementation. Behaviour is unchanged.
 */
import { format, isPast, isToday } from "date-fns";
import { CheckCircle2, Circle, CalendarClock, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PartnerTask } from "@/hooks/usePartnerTasks";

export function TaskRow({ task, onToggle, onDelete }: {
  task: PartnerTask;
  onToggle: (t: PartnerTask) => void;
  onDelete: (t: PartnerTask) => void;
}) {
  const done = task.status === "done";
  const due = task.due_date ? new Date(task.due_date) : null;
  const overdue = due && !done && isPast(due) && !isToday(due);
  const dueToday = due && !done && isToday(due);
  return (
    <div className="flex items-start gap-2 rounded border bg-card p-2.5 group">
      <button
        onClick={() => onToggle(task)}
        className="mt-0.5 text-muted-foreground hover:text-primary transition-colors"
        aria-label={done ? "Mark open" : "Mark done"}
      >
        {done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${done ? "line-through text-muted-foreground" : "font-medium"}`}>{task.title}</div>
        {task.description && (
          <div className="text-xs text-muted-foreground mt-0.5">{task.description}</div>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {due && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
              overdue ? "border-destructive/40 bg-destructive/10 text-destructive"
              : dueToday ? "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "border-hairline bg-muted text-muted-foreground"
            }`}>
              <CalendarClock className="h-3 w-3" />
              {format(due, "MMM d")}
            </span>
          )}
          {task.priority === "high" && (
            <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">High</Badge>
          )}
          {task.assignee && (
            <span className="text-[10px] text-muted-foreground">@{task.assignee}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onDelete(task)}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1"
        aria-label="Delete task"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
