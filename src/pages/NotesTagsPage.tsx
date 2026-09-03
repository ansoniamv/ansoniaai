import { useState } from "react";
import { StickyNote, Tag, Plus, Trash2, Pin, PinOff, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAllNotes, useCreateNote, useUpdateNote, useDeleteNote, useTags, useCreateTag, useDeleteTag, useUpdateTag } from "@/hooks/useNotes";
import { NoteAuthor } from "@/components/NoteAuthor";
import { NoteComposerDialog } from "@/components/NoteComposerDialog";
import { NoteContent } from "@/components/NoteContent";
import { NoteLinkChips } from "@/components/NoteLinkChips";

const TAG_COLORS = ["#6aa3d8", "#22c55e", "#ef4444", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];

export default function NotesTagsPage() {
  const { data: notes } = useAllNotes();
  const { data: tags } = useTags();
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const updateTag = useUpdateTag();
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState("");

  const handleCreateTag = () => {
    if (!newTagName.trim()) return;
    createTag.mutate({ name: newTagName.trim(), color: newTagColor }, {
      onSuccess: () => { setNewTagName(""); toast.success("Tag created"); },
      onError: (err) => toast.error(err.message),
    });
  };

  const handleDeleteTag = (id: string) => {
    deleteTag.mutate(id, { onError: (err) => toast.error(err.message) });
  };

  const handleTogglePin = (note: any) => {
    updateNote.mutate({ id: note.id, is_pinned: !note.is_pinned });
  };

  const handleDeleteNote = (id: string) => {
    deleteNote.mutate(id, { onError: (err) => toast.error(err.message) });
  };

  const entityTypeLabel = (type: string) => {
    switch (type) {
      case "deal": return "Deal";
      case "partner": return "Partner";
      case "capital_raise": return "Capital Raise";
      default: return type;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notes & Tags</h1>
          <p className="text-sm text-muted-foreground">Manage notes and tags across all entities</p>
        </div>
        <NoteComposerDialog />
      </div>

      <Tabs defaultValue="notes">
        <TabsList>
          <TabsTrigger value="notes" className="gap-1">
            <StickyNote className="h-3.5 w-3.5" /> Notes Timeline
          </TabsTrigger>
          <TabsTrigger value="tags" className="gap-1">
            <Tag className="h-3.5 w-3.5" /> Tag Management
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notes" className="mt-4">
          {!notes?.length ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <p>No notes yet. Use "Add New Note" above to create one tagged to any deal or partner.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {notes.map(note => (
                <Card key={note.id} className={note.is_pinned ? "border-primary/30" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          {note.is_pinned && <Pin className="h-3 w-3 text-primary" />}
                          <Badge variant="outline" className="text-[10px]">{entityTypeLabel(note.entity_type)}</Badge>
                          <NoteAuthor member={note.team_members} fallbackName={note.author} />
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {new Date(note.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="mb-2">
                          <NoteLinkChips
                            noteId={note.id}
                            ownerType={note.entity_type}
                            ownerId={note.entity_id}
                            links={note.note_links ?? []}
                          />
                        </div>
                        <NoteContent content={note.content} format={note.content_format} />
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleTogglePin(note)}>
                          {note.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteNote(note.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tags" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Manage Tags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="New tag name..."
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCreateTag()}
                  className="max-w-xs"
                />
                <div className="flex gap-1">
                  {TAG_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewTagColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${newTagColor === c ? "border-foreground scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <Button onClick={handleCreateTag} disabled={!newTagName.trim()} size="sm">
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>

              {!tags?.length ? (
                <p className="text-sm text-muted-foreground">No tags created yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => (
                    <div key={tag.id} className="flex items-center gap-1 border rounded-full px-3 py-1.5 group">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                      {editingTag === tag.id ? (
                        <form onSubmit={e => {
                          e.preventDefault();
                          if (editTagName.trim()) {
                            updateTag.mutate({ id: tag.id, name: editTagName.trim() }, {
                              onSuccess: () => setEditingTag(null),
                            });
                          }
                        }}>
                          <Input
                            value={editTagName}
                            onChange={e => setEditTagName(e.target.value)}
                            className="h-6 text-xs w-24 px-1"
                            autoFocus
                            onBlur={() => setEditingTag(null)}
                          />
                        </form>
                      ) : (
                        <span className="text-sm">{tag.name}</span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive"
                        onClick={() => handleDeleteTag(tag.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
