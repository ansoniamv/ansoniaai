import { useEffect, useRef, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "react-router-dom";
import { format } from "date-fns";
import { NoteComposerDialog } from "@/components/NoteComposerDialog";
import markLight from "@/assets/ansonia-ai-mark-light.png";
import { AskAtlasWidget } from "@/components/AskAtlasWidget";
import { PageSearchWidget } from "@/components/PageSearchWidget";
import { GlobalSearchPalette } from "@/components/GlobalSearchPalette";
import { ChangeRequestDialog } from "@/components/roadmap/ChangeRequestDialog";
import { MessageSquarePlus } from "lucide-react";


const ROUTE_LABELS: Array<{ match: RegExp; label: string }> = [
  { match: /^\/$/, label: "Dashboard" },
  { match: /^\/pipeline-map/, label: "Map View" },
  { match: /^\/pipeline/, label: "Acquisitions Pipeline" },
  { match: /^\/deals\/new/, label: "New Deal" },
  { match: /^\/deals\/[^/]+\/edit/, label: "Edit Deal" },
  { match: /^\/deals\/[^/]+/, label: "Deal Detail" },
  { match: /^\/deals/, label: "Filtered Deals" },
  { match: /^\/partners\/[^/]+/, label: "Partner Detail" },
  { match: /^\/partners/, label: "Capital Partners" },
  { match: /^\/capital-raise/, label: "Capital Raise" },
  { match: /^\/capital-feed/, label: "Capital Feed" },
  { match: /^\/brain/, label: "Brain" },
  { match: /^\/buy-box/, label: "Buy Box" },
  { match: /^\/market-data/, label: "Market Data" },
  { match: /^\/notes/, label: "Notes & Tags" },
  { match: /^\/outlook/, label: "Outlook" },
  { match: /^\/chat/, label: "Ask Atlas" },
  { match: /^\/roadmap/, label: "Product Roadmap" },
  { match: /^\/admin\/users/, label: "Users" },
  { match: /^\/dev-notes/, label: "Dev Notes" },
];

/**
 * Routes that fill the viewport and own their padding.
 *
 * The shell centres every page in a 1280px column with 24px of side padding
 * and 32px top and bottom. That is right for a document and wrong for a map:
 * on a wide screen it leaves the map drawing in about a third of the glass
 * with the rest of the page blank below it. A full-bleed route gets the whole
 * area under the header instead, and puts its own controls on top of the map.
 */
const FULL_BLEED = [/^\/pipeline-map/];

/**
 * Routes that keep the shell's column and padding but are pinned to the
 * viewport height, so they scroll inside themselves instead of growing <main>.
 *
 * Ask Atlas needs this: its message list scrolls in its own pane with the
 * composer under it. Under min-h-full the column grew to fit every message,
 * <main> scrolled instead, and the composer sat below the whole conversation.
 */
const FIXED_HEIGHT = [/^\/chat/];

/**
 * Record pages that keep the shell's padding but use the whole width. A
 * partner or deal record lays out in two or three columns; held to 1280px the
 * middle column ends up narrow, and everything in it wraps and scrolls.
 */
const WIDE = [/^\/partners\/(?!new$|import$)[^/]+$/, /^\/deals\/(?!new$)[^/]+$/];

function isFullBleed(pathname: string): boolean {
  return FULL_BLEED.some((r) => r.test(pathname));
}

function isWide(pathname: string): boolean {
  return WIDE.some((r) => r.test(pathname));
}

function isFixedHeight(pathname: string): boolean {
  return FIXED_HEIGHT.some((r) => r.test(pathname));
}

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
  const fullBleed = isFullBleed(location.pathname);
  const fixedHeight = isFixedHeight(location.pathname);
  const wide = isWide(location.pathname);
  const today = format(new Date(), "EEEE, MMM d, yyyy");
  const [noteOpen, setNoteOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
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
              <img src={markLight} alt="Ansonia.AI" className="h-5 w-auto" />
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
              <button
                type="button"
                onClick={() => setRequestOpen(true)}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded border border-hairline text-[11px] uppercase tracking-[0.08em] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Ask for a change to this page or the platform"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Request change</span>
              </button>
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
          <main
            ref={mainRef}
            className={
              "flex-1 min-h-0 " + (fullBleed || fixedHeight ? "overflow-hidden" : "overflow-auto")
            }
          >
            {/* flex column + min-h-full for ordinary pages: a single stretched
                column lays out identically, and taller content scrolls <main>.

                Full-bleed and fixed-height routes get h-full instead, and any
                scrolling moves inside the page: a map sizes its canvas from its
                container, and Ask Atlas scrolls its message list. min-h-full
                would let either container grow rather than settle. */}
            <div
              className={
                fullBleed
                  ? "h-full flex flex-col"
                  : (wide ? "max-w-[2000px]" : "max-w-[1280px]") + " mx-auto px-6 py-8 flex flex-col " +
                    (fixedHeight ? "h-full" : "min-h-full")
              }
            >
              {children}
            </div>
          </main>
        </div>
      </div>
      <NoteComposerDialog open={noteOpen} onOpenChange={setNoteOpen} />
      <ChangeRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        pageLabel={routeLabel}
        pagePath={location.pathname}
      />
      <GlobalSearchPalette />
      {!location.pathname.startsWith("/chat") && <PageSearchWidget />}
      {!location.pathname.startsWith("/chat") && <AskAtlasWidget />}
    </SidebarProvider>
  );
}
