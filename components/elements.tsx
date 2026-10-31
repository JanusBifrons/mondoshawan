import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/lib/status";

/**
 * The five elements. Glyphs are the classic alchemical triangles (public domain),
 * plus a radiant star for the fifth. Each session status maps to one element.
 */
export type Element = "fire" | "water" | "air" | "earth" | "fifth";

export const ELEMENT_NAME: Record<Element, string> = {
  fire: "Fire",
  water: "Water",
  air: "Air",
  earth: "Earth",
  fifth: "The fifth",
};

/** Text colour class per element (uses the theme's element tokens). */
export const ELEMENT_TEXT: Record<Element, string> = {
  fire: "text-fire",
  water: "text-water",
  air: "text-air",
  earth: "text-earth",
  fifth: "text-fifth",
};

/**
 * Idle = earth (grounded), working = fire (energy), waiting for you = air (open, your move),
 * needs permission = the fifth (it needs a human), ended = water (flowed away).
 */
export const STATUS_ELEMENT: Record<SessionStatus, Element> = {
  idle: "earth",
  working: "fire",
  waiting: "air",
  needs_permission: "fifth",
  ended: "water",
};

export function ElementGlyph({
  element,
  className,
  strokeWidth = 2,
}: {
  element: Element;
  className?: string;
  strokeWidth?: number;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
  };
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)} aria-hidden="true">
      {element === "fire" && <path d="M12 3 L21 20 H3 Z" {...common} />}
      {element === "air" && (
        <>
          <path d="M12 3 L21 20 H3 Z" {...common} />
          <path d="M6.2 14 H17.8" {...common} />
        </>
      )}
      {element === "water" && <path d="M12 21 L3 4 H21 Z" {...common} />}
      {element === "earth" && (
        <>
          <path d="M12 21 L3 4 H21 Z" {...common} />
          <path d="M6.2 10 H17.8" {...common} />
        </>
      )}
      {element === "fifth" && (
        <>
          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
          <path d="M12 2 V6.5 M12 17.5 V22 M2 12 H6.5 M17.5 12 H22 M5 5 L8 8 M16 16 L19 19 M19 5 L16 8 M8 16 L5 19" {...common} />
        </>
      )}
    </svg>
  );
}

/** Mondo's mark: the four elements around a glowing fifth. */
export function MondoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-8", className)} aria-hidden="true">
      <defs>
        <radialGradient id="mondo-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--taxi)" />
          <stop offset="55%" stopColor="var(--leeloo)" />
          <stop offset="100%" stopColor="var(--leeloo)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="12" fill="url(#mondo-core)" />
      <circle cx="20" cy="20" r="3.6" fill="var(--taxi)" />
      <g fill="none" stroke="var(--brass)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        {/* corners: fire (TL), air (TR), water (BL), earth (BR) */}
        <path d="M9.5 3.5 L13.5 10.5 H5.5 Z" />
        <path d="M30.5 3.5 L34.5 10.5 H26.5 Z M27.8 8 H33.2" />
        <path d="M9.5 36.5 L5.5 29.5 H13.5 Z" />
        <path d="M30.5 36.5 L26.5 29.5 H34.5 Z M27.8 32 H33.2" />
      </g>
    </svg>
  );
}
