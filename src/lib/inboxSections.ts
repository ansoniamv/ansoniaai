import { tierKey } from "@/lib/tier";

/**
 * The Deal Inbox is organised by fit, not by day, so the acquisitions team can
 * work it like an inbox: approve or deny Strong/Medium deals and watch them
 * leave. Accepted deals live on the pipeline page and are not shown here.
 */
export type InboxSectionKey = "unscored" | "strong" | "medium" | "other" | "denied";

export const INBOX_SECTIONS: {
  key: InboxSectionKey;
  title: string;
  subtitle?: string;
  defaultOpen: boolean;
}[] = [
  { key: "unscored", title: "Awaiting Score", subtitle: "Moves to its tier once scored", defaultOpen: true },
  { key: "strong", title: "Strong Fit", defaultOpen: true },
  { key: "medium", title: "Medium Fit", defaultOpen: true },
  { key: "other", title: "Screened Out / Other Deals", subtitle: "Maybe, skip, and gate-filtered", defaultOpen: false },
  { key: "denied", title: "Denied", defaultOpen: false },
];

type SectionableDeal = {
  fit_tier: string | null;
  gate_status: string | null;
  denied: boolean | null;
  reviewed?: boolean | null;
  accepted_deal_id: string | null;
  email_received_at: string | null;
  denied_at?: string | null;
  reviewed_at?: string | null;
};

/** Which section a deal belongs in, or null if it has gone to the pipeline. */
export function inboxSectionFor(d: SectionableDeal): InboxSectionKey | null {
  if (d.accepted_deal_id) return null;
  // "Mark Reviewed" was retired; deals cleared that way without an approve or
  // deny are treated as passed on. Accept and deny both set reviewed too.
  if (d.denied || d.reviewed) return "denied";
  if (d.gate_status === "filtered") return "other";
  if (d.fit_tier == null) return "unscored";
  const t = tierKey(d.fit_tier);
  if (t === "strong" || t === "medium") return t;
  return "other";
}

// Newest first; undated rows sink to the bottom.
const newestFirst = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return b.localeCompare(a);
};

/**
 * Bucket deals into sections, each sorted newest email first. Denied is sorted
 * by when it was denied, so a mistaken denial is at the top to restore.
 */
export function bucketInboxDeals<T extends SectionableDeal>(deals: T[]): Record<InboxSectionKey, T[]> {
  const out: Record<InboxSectionKey, T[]> = { unscored: [], strong: [], medium: [], other: [], denied: [] };
  for (const d of deals) {
    const k = inboxSectionFor(d);
    if (k) out[k].push(d);
  }
  for (const k of Object.keys(out) as InboxSectionKey[]) {
    out[k].sort((a, b) =>
      k === "denied"
        ? newestFirst(
            a.denied_at ?? a.reviewed_at ?? a.email_received_at,
            b.denied_at ?? b.reviewed_at ?? b.email_received_at,
          )
        : newestFirst(a.email_received_at, b.email_received_at),
    );
  }
  return out;
}
