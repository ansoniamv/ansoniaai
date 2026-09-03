import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type OutlookMessage = Tables<"outlook_messages">;

// Lightweight columns for the list view. Excludes body_html/body_text/raw which
// can be ~50KB each and cause statement timeouts when selected for 200 rows.
const LIST_COLUMNS =
  "id,message_id,conversation_id,subject,preview,from_email,from_name,to_recipients,received_at,sent_at,is_read,has_attachments,importance,web_link,folder,partner_id,partner_contact_id,deal_id";

export function useOutlookMessages(filters?: { partnerId?: string; dealId?: string; unreadOnly?: boolean }) {
  return useQuery({
    queryKey: ["outlook_messages", filters],
    queryFn: async () => {
      let q = supabase
        .from("outlook_messages")
        .select(LIST_COLUMNS)
        .order("received_at", { ascending: false })
        .limit(200);
      if (filters?.partnerId) q = q.eq("partner_id", filters.partnerId);
      if (filters?.dealId) q = q.eq("deal_id", filters.dealId);
      if (filters?.unreadOnly) q = q.eq("is_read", false);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as OutlookMessage[];
    },
  });
}

export type LatestPartnerEmail = {
  partner_id: string;
  last_at: string;              // ISO
  direction: "inbound" | "outbound";
  subject: string | null;
  message_id: string;           // outlook_messages.id
};

/**
 * Batched: one query returning the single most recent message per partner
 * for a set of partner ids. Used to power Kanban card email badges without
 * spawning N per-card queries.
 */
export function useLatestPartnerEmails(partnerIds: string[]) {
  const key = [...new Set(partnerIds)].filter(Boolean).sort();
  return useQuery({
    queryKey: ["outlook_messages", "latest_by_partner", key],
    enabled: key.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outlook_messages")
        .select("id,partner_id,folder,received_at,sent_at,subject")
        .in("partner_id", key)
        .order("received_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const latest = new Map<string, LatestPartnerEmail>();
      for (const m of (data || []) as any[]) {
        if (!m.partner_id || latest.has(m.partner_id)) continue;
        latest.set(m.partner_id, {
          partner_id: m.partner_id,
          last_at: m.received_at || m.sent_at,
          direction: m.folder === "inbox" ? "inbound" : "outbound",
          subject: m.subject ?? null,
          message_id: m.id,
        });
      }
      return latest;
    },
    staleTime: 60_000,
  });
}

export function useOutlookMessageBody(id: string | undefined) {
  return useQuery({
    queryKey: ["outlook_message_body", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outlook_messages")
        .select("id,body_html,body_text,cc_recipients")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSyncOutlook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts?: { top?: number; folder?: string }) => {
      const { data, error } = await supabase.functions.invoke("outlook-sync", { body: opts || {} });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { ok: boolean; fetched: number; upserted: number; matched: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outlook_messages"] }),
  });
}

export function useLinkMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dealId, partnerId, partnerContactId }: {
      id: string; dealId?: string | null; partnerId?: string | null; partnerContactId?: string | null;
    }) => {
      const update: Record<string, string | null> = {};
      if (dealId !== undefined) update.deal_id = dealId;
      if (partnerId !== undefined) update.partner_id = partnerId;
      if (partnerContactId !== undefined) update.partner_contact_id = partnerContactId;
      const { error } = await supabase.from("outlook_messages").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outlook_messages"] }),
  });
}

/**
 * Fetch the additional deal ids linked to a message via the outlook_message_deals
 * link table. The primary `deal_id` column on outlook_messages is kept in sync
 * as the "first" deal for backward compatibility with existing queries.
 */
export function useMessageDeals(messageId: string | undefined) {
  return useQuery({
    queryKey: ["outlook_message_deals", messageId],
    enabled: !!messageId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("outlook_message_deals")
        .select("deal_id")
        .eq("message_id", messageId!);
      if (error) throw error;
      return ((data || []) as Array<{ deal_id: string }>).map((r) => r.deal_id);
    },
  });
}

export function useSetMessageDeals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dealIds }: { id: string; dealIds: string[] }) => {
      const unique = [...new Set(dealIds)];
      // Rewrite link table
      const del = await (supabase as any)
        .from("outlook_message_deals")
        .delete()
        .eq("message_id", id);
      if (del.error) throw del.error;
      if (unique.length > 0) {
        const rows = unique.map((deal_id) => ({ message_id: id, deal_id }));
        const ins = await (supabase as any)
          .from("outlook_message_deals")
          .insert(rows);
        if (ins.error) throw ins.error;
      }
      // Keep the legacy single-deal column pointing at the first selection
      const primary = unique[0] ?? null;
      const upd = await supabase
        .from("outlook_messages")
        .update({ deal_id: primary })
        .eq("id", id);
      if (upd.error) throw upd.error;
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["outlook_message_deals", vars.id] });
      qc.invalidateQueries({ queryKey: ["outlook_messages"] });
    },
  });
}
