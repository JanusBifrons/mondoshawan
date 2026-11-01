import type { Metadata } from "next";
import { Chakra_Petch, Share_Tech_Mono, Syncopate } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { PairingPrompt } from "@/components/pairing-prompt";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadConfig, projectSlug } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listOpenChases } from "@/lib/design";
import { chaseUrgency } from "@/lib/design-meta";
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Phones (via the LAN gateway) never see the "allow this device?" prompt.
  const remote = (await headers()).get("x-mondo-remote") === "1";
  const projects = loadConfig().projects.map((p) => ({ name: p.name, slug: projectSlug(p.name) }));
  // Chases due today or overdue, across projects: shown as a badge on Design.
  let dueChases = 0;
  try {
    dueChases = listOpenChases(getDb()).filter((c) => ["overdue", "today"].includes(chaseUrgency(c.dueAt))).length;
  } catch {
    /* never let a badge break the page */
  }
  return (
    <html lang="en" className={cn(display.variable, sans.variable, mono.variable)} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar projects={projects} designBadge={dueChases} />
              <SidebarInset className="min-w-0 bg-transparent">
                {children}
                <MobileNav badges={{ "/design": dueChases }} />
              </SidebarInset>
              {!remote && <PairingPrompt />}
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
