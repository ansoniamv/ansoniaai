import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ChangeRow } from "@/lib/partnerFeed";
import { CRITERIA_FIELDS, type NoteRow, type QuickNoteRow } from "@/lib/capitalFeed";

const ROW_LIMIT = 500;

export const FEED_EMOJIS = ["👍", "🔥", "👀", "✅", "💡", "⚠️"] as const;
export type FeedEmoji = (typeof FEED_EMOJIS)[number];

export type FeedComment = {
  id: string;
  item_key: string;
  body: string;
  author_id: string;
  author_label: string | null;
  created_at: string;
  updated_at: string;
};

export type FeedReaction = {
  item_key: string;
  user_id: string;
  emoji: string;
  user_label: string | null;
};

/** User notes, quick notes and criteria changes on capital partners in the last `days`. */
export function useCapitalFeed(days: number) {
  return useQuery({
    queryKey: ["capital-feed", days],
    queryFn: async (): Promise<{ notes: NoteRow[]; quickNotes: QuickNoteRow[]; changes: ChangeRow[] }> => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const db = supabase as any;
      const [notes, quickNotes, changes] = await Promise.all([
        db.from("notes")
          .select("id,entity_id,content,content_format,classification_summary,author,team_member_id,created_at,team_members(full_name)")
          .eq("entity_type", "partner")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(ROW_LIMIT),
        db.from("partner_interactions")
          .select("id,partner_id,content,author,interaction_date,created_at")
          .eq("interaction_type", "note")
          .gte("interaction_date", since)
          .order("interaction_date", { ascending: false })
          .limit(ROW_LIMIT),
        db.from("partner_change_log")
          .select("id,partner_id,field,old_value,new_value,changed_by_label,source,changed_at,source_ref")
          .in("field", [...CRITERIA_FIELDS])
          .gte("changed_at", since)
          .order("changed_at", { ascending: false })
          .limit(ROW_LIMIT * 4),
      ]);
      for (const r of [notes, quickNotes, changes]) if (r.error) throw r.error;
      return { notes: notes.data ?? [], quickNotes: quickNotes.data ?? [], changes: changes.data ?? [] };
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Comments and reactions written in the window. A comment always comes after
 * its story, so the story window covers every comment on a visible story.
 */
export function useFeedSocial(days: number) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("capital-feed-social")
      .on("postgres_changes", { event: "*", schema: "public", table: "capital_feed_comments" }, () =>
        qc.invalidateQueries({ queryKey: ["capital-feed-social"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "capital_feed_reactions" }, () =>
        qc.invalidateQueries({ queryKey: ["capital-feed-social"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  return useQuery({
    queryKey: ["capital-feed-social", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const db = supabase as any;
      const [comments, reactions] = await Promise.all([
        db.from("capital_feed_comments")
          .select("id,item_key,body,author_id,author_label,created_at,updated_at")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(5000),
        db.from("capital_feed_reactions")
          .select("item_key,user_id,emoji,user_label")
          .gte("created_at", since)
          .limit(10000),
      ]);
      const commentsByKey = new Map<string, FeedComment[]>();
      for (const c of (comments.error ? [] : comments.data ?? []) as FeedComment[]) {
        const list = commentsByKey.get(c.item_key);
        if (list) list.push(c); else commentsByKey.set(c.item_key, [c]);
      }
      const reactionsByKey = new Map<string, FeedReaction[]>();
      for (const r of (reactions.error ? [] : reactions.data ?? []) as FeedReaction[]) {
        const list = reactionsByKey.get(r.item_key);
        if (list) list.push(r); else reactionsByKey.set(r.item_key, [r]);
      }
      // Missing tables (migration not applied) disable the social bar instead of breaking the feed.
      return { commentsByKey, reactionsByKey, available: !comments.error && !reactions.error };
    },
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemKey, body }: { itemKey: string; body: string }) => {
      const { error } = await (supabase as any).from("capital_feed_comments").insert({ item_key: itemKey, body: body.trim() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capital-feed-social"] }),
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("capital_feed_comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capital-feed-social"] }),
  });
}

export function useToggleReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemKey, emoji, userId, on }: { itemKey: string; emoji: string; userId: string; on: boolean }) => {
      const db = supabase as any;
      const { error } = on
        ? await db.from("capital_feed_reactions").insert({ item_key: itemKey, emoji })
        : await db.from("capital_feed_reactions").delete().eq("item_key", itemKey).eq("emoji", emoji).eq("user_id", userId);
      // A double click can race into a duplicate insert; the reaction is already there.
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capital-feed-social"] }),
  });
}
