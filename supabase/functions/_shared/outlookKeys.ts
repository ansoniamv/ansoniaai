/** Candidate env var names for the Atlas mailbox connection, in priority order. */
export const ATLAS_CANDIDATES = [
  "MICROSOFT_OUTLOOK_ATLAS_API_KEY",
  "MICROSOFT_OUTLOOK_API_KEY_1",
  "MICROSOFT_OUTLOOK_API_KEY_2",
  "MICROSOFT_OUTLOOK_API_KEY_3",
  "OUTLOOK_ATLAS_API_KEY",
  "MICROSOFT_OUTLOOK_ATLAS",
] as const;

const ACQ_NAME = "MICROSOFT_OUTLOOK_API_KEY";

export type KeyResolution = {
  key: string | null;
  /** Which env var supplied it — safe to log and display. Never log the value. */
  name: string | null;
  /** Env var names checked and found present (names only). */
  present: string[];
  /** True when the resolved Atlas key is byte-identical to the acquisitions key. */
  collidesWithAcquisitions: boolean;
};

export function resolveAcquisitionsKey(): { key: string | null; name: string | null } {
  const v = Deno.env.get(ACQ_NAME);
  return { key: v || null, name: v ? ACQ_NAME : null };
}

export function resolveAtlasKey(): KeyResolution {
  const acq = Deno.env.get(ACQ_NAME) || null;
  const present: string[] = [];
  let key: string | null = null;
  let name: string | null = null;

  for (const n of ATLAS_CANDIDATES) {
    const v = Deno.env.get(n);
    if (!v) continue;
    present.push(n);
    if (!key) {
      key = v;
      name = n;
    }
  }
  return {
    key,
    name,
    present,
    collidesWithAcquisitions: !!key && !!acq && key === acq,
  };
}
