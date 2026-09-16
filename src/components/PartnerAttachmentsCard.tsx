/**
 * Partner attachments card.
 *
 * Extracted verbatim from PartnerDetail.tsx so the internal-partner desk
 * (InternalPartnerDetail) can reuse it without importing the page module.
 * Behaviour is unchanged.
 */
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Paperclip, File as FileIcon, FileText, FileImage, FileSpreadsheet, Download, Trash2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  usePartnerAttachments,
  useUploadPartnerAttachment,
  useDeletePartnerAttachment,
  type PartnerAttachment,
} from "@/hooks/usePartners";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function formatFileSize(bytes: number | null | undefined) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function AttachmentIcon({ contentType, fileName }: { contentType: string | null; fileName: string }) {
  const ct = (contentType || "").toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (ct.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext))
    return <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (ct.includes("pdf") || ext === "pdf")
    return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (ct.includes("sheet") || ct.includes("excel") || ["xls", "xlsx", "csv"].includes(ext))
    return <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (ct.startsWith("text/") || ["doc", "docx", "txt", "md"].includes(ext))
    return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
  return <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function isPdfAttachment(a: PartnerAttachment) {
  const ct = (a.content_type || "").toLowerCase();
  const ext = a.file_name.split(".").pop()?.toLowerCase() || "";
  return ct === "application/pdf" || ext === "pdf";
}

function canPreviewAttachment(a: PartnerAttachment) {
  const ct = (a.content_type || "").toLowerCase();
  const ext = a.file_name.split(".").pop()?.toLowerCase() || "";
  return (
    ct.startsWith("image/") ||
    ct.startsWith("text/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "md", "csv"].includes(ext)
  );
}

export function PartnerAttachmentsCard({ partnerId }: { partnerId: string }) {
  const { data: attachments } = usePartnerAttachments(partnerId);
  const upload = useUploadPartnerAttachment();
  const del = useDeletePartnerAttachment();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PartnerAttachment | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<PartnerAttachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const valid: File[] = [];
    for (const f of arr) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${f.name} is over 25 MB and was skipped`);
        continue;
      }
      valid.push(f);
    }
    setPendingFiles(valid);
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) {
      toast.error("Choose a file to upload");
      return;
    }
    setUploading(true);
    try {
      for (const file of pendingFiles) {
        try {
          await upload.mutateAsync({
            partnerId,
            file,
            label: label.trim() || null,
          });
          toast.success(`Uploaded ${file.name}`);
        } catch (e: any) {
          toast.error(`Failed to upload ${file.name}: ${e?.message ?? e}`);
        }
      }
      setPendingFiles([]);
      setLabel("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setUploading(false);
    }
  };

  const fetchAttachmentBlob = async (a: PartnerAttachment): Promise<Blob> => {
    const { data, error } = await supabase.storage
      .from("partner-attachments")
      .download(a.storage_path);
    if (error) throw error;
    if (!data) throw new Error("No file data returned");
    return data.type || !a.content_type ? data : new Blob([data], { type: a.content_type });
  };

  const openAttachment = async (a: PartnerAttachment) => {
    setPreviewAttachment(a);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const blob = await fetchAttachmentBlob(a);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (e: any) {
      setPreviewError(e?.message ?? String(e));
      toast.error("Could not open file: " + (e?.message ?? e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadAttachment = async (a: PartnerAttachment) => {
    try {
      const blob = await fetchAttachmentBlob(a);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      toast.error("Download failed: " + (e?.message ?? e));
    }
  };



  const count = attachments?.length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3 items-center text-center">
        <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground inline-flex items-center gap-2 justify-center">
          <Paperclip className="h-4 w-4" /> Attachments ({count})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Uploader row */}
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-md border bg-muted/20">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" />
            {pendingFiles.length > 0
              ? `${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} chosen`
              : "Choose file"}
          </Button>
          <Input
            placeholder="Label (optional) — e.g. Term Sheet, NDA"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-9 flex-1 min-w-[200px]"
            disabled={uploading}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleUpload}
            disabled={uploading || pendingFiles.length === 0}
            className="gap-1.5"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload
          </Button>
        </div>

        {/* List */}
        {attachments && attachments.length > 0 ? (
          <div className="space-y-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="p-2.5 rounded-md border bg-muted/20 hover:bg-muted/40 transition-colors flex items-center gap-3"
              >
                <AttachmentIcon contentType={a.content_type} fileName={a.file_name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        if (isPdfAttachment(a)) downloadAttachment(a);
                        else openAttachment(a);
                      }}
                      className="text-sm font-medium truncate text-primary hover:underline text-left"
                    >
                      {a.file_name}
                    </button>
                    {a.label && (
                      <Badge variant="secondary" className="text-[10px]">
                        {a.label}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                    {a.file_size != null && <span>{formatFileSize(a.file_size)}</span>}
                    <span>·</span>
                    <span>{new Date(a.created_at).toLocaleDateString()}</span>
                    {a.uploaded_by && (
                      <>
                        <span>·</span>
                        <span className="truncate">{a.uploaded_by}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => downloadAttachment(a)}
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(a)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No attachments yet. Upload deal docs, term sheets, or NDAs to keep them with this partner.
          </p>
        )}
      </CardContent>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.file_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmDelete) return;
                del.mutate(
                  {
                    id: confirmDelete.id,
                    partner_id: confirmDelete.partner_id,
                    storage_path: confirmDelete.storage_path,
                  },
                  {
                    onSuccess: () => {
                      toast.success("Attachment deleted");
                      setConfirmDelete(null);
                    },
                    onError: (err: any) =>
                      toast.error("Delete failed: " + (err?.message ?? err)),
                  },
                );
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!previewAttachment}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewAttachment(null);
            setPreviewUrl(null);
            setPreviewError(null);
            setPreviewLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-5xl p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b">
            <DialogTitle className="text-base truncate pr-8">{previewAttachment?.file_name}</DialogTitle>
            <DialogDescription>
              {previewAttachment?.file_size != null ? formatFileSize(previewAttachment.file_size) : "Attachment preview"}
            </DialogDescription>
          </DialogHeader>
          <div className="h-[72vh] bg-muted/20">
            {previewLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading preview…
              </div>
            ) : previewError ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <FileIcon className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Preview unavailable: {previewError}</p>
                {previewAttachment && (
                  <Button type="button" size="sm" onClick={() => downloadAttachment(previewAttachment)} className="gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                )}
              </div>
            ) : previewAttachment && previewUrl && canPreviewAttachment(previewAttachment) ? (
              (previewAttachment.content_type || "").startsWith("image/") ? (
                <div className="h-full w-full flex items-center justify-center p-4">
                  <img src={previewUrl} alt={previewAttachment.file_name} className="max-h-full max-w-full object-contain" />
                </div>
              ) : (
                <iframe title={previewAttachment.file_name} src={previewUrl} className="h-full w-full border-0" />
              )
            ) : previewAttachment ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <AttachmentIcon contentType={previewAttachment.content_type} fileName={previewAttachment.file_name} />
                <p className="text-sm text-muted-foreground">This file type cannot be previewed in the browser.</p>
                <Button type="button" size="sm" onClick={() => downloadAttachment(previewAttachment)} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
