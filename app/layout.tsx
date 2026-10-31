import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadConfig, projectSlug } from "@/lib/config";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Mondo",
  description: "Claude Code session monitor",
};

// Reads mondo.config.json on each request so registry edits show up without a rebuild.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const projects = loadConfig().projects.map((p) => ({ name: p.name, slug: projectSlug(p.name) }));
  return (
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <ThemeProvider>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar projects={projects} />
              <SidebarInset className="min-w-0">{children}</SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
