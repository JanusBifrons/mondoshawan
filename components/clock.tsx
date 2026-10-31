"use client";

import { useEffect, useState } from "react";

/** Dashboard clock in the header, taxi-console style. */
export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="hidden rounded-sm border border-brass/50 bg-[oklch(0.17_0.03_265)] px-2 py-1 font-mono text-xs leading-none tracking-widest text-[oklch(0.88_0.17_95)] shadow-inner sm:block">
      {p(now.getDate())}.{p(now.getMonth() + 1)}.{now.getFullYear()}
      <span className="mx-1.5 text-brass/70">|</span>
      {p(now.getHours())}:{p(now.getMinutes())}
      <span className="text-taxi/60">:{p(now.getSeconds())}</span>
    </div>
  );
}
