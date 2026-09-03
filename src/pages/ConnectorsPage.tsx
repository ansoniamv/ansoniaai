import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Connector {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  updated_at: string;
}

export default function ConnectorsPage() {
  const [rows, setRows] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("connectors")
      .select("*")
      .order("name", { ascending: true });
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Connector[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (c: Connector, next: boolean) => {
    setPending(c.id);
    const { error } = await supabase
      .from("connectors")
      .update({ enabled: next })
      .eq("id", c.id);
    setPending(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, enabled: next } : r)));
    toast.success(`${c.name} ${next ? "enabled" : "disabled"}`);
  };

  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Connectors</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Temporarily turn external data integrations on or off. Disabling a connector
          stops all outbound API calls until you turn it back on.
        </p>
      </div>

      <Card className="surface-card border-hairline">
        <CardHeader>
          <CardTitle className="text-base">External data sources</CardTitle>
          <CardDescription>
            When off, the app stops pulling data from this source. No existing data is changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">No connectors configured.</p>
          ) : (
            rows.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                      {c.key}
                    </Badge>
                    {c.enabled ? (
                      <Badge className="bg-emerald-600/15 text-emerald-700 border border-emerald-600/30">On</Badge>
                    ) : (
                      <Badge variant="secondary">Off</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    When off, the app stops pulling data from this source.
                  </p>
                </div>
                <Switch
                  checked={c.enabled}
                  disabled={pending === c.id}
                  onCheckedChange={(v) => toggle(c, v)}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
