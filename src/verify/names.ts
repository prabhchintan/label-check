/**
 * Name comparison for brand names and class/type designations.
 *
 * Dave's example: "STONE'S THROW" on the label, "Stone's Throw" in the
 * application, technically different strings, obviously the same brand.
 *
 * Three deterministic layers before any AI is involved:
 *   1. exact        → pass
 *   2. normalized   → pass with a note (case / punctuation / spacing only)
 *   3. near-miss    → escalate to a model judgment call (the ONLY place AI
 *                     influences a match decision, and it is labeled as such)
 *   anything else   → different (fail)
 */

import type { NameComparison } from "./types";

/** Uppercase, unify apostrophes/quotes/dashes, strip punctuation, collapse spaces. */
export function normalizeName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[^A-Z0-9 ]/g, "") // drop punctuation entirely
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic Levenshtein distance, small strings only, O(mn) is fine. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] as number) + 1,
        (curr[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] as number;
}

/** Near-miss threshold: distance ≤ 2, or ≤ 15% of length for longer names. */
function nearMissThreshold(len: number): number {
  return Math.max(2, Math.floor(len * 0.15));
}

export function compareNames(
  application: string,
  label: string,
): NameComparison {
  if (application === label) return { kind: "exact" };

  const a = normalizeName(application);
  const b = normalizeName(label);

  if (a === b && a !== "") {
    return {
      kind: "normalized",
      note: describeSuperficialDifference(application, label),
    };
  }

  if (levenshtein(a, b) <= nearMissThreshold(Math.max(a.length, b.length))) {
    return { kind: "near-miss" };
  }
  if (tokenContainment(a, b)) {
    return { kind: "near-miss" };
  }
  return { kind: "different" };
}

/**
 * Token containment: every word of the shorter name appears in the longer
 * one (tolerating one character of drift per longer word, WHISKY/WHISKEY).
 * Real labels routinely add qualifiers around the registered designation,
 * "Tequila" vs "Tequila 100% Agave Azul", "Straight Bourbon Whisky" vs
 * "Oregon Straight Bourbon Whiskey". Those deserve a judgment call, never an
 * automatic mismatch, and never an automatic pass.
 */
function tokenContainment(a: string, b: string): boolean {
  const ta = a.split(" ").filter(Boolean);
  const tb = b.split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0 || ta.length === tb.length) {
    return false;
  }
  const [short, long] = ta.length < tb.length ? [ta, tb] : [tb, ta];
  return short.every((w) =>
    long.some((l) => levenshtein(w, l) <= (w.length >= 5 ? 1 : 0)),
  );
}

/** Explain WHY two superficially-different strings are the same name. */
function describeSuperficialDifference(app: string, label: string): string {
  const differences: string[] = [];
  if (app.toUpperCase() === label.toUpperCase() && app !== label) {
    differences.push("letter case");
  }
  const stripPunct = (s: string) =>
    s.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  if (
    stripPunct(app) === stripPunct(label) &&
    app.toUpperCase() !== label.toUpperCase()
  ) {
    differences.push("punctuation or spacing");
  }
  const detail =
    differences.length > 0 ? differences.join(" and ") : "formatting";
  return `Same name, differs only in ${detail}.`;
}
