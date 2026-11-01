"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BookOpen, Bot, FolderKanban, GitFork, Library, Map, MonitorDot, PenTool, Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { MondoMark } from "@/components/elements";
import { ThemeToggle } from "@/components/theme-toggle";

// Active nav item: Leeloo orange with a lit edge.
const NAV_ACTIVE =
  "data-[active=true]:text-leeloo data-[active=true]:shadow-[inset_2px_0_0_var(--leeloo)] data-[active=true]:font-semibold";

export interface SidebarProject {
  name: string;
  slug: string;
}

function NavItem({
  href,
  label,
  icon: Icon,
  exact = false,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ComponentType;
  exact?: boolean;
  badge?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label} className={NAV_ACTIVE}>
        <Link href={href}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {badge && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

export function AppSidebar({ projects, designBadge }: { projects: SidebarProject[]; designBadge?: number }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  // On phones the sidebar is a drawer: close it once a link has been followed.
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <MondoMark className="size-8 shrink-0" />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="display glow truncate text-sm font-bold text-leeloo">Mondo</span>
                  <span className="readout truncate">Mondoshawan</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="readout">Monitor</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem href="/" label="Sessions" icon={MonitorDot} exact />
              <NavItem href="/agents" label="Agents" icon={Bot} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="readout">Knowledge</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem href="/knowledge" label="Knowledge base" icon={Library} exact />
              <SidebarMenuItem>
                <SidebarMenuSub>
                  {projects.map((p) => {
                    const href = `/knowledge/${p.slug}`;
                    return (
                      <SidebarMenuSubItem key={p.slug}>
                        <SidebarMenuSubButton asChild isActive={pathname === href} className={NAV_ACTIVE}>
                          <Link href={href}>
                            <BookOpen />
                            <span>{p.name}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="readout">Design</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem href="/design" label="Design bible" icon={PenTool} exact badge={designBadge ? String(designBadge) : undefined} />
              <SidebarMenuItem>
                <SidebarMenuSub>
                  {projects.map((p) => {
                    const href = `/design/${p.slug}`;
                    return (
                      <SidebarMenuSubItem key={p.slug}>
                        <SidebarMenuSubButton asChild isActive={pathname === href} className={NAV_ACTIVE}>
                          <Link href={href}>
                            <GitFork />
                            <span>{p.name}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="readout">Coming soon</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem href="/roadmap" label="Roadmap" icon={Map} />
              <NavItem href="/prompts" label="Prompts & handoffs" icon={FolderKanban} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <NavItem href="/settings" label="Settings" icon={Settings} />
          <ThemeToggle />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
