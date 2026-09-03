import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface ComposeEmailDialogProps {
  trigger: React.ReactNode;
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
  partnerId?: string;
  partnerContactId?: string;
  dealId?: string;
}

export function ComposeEmailDialog({
  trigger, defaultTo = "", defaultSubject = "", defaultBody = "",
  partnerId, partnerContactId, dealId,
}: ComposeEmailDialogProps) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      toast({ title: "Missing fields", description: "To, subject and body are required.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("outlook-send", {
        body: {
          to: to.split(",").map((s) => s.trim()).filter(Boolean),
          cc: cc.split(",").map((s) => s.trim()).filter(Boolean),
          subject,
          text: body,
          partnerId, partnerContactId, dealId,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast({ title: "Email sent" });
      setOpen(false);
      setBody(defaultBody); setCc("");
    } catch (e) {
      toast({ title: "Send failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New email</DialogTitle>
          <DialogDescription>Sent from the connected Outlook inbox.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cc (comma-separated)</Label>
            <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Message</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
