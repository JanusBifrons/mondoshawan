"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Laptop, Moon, Sun } from "lucide-react";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

const ORDER = ["dark", "light", "system"] as const;
const META = {
  dark: { label: "Theme: 2263", hint: "Night city", Icon: Moon },
  light: { label: "Theme: Temple", hint: "Sandstone", Icon: Sun },
  system: { label: "Theme: system", hint: "Follow Windows", Icon: Laptop },
};

/** Cycles 2263 (dark) → Temple (light) → system. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current = (mounted && ORDER.includes(theme as (typeof ORDER)[number]) ? theme : "dark") as
    (typeof ORDER)[number];
  const { label, hint, Icon } = META[current];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={`${label} (${hint})`} onClick={() => setTheme(next)}>
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
