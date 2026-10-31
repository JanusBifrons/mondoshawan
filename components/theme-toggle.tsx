"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Laptop, Moon, Sun } from "lucide-react";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

const ORDER = ["system", "light", "dark"] as const;
const META = {
  system: { label: "Theme: system", Icon: Laptop },
  light: { label: "Theme: light", Icon: Sun },
  dark: { label: "Theme: dark", Icon: Moon },
};

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current = (mounted && ORDER.includes(theme as (typeof ORDER)[number]) ? theme : "system") as
    (typeof ORDER)[number];
  const { label, Icon } = META[current];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={label} onClick={() => setTheme(next)}>
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
