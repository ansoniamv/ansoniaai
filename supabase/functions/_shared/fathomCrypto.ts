// AES-GCM encryption for Fathom credentials at rest.
//
// The key is FATHOM_TOKEN_KEY: 32 random bytes, base64. A stored value is
// "v1:" + base64(12-byte IV || ciphertext+tag), so a row read on its own (a
// backup, a leaked dump) holds nothing usable without the function secret.
//
// No Deno-only imports: src/test imports this module under vitest.

const PREFIX = "v1:";

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64);
  if (raw.length !== 32) throw new Error("FATHOM_TOKEN_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return PREFIX + b64encode(out);
}

/** Throws on a wrong key or a tampered value (the GCM tag fails). */
export async function decryptSecret(stored: string, keyB64: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) throw new Error("Unrecognised encrypted value");
  const key = await importKey(keyB64);
  const buf = b64decode(stored.slice(PREFIX.length));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf.slice(0, 12) },
    key,
    buf.slice(12),
  );
  return new TextDecoder().decode(plain);
}
