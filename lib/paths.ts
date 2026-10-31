/**
 * Normalise a Windows path so different spellings compare equal:
 * `/c/Users/X`, `C:\Users\X\` and `c:/users/x` all become `c:/users/x`.
 */
export function normalizePath(input: string): string {
  let p = (input ?? "").trim();
  if (!p) return "";
  p = p.replace(/\\/g, "/");
  // Git Bash / MSYS style: /c/Users -> c:/Users
  p = p.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:");
  p = p.replace(/\/{2,}/g, "/");
  p = p.toLowerCase();
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  // Keep a drive root as "c:" rather than "c:/" so prefix checks stay simple
  return p;
}

/** True when `child` is `parent` or sits somewhere beneath it. Both must be normalised. */
export function isWithin(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  return child === parent || child.startsWith(parent + "/");
}

/** Last path segment, keeping the original casing. */
export function baseName(p: string): string {
  const parts = (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}
