import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

async function loadConnector(key: string): Promise<boolean> {
  const { data } = await supabase
    .from("connectors")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();
  const enabled = data?.enabled ?? true;
  cache.set(key, enabled);
  return enabled;
}

export function useConnectorEnabled(key: string): boolean {
  const [enabled, setEnabled] = useState<boolean>(cache.get(key) ?? true);

  useEffect(() => {
    let cancelled = false;
    loadConnector(key).then((v) => {
      if (!cancelled) setEnabled(v);
    });
    const onChange = () => setEnabled(cache.get(key) ?? true);
    listeners.add(onChange);

    const channel = supabase
      .channel(`connectors-${key}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "connectors", filter: `key=eq.${key}` },
        (payload: any) => {
          const next = payload.new?.enabled ?? true;
          cache.set(key, next);
          listeners.forEach((l) => l());
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      listeners.delete(onChange);
      supabase.removeChannel(channel);
    };
  }, [key]);

  return enabled;
}
