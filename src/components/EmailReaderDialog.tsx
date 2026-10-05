/**
 * Read-only Outlook message reader.
 *
 * Extracted verbatim from PartnerDetail.tsx so it can be reused without
 * importing the page module. The body renders through EmailBody, the same
 * sandboxed reader the inboxes use.
 */
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { safeExternalUrl } from "@/lib/safeUrl";
import { useOutlookMessageBody, type OutlookMessage } from "@/hooks/useOutlook";
import { EmailBody } from "@/components/EmailBody";

export function EmailReaderDialog({ message, onClose }: { message: OutlookMessage | null; onClose: () => void }) {
  const { data: body, isLoading } = useOutlookMessageBody(message?.id);
  const open = !!message;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug pr-8">{message?.subject || "(no subject)"}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-1 text-xs">
              <span>
                <span className="font-medium text-foreground">{message?.from_name || message?.from_email || "Unknown"}</span>
                {message?.from_email && <span className="text-muted-foreground"> &lt;{message.from_email}&gt;</span>}
              </span>
              <span className="text-muted-foreground">
                {message?.received_at ? new Date(message.received_at).toLocaleString() : ""}
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto border-t pt-4 -mx-6 px-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading message…</p>
          ) : (
            <EmailBody
              key={message?.id}
              html={body?.body_html}
              text={body?.body_text || message?.preview}
              title={message?.subject || "Email message"}
            />
          )}
        </div>
        {safeExternalUrl(message?.web_link) && (
          <DialogFooter>
            <Button asChild variant="outline" size="sm">
              <a href={safeExternalUrl(message!.web_link)!} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Open in Outlook
              </a>
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
