import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import ansoniaLogoAsset from "@/assets/ansonia-logo.png.asset.json";
const ansoniaLogo = ansoniaLogoAsset.url;

const COMPANY_DOMAIN = "@ansoniaproperties.com";

const schema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

// Signup is limited to company addresses. This check is only for a fast, clear
// error — the real gate is the handle_new_user trigger, which aborts the insert
// server-side, so bypassing this form achieves nothing.
const signUpSchema = schema.extend({
  email: z
    .string()
    .trim()
    .email("Invalid email")
    .max(255)
    .refine((v) => v.toLowerCase().endsWith(COMPANY_DOMAIN), {
      message: `Accounts are limited to ${COMPANY_DOMAIN} addresses`,
    }),
});

type Mode = "signin" | "signup" | "forgot";

export default function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const forgotMode = mode === "forgot";

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate("/", { replace: true });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signUpSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setSubmitting(false);
    if (error) {
      // The trigger raises a check_violation for a non-company domain; surface
      // that plainly rather than the raw Postgres wording.
      toast.error(
        /check_violation|ansoniaproperties/i.test(error.message)
          ? `Accounts are limited to ${COMPANY_DOMAIN} addresses.`
          : error.message,
      );
      return;
    }
    // Email confirmation is on, so there is no session yet.
    if (!data.session) {
      toast.success("Check your email to confirm your account, then sign in.");
      setMode("signin");
      setPassword("");
      return;
    }
    navigate("/", { replace: true });
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailParsed = z.string().trim().email().safeParse(email);
    if (!emailParsed.success) {
      toast.error("Enter a valid email");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailParsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("If the email is registered, a reset link was sent.");
    setForgotMode(false);
  };

  const labelCls =
    "block text-[11px] font-light uppercase text-white/90";
  const inputCls =
    "w-full h-11 px-3 text-sm text-white bg-white/[0.08] border border-[#6aa3d8]/40 rounded-[3px] outline-none transition-colors placeholder:text-white/45 focus:border-[#6aa3d8] focus:bg-white/[0.12]";

  return (
    <div
      className="min-h-screen flex items-start justify-center pt-24 p-6 relative"
      style={{
        backgroundColor: "#002752",
        fontFamily: "'Raleway', 'Montserrat', system-ui, sans-serif",
        fontWeight: 300,
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;600&display=swap"
      />

      <div className="w-full max-w-sm">
        {/* Logo lockup */}
        <div className="flex flex-col items-center">
          <img
            src={ansoniaLogo}
            alt="Ansonia Properties"
            className="h-24 w-auto"
          />
          <p
            className="text-white text-sm uppercase my-10"
            style={{ letterSpacing: "0.28em", fontWeight: 300 }}
          >
            Ansonia Acquisitions
          </p>
        </div>

        {/* Form sits on dark background; hairline accent border defines the panel
            and echoes the input border treatment. */}
        <div className="bg-white/[0.03] p-8 border border-[#6aa3d8]/25 rounded-[3px]">
          <h1
            className="text-center text-white text-sm mb-1"
            style={{ letterSpacing: "0.24em", fontWeight: 300 }}
          >
            {mode === "forgot" ? "RESET PASSWORD" : mode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}
          </h1>
          <div
            className="mx-auto mb-8 h-px w-10 bg-[#6aa3d8]/60"
            aria-hidden
          />

          {forgotMode ? (
            <form onSubmit={handleForgot} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className={labelCls}
                  style={{ letterSpacing: "0.12em" }}
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputCls}
                />
              </div>
              <PrimaryButton submitting={submitting}>SEND RESET LINK</PrimaryButton>
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="block w-full text-center text-xs text-[#6aa3d8]/80 hover:text-[#6aa3d8] transition-colors"
                style={{ letterSpacing: "0.12em" }}
              >
                BACK TO SIGN IN
              </button>
            </form>
          ) : mode === "signup" ? (
            <form onSubmit={handleSignUp} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="signup-email" className={labelCls} style={{ letterSpacing: "0.12em" }}>
                  Work Email
                </label>
                <input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  placeholder={`you${COMPANY_DOMAIN}`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputCls}
                />
                <p className="text-[10px] text-white/50" style={{ letterSpacing: "0.08em" }}>
                  Must be a {COMPANY_DOMAIN} address
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="signup-password" className={labelCls} style={{ letterSpacing: "0.12em" }}>
                  Password
                </label>
                <input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={inputCls}
                />
                <p className="text-[10px] text-white/50" style={{ letterSpacing: "0.08em" }}>
                  At least 8 characters
                </p>
              </div>
              <PrimaryButton submitting={submitting}>CREATE ACCOUNT</PrimaryButton>
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="block w-full text-center text-xs text-[#6aa3d8]/80 hover:text-[#6aa3d8] transition-colors"
                style={{ letterSpacing: "0.12em" }}
              >
                BACK TO SIGN IN
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="signin-email"
                  className={labelCls}
                  style={{ letterSpacing: "0.12em" }}
                >
                  Email
                </label>
                <input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="signin-password"
                  className={labelCls}
                  style={{ letterSpacing: "0.12em" }}
                >
                  Password
                </label>
                <input
                  id="signin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={inputCls}
                />
              </div>
              <PrimaryButton submitting={submitting}>SIGN IN</PrimaryButton>
              <button
                type="button"
                onClick={() => setMode("forgot")}
                className="block w-full text-center text-xs text-[#6aa3d8]/80 hover:text-[#6aa3d8] transition-colors"
                style={{ letterSpacing: "0.12em" }}
              >
                FORGOT PASSWORD?
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="block w-full text-center text-xs text-[#6aa3d8]/80 hover:text-[#6aa3d8] transition-colors"
                style={{ letterSpacing: "0.12em" }}
              >
                CREATE AN ACCOUNT
              </button>
            </form>
          )}

          <p
            className="text-[10px] text-white/50 text-center pt-8"
            style={{ letterSpacing: "0.12em" }}
          >
            ACCESS IS LIMITED TO {COMPANY_DOMAIN.replace("@", "").toUpperCase()} EMAIL ADDRESSES.
          </p>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: "3px", backgroundColor: "#6aa3d8" }}
        aria-hidden
      />
    </div>
  );
}

function PrimaryButton({
  submitting,
  children,
}: {
  submitting: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={submitting}
      className="w-full h-11 inline-flex items-center justify-center gap-2 text-[12px] uppercase rounded-[3px] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      style={{
        backgroundColor: "#6aa3d8",
        color: "#002752",
        fontWeight: 600,
        letterSpacing: "0.1em",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
          "rgba(106,163,216,0.85)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6aa3d8";
      }}
    >
      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
