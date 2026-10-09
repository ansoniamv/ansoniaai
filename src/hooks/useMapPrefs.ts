import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ACTIVE_STATUSES, DEAL_STATUSES, type DealStatus } from "@/lib/dealStatus";
import { MAP_PREF_KEY, type ColorMode } from "@/lib/mapLayers";

export type MapPrefs = {
  visible: DealStatus[];
  colorMode: ColorMode;
};

/**
 * Default view: everything except Pass.
 *
 * Pass is 70 of 95 deals, so including it by default would bury the live
 * pipeline under rejected deals. It stays one tick away.
 */
export const DEFAULT_PREFS: MapPrefs = {
  visible: DEAL_STATUSES.filter((s) => s !== "Pass"),
  colorMode: "status",
};

function sanitize(raw: unknown): MapPrefs {
  const v = (raw ?? {}) as Partial<MapPrefs>;
  // Only statuses that still exist survive a read. A status removed from the
  // enum would otherwise linger in saved prefs and filter out everything.
  const visible = Array.isArray(v.visible)
    ? DEAL_STATUSES.filter((s) => (v.visible as string[]).includes(s))
    : DEFAULT_PREFS.visible;
  const colorMode: ColorMode = v.colorMode === "crime" ? "crime" : "status";
  return { visible, colorMode };
}

/**
 * Legend state, per user, in user_preferences.
 *
 * Reads fall back to the default rather than to an empty map: a failed read
 * must not look like "the user hid every status". Writes are fire-and-forget —
 * losing a checkbox preference is not worth blocking the UI for.
 */
export function useMapPrefs() {
  const [prefs, setPrefs] = useState<MapPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (!cancelled) setLoaded(true); return; }
        const { data, error } = await supabase
          .from("user_preferences")
          .select("value")
          .eq("user_id", user.id)
          .eq("key", MAP_PREF_KEY)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled && data?.value) setPrefs(sanitize(data.value));
      } catch (e) {
        console.warn("[map] preference read failed, using defaults:", e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: MapPrefs) => {
    setPrefs(next);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("user_preferences").upsert(
        { user_id: user.id, key: MAP_PREF_KEY, value: next, updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" },
      );
    } catch (e) {
      console.warn("[map] preference save failed:", e);
    }
  }, []);

  return { prefs, setPrefs: save, loaded };
}

export { ACTIVE_STATUSES };
