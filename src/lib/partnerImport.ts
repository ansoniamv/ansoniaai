// Helpers for the Partner Import page (src/pages/PartnerImportPage.tsx).

const FIRM_SUFFIXES = new Set([
  "llc", "lp", "llp", "inc", "co", "corp", "corporation", "company", "ltd",
  "group", "partners", "capital", "management", "holdings", "investments", "advisors", "the",
]);

/** "The Carlyle Group, L.P." → "carlyle". Suffix words are dropped so near-names compare equal. */
export function normalizeFirmName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const core = words.filter((w) => !FIRM_SUFFIXES.has(w));
  // A name made only of suffix words ("Capital Partners") keeps them all.
  return (core.length ? core : words).join(" ");
}

/**
 * Existing partners that are probably the firm being imported: the same name
 * once suffixes are dropped, or one name containing the other as whole words.
 * Archived partners count — re-importing one should restore it, not duplicate it.
 */
export function findSimilarPartners<T extends { name: string }>(name: string, partners: T[]): T[] {
  const target = normalizeFirmName(name);
  if (!target) return [];
  const padded = ` ${target} `;
  return partners.filter((p) => {
    const other = normalizeFirmName(p.name);
    if (!other) return false;
    if (other === target) return true;
    const shorter = other.length < target.length ? other : target;
    // Containment on a one-short-word name ("ag", "jll") matches too much.
    if (shorter.length < 4) return false;
    return padded.includes(` ${other} `) || ` ${other} `.includes(padded);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Pasted plain text → the paragraph HTML the notes editor stores. */
export function notesToHtml(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}
