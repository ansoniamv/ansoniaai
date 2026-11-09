import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { callFathom } from "@/hooks/useFathom";

/**
 * Fathom sends the user back here after sign-in with ?code&state (or ?error).
 * The code is handed to the fathom function under the user's session, which
 * checks the state and exchanges it. The state is single-use, so the effect
 * runs once even under StrictMode's double mount.
 */
export default function FathomCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = params.get("code");
    const state = params.get("state");
    if (params.get("error") || !code || !state) {
      setError("Fathom sign-in was cancelled or didn't complete.");
      return;
    }
    callFathom({ action: "oauth_complete", code, state })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["fathom_status"] });
        toast.success("Fathom connected. Your last 30 days of calls are syncing.");
        navigate("/fathom", { replace: true });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [params, navigate, qc]);

  return (
    <div className="container mx-auto max-w-3xl py-16 text-sm">
      {error ? (
        <div className="space-y-3">
          <div className="text-destructive">{error}</div>
          <Link to="/fathom" className="underline">Back to Fathom</Link>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Connecting Fathom…
        </div>
      )}
    </div>
  );
}
