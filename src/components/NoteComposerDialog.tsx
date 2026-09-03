import { useState, useCallback } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { EntityPicker, type EntityRef } from "@/components/EntityPicker";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useCreateNote } from "@/hooks/useNotes";
import { insertNoteLinks } from "@/hooks/useNoteLinks";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { toast } from "sonner";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

export interface NoteComposerDialogProps {
  trigger?: React.ReactNode;
  presetEntity?: EntityRef;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function NoteComposerDialog({
  trigger,
  presetEntity,
  open: openProp,
  onOpenChange,
}: NoteComposerDialogProps) {
  const [openState, setOpenState] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp! : openState;
  const setOpen = (v: boolean) => {
    if (!isControlled) setOpenState(v);
    onOpenChange?.(v);
  };

  const initial: EntityRef[] = presetEntity ? [presetEntity] : [];
  const [entities, setEntities] = useState<EntityRef[]>(initial);
  const [content, setContent] = useState("");
  const { user } = useAuth();
  const currentMember = useCurrentTeamMember();
  const createNote = useCreateNote();

  const reset = useCallback(() => {
    setEntities(presetEntity ? [presetEntity] : []);
    setContent("");
  }, [presetEntity]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
    }
  };

  const save = async () => {
    // Combined target list: preset owner (if any) + any additional entities selected.
    // Dedupe against preset so the same record isn't linked twice.
    const combined: EntityRef[] = presetEntity
      ? [
          presetEntity,
          ...entities.filter(
            (e) =>
              !(e.entity_type === presetEntity.entity_type && e.entity_id === presetEntity.entity_id)
          ),
        ]
      : entities;

    if (combined.length === 0) {
      toast.error("Please select at least one deal or partner to tag this note to.");
      return;
    }
    if (!stripHtml(content).trim()) {
      toast.error("Note content cannot be empty.");
      return;
    }

    const [primary, ...extras] = combined;

    try {
      const note = await createNote.mutateAsync({
        entity_type: primary.entity_type,
        entity_id: primary.entity_id,
        content,
        content_format: "html",
        author: currentMember?.full_name ?? user?.email ?? undefined,
        team_member_id: currentMember?.id ?? null,
      });
      if (extras.length > 0) {
        await insertNoteLinks(
          note.id,
          extras.map((e) => ({ linked_type: e.entity_type, linked_id: e.entity_id }))
        );
      }
      toast.success(
        combined.length === 1
          ? `Note added to ${combined[0].label}`
          : `Note added and linked to ${combined.length} records`
      );
      setOpen(false);
      reset();
    } catch (e) {
      toast.error((e as Error).message || "Failed to save note.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {(trigger || !isControlled) && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add New Note
            </Button>
          )}
        </DialogTrigger>
      )}

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Note</DialogTitle>
          <DialogDescription>
            Tag this note to one or more deals and partners — it will show up on
            each record automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              {presetEntity ? "Also link to (optional)" : (
                <>Tag to <span className="text-red-500">*</span></>
              )}
            </Label>
            <EntityPicker value={entities} onChange={setEntities} />
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <RichTextEditor
              value={content}
              onChange={setContent}
              placeholder="Summarize the conversation… (Cmd/Ctrl+Enter to save)"
              autoFocus
              onSubmit={save}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={createNote.isPending}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={createNote.isPending}>
            {createNote.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save Note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
