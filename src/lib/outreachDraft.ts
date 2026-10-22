/**
 * The AI outreach draft marks what it could not fill as [[CFO date]]. None of
 * those may reach a partner, so the dialog lists them and holds the drafts
 * until each one is filled in or removed.
 */
export function unfilledPlaceholders(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(/\[\[([^\]\n]*)\]\]/g)) found.add(m[1].trim() || "(blank)");
  }
  return [...found];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Token values go into an HTML body, so a partner named "A & B" stays text. */
export function fillTokensHtml(tpl: string, ctx: Record<string, string>) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => escapeHtml(ctx[k] ?? ""));
}

const BULLET = /^\s*[*\-•]\s+/;

/**
 * The drafter writes plain text: blank lines between paragraphs and "*" or "-"
 * bullets, as the template does. The body editor is rich text, so the draft is
 * turned into paragraphs and real lists that can then be bolded, re-listed and
 * so on.
 */
export function outreachTextToHtml(text: string): string {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    let lines: string[] = [];
    let items: string[] = [];
    const flush = () => {
      if (lines.length) out.push(`<p>${lines.map(escapeHtml).join("<br>")}</p>`);
      if (items.length) out.push(`<ul>${items.map((i) => `<li><p>${escapeHtml(i)}</p></li>`).join("")}</ul>`);
      lines = [];
      items = [];
    };
    for (const raw of block.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (BULLET.test(line)) {
        if (lines.length) {
          out.push(`<p>${lines.map(escapeHtml).join("<br>")}</p>`);
          lines = [];
        }
        items.push(line.replace(BULLET, ""));
      } else {
        if (items.length) flush();
        lines.push(line);
      }
    }
    flush();
  }
  return out.join("");
}

/**
 * The editor's HTML as an Outlook body: in the house font, and with the empty
 * paragraphs a double Enter leaves kept as blank lines rather than collapsed.
 */
export function outreachEmailHtml(html: string): string {
  const body = html.replace(/<p><\/p>/g, "<p><br></p>");
  return `<div style="font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt;">${body}</div>`;
}
