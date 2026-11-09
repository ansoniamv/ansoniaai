// Fathom webhook signature check (Standard Webhooks / svix format).
//
// Signed content is `${webhook-id}.${webhook-timestamp}.${raw body}`, HMAC-SHA256
// with the base64-decoded part of the secret after "whsec_". The
// webhook-signature header is a space-separated list of "v1,<base64>" entries;
// any one matching is enough. Timestamps outside a 5-minute window are refused
// so a captured delivery can't be replayed later.
//
// No Deno-only imports: src/test imports this module under vitest.

const TOLERANCE_SECONDS = 5 * 60;

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signWebhook(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const keyBytes = b64decode(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return b64encode(new Uint8Array(sig));
}

export async function verifyFathomWebhook(opts: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  body: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const { secret, id, timestamp, signatureHeader, body } = opts;
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  // Digits only: Number("") is 0 and Number("1e9") parses, neither is a timestamp.
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const expected = await signWebhook(secret, id, timestamp, body);
  return signatureHeader
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => {
      const comma = part.indexOf(",");
      if (comma < 0 || part.slice(0, comma) !== "v1") return false;
      return constantTimeEqual(part.slice(comma + 1), expected);
    });
}
