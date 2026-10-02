/**
 * The Pipeline "CFO" cell holds either a call-for-offers date or free text
 * ("Off Market", "Broker to advise"). Two columns back it:
 *   cfo_date — a real date, so the column still sorts chronologically
 *   cfo_note — free text, shown when there is no date (or beside one)
 *
 * One input feeds both. A leading date ("10/15/26", "10/15", "2026-10-15")
 * becomes cfo_date and anything after it becomes cfo_note; input that does
 * not start with a valid date is stored whole as cfo_note.
 */
export type CfoValue = { cfo_date: string | null; cfo_note: string | null };

const pad = (n: number) => String(n).padStart(2, "0");

const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Valid calendar date? Rejects 2/30, 13/1 and friends. */
function isRealDate(y: number, m: number, d: number) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function parseCfoInput(raw: string, today: Date = new Date()): CfoValue {
  const s = raw.trim();
  if (!s) return { cfo_date: null, cfo_note: null };

  let y: number | null = null;
  let m = 0;
  let d = 0;
  let rest = "";

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?![\d-])(.*)$/);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])(.*)$/);
  if (iso) {
    y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); rest = iso[4];
  } else if (us) {
    m = Number(us[1]); d = Number(us[2]); rest = us[4];
    if (us[3]) {
      y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    } else {
      // No year typed: this year, unless that lands well in the past — a
      // December entry of "1/10" means next January's call for offers.
      y = today.getFullYear();
      const candidate = new Date(y, m - 1, d);
      const ninetyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90);
      if (candidate < ninetyDaysAgo) y += 1;
    }
  }

  if (y != null && isRealDate(y, m, d)) {
    const note = rest.replace(/^[\s,;:–—-]+/, "").trim();
    return { cfo_date: toIso(y, m, d), cfo_note: note || null };
  }
  return { cfo_date: null, cfo_note: s };
}

/** "2026-10-15" → "10/15/26" */
export function formatCfoDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(-2)}`;
}

/** The text the editor opens with — round-trips through parseCfoInput. */
export function cfoToInput(v: Partial<CfoValue>) {
  const date = v.cfo_date ? formatCfoDate(v.cfo_date) : "";
  const note = v.cfo_note?.trim() ?? "";
  return [date, note].filter(Boolean).join(" ");
}

/** "2026-10-15" → local Date (never via the UTC-parsing Date constructor). */
export function cfoDateToLocal(iso: string | null | undefined) {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function localToCfoDate(dt: Date) {
  return toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}
