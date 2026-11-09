// Turning a Fathom meeting into our rows: transcript chunks for search, the
// partners a call was with, and the fathom_meetings row itself.
//
// No Deno-only imports: src/test imports this module under vitest.

import type { FathomInvitee, FathomMeeting, FathomTranscriptItem } from "./fathomApi.ts";

export const OWN_DOMAINS = ["ansoniaproperties.com"];

// A domain shared by unrelated people says nothing about which firm they're at.
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "comcast.net", "att.net", "verizon.net",
]);

export type TranscriptChunk = { seq: number; speakers: string; start_ts: string | null; content: string };

/**
 * Groups transcript lines into chunks of about `maxChars`, breaking only
 * between lines so a speaker's sentence is never split. Each line keeps its
 * speaker ("Jane Doe: …") so a search hit can say who said it. A single line
 * longer than maxChars becomes its own chunk.
 */
export function chunkTranscript(items: FathomTranscriptItem[], maxChars = 1500): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let lines: string[] = [];
  let speakers: string[] = [];
  let start: string | null = null;
  let size = 0;

  const flush = () => {
    if (lines.length === 0) return;
    chunks.push({ seq: chunks.length, speakers: speakers.join(", "), start_ts: start, content: lines.join("\n") });
    lines = [];
    speakers = [];
    start = null;
    size = 0;
  };

  for (const item of items) {
    const text = (item.text ?? "").trim();
    if (!text) continue;
    const speaker = item.speaker?.display_name?.trim() || "Unknown speaker";
    const line = `${speaker}: ${text}`;
    if (size > 0 && size + line.length + 1 > maxChars) flush();
    if (lines.length === 0) start = item.timestamp || null;
    if (!speakers.includes(speaker)) speakers.push(speaker);
    lines.push(line);
    size += line.length + 1;
  }
  flush();
  return chunks;
}

function domainOf(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 0) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

/**
 * Which partners a call was with. An invitee whose email is a known partner
 * contact matches that partner; otherwise an invitee at a domain used by a
 * partner's contacts matches every partner using that domain. Our own domain
 * and free-mail domains never match by domain.
 */
export function matchPartners(
  invitees: FathomInvitee[],
  contacts: { partner_id: string; email: string | null }[],
  ownDomains: string[] = OWN_DOMAINS,
): string[] {
  const own = new Set(ownDomains.map((d) => d.toLowerCase()));
  const byEmail = new Map<string, Set<string>>();
  const byDomain = new Map<string, Set<string>>();

  for (const c of contacts) {
    const email = c.email?.trim().toLowerCase();
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, new Set());
    byEmail.get(email)!.add(c.partner_id);
    const d = domainOf(email);
    if (d && !own.has(d) && !FREE_MAIL_DOMAINS.has(d)) {
      if (!byDomain.has(d)) byDomain.set(d, new Set());
      byDomain.get(d)!.add(c.partner_id);
    }
  }

  const matched = new Set<string>();
  for (const inv of invitees) {
    const email = inv.email?.trim().toLowerCase();
    if (!email) continue;
    const exact = byEmail.get(email);
    if (exact) {
      exact.forEach((id) => matched.add(id));
      continue;
    }
    const d = domainOf(email);
    if (d) byDomain.get(d)?.forEach((id) => matched.add(id));
  }
  return [...matched].sort();
}

/** The fathom_meetings columns that come from Fathom's meeting object. */
export function meetingRow(m: FathomMeeting) {
  return {
    recording_id: m.recording_id,
    title: m.meeting_title || m.title || "Untitled meeting",
    started_at: m.recording_start_time ?? m.scheduled_start_time ?? m.created_at ?? null,
    ended_at: m.recording_end_time ?? m.scheduled_end_time ?? null,
    recorded_by_name: m.recorded_by?.name ?? null,
    recorded_by_email: m.recorded_by?.email ?? null,
    share_url: m.share_url ?? m.url ?? null,
    invitees: (m.calendar_invitees ?? []).map((i) => ({
      name: i.name ?? null,
      email: i.email ?? null,
      is_external: i.is_external ?? null,
    })),
  };
}

/** True when a meeting payload already carries its content (API key list, webhook). */
export function hasInlineContent(m: FathomMeeting): boolean {
  return Array.isArray(m.transcript) || m.default_summary != null;
}
