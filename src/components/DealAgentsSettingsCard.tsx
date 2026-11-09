/**
 * Admin settings for the CA agent: who it signs as, the deal-portal logins it
 * may use, and the switch that lets it sign at all.
 *
 * Portal passwords go straight to the deal-agents function, which stores them
 * in the Anthropic vault; they are never saved in this app's database, and the
 * agent's sandbox only sees a placeholder that is swapped for the password on
 * the portal's own hosts.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type SignerProfile,
  useDealAgentsAdmin,
  useDealAgentsStatus,
  useSignerProfile,
  useUpdateSignerProfile,
} from "@/hooks/useDealAgents";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Hosts each portal signs in on. RCM also serves brokers' own domains. */
const PORTAL_HOSTS: Record<string, string> = {
  rcm: "rcm1.com, *.rcm1.com, cbredealflow.com, *.cbredealflow.com",
  buildout: "buildout.com, *.buildout.com",
  crexi: "crexi.com, *.crexi.com",
  docusign: "docusign.net, *.docusign.net, docusign.com, *.docusign.com",
};

const FIELDS: { key: keyof SignerProfile; label: string }[] = [
  { key: "full_name", label: "Full name" },
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "address_line", label: "Street address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "ZIP" },
];

export function DealAgentsSettingsCard() {
  const { data: profile } = useSignerProfile();
  const { data: status, isLoading: statusLoading } = useDealAgentsStatus();
  const update = useUpdateSignerProfile();
  const adminCall = useDealAgentsAdmin();

  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!profile) return;
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, (profile[f.key] as string | null) ?? ""])));
  }, [profile]);

  const [login, setLogin] = useState({ platform: "rcm", username: "acquisitions@ansoniaproperties.com", password: "", hosts: PORTAL_HOSTS.rcm });
  const sigRef = useRef<HTMLInputElement>(null);
  const [sigUploading, setSigUploading] = useState(false);

  const saveProfile = () => {
    const patch = Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key]?.trim() || null]));
    if (!patch.full_name || !patch.company || !patch.email) {
      toast.error("Name, company and email are required.");
      return;
    }
    update.mutate(patch as never, {
      onSuccess: () => toast.success("Signer saved"),
      onError: (e) => toast.error(errMsg(e)),
    });
  };

  const uploadSignature = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/png$/.test(file.type) || file.size > 2_000_000) {
      toast.error("Use a PNG under 2 MB, ideally a transparent signature.");
      return;
    }
    setSigUploading(true);
    try {
      const path = `signer/signature-${Date.now()}.png`;
      const { error } = await supabase.storage.from("agent-files").upload(path, file, { contentType: "image/png" });
      if (error) throw error;
      await update.mutateAsync({ signature_path: path });
      toast.success("Signature saved");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSigUploading(false);
      if (sigRef.current) sigRef.current.value = "";
    }
  };

  const saveLogin = () => {
    adminCall.mutate(
      {
        action: "save_login",
        platform: login.platform.trim().toLowerCase(),
        username: login.username.trim(),
        password: login.password,
        hosts: login.hosts.split(",").map((h) => h.trim()).filter(Boolean),
      },
      {
        onSuccess: () => {
          toast.success("Login saved to the vault");
          setLogin((l) => ({ ...l, password: "" }));
        },
        onError: (e) => toast.error(errMsg(e)),
      },
    );
  };

  const canEnable = !!status?.configured && !!profile?.full_name;

  return (
    <Card className="surface-card border-hairline">
      <CardHeader>
        <CardTitle className="text-base">Deal agents</CardTitle>
        <CardDescription>
          When a deal is added from the inbox, the CA agent signs its confidentiality agreement as the signer below and
          brings the OM, rent roll and T12 onto the deal. CAs with unusual terms wait on the deal page for approval.
          Underwriting attachments on a pipeline deal's emails are copied onto the deal either way.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Agent */}
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm">
            <div className="font-medium">Agent</div>
            <div className="text-muted-foreground">
              {statusLoading
                ? "Checking…"
                : !status?.configured
                  ? "Not set up yet."
                  : status.up_to_date
                    ? `Set up. Each run is capped at $${status.run_budget_usd}.`
                    : "Set up, but the definition changed. Update it."}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={adminCall.isPending || (!!status?.configured && status.up_to_date)}
            onClick={() =>
              adminCall.mutate({ action: "setup" }, {
                onSuccess: () => toast.success("Agent set up"),
                onError: (e) => toast.error(errMsg(e)),
              })
            }
          >
            {adminCall.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {status?.configured ? "Update" : "Set up"}
          </Button>
        </div>

        {/* On/off */}
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm">
            <div className="font-medium">Sign CAs automatically</div>
            <div className="text-muted-foreground">
              Off: accepting a deal records the CA link and waits for someone to press Sign CA on the deal page.
            </div>
          </div>
          <Switch
            checked={!!profile?.enabled}
            disabled={!canEnable || update.isPending}
            onCheckedChange={(v) =>
              update.mutate({ enabled: v }, {
                onSuccess: () => toast.success(v ? "CA signing on" : "CA signing off"),
                onError: (e) => toast.error(errMsg(e)),
              })
            }
          />
        </div>

        {/* Signer */}
        <div className="space-y-3">
          <div className="text-sm font-medium">Signer</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`signer-${f.key}`} className="text-xs">{f.label}</Label>
                <Input
                  id={`signer-${f.key}`}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={saveProfile} disabled={update.isPending}>Save signer</Button>
            <input ref={sigRef} type="file" accept="image/png" className="hidden" onChange={(e) => uploadSignature(e.target.files?.[0])} />
            <Button size="sm" variant="outline" onClick={() => sigRef.current?.click()} disabled={sigUploading}>
              {sigUploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
              {profile?.signature_path ? "Replace signature image" : "Upload signature image"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Used only where a portal asks for an image; most CAs take the typed name.
            </span>
          </div>
        </div>

        {/* Logins */}
        <div className="space-y-3">
          <div className="text-sm font-medium">Portal logins</div>
          {(status?.logins ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet. Most CA links in the inbox are RCM Lightbox, which signs inside the firm's RCM account.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {status!.logins.map((l) => (
                <div key={l.platform} className="flex items-center justify-between py-2 text-sm">
                  <div className="min-w-0">
                    <Badge variant="outline" className="font-mono text-[10px] uppercase mr-2">{l.platform}</Badge>
                    {l.username}
                    <div className="text-xs text-muted-foreground truncate">{l.hosts.join(", ")}</div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${l.platform} login`}
                    onClick={() =>
                      adminCall.mutate({ action: "delete_login", platform: l.platform }, {
                        onSuccess: () => toast.success("Login removed"),
                        onError: (e) => toast.error(errMsg(e)),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="login-platform" className="text-xs">Portal</Label>
              <Input
                id="login-platform"
                value={login.platform}
                placeholder="rcm, buildout, crexi, docusign"
                onChange={(e) => {
                  const p = e.target.value;
                  setLogin((l) => ({ ...l, platform: p, hosts: PORTAL_HOSTS[p.trim().toLowerCase()] ?? l.hosts }));
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="login-username" className="text-xs">Username</Label>
              <Input id="login-username" value={login.username} onChange={(e) => setLogin((l) => ({ ...l, username: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="login-password" className="text-xs">Password</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="new-password"
                value={login.password}
                onChange={(e) => setLogin((l) => ({ ...l, password: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="login-hosts" className="text-xs">Hosts the password may be sent to</Label>
              <Input id="login-hosts" value={login.hosts} onChange={(e) => setLogin((l) => ({ ...l, hosts: e.target.value }))} />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={saveLogin}
            disabled={adminCall.isPending || !status?.configured || !login.password || !login.username || !login.platform}
          >
            Save login
          </Button>
          <p className="text-xs text-muted-foreground">
            The password goes to the Anthropic vault and is never stored in this app. Verification codes are read from
            the acquisitions mailbox, so the login's email should be acquisitions@.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
