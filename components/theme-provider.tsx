"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// Dark ("2263") is Mondo's signature look; Temple (light) and System are one click away.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
