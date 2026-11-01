/**
 * Design-bible vocabulary, safe to import from client components (no db or node imports).
 * lib/design.ts holds the rules; this holds the words.
 */

export const STAGES = ["idea", "proposed", "approved", "in_build", "built", "retired"] as const;
export type Stage = (typeof STAGES)[number];

export const KINDS = ["system", "mechanic", "feature", "content", "other"] as const;
export type Kind = (typeof KINDS)[number];

export const FIDELITIES = ["unchecked", "matches", "drifted", "accepted"] as const;
export type Fidelity = (typeof FIDELITIES)[number];

export const LINK_TYPES = ["depends_on", "affects", "conflicts_with", "variant_of", "replaces"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const REVIEW_DECISIONS = ["fix_build", "change_intent", "accept"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const QUESTION_OUTCOMES = ["answered", "accepted", "dismissed"] as const;
export type QuestionOutcome = (typeof QUESTION_OUTCOMES)[number];

/** Stages that are canon intent (signed off by the human). */
export const CANON_STAGES: readonly Stage[] = ["approved", "in_build"];

export type Band = "sky" | "grey" | "ground" | "retired";

/** Where a stage sits in the flow, from reality (ground) up to ideas (sky). */
export function bandOf(stage: Stage): Band {
  if (stage === "built") return "ground";
  if (stage === "in_build" || stage === "approved") return "grey";
  if (stage === "retired") return "retired";
  return "sky";
}

export const STAGE_LABEL: Record<Stage, string> = {
  idea: "Idea",
  proposed: "Proposed",
  approved: "Approved",
  in_build: "In build",
  built: "Built",
  retired: "Retired",
};

export const STAGE_HINT: Record<Stage, string> = {
  idea: "Pie in the sky. Grow it freely.",
  proposed: "Being hardened: answer the questions before approving.",
  approved: "Signed-off intent, not built yet.",
  in_build: "Being built. Gaps between intent and reality get reviewed.",
  built: "What the game does today, written by agents from the code.",
  retired: "Out of the design; history kept.",
};

export const BAND_LABEL: Record<Band, string> = {
  sky: "Sky · ideas & proposals",
  grey: "Grey zone · approved & in build",
  ground: "Ground · built",
  retired: "Retired",
};

export const KIND_LABEL: Record<Kind, string> = {
  system: "System",
  mechanic: "Mechanic",
  feature: "Feature",
  content: "Content",
  other: "Other",
};

export const FIDELITY_LABEL: Record<Fidelity, string> = {
  unchecked: "Unchecked",
  matches: "Matches intent",
  drifted: "Drifted",
  accepted: "Gap accepted",
};

export const LINK_LABEL: Record<LinkType, [out: string, inbound: string]> = {
  depends_on: ["depends on", "is needed by"],
  affects: ["affects", "is affected by"],
  conflicts_with: ["conflicts with", "conflicts with"],
  variant_of: ["is a variant of", "has variant"],
  replaces: ["replaces", "is replaced by"],
};

export const DECISION_LABEL: Record<ReviewDecision, string> = {
  fix_build: "Fix the build",
  change_intent: "Change the intent",
  accept: "Accept the gap",
};
