/**
 * Return a safe URL string (http/https only), or null if the input is
 * missing, malformed, or uses a dangerous scheme (javascript:, data:, etc.).
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Add protocol if missing so URL() can parse bare hostnames.
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
