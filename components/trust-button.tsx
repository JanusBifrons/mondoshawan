"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens a trust window on the PC for every untrusted project at once. */
export function TrustButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/trust", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setMsg(
        d.errors.length
          ? `Couldn't open: ${d.errors.join("; ")}`
          : `Opened ${d.opened.length} window${d.opened.length === 1 ? "" : "s"}. In each, choose "Yes, I trust this folder", then close it. This page updates when you come back.`,
      );
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button onClick={open} disabled={busy}>
        <ShieldCheck /> Open trust prompts for {count} project{count === 1 ? "" : "s"}
      </Button>
      {msg && (
        <p className="text-sm text-muted-foreground">
          {msg}{" "}
          <button type="button" className="text-diva underline" onClick={() => router.refresh()}>
            Refresh
          </button>
        </p>
      )}
    </div>
  );
}
