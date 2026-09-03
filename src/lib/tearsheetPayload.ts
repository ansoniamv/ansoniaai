/**
 * Deal IDs must NOT travel in the URL — a full pipeline overruns edge URL limits.
 * The export dialog stashes the selection under a short token; the tearsheet reads it.
 */
export type TearsheetPayload = {
  partnerId: string;
  dealIds: string[];
  showScore: boolean;
  includeOutside: boolean;
  savedAt: number;
};

const PREFIX = "tearsheet:";
const TTL_MS = 24 * 60 * 60 * 1000;

/** Hard cap — a 300-row tearsheet is not a document anyone reads. */
export const MAX_TEARSHEET_DEALS = 150;

export function sweepTearsheetPayloads() {
  try {
    const now = Date.now();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(PREFIX)) continue;
      try {
        const p = JSON.parse(localStorage.getItem(key) ?? "null") as TearsheetPayload | null;
        if (!p || typeof p.savedAt !== "number" || now - p.savedAt > TTL_MS) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* storage unavailable */
  }
}

export function saveTearsheetPayload(payload: Omit<TearsheetPayload, "savedAt">): string {
  sweepTearsheetPayloads();
  const token = crypto.randomUUID().slice(0, 8);
  localStorage.setItem(PREFIX + token, JSON.stringify({ ...payload, savedAt: Date.now() }));
  return token;
}

export function readTearsheetPayload(token: string | null): TearsheetPayload | null {
  if (!token) return null;
  try {
    const raw = localStorage.getItem(PREFIX + token);
    if (!raw) return null;
    const p = JSON.parse(raw) as TearsheetPayload;
    if (!p || !Array.isArray(p.dealIds) || typeof p.savedAt !== "number") return null;
    if (Date.now() - p.savedAt > TTL_MS) return null;
    return p;
  } catch {
    return null;
  }
}
