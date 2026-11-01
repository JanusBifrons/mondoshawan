"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Library, MonitorDot, PenTool, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Sessions", icon: MonitorDot, exact: true },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/design", label: "Design", icon: PenTool },
  { href: "/knowledge", label: "Knowledge", icon: Library },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Phone tab bar (below md). The sidebar is still there behind the menu button, but a
 * bottom bar is what people expect on a phone.
 */
export function MobileNav({ badges = {} }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <>
      {/* Spacer so page content isn't hidden behind the fixed bar. */}
      <div className="h-16 md:hidden" aria-hidden />
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-brass/30 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {TABS.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-xs",
                    active ? "font-semibold text-leeloo shadow-[inset_0_2px_0_var(--leeloo)]" : "text-muted-foreground",
                  )}
                >
                  <span className="relative">
                    <Icon className="size-5" />
                    {!!badges[href] && (
                      <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-taxi px-1 text-center text-[0.6rem] leading-4 font-bold text-black">
                        {badges[href]}
                      </span>
                    )}
                  </span>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
