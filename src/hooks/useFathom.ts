import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FathomStatus = {
  oauth_available: boolean;
  team_meetings: number;
  connection: null | {
    auth_method: "oauth" | "api_key";
    status: "active" | "needs_reconnect" | "error";
    last_error: string | null;
    last_synced_at: string | null;
    connected_at: string;
    webhook: boolean;
    meetings: number;
    pending: number;
  };
};

/** Where Fathom sends the user back after sign-in. Must be in FATHOM_REDIRECT_URIS. */
export const fathomRedirectUri = () => `${window.location.origin}/integrations/fathom/callback`;

/** Pull the real message out of a FunctionsHttpError, which hides the body. */
async function invokeError(error: unknown): Promise<Error> {
  // The request never reached the function: not deployed, offline, or this
  // origin isn't in ALLOWED_ORIGINS. supabase-js says only "Failed to send a
  // request to the Edge Function".
  if ((error as { name?: string })?.name === "FunctionsFetchError") {
    return new Error("Couldn't reach the Fathom service. Try again in a minute; if it keeps happening, tell an admin.");
  }
  try {
    const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context?.json?.();
    if (body?.error) return new Error(body.error);
  } catch {
    // fall through
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function callFathom<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("fathom", { body });
  if (error) throw await invokeError(error);
  return data as T;
}

const STATUS_KEY = ["fathom_status"];

export function useFathomStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => callFathom<FathomStatus>({ action: "status" }),
    // While a first sync is filling in content, keep the counts moving.
    refetchInterval: (q) => ((q.state.data?.connection?.pending ?? 0) > 0 ? 15_000 : false),
  });
}

export function useFathomAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => callFathom<Record<string, unknown>>(body),
    onSettled: () => qc.invalidateQueries({ queryKey: STATUS_KEY }),
  });
}
