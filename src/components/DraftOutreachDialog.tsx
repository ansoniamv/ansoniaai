import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, ExternalLink, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Engagement } from "@/hooks/useCapitalRaiseEngagements";
import type { Deal } from "@/hooks/useDeals";

const fmtCurrency = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
};

function fillTokens(tpl: string, ctx: Record<string, string>) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? "");
}

const DEFAULT_SUBJECT = "{{deal_name}} — capital partner intro";
const DEFAULT_BODY =
  `Hi {{contact_first_name}},\n\n` +
  `Wanted to share a new opportunity we're raising on: {{deal_name}}. We're targeting {{target_raise}} in equity ` +
  `and thought it might fit {{partner_name}}'s box.\n\n` +
  `Happy to send the deck and underwriting if you'd like to take a look.\n\n` +
  `Best,\n{{owner}}`;

type Recipient = {
  engagement: Engagement;
  contactId: string | null;
  contactName: string | null;
  email: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal;
  engagements: Engagement[];
}

export function DraftOutreachDialog({ open, onOpenChange, deal, engagements }: Props) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<
    { partner: string; ok: boolean; webLink?: string; error?: string }[] | null
  >(null);

  const eligible = useMemo(
    () => engagements.filter((e) => e.stage !== "passed" && e.stage !== "committed"),
    [engagements],
  );

  useEffect(() => {
    if (!open) return;
    setResults(null);
    const partnerIds = eligible.map((e) => e.partner_id);
    if (partnerIds.length === 0) {
      setRecipients([]);
      return;
    }
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("partner_contacts")
        .select("id, partner_id, name, email")
        .in("partner_id", partnerIds);
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const byPartner = new Map<string, { id: string; name: string | null; email: string | null }[]>();
      for (const c of (data as any[]) || []) {
        const arr = byPartner.get(c.partner_id) || [];
        arr.push({ id: c.id, name: c.name, email: c.email });
        byPartner.set(c.partner_id, arr);
      }
      const recs: Recipient[] = eligible.map((e) => {
        const list = byPartner.get(e.partner_id) || [];
        const withEmail = list.find((c) => c.email && c.email.trim());
        return {
          engagement: e,
          contactId: withEmail?.id ?? null,
          contactName: withEmail?.name ?? list[0]?.name ?? null,
          email: withEmail?.email ?? null,
        };
      });
      setRecipients(recs);
      setSelected(new Set(recs.filter((r) => r.email).map((r) => r.engagement.id)));
      setLoading(false);
    })();
  }, [open, eligible]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildCtx = (r: Recipient): Record<string, string> => ({
    partner_name: r.engagement.partner_name || "your team",
    contact_first_name: (r.contactName || "").split(" ")[0] || "there",
    deal_name: (deal as any).property_name || "our current deal",
    target_raise: fmtCurrency((deal as any).target_raise),
    committed: fmtCurrency((deal as any).total_committed),
    owner: r.engagement.owner || "the Ansonia team",
  });

  const firstSelected = recipients.find((r) => selected.has(r.engagement.id) && r.email);
  const previewCtx = firstSelected ? buildCtx(firstSelected) : null;
  const previewSubject = previewCtx ? fillTokens(subject, previewCtx) : subject;
  const previewBody = previewCtx ? fillTokens(body, previewCtx) : body;

  const selectedWithEmail = recipients.filter((r) => selected.has(r.engagement.id) && r.email);

  const submit = async () => {
    if (selectedWithEmail.length === 0) {
      toast.error("Select at least one recipient with an email");
      return;
    }
    setSubmitting(true);
    const out: { partner: string; ok: boolean; webLink?: string; error?: string }[] = [];
    for (const r of selectedWithEmail) {
      const ctx = buildCtx(r);
      try {
        const { data, error } = await supabase.functions.invoke("outlook-draft", {
          body: {
            to: [r.email!],
            subject: fillTokens(subject, ctx),
            text: fillTokens(body, ctx),
            partnerId: r.engagement.partner_id,
            partnerContactId: r.contactId,
            dealId: deal.id,
          },
        });
        if (error) {
          // Try to surface Graph detail
          let detail = error.message;
          try {
            const ctx2 = (error as any).context;
            if (ctx2?.text) detail = await ctx2.text();
          } catch {
            /* ignore */
          }
          out.push({ partner: r.engagement.partner_name || "Partner", ok: false, error: detail });
        } else if ((data as any)?.error) {
          out.push({
            partner: r.engagement.partner_name || "Partner",
            ok: false,
            error: `${(data as any).error}${(data as any).detail ? `: ${(data as any).detail}` : ""}`,
          });
        } else {
          out.push({
            partner: r.engagement.partner_name || "Partner",
            ok: true,
            webLink: (data as any)?.webLink,
          });
        }
      } catch (e) {
        out.push({
          partner: r.engagement.partner_name || "Partner",
          ok: false,
          error: (e as Error).message,
        });
      }
    }
    setSubmitting(false);
    setResults(out);
    const ok = out.filter((o) => o.ok).length;
    const failed = out.length - ok;
    const skipped = recipients.filter((r) => selected.has(r.engagement.id) && !r.email).length;
    if (ok > 0)
      toast.success(`Created ${ok} draft${ok === 1 ? "" : "s"} in Atlas · ${skipped} skipped · ${failed} failed`);
    else toast.error(`No drafts created · ${failed} failed`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Draft Outreach Email</DialogTitle>
          <DialogDescription>
            Create personalized draft emails in the Atlas mailbox for each selected pipeline partner.
            Nothing is sent — review and send from Outlook Drafts.
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="flex-1 overflow-auto space-y-2">
            <div className="text-sm font-medium">Results</div>
            {results.map((r, i) => (
              <div
                key={i}
                className="flex items-start justify-between gap-2 rounded-sm border p-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.partner}</div>
                  {!r.ok && (
                    <div className="text-destructive break-words mt-0.5">{r.error}</div>
                  )}
                </div>
                {r.ok && r.webLink ? (
                  <a
                    href={r.webLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1 shrink-0"
                  >
                    Open draft <ExternalLink className="h-3 w-3" />
                  </a>
                ) : r.ok ? (
                  <Badge variant="secondary">Draft created</Badge>
                ) : (
                  <Badge variant="destructive">Failed</Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 overflow-auto space-y-4">
            {/* Recipients */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs">Recipients (pipeline partners)</Label>
                <div className="text-[11px] text-muted-foreground">
                  {selectedWithEmail.length} selected
                </div>
              </div>
              <ScrollArea className="h-40 rounded-sm border">
                <div className="p-1.5 space-y-1">
                  {loading && (
                    <div className="text-xs text-muted-foreground p-2">Loading contacts…</div>
                  )}
                  {!loading && recipients.length === 0 && (
                    <div className="text-xs text-muted-foreground p-2">
                      No eligible partners in this raise.
                    </div>
                  )}
                  {recipients.map((r) => {
                    const hasEmail = !!r.email;
                    return (
                      <label
                        key={r.engagement.id}
                        className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs ${
                          hasEmail ? "hover:bg-muted/50 cursor-pointer" : "opacity-60"
                        }`}
                      >
                        <Checkbox
                          checked={selected.has(r.engagement.id)}
                          onCheckedChange={() => hasEmail && toggle(r.engagement.id)}
                          disabled={!hasEmail}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {r.engagement.partner_name || "Unknown partner"}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {hasEmail ? (
                              <>
                                {r.contactName ? `${r.contactName} · ` : ""}
                                {r.email}
                              </>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-500 inline-flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                no email on file — add a contact
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {r.engagement.stage}
                        </Badge>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Template */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">Subject</Label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Body</Label>
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={10}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="text-[10px] text-muted-foreground leading-relaxed">
                  Tokens:{" "}
                  <code>{"{{partner_name}}"}</code> <code>{"{{contact_first_name}}"}</code>{" "}
                  <code>{"{{deal_name}}"}</code> <code>{"{{target_raise}}"}</code>{" "}
                  <code>{"{{committed}}"}</code> <code>{"{{owner}}"}</code>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  Preview {firstSelected ? `— ${firstSelected.engagement.partner_name}` : ""}
                </Label>
                <div className="rounded-sm border bg-muted/30 p-2 text-xs h-full min-h-[240px]">
                  <div className="font-medium mb-1 break-words">{previewSubject}</div>
                  <div className="whitespace-pre-wrap text-muted-foreground break-words">
                    {previewBody}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {results ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting || selectedWithEmail.length === 0}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Mail className="h-4 w-4 mr-1" />
                )}
                Create {selectedWithEmail.length} draft{selectedWithEmail.length === 1 ? "" : "s"} in Outlook
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
