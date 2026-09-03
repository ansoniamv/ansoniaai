import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const schema = z.string().min(8, "Password must be at least 8 characters").max(200);

function parseHashParams(): Record<string, string> {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const search = window.location.search.startsWith("?") ? window.location.search.slice(1) : window.location.search;
  const out: Record<string, string> = {};
  for (const part of [hash, search]) {
    if (!part) continue;
    for (const kv of part.split("&")) {
      const [k, v] = kv.split("=");
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }
  return out;
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    // Check URL for error params from Supabase auth redirect
    const params = parseHashParams();
    if (params.error || params.error_code || params.error_description) {
      const code = params.error_code || params.error || "";
      const desc = params.error_description?.replace(/\+/g, " ") || "";
      let friendly = desc || "This link is invalid or has expired.";
      if (/expired/i.test(code + desc)) {
        friendly = "This invite/reset link has expired. Request a new one below.";
      } else if (/otp|access_denied|invalid/i.test(code + desc)) {
        friendly =
          "This link is no longer valid. It may have already been used or pre-opened by an email security scanner. Request a new one below.";
      }
      setLinkError(friendly);
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    // Fallback: if after 4s we have no session and no error, treat as bad link
    const t = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) {
          setLinkError("We couldn't validate this link. Request a new one below.");
        }
      });
    }, 4000);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(password);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated. Welcome!");
    navigate("/", { replace: true });
  };

  const requestNewLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailParsed = z.string().trim().email().safeParse(resendEmail);
    if (!emailParsed.success) {
      toast.error("Enter a valid email");
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailParsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("If the email is registered, a new link was sent. Check your inbox.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Set your password</CardTitle>
          <CardDescription>
            {linkError
              ? "Link issue"
              : ready
                ? "Choose a password to finish setting up your account."
                : "Validating link…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkError ? (
            <div className="space-y-4">
              <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                <p>{linkError}</p>
              </div>
              <form onSubmit={requestNewLink} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="resend-email">Your email</Label>
                  <Input
                    id="resend-email"
                    type="email"
                    autoComplete="email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={resending}>
                  {resending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send me a new link
                </Button>
                <button
                  type="button"
                  onClick={() => navigate("/auth")}
                  className="text-sm text-muted-foreground hover:text-foreground w-full text-center"
                >
                  Back to sign in
                </button>
              </form>
            </div>
          ) : (
            ready && (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save password
                </Button>
              </form>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
