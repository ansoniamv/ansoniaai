/**
 * The two panes of an email reader: a list row and the full-message detail with
 * partner / deal tagging. Shared by the Acquisitions Inbox (/outlook) and the
 * Atlas Inbox's Unattributed tab (/suggestions) so both read the same way.
 */
import type { ReactNode } from "react";
import { ExternalLink, Paperclip, Link2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DealMultiLink } from "@/components/DealMultiLink";
import { EmailBody } from "@/components/EmailBody";
import { LinkCombobox } from "@/components/LinkCombobox";
import { safeExternalUrl } from "@/lib/safeUrl";
import { cn } from "@/lib/utils";
import { useOutlookMessageBody, type OutlookMessage } from "@/hooks/useOutlook";

type Recipient = { emailAddress?: { address?: string; name?: string } };

function recipients(list: unknown): string {
  if (!Array.isArray(list)) return "";
  return (list as Recipient[])
    .map((r) => {
      const name = r.emailAddress?.name;
      const addr = r.emailAddress?.address;
      return name && addr && name !== addr ? `${name} <${addr}>` : addr || name;
    })
    .filter(Boolean)
    .join(", ");
}

export function EmailMessageRow({ msg, active, onClick }: { msg: OutlookMessage; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "w-full text-left p-3 hover:bg-muted/50 transition-colors",
          active && "bg-muted",
          !msg.is_read && "border-l-2 border-l-primary",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn("text-sm truncate", !msg.is_read ? "font-semibold" : "font-medium")}>
                {msg.from_name || msg.from_email || "Unknown"}
              </span>
              {msg.has_attachments && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
            </div>
            <div className="text-sm truncate mt-0.5">{msg.subject || "(no subject)"}</div>
            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5 break-words">{msg.preview}</div>
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {msg.received_at ? formatDistanceToNow(new Date(msg.received_at), { addSuffix: false }) : ""}
          </div>
        </div>
        {(msg.partner_id || msg.deal_id) && (
          <div className="flex gap-1 mt-2">
            {msg.partner_id && <Badge variant="secondary" className="text-[10px]"><Link2 className="h-2.5 w-2.5 mr-1" />Partner</Badge>}
            {msg.deal_id && <Badge variant="secondary" className="text-[10px]"><Link2 className="h-2.5 w-2.5 mr-1" />Deal</Badge>}
          </div>
        )}
      </button>
    </li>
  );
}

export function EmailMessageDetail({
  msg,
  partners,
  deals,
  onPartnerChange,
  linking,
  partnerPlaceholder = "Link partner",
  notice,
  tagging,
}: {
  msg: OutlookMessage;
  partners: Array<{ id: string; name: string }>;
  deals: Array<{ id: string; property_name: string }>;
  onPartnerChange?: (partnerId: string | null) => void;
  linking: boolean;
  partnerPlaceholder?: string;
  /** Optional line under the tagging controls (e.g. what tagging will trigger). */
  notice?: ReactNode;
  /** Replaces the default save-on-click partner / deal controls. */
  tagging?: ReactNode;
}) {
  const { data: bodyRow, isLoading: bodyLoading } = useOutlookMessageBody(msg.id);
  const to = recipients(msg.to_recipients);
  const cc = recipients(bodyRow?.cc_recipients);
  const link = safeExternalUrl(msg.web_link);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-4 border-b space-y-2 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold leading-tight break-words min-w-0">{msg.subject || "(no subject)"}</h2>
          {link && (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <a href={link} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Open
              </a>
            </Button>
          )}
        </div>
        <div className="text-sm break-words">
          <span className="font-medium">{msg.from_name || msg.from_email || "Unknown"}</span>{" "}
          {msg.from_email && <span className="text-muted-foreground">&lt;{msg.from_email}&gt;</span>}
        </div>
        <div className="text-xs text-muted-foreground break-words">To: {to || "—"}</div>
        {cc && <div className="text-xs text-muted-foreground break-words">Cc: {cc}</div>}
        <div className="text-xs text-muted-foreground">
          {msg.received_at && format(new Date(msg.received_at), "PPp")}
        </div>

        {tagging ?? (
          <div className="flex flex-wrap gap-2 pt-2">
            <LinkCombobox
              kind="partner"
              items={partners.map((p) => ({ id: p.id, label: p.name }))}
              value={msg.partner_id}
              onChange={(v) => onPartnerChange?.(v)}
              disabled={linking}
              placeholder={partnerPlaceholder}
            />
            <DealMultiLink messageId={msg.id} fallbackDealId={msg.deal_id} deals={deals} />
          </div>
        )}
        {notice && <div className="text-xs text-muted-foreground">{notice}</div>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-muted/30 p-4">
        {bodyLoading ? (
          <div className="text-sm text-muted-foreground">Loading message…</div>
        ) : (
          <EmailBody
            key={msg.id}
            html={bodyRow?.body_html}
            text={bodyRow?.body_text || msg.preview}
            title={msg.subject || "Email message"}
          />
        )}
      </div>
    </div>
  );
}
