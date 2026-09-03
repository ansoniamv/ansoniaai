import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Users, StickyNote, Mail, Search } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";

type Hit = {
  id: string;
  kind: "deal" | "partner" | "note" | "email";
  title: string;
  subtitle?: string;
  route: string;
};

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export function GlobalSearchPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const debounced = useDebounced(q, 200);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const term = debounced.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const like = `%${term.replace(/[%_]/g, "\\$&")}%`;

    Promise.all([
      supabase.from("deals").select("id, property_name, city, state").ilike("property_name", like).limit(6),
      supabase.from("partners").select("id, name, firm_type").ilike("name", like).limit(6),
      supabase.from("notes").select("id, content, content_format, entity_type, entity_id").ilike("content", like).limit(6),
      (supabase as any)
        .from("outlook_messages")
        .select("id, subject, from_name, from_email, deal_id, partner_id")
        .or(`subject.ilike.${like},from_name.ilike.${like},from_email.ilike.${like}`)
        .limit(6),
    ])
      .then(([deals, partners, notes, emails]: any[]) => {
        if (cancelled) return;
        const results: Hit[] = [];
        (deals.data ?? []).forEach((d: any) =>
          results.push({
            id: d.id,
            kind: "deal",
            title: d.property_name || "Untitled deal",
            subtitle: [d.city, d.state].filter(Boolean).join(", ") || undefined,
            route: `/deals/${d.id}`,
          })
        );
        (partners.data ?? []).forEach((p: any) =>
          results.push({
            id: p.id,
            kind: "partner",
            title: p.name,
            subtitle: p.firm_type ?? undefined,
            route: `/partners/${p.id}`,
          })
        );
        (notes.data ?? []).forEach((n: any) => {
          const text = n.content_format === "html" ? stripHtml(n.content ?? "") : (n.content ?? "");
          const route =
            n.entity_type === "deal"
              ? `/deals/${n.entity_id}`
              : n.entity_type === "partner"
              ? `/partners/${n.entity_id}`
              : "/notes";
          results.push({
            id: n.id,
            kind: "note",
            title: text.slice(0, 80) || "Note",
            subtitle: `${n.entity_type} note`,
            route,
          });
        });
        (emails.data ?? []).forEach((m: any) => {
          const route = m.deal_id
            ? `/deals/${m.deal_id}`
            : m.partner_id
            ? `/partners/${m.partner_id}`
            : "/outlook";
          results.push({
            id: m.id,
            kind: "email",
            title: m.subject || "(no subject)",
            subtitle: m.from_name || m.from_email || undefined,
            route,
          });
        });
        setHits(results);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  const grouped = useMemo(() => {
    return {
      deal: hits.filter((h) => h.kind === "deal"),
      partner: hits.filter((h) => h.kind === "partner"),
      note: hits.filter((h) => h.kind === "note"),
      email: hits.filter((h) => h.kind === "email"),
    };
  }, [hits]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    navigate(h.route);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search deals, partners, notes, emails…"
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        {q.trim().length < 2 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <Search className="h-4 w-4 mx-auto mb-2 opacity-60" />
            Type at least 2 characters. Press ⌘K / Ctrl+K anywhere to open.
          </div>
        ) : loading && hits.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Searching…</div>
        ) : (
          <>
            <CommandEmpty>No results.</CommandEmpty>
            {grouped.deal.length > 0 && (
              <CommandGroup heading="Deals">
                {grouped.deal.map((h) => (
                  <CommandItem key={`d-${h.id}`} value={`deal-${h.id}-${h.title}`} onSelect={() => go(h)}>
                    <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{h.title}</div>
                      {h.subtitle && <div className="text-[10px] text-muted-foreground truncate">{h.subtitle}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {grouped.partner.length > 0 && (
              <CommandGroup heading="Partners">
                {grouped.partner.map((h) => (
                  <CommandItem key={`p-${h.id}`} value={`partner-${h.id}-${h.title}`} onSelect={() => go(h)}>
                    <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{h.title}</div>
                      {h.subtitle && <div className="text-[10px] text-muted-foreground truncate">{h.subtitle}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {grouped.note.length > 0 && (
              <CommandGroup heading="Notes">
                {grouped.note.map((h) => (
                  <CommandItem key={`n-${h.id}`} value={`note-${h.id}-${h.title}`} onSelect={() => go(h)}>
                    <StickyNote className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{h.title}</div>
                      {h.subtitle && <div className="text-[10px] text-muted-foreground truncate">{h.subtitle}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {grouped.email.length > 0 && (
              <CommandGroup heading="Emails">
                {grouped.email.map((h) => (
                  <CommandItem key={`e-${h.id}`} value={`email-${h.id}-${h.title}`} onSelect={() => go(h)}>
                    <Mail className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{h.title}</div>
                      {h.subtitle && <div className="text-[10px] text-muted-foreground truncate">{h.subtitle}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
