import { useEffect, useRef, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "react-router-dom";
import { format } from "date-fns";
import { NoteComposerDialog } from "@/components/NoteComposerDialog";
import logoAsset from "@/assets/ansonia-logo.png.asset.json";
import { AskAtlasWidget } from "@/components/AskAtlasWidget";
import { PageSearchWidget } from "@/components/PageSearchWidget";
import { GlobalSearchPalette } from "@/components/GlobalSearchPalette";


const ROUTE_LABELS: Array<{ match: RegExp; label: string }> = [
  { match: /^\/$/, label: "Dashboard" },
  { match: /^\/pipeline/, label: "Acquisitions Pipeline" },
  { match: /^\/deals\/new/, label: "New Deal" },
  { match: /^\/deals\/[^/]+\/edit/, label: "Edit Deal" },
  { match: /^\/deals\/[^/]+/, label: "Deal Detail" },
  { match: /^\/deals/, label: "Filtered Deals" },
  { match: /^\/partners\/[^/]+/, label: "Partner Detail" },
  { match: /^\/partners/, label: "Capital Partners" },
  { match: /^\/capital-raise/, label: "Capital Raise" },
  { match: /^\/buy-box/, label: "Buy Box" },
  { match: /^\/notes/, label: "Notes & Tags" },
  { match: /^\/outlook/, label: "Outlook" },
  { match: /^\/chat/, label: "Ask Atlas" },
  { match: /^\/roadmap/, label: "Product Roadmap" },
  { match: /^\/admin\/users/, label: "Users" },
  { match: /^\/dev-notes/, label: "Dev Notes" },
];

function getRouteLabel(pathname: string): string {
  return ROUTE_LABELS.find((r) => r.match.test(pathname))?.label ?? "";
}

function initials(nameOrEmail: string | null | undefined): string {
  if (!nameOrEmail) return "··";
  const [local] = nameOrEmail.split("@");
  const parts = local.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const location = useLocation();
  const routeLabel = getRouteLabel(location.pathname);
  const today = format(new Date(), "EEEE, MMM d, yyyy");
  const [noteOpen, setNoteOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  // Scrolling happens on <main> (overflow-auto), not window. Reset it on route change.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "n" || e.key === "N")) {
        // Don't hijack when the user is typing in a native browser input dialog etc.
        e.preventDefault();
        setNoteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  return (
    <SidebarProvider>
      <div className="h-screen flex w-full bg-background overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-14 flex items-center gap-4 border-b border-hairline px-6 bg-card shrink-0">
            <div className="h-8 w-8 rounded-md bg-[hsl(217,53%,26%)] flex items-center justify-center">
              <img src={logoAsset.url} alt="Ansonia" className="h-5 w-auto" />
            </div>
            <div className="h-5 w-px bg-hairline" />
            <SidebarTrigger className="text-muted-foreground hover:text-foreground -ml-2" />
            <div className="h-5 w-px bg-hairline" />
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
                {today}
              </span>
              <span className="text-sm font-semibold text-foreground font-display">
                {routeLabel || "Acquisitions Pipeline"}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
                {profile?.email}
              </span>
              <div
                className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold ring-1 ring-hairline"
                title={profile?.email ?? ""}
              >
                {initials(profile?.full_name ?? profile?.email)}
              </div>
            </div>
          </header>
          <main ref={mainRef} className="flex-1 overflow-auto">
            <div className="max-w-[1280px] mx-auto px-6 py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
      <NoteComposerDialog open={noteOpen} onOpenChange={setNoteOpen} />
      <GlobalSearchPalette />
      {!location.pathname.startsWith("/chat") && <PageSearchWidget />}
      {!location.pathname.startsWith("/chat") && <AskAtlasWidget />}
    </SidebarProvider>
  );
}
