import type { Metadata } from "next";
import { Chakra_Petch, Share_Tech_Mono, Syncopate } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadConfig, projectSlug } from "@/lib/config";
import { cn } from "@/lib/utils";

// Wide futurist display face, an angular sci-fi UI face, and a dashboard readout mono.
const display = Syncopate({ subsets: ["latin"], weight: ["400", "700"], variable: "--ff-display" });
const sans = Chakra_Petch({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--ff-sans" });
const mono = Share_Tech_Mono({ subsets: ["latin"], weight: "400", variable: "--ff-mono" });

export const metadata: Metadata = {
  title: "Mondo",
  description: "Claude Code session monitor",
};

// Reads mondo.config.json on each request so registry edits show up without a rebuild.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const projects = loadConfig().projects.map((p) => ({ name: p.name, slug: projectSlug(p.name) }));
  return (
    <html lang="en" className={cn(display.variable, sans.variable, mono.variable)} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar projects={projects} />
              <SidebarInset className="min-w-0 bg-transparent">{children}</SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
