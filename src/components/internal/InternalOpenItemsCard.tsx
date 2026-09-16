/**
 * "Open Items" — the desk's own to-do list.
 *
 * Backed by the same partner_tasks table and the same TaskRow the partner sheet
 * uses, so an item added here is the same kind of record as anywhere else.
 */
import { useState } from "react";
import { toast } from "sonner";
import { ListChecks, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskRow } from "@/components/PartnerTaskRow";
import {
  usePartnerTasks,
  useCreatePartnerTask,
  useUpdatePartnerTask,
  useDeletePartnerTask,
  type PartnerTask,
} from "@/hooks/usePartnerTasks";

const EMPTY_DRAFT = { title: "", due_date: "", priority: "normal", assignee: "" };
const MAX_DONE_SHOWN = 20;

export function InternalOpenItemsCard({ partnerId }: { partnerId: string }) {
  const { data: tasks } = usePartnerTasks(partnerId);
  const createTask = useCreatePartnerTask();
  const updateTask = useUpdatePartnerTask();
  const deleteTask = useDeletePartnerTask();
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const openTasks = (tasks ?? []).filter((t) => t.status !== "done");
  const doneTasks = (tasks ?? []).filter((t) => t.status === "done");

  const addTask = () => {
    const title = draft.title.trim();
    if (!title) return;
    createTask.mutate(
      {
        partner_id: partnerId,
        title,
        due_date: draft.due_date || null,
        priority: draft.priority,
        assignee: draft.assignee.trim() || null,
      },
      {
        onSuccess: () => setDraft(EMPTY_DRAFT),
        onError: (e: Error) => toast.error("Could not add item: " + e.message),
      },
    );
  };

  const toggleTask = (t: PartnerTask) =>
    updateTask.mutate({
      id: t.id,
      partner_id: t.partner_id,
      status: t.status === "done" ? "open" : "done",
      completed_at: t.status === "done" ? null : new Date().toISOString(),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-[#002752]" />
          Open Items
          {openTasks.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {openTasks.length} open
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded border p-3 space-y-2 bg-muted/30">
          <Input
            placeholder="New item…"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.title.trim()) addTask();
            }}
            className="h-8 text-sm"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              type="date"
              value={draft.due_date}
              onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
              className="h-8 text-xs"
            />
            <Select value={draft.priority} onValueChange={(v) => setDraft({ ...draft, priority: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Assignee"
              value={draft.assignee}
              onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <Button
            size="sm"
            onClick={addTask}
            disabled={!draft.title.trim() || createTask.isPending}
            className="w-full h-8"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add item
          </Button>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Open ({openTasks.length})
          </div>
          <div className="space-y-1.5">
            {openTasks.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No open items. Add one above.</p>
            )}
            {openTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onToggle={toggleTask}
                onDelete={(t) => deleteTask.mutate({ id: t.id, partner_id: t.partner_id })}
              />
            ))}
          </div>
        </div>

        {doneTasks.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Completed ({doneTasks.length})
            </div>
            <div className="space-y-1.5 opacity-70">
              {doneTasks.slice(0, MAX_DONE_SHOWN).map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggle={toggleTask}
                  onDelete={(t) => deleteTask.mutate({ id: t.id, partner_id: t.partner_id })}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
