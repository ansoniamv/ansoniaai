/**
 * Connect a personal Fathom account so Atlas can search recorded calls.
 *
 * Sign-in goes through Fathom (OAuth). Until Fathom approves our app, or when
 * the server has no OAuth credentials, a personal API key from Fathom's
 * Settings → API Access works instead. Keys and tokens go straight to the
 * fathom function, which encrypts them; this page never stores them.
 */
import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { callFathom, fathomRedirectUri, useFathomAction, useFathomStatus } from "@/hooks/useFathom";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function FathomConnectionCard() {
  const { data: status, isLoading, error } = useFathomStatus();
  const action = useFathomAction();
  const [apiKey, setApiKey] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const conn = status?.connection ?? null;
  const oauth = !!status?.oauth_available;

  const signIn = async () => {
    setRedirecting(true);
    try {
      const { url } = await callFathom<{ url: string }>({ action: "oauth_start", redirect_uri: fathomRedirectUri() });
      window.location.assign(url);
    } catch (e) {
      toast.error(errMsg(e));
      setRedirecting(false);
    }
  };

  const connectKey = () => {
    action.mutate(
      { action: "connect_api_key", api_key: apiKey.trim() },
      {
        onSuccess: () => {
          setApiKey("");
          setKeyOpen(false);
          toast.success("Fathom connected. Your last 30 days of calls are syncing.");
        },
        onError: (e) => toast.error(errMsg(e)),
      },
    );
  };

  const keyForm = (
    <div className="space-y-2">
      <Label htmlFor="fathom-api-key" className="text-xs">Fathom API key</Label>
      <div className="flex gap-2">
        <Input
          id="fathom-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste your key"
        />
        <Button size="sm" onClick={connectKey} disabled={action.isPending || apiKey.trim().length < 10}>
          {action.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Connect
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        In Fathom, open Settings → API Access and generate a key. It's encrypted before it's stored.
      </p>
    </div>
  );

  const connectControls = oauth ? (
    <div className="space-y-3">
      <Button size="sm" onClick={signIn} disabled={redirecting}>
        {redirecting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
        {conn ? "Reconnect Fathom" : "Connect Fathom"}
      </Button>
      <Collapsible open={keyOpen} onOpenChange={setKeyOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Use an API key instead
          <ChevronDown className={`h-3 w-3 transition-transform ${keyOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">{keyForm}</CollapsibleContent>
      </Collapsible>
    </div>
  ) : (
    keyForm
  );

  return (
    <Card className="surface-card border-hairline">
      <CardHeader>
        <CardTitle className="text-base">Your connection</CardTitle>
        <CardDescription>
          Connect your Fathom account so Atlas can answer questions about your calls with partners, brokers and sellers.
          The platform keeps the last 30 days of calls that had someone from outside Ansonia on them, and the whole team
          can search them. Internal calls are never brought in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{errMsg(error)}</div>
        ) : !conn ? (
          connectControls
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="text-sm space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  Connected
                  {conn.status === "active" && <Badge variant="secondary">Active</Badge>}
                  {conn.status === "needs_reconnect" && <Badge variant="destructive">Reconnect needed</Badge>}
                  {conn.status === "error" && <Badge variant="outline">Sync problem</Badge>}
                </div>
                <div className="text-muted-foreground">
                  {conn.auth_method === "oauth" ? "Signed in with Fathom" : "Using an API key"}
                  {" · "}
                  {conn.last_synced_at
                    ? `last synced ${formatDistanceToNowStrict(new Date(conn.last_synced_at), { addSuffix: true })}`
                    : "first sync in progress"}
                </div>
                <div className="text-muted-foreground">
                  {conn.meetings} {conn.meetings === 1 ? "call" : "calls"} from your account
                  {conn.pending > 0 && ` (${conn.pending} still fetching)`}
                  {" · "}
                  {status?.team_meetings ?? 0} across the team
                </div>
                {!conn.webhook && (
                  <div className="text-xs text-muted-foreground">
                    New calls arrive within about 10 minutes.
                  </div>
                )}
                {conn.last_error && conn.status !== "active" && (
                  <div className="text-xs text-destructive">{conn.last_error}</div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ action: "sync_now" }, {
                      onSuccess: () => toast.success("Syncing your Fathom calls"),
                      onError: (e) => toast.error(errMsg(e)),
                    })
                  }
                >
                  Sync now
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" disabled={action.isPending}>Disconnect</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disconnect Fathom?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This deletes the {conn.meetings} {conn.meetings === 1 ? "call" : "calls"} your account brought in,
                        so Atlas can no longer search them. Your recordings in Fathom aren't touched.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          action.mutate({ action: "disconnect" }, {
                            onSuccess: () => toast.success("Fathom disconnected"),
                            onError: (e) => toast.error(errMsg(e)),
                          })
                        }
                      >
                        Disconnect
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            {conn.status === "needs_reconnect" && connectControls}
          </>
        )}
      </CardContent>
    </Card>
  );
}
