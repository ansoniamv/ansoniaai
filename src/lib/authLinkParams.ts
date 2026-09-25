// Snapshot of the auth-link parameters (type, token_hash, error…) in the URL the
// app was opened with. Imported first from main.tsx so it runs before the
// Supabase client exists: supabase-js strips the #access_token…&type=invite hash
// once it has turned it into a session, and /reset-password is lazy-loaded, so
// by the time that page mounts the hash may already be gone.
function parse(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of [window.location.hash.replace(/^#/, ""), window.location.search.replace(/^\?/, "")]) {
    if (!part) continue;
    for (const kv of part.split("&")) {
      const [k, v] = kv.split("=");
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }
  return out;
}

export const initialAuthLinkParams: Readonly<Record<string, string>> = parse();
