import { Inbox, Mail, List, Plus, Target, BarChart3, LayoutDashboard, Users, Columns3, StickyNote, MessageSquare, ShieldCheck, LogOut, Map, Activity, Plug, Thermometer, Sparkles, FileText } from "lucide-react";
import logoAsset from "@/assets/ansonia-logo.png.asset.json";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { usePendingSuggestionCount } from "@/hooks/usePartnerSuggestions";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const inboxNav = [
  { title: "Suggested Deals", url: "/pipeline", icon: Inbox },
  { title: "Acquisitions Inbox", url: "/outlook", icon: Mail },
];

const pipelineNav = [
  { title: "New Deal", url: "/deals/new", icon: Plus },
  { title: "List View", url: "/deals", icon: List },
  { title: "Dashboard View", url: "/pipeline-dashboard", icon: LayoutDashboard },
];

const capitalNav = [
  { title: "Capital Partners", url: "/partners", icon: Users },
  { title: "Capital Raise", url: "/capital-raise", icon: Columns3 },
  { title: "Atlas Inbox", url: "/suggestions", icon: Sparkles },
];

const workspaceNav = [
  { title: "General Dashboard", url: "/", icon: BarChart3 },
  { title: "Buy Box", url: "/buy-box", icon: Target },
  { title: "Notes & Tags", url: "/notes", icon: StickyNote },
  { title: "Ask Atlas", url: "/chat", icon: MessageSquare },
  { title: "Roadmap", url: "/roadmap", icon: Map },
  { title: "API Status", url: "/api-status", icon: Activity },
];

const navItem = (item: { title: string; url: string; icon: React.ComponentType<{ className?: string }> }, collapsed: boolean) => (
  <SidebarMenuItem key={item.title}>
    <SidebarMenuButton asChild className="h-9">
      <NavLink
        to={item.url}
        end={item.url === "/"}
        className="flex items-center gap-3 px-3 rounded-md text-[13px] text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
      >
        <item.icon className="h-4 w-4 stroke-[1.75] shrink-0" />
        {!collapsed && <span className="truncate">{item.title}</span>}
      </NavLink>
    </SidebarMenuButton>
  </SidebarMenuItem>
);

const groupLabelCls = "px-3 pt-4 pb-1 text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45 font-semibold";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isAdmin, signOut, profile } = useAuth();
  const { data: pendingCount } = usePendingSuggestionCount();

  const renderCapitalItem = (item: typeof capitalNav[number]) => {
    if (item.url !== "/suggestions") return navItem(item, collapsed);
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild className="h-9">
          <NavLink
            to={item.url}
            className="flex items-center gap-3 px-3 rounded-md text-[13px] text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <item.icon className="h-4 w-4 stroke-[1.75] shrink-0" />
            {!collapsed && (
              <>
                <span className="truncate flex-1">{item.title}</span>
                {pendingCount && pendingCount > 0 ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-semibold">
                    {pendingCount}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="px-4 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <img src={logoAsset.url} alt="Ansonia" className="h-8 w-auto" />
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight text-sidebar-foreground font-display">
                Ansonia
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/50 font-medium">
                Acquisitions
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel className={groupLabelCls}>Inbox</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {inboxNav.map((i) => navItem(i, collapsed))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="border-t border-sidebar-border pt-2">
          {!collapsed && <SidebarGroupLabel className={groupLabelCls}>Pipeline</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {pipelineNav.map((i) => navItem(i, collapsed))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="border-t border-sidebar-border pt-2">
          {!collapsed && <SidebarGroupLabel className={groupLabelCls}>Capital</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {capitalNav.map(renderCapitalItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="border-t border-sidebar-border pt-2">
          {!collapsed && <SidebarGroupLabel className={groupLabelCls}>Workspace</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {workspaceNav.map((i) => navItem(i, collapsed))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>


        {isAdmin && (
          <SidebarGroup className="border-t border-sidebar-border pt-2">
            {!collapsed && <SidebarGroupLabel className={groupLabelCls}>Admin</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {navItem({ title: "Users", url: "/admin/users", icon: ShieldCheck }, collapsed)}
                {navItem({ title: "Connectors", url: "/admin/connectors", icon: Plug }, collapsed)}
                {navItem({ title: "Warmth Import", url: "/admin/warmth-import", icon: Thermometer }, collapsed)}


              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {!collapsed && (
        <SidebarFooter className="border-t border-sidebar-border p-3 space-y-2">
          {profile && (
            <div className="text-[11px] text-sidebar-foreground/55 truncate font-mono">{profile.email}</div>
          )}
          <div className="flex items-center justify-between gap-2">
            <NavLink
              to="/dev-notes"
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
              activeClassName="text-sidebar-primary"
            >
              <FileText className="h-3 w-3" />
              <span className="font-semibold">Dev Notes</span>
            </NavLink>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-[11px] text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent h-7 px-2"
            >
              <LogOut className="h-3.5 w-3.5 mr-1" /> Sign out
            </Button>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
