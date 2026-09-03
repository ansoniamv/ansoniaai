import { useState, useEffect, useRef } from "react";
import { Loader2, Pin, PinOff, Trash2, StickyNote, Pencil, Check, X, Sparkles, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/RichTextEditor";
import { NoteContent } from "@/components/NoteContent";
import { NoteAuthor } from "@/components/NoteAuthor";
import { NoteLinkChips } from "@/components/NoteLinkChips";
import { useNotes, useCreateNote, useUpdateNote, useDeleteNote, type Note } from "@/hooks/useNotes";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { usePartnerContacts } from "@/hooks/usePartners";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const NO_CONTACT = "__none__";

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isEmptyHtml(html: string) {
  return !html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim();
}

export interface EntityNotesProps {
  entityType: "deal" | "partner" | "capital_raise";
  entityId: string;
  className?: string;
}

export function EntityNotes({ entityType, entityId, className }: EntityNotesProps) {
  const { data: notes, isLoading } = useNotes(entityType, entityId);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const { user } = useAuth();
  const currentMember = useCurrentTeamMember();
  const [content, setContent] = useState("");
  const [contactId, setContactId] = useState<string>(NO_CONTACT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingContactId, setEditingContactId] = useState<string>(NO_CONTACT);
  const classifyingRef = useRef<Set<string>>(new Set());

  const shouldClassify = entityType === "partner";
  const isPartner = entityType === "partner";
  const { data: partnerContacts } = usePartnerContacts(isPartner ? entityId : undefined);

  const triggerClassify = async (noteId: string) => {
    if (!shouldClassify) return;
    try {
      await supabase.functions.invoke("classify-note", { body: { note_id: noteId } });
    } catch (err) {
      console.warn("classify-note failed", err);
    }
  };

  // Auto-classify any partner notes that don't have a fresh classification yet.
  useEffect(() => {
    if (!shouldClassify || !notes) return;
    for (const n of notes) {
      if (n.classification && n.classification !== "unclassified") continue;
      if (classifyingRef.current.has(n.id)) continue;
      classifyingRef.current.add(n.id);
      triggerClassify(n.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, shouldClassify]);

  const handleAdd = () => {
    if (isEmptyHtml(content)) return;
    createNote.mutate(
      {
        entity_type: entityType,
        entity_id: entityId,
        content,
        content_format: "html",
        author: currentMember?.full_name ?? user?.email ?? undefined,
        team_member_id: currentMember?.id ?? null,
        contact_id: isPartner && contactId !== NO_CONTACT ? contactId : null,
      },
      {
        onSuccess: (data: any) => {
          setContent("");
          setContactId(NO_CONTACT);
          toast.success("Note added");
          if (data?.id) triggerClassify(data.id);
        },
        onError: (err: any) => toast.error("Failed to add note: " + err.message),
      }
    );
  };

  const startEdit = (id: string, current: string, currentContactId?: string | null) => {
    setEditingId(id);
    setEditingContent(current);
    setEditingContactId(currentContactId ?? NO_CONTACT);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent("");
    setEditingContactId(NO_CONTACT);
  };

  const saveEdit = (id: string) => {
    if (isEmptyHtml(editingContent)) {
      toast.error("Note cannot be empty");
      return;
    }
    updateNote.mutate(
      {
        id,
        content: editingContent,
        content_format: "html",
        ...(isPartner ? { contact_id: editingContactId !== NO_CONTACT ? editingContactId : null } : {}),
      },
      {
        onSuccess: () => {
          cancelEdit();
          toast.success("Note updated");
          triggerClassify(id);
        },
        onError: (err: any) => toast.error("Failed to update note: " + err.message),
      }
    );
  };

  const contactPicker = (value: string, onValueChange: (v: string) => void, placeholder = "Tag a contact…") => (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-8 w-[200px] text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CONTACT}>No specific contact</SelectItem>
        {(partnerContacts ?? []).map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}{c.role ? ` — ${c.role}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <StickyNote className="h-4 w-4" /> Notes
          {notes && notes.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({notes.length})</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <RichTextEditor
            value={content}
            onChange={setContent}
            placeholder="Add a note… (Cmd/Ctrl+Enter to save)"
            onSubmit={handleAdd}
          />
          <div className="flex justify-end items-center gap-2">
            {isPartner && contactPicker(contactId, setContactId)}
            <Button size="sm" onClick={handleAdd} disabled={createNote.isPending || isEmptyHtml(content)}>
              {createNote.isPending ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : null}
              Add Note
            </Button>
          </div>
        </div>

        {(() => {
          if (isLoading) return <p className="text-sm text-muted-foreground">Loading notes...</p>;
          if (!notes || notes.length === 0) return <p className="text-sm text-muted-foreground">No notes yet.</p>;

          const renderNote = (n: Note) => {
            const isEditing = editingId === n.id;
            const isFirm = n.classification === "firm";
            return (
              <div key={n.id} className="rounded-md border p-3 bg-muted/20">

                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0 text-xs text-muted-foreground flex-wrap">
                    <NoteAuthor member={n.team_members} fallbackName={n.author} />
                    <span className="whitespace-nowrap">
                      · {formatTimestamp(n.created_at)}
                      {n.updated_at && n.updated_at !== n.created_at ? " (edited)" : ""}
                    </span>
                    {n.partner_contacts && (
                      <Badge variant="secondary" className="h-5 gap-1 text-[10px] font-normal">
                        <User className="h-3 w-3" />
                        {n.partner_contacts.name}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <Button size="icon" variant="ghost" className="h-6 w-6" title="Save" onClick={() => saveEdit(n.id)} disabled={updateNote.isPending}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" title="Cancel" onClick={cancelEdit}>
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="icon" variant="ghost" className="h-6 w-6" title="Edit" onClick={() => startEdit(n.id, n.content, n.contact_id)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" title={n.is_pinned ? "Unpin" : "Pin"} onClick={() => updateNote.mutate({ id: n.id, is_pinned: !n.is_pinned })}>
                          {n.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" title="Delete" onClick={() => { if (confirm("Delete this note?")) deleteNote.mutate(n.id); }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mb-2">
                  <NoteLinkChips
                    noteId={n.id}
                    ownerType={n.entity_type}
                    ownerId={n.entity_id}
                    links={n.note_links ?? []}
                    hideEntity={{ entity_type: entityType, entity_id: entityId }}
                  />
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <RichTextEditor value={editingContent} onChange={setEditingContent} onSubmit={() => saveEdit(n.id)} autoFocus />
                    {isPartner && (
                      <div className="flex justify-end">
                        {contactPicker(editingContactId, setEditingContactId)}
                      </div>
                    )}
                  </div>
                ) : (
                  <NoteContent content={n.content} format={n.content_format} />
                )}
              </div>
            );
          };

          return (
            <div className="space-y-2">
              {notes.map((n) => renderNote(n))}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
