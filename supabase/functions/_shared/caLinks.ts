// Finding the "Sign CA" link in a broker's marketing email, and the deal-room
// link that sits next to it.
//
// Pure functions, no Deno APIs, so src/test can import them.
//
// Every href in the acquisitions mailbox is wrapped by Defender Safe Links
// (https://nam10.safelinks.protection.outlook.com/?url=<real url>&data=...), so
// links are unwrapped before anything looks at their host. A link is judged by
// both its anchor text ("SIGN CONFIDENTIALITY AGREEMENT", "Execute the
// Agreement", "Click here to sign the CA") and its URL (my.rcm1.com/buyer/agreement).

export type CaPlatform =
  | "rcm"
  | "buildout"
  | "crexi"
  | "docusign"
  | "jll"
  | "cbre"
  | "newmark"
  | "berkadia"
  | "walker_dunlop"
  | "northmarq"
  | "cushman"
  | "colliers"
  | "marcus_millichap"
  | "other";

export type EmailLink = { url: string; text: string };

export type CaLinks = {
  /** Best "sign the CA" link, or null when the email carries none. */
  ca: (EmailLink & { platform: CaPlatform }) | null;
  /** Deal-room / property-website / document-center links, best first. */
  dealRoom: EmailLink[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** The real URL behind a Safe Links wrapper (nested wrappers too); other URLs unchanged. */
export function unwrapSafeLink(raw: string): string {
  let url = decodeEntities(raw.trim());
  for (let i = 0; i < 3; i++) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return url;
    }
    if (!/(^|\.)safelinks\.protection\.outlook\.com$/i.test(u.hostname)) return url;
    const inner = u.searchParams.get("url");
    if (!inner) return url;
    url = inner;
  }
  return url;
}

/** Every <a href> in an HTML body with its visible text, unwrapped; plain-text URLs too. */
export function extractLinks(body: string): EmailLink[] {
  const out: EmailLink[] = [];
  const seen = new Set<string>();
  const push = (href: string, text: string) => {
    const url = unwrapSafeLink(href);
    if (!/^https?:\/\//i.test(url)) return;
    const clean = decodeEntities(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    const key = `${url}\u0000${clean}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url, text: clean });
  };
  const anchor = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(body))) push(m[2], m[3]);
  if (out.length === 0) {
    // Plain-text email: the label is whatever sits on the line before the URL.
    const lines = body.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const u of line.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []) {
        const label = line.replace(u, "").trim() || (lines[i - 1] ?? "").trim();
        push(u, label);
      }
    });
  }
  return out;
}

const host = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const PLATFORM_HOSTS: [RegExp, CaPlatform][] = [
  [/(^|\.)rcm1\.com$|(^|\.)lightboxre\.com$/, "rcm"],
  [/(^|\.)buildout\.com$/, "buildout"],
  [/(^|\.)crexi\.com$/, "crexi"],
  [/(^|\.)docusign\.(net|com)$/, "docusign"],
  [/(^|\.)jll\.com$|(^|\.)us\.jll\.com$/, "jll"],
  [/(^|\.)cbre\.com$|(^|\.)cbredealflow\.com$/, "cbre"],
  [/(^|\.)nmrk\.com$|(^|\.)newmark\.com$/, "newmark"],
  [/(^|\.)berkadia\.com$/, "berkadia"],
  [/(^|\.)walkerdunlop\.com$/, "walker_dunlop"],
  [/(^|\.)northmarq\.com$/, "northmarq"],
  [/(^|\.)cushwake\.com$|(^|\.)cwmultifamily\.com$/, "cushman"],
  [/(^|\.)colliers\.com$/, "colliers"],
  [/(^|\.)marcusmillichap\.com$/, "marcus_millichap"],
];

/** RCM's buyer pages, which brokers also serve from their own domains (cbredealflow.com). */
const RCM_PATH = /\/buyer\/(agreement|brochure)|\/handler\/(email|modern)\.aspx/i;

export function platformFor(url: string): CaPlatform {
  const h = host(url);
  if (RCM_PATH.test(url)) return "rcm";
  for (const [re, p] of PLATFORM_HOSTS) if (re.test(h)) return p;
  return "other";
}

// Anchor text that offers the CA itself.
const CA_TEXT =
  /\b(sign|execute|e-?sign|complete|accept|agree to)\b[^.]{0,40}\b(ca|cas|nda|confidentiality|non-?disclosure|agreement)\b|\bconfidentiality agreement\b|\bnon-?disclosure\b|^\s*(ca|nda)( link)?\s*$|\bca link\b/i;
// URL shapes of known CA pages.
const CA_URL = /\/buyer\/agreement|\/(ca|nda|confidentiality[-_]?agreement)(\/|\?|$)|[?&](ca|nda)=|docusign\.net\/Signing|powerforms\.docusign/i;
// Things that look like a CA link but are not.
const NOT_CA = /unsubscribe|privacy|terms of use|view (online|in browser)|preferences|log-view|mailto:/i;

const ROOM_TEXT =
  /\b(property website|deal ?room|document center|data ?room|virtual (deal|data) room|view (the )?(om|offering)|offering memorandum|due diligence|landing page|marketing (materials|documents)|underwriting materials|download)\b/i;
const ROOM_URL = /\/handler\/modern\.aspx|\/dealroom|\/deal-room|\/documents?\b|\/vdr\b|buildout\.com\/website|crexi\.com\/properties/i;

/** The CA link and deal-room links in one email body. */
export function findCaLinks(body: string | null | undefined): CaLinks {
  if (!body) return { ca: null, dealRoom: [] };
  const links = extractLinks(body).filter((l) => !NOT_CA.test(l.text) && !NOT_CA.test(l.url));

  const scored = links
    .map((l) => {
      let score = 0;
      if (CA_TEXT.test(l.text)) score += 2;
      if (CA_URL.test(l.url)) score += 2;
      if (platformFor(l.url) !== "other") score += 0.5;
      return { l, score };
    })
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.l ?? null;
  const ca = best ? { ...best, platform: platformFor(best.url) } : null;

  const dealRoom = links
    .filter((l) => l !== best && (ROOM_TEXT.test(l.text) || ROOM_URL.test(l.url)))
    .filter((l, i, all) => all.findIndex((o) => o.url === l.url) === i);

  return { ca, dealRoom };
}

/**
 * The CA link across a deal's emails, oldest first. The first email that
 * carries one wins: later "offers due" blasts repeat the same link, and a reply
 * thread never has one.
 */
export function findCaLinksInThread(bodies: (string | null | undefined)[]): CaLinks {
  const dealRoom: EmailLink[] = [];
  let ca: CaLinks["ca"] = null;
  for (const b of bodies) {
    const found = findCaLinks(b);
    if (!ca && found.ca) ca = found.ca;
    for (const r of found.dealRoom) if (!dealRoom.some((d) => d.url === r.url)) dealRoom.push(r);
  }
  return { ca, dealRoom: dealRoom.slice(0, 5) };
}
