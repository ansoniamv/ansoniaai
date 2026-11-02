/**
 * Finds where in an email a suggestion's quote comes from. Pure: shared by
 * summarize-partner-pass (to pick the email) and the Atlas Inbox (to
 * highlight it).
 *
 * Pass notes paraphrase the partner ("Stratton went risk off on Columbus over
 * new supply" for "We are risk off on Columbus at the moment due to new
 * supply concerns"), so an exact match is tried first, then the sentence
 * sharing the most distinctive words and numbers with the quote.
 */

const STOP = new Set([
  "about", "after", "also", "ansonia", "been", "being", "both", "could", "does", "each", "even", "from",
  "have", "here", "into", "just", "like", "more", "most", "much", "only", "other", "over", "said",
  "should", "some", "such", "than", "that", "their", "them", "then", "there", "these", "they", "this",
  "those", "very", "want", "went", "were", "what", "when", "which", "while", "will", "with", "would",
  "your", "thanks", "phillip", "deal",
]);

/** Distinctive tokens: numbers count double, since "$15M" pins a passage better than any word. */
function tokens(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const lower = s.toLowerCase();
  for (const n of lower.match(/\d+(?:\.\d+)?/g) ?? []) out.set(n, 2);
  for (const w of lower.match(/[a-z]{4,}/g) ?? []) {
    if (STOP.has(w)) continue;
    out.set(w.replace(/(ies|es|s)$/, ""), 1);
  }
  return out;
}

const squashWs = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Exact match ignoring whitespace and case: [start, end) in the original text. */
export function findExact(text: string, quote: string): [number, number] | null {
  const q = squashWs(quote);
  if (q.length < 8) return null;
  const map: number[] = [];
  let norm = "";
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (prevSpace || norm.length === 0) continue;
      norm += " "; map.push(i); prevSpace = true;
    } else {
      norm += ch.toLowerCase(); map.push(i); prevSpace = false;
    }
  }
  const at = norm.indexOf(q);
  if (at < 0) return null;
  return [map[at], (map[at + q.length - 1] ?? text.length - 1) + 1];
}

/** Sentence spans: split after . ! ? followed by whitespace, and at line breaks. */
function sentences(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const re = /[.!?](?=\s)|\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + 1;
    if (end - start > 1) spans.push([start, end]);
    start = end;
  }
  if (start < text.length) spans.push([start, text.length]);
  return spans
    .map(([s, e]) => {
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      return [s, e] as [number, number];
    })
    .filter(([s, e]) => e - s >= 12 && e - s <= 600);
}

export type QuoteMatch = { start: number; end: number; exact: boolean; score: number };

/** Below this share of the quote's weight, a sentence is not shown as its source. */
const MIN_COVERAGE = 0.35;

/**
 * Where the quote is in the text: the exact words, or the sentence sharing
 * the most of them (at least two tokens and MIN_COVERAGE of the weight).
 * Ties go to the earliest sentence. Null when nothing is close enough.
 */
export function matchQuote(text: string, quote: string | null | undefined): QuoteMatch | null {
  if (!text || !quote) return null;
  const exact = findExact(text, quote);
  if (exact) return { start: exact[0], end: exact[1], exact: true, score: 1 };
  const want = tokens(quote);
  const total = [...want.values()].reduce((a, b) => a + b, 0);
  if (want.size < 2) return null;
  let best: QuoteMatch | null = null;
  for (const [s, e] of sentences(text)) {
    const have = tokens(text.slice(s, e));
    let got = 0;
    let hits = 0;
    for (const [t, w] of want) if (have.has(t)) { got += w; hits++; }
    const score = got / total;
    if (hits >= 2 && score >= MIN_COVERAGE && (!best || score > best.score)) {
      best = { start: s, end: e, exact: false, score };
    }
  }
  return best;
}
