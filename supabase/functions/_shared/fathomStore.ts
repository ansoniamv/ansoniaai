// Writing Fathom meetings into fathom_meetings / fathom_transcript_chunks.
// Shared by the fathom function (sync) and fathom-webhook (push).

import type { FathomActionItem, FathomMeeting, FathomTranscriptItem } from "./fathomApi.ts";
import { chunkTranscript, matchPartners, meetingRow } from "./fathomIngest.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped client, as in the other functions
type Db = any;

export type PartnerContact = { partner_id: string; email: string | null };

export async function loadPartnerContacts(admin: Db): Promise<PartnerContact[]> {
  const { data, error } = await admin
    .from("partner_contacts")
    .select("partner_id, email")
    .not("email", "is", null)
    .limit(10000);
  if (error) throw new Error(`partner_contacts: ${error.message}`);
  return data ?? [];
}

/** Meeting metadata only, content to follow. Never overwrites a meeting already stored. */
export async function storePendingMeeting(
  admin: Db,
  m: FathomMeeting,
  syncedBy: string,
  contacts: PartnerContact[],
) {
  const row = meetingRow(m);
  const { error } = await admin.from("fathom_meetings").upsert(
    {
      ...row,
      synced_by: syncedBy,
      action_items: m.action_items ?? [],
      partner_ids: matchPartners(m.calendar_invitees ?? [], contacts),
      content_status: "pending",
    },
    { onConflict: "recording_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`fathom_meetings pending upsert: ${error.message}`);
}

/**
 * The whole meeting with its content: replaces the row and its transcript
 * chunks. `synced_by` is kept when the meeting is already stored, so a call
 * two users both have stays with whoever brought it in first.
 */
export async function storeMeetingContent(
  admin: Db,
  m: FathomMeeting,
  content: {
    syncedBy: string;
    summary: string | null;
    actionItems: FathomActionItem[] | null | undefined;
    transcript: FathomTranscriptItem[];
  },
  contacts: PartnerContact[],
) {
  const row = meetingRow(m);
  const { data: existing } = await admin
    .from("fathom_meetings")
    .select("synced_by")
    .eq("recording_id", row.recording_id)
    .maybeSingle();

  const { error } = await admin.from("fathom_meetings").upsert(
    {
      ...row,
      synced_by: existing?.synced_by ?? content.syncedBy,
      summary_md: content.summary,
      action_items: content.actionItems ?? [],
      partner_ids: matchPartners(m.calendar_invitees ?? [], contacts),
      content_status: "ready",
    },
    { onConflict: "recording_id" },
  );
  if (error) throw new Error(`fathom_meetings upsert: ${error.message}`);

  const del = await admin.from("fathom_transcript_chunks").delete().eq("recording_id", row.recording_id);
  if (del.error) throw new Error(`fathom_transcript_chunks delete: ${del.error.message}`);

  const chunks = chunkTranscript(content.transcript).map((c) => ({ ...c, recording_id: row.recording_id }));
  for (let i = 0; i < chunks.length; i += 200) {
    const ins = await admin.from("fathom_transcript_chunks").insert(chunks.slice(i, i + 200));
    if (ins.error) throw new Error(`fathom_transcript_chunks insert: ${ins.error.message}`);
  }
  return { chunks: chunks.length };
}
