import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const SAVE_DEBOUNCE_MS = 500;

/**
 * Persists a per-user UI preference to the `user_preferences` table.
 * Falls back to localStorage while the user is unauthenticated or the row
 * hasn't loaded yet, then syncs once the server value arrives.
 *
 * - A locally modified ("dirty") value is never clobbered by a late server load.
 * - Server writes are debounced (~500ms) and flushed on unmount.
 * - Write failures surface instead of being swallowed.
 */
export function useUserPreference<T>(key: string, defaultValue: T) {
  const { user } = useAuth();
  const storageKey = `pref:${key}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {}
    return defaultValue;
  });

  const [loaded, setLoaded] = useState(false);
  const skipNextSave = useRef(true); // skip the initial save (it's just the loaded value)
  const dirty = useRef(false); // true once the user has changed the value locally

  // Load from server once we have a user
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setLoaded(true);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", key)
        .maybeSingle();
      if (cancelled) return;
      if (data?.value !== undefined && data?.value !== null && !dirty.current) {
        skipNextSave.current = true;
        setValue(data.value as T);
        try { localStorage.setItem(storageKey, JSON.stringify(data.value)); } catch {}
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user, key, storageKey]);

  // Debounced server write (localStorage mirror stays immediate)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T | null>(null);
  const userIdRef = useRef<string | undefined>(user?.id);
  userIdRef.current = user?.id;

  const flush = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid || pendingRef.current === null) return;
    const payload = pendingRef.current;
    pendingRef.current = null;
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: uid, key, value: payload as any }, { onConflict: "user_id,key" });
    if (error) {
      console.error("preference save failed", key, error);
      toast.error("Couldn't save your layout preference");
    }
  }, [key]);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch {}
    if (!loaded || !user) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    pendingRef.current = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }, [value, loaded, user, key, storageKey, flush]);

  // Flush any pending write on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void flush();
      }
    };
  }, [flush]);

  const setValueDirty = useCallback((v: T | ((prev: T) => T)) => {
    dirty.current = true;
    setValue(v);
  }, []);

  return [value, setValueDirty] as const;
}
