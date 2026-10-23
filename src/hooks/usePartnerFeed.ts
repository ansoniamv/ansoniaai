import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { groupChanges, sortFeed, type ChangeRow, type FeedItem } from "@/lib/partnerFeed";

// Caps per source so a busy 90-day window can't pull thousands of rows.
const EMAIL_LIMIT = 1000;
const ROW_LIMIT = 500;

/**
 * Everything that happened across capital partners in the last `days`:
 * emails, notes, logged interactions, new firms, new contacts, field changes.
 */
export function usePartnerFeed(days: number) {
  return useQuery({
    queryKey: ["partner-feed", days],
    queryFn: async (): Promise<FeedItem[]> => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const db = supabase as any;
      const [emails, notes, logged, partners, contacts, changes] = await Promise.all([
        db.from("outlook_messages")
          .select("id,partner_id,subject,preview,from_name,from_email,folder,received_at,sent_at")
          .not("partner_id", "is", null)
          .gte("received_at", since)
          .order("received_at", { ascending: false })
          .limit(EMAIL_LIMIT),
        db.from("notes")
          .select("id,entity_id,content,content_format,author,created_at,team_members(full_name)")
          .eq("entity_type", "partner")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(ROW_LIMIT),
        db.from("partner_interactions")
          .select("id,partner_id,interaction_type,fact_category,content,author,source,interaction_date,created_at")
          .gte("interaction_date", since)
          .order("interaction_date", { ascending: false })
          .limit(ROW_LIMIT),
        db.from("partners")
          .select("id,name,firm_type,data_source,created_at")
          .gte("created_at", since)
          .limit(ROW_LIMIT),
        db.from("partner_contacts")
          .select("id,partner_id,name,role,email,created_at")
          .gte("created_at", since)
          .limit(ROW_LIMIT),
        db.from("partner_change_log")
          .select("id,partner_id,field,old_value,new_value,changed_by_label,source,changed_at")
          .gte("changed_at", since)
          .order("changed_at", { ascending: false })
          .limit(ROW_LIMIT * 4),
      ]);
      for (const r of [emails, notes, logged, partners, contacts]) if (r.error) throw r.error;

      const items: FeedItem[] = [];
      for (const m of emails.data ?? []) {
        const sent = /sent/i.test(m.folder ?? "");
        items.push({
          key: `e-${m.id}`, kind: "email", at: m.received_at ?? m.sent_at, partnerId: m.partner_id, sent,
          title: m.subject || "(no subject)",
          byline: sent ? "Sent" : `From ${m.from_name || m.from_email || "unknown sender"}`,
          snippet: m.preview,
        });
      }
      for (const n of notes.data ?? []) {
        items.push({
          key: `n-${n.id}`, kind: "note", at: n.created_at, partnerId: n.entity_id,
          title: "Note", byline: n.team_members?.full_name ?? n.author,
          note: { content: n.content, format: n.content_format },
        });
      }
      for (const i of logged.data ?? []) {
        items.push({
          key: `i-${i.id}`, kind: "logged", at: i.interaction_date || i.created_at, partnerId: i.partner_id,
          title: i.fact_category ? `${i.interaction_type} · ${i.fact_category}` : i.interaction_type,
          byline: i.author ?? i.source, snippet: i.content,
        });
      }
      for (const p of partners.data ?? []) {
        items.push({
          key: `p-${p.id}`, kind: "new_partner", at: p.created_at, partnerId: p.id,
          title: "New partner added", byline: [p.firm_type, p.data_source].filter(Boolean).join(" · ") || null,
        });
      }
      for (const c of contacts.data ?? []) {
        items.push({
          key: `k-${c.id}`, kind: "new_contact", at: c.created_at, partnerId: c.partner_id,
          title: `New contact: ${c.name}`, byline: [c.role, c.email].filter(Boolean).join(" · ") || null,
        });
      }
      // The change log arrives with its migration; until that is applied the
      // feed still works, just without changes.
      if (!changes.error) items.push(...groupChanges((changes.data ?? []) as ChangeRow[]));

      return sortFeed(items);
    },
  });
}
