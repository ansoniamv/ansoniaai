import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserPlus, Check, X, Shield, ShieldOff, Mail } from "lucide-react";
import { toast } from "sonner";

type Status = "pending" | "approved" | "rejected";
interface Row {
  id: string;
  email: string;
  full_name: string | null;
  status: Status;
  created_at: string;
  is_admin: boolean;
}

const inviteSchema = z.object({
  email: z.string().trim().email().max(255),
  full_name: z.string().trim().max(120).optional().or(z.literal("")),
});

export default function AdminUsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: profiles, error: pErr }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,status,created_at").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id,role"),
    ]);
    if (pErr) {
      toast.error(pErr.message);
      setLoading(false);
      return;
    }
    const adminIds = new Set((roles ?? []).filter((r: any) => r.role === "admin").map((r: any) => r.user_id));
    setRows((profiles ?? []).map((p: any) => ({ ...p, is_admin: adminIds.has(p.id) })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = inviteSchema.safeParse({ email, full_name: fullName });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setInviting(true);
    const { error } = await supabase.functions.invoke("admin-invite-user", {
      body: { email: parsed.data.email, full_name: parsed.data.full_name || null },
    });
    setInviting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Invite sent to ${parsed.data.email}`);
    setEmail("");
    setFullName("");
    load();
  };

  const updateStatus = async (id: string, status: Status) => {
    const { error } = await supabase
      .from("profiles")
      .update({ status, approved_at: status === "approved" ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`User ${status}`);
    load();
  };

  const resendInvite = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return toast.error(error.message);
    toast.success(`Invite link resent to ${email}`);
  };

  const toggleAdmin = async (id: string, makeAdmin: boolean) => {
    if (makeAdmin) {
      const { error } = await supabase.from("user_roles").insert({ user_id: id, role: "admin" });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", id).eq("role", "admin");
      if (error) return toast.error(error.message);
    }
    toast.success(makeAdmin ? "Admin granted" : "Admin revoked");
    load();
  };

  const statusBadge = (s: Status) => {
    const v = s === "approved" ? "default" : s === "pending" ? "secondary" : "destructive";
    return <Badge variant={v as any}>{s}</Badge>;
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold">User Management</h1>
        <p className="text-muted-foreground">Invite teammates and approve access requests.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" /> Invite user</CardTitle>
          <CardDescription>They'll receive an email to set their password and will be auto-approved.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="invite-name">Full name (optional)</Label>
              <Input id="invite-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <Button type="submit" disabled={inviting}>
              {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send invite
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All users</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.email}</TableCell>
                    <TableCell>{r.full_name ?? "—"}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell>{r.is_admin ? <Badge>admin</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right space-x-2">
                      {r.status !== "approved" && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "approved")}>
                          <Check className="h-4 w-4 mr-1" /> Approve
                        </Button>
                      )}
                      {r.status !== "rejected" && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "rejected")}>
                          <X className="h-4 w-4 mr-1" /> Reject
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => resendInvite(r.email)}>
                        <Mail className="h-4 w-4 mr-1" /> Resend invite
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggleAdmin(r.id, !r.is_admin)}>
                        {r.is_admin ? <><ShieldOff className="h-4 w-4 mr-1" /> Revoke admin</> : <><Shield className="h-4 w-4 mr-1" /> Make admin</>}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No users yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
