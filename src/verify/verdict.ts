/**
 * Verdict assembly: per-field results → overall tier.
 *
 * GREEN, every check passed; agent can clear quickly.
 * YELLOW, something needs human eyes; the specific discrepancy is highlighted.
 * RED, at least one clear violation or mismatch.
 *
 * The tool never approves or rejects an application. It triages. The agent decides.
 */

import type { FieldResult, Tier, Verdict } from "./types";

export function assembleVerdict(fields: FieldResult[]): Verdict {
  // No checks ran (e.g. extraction produced nothing). "All checks passed" would
  // be a false GREEN on an empty set, the one verdict this tool must never give.
  if (fields.length === 0) {
    return {
      tier: "YELLOW",
      fields,
      summary: "No checks could be run on this label. Needs human review.",
    };
  }

  let tier: Tier = "GREEN";
  for (const f of fields) {
    if (f.status === "fail" || f.status === "missing") {
      tier = "RED";
      break;
    }
    if (f.status === "review") tier = "YELLOW";
  }

  const failing = fields.filter(
    (f) => f.status === "fail" || f.status === "missing",
  );
  const reviewing = fields.filter((f) => f.status === "review");

  let summary: string;
  if (tier === "GREEN") {
    summary = "All checks passed. Ready for agent sign-off.";
  } else if (tier === "YELLOW") {
    summary = `Needs human review: ${reviewing.map((f) => f.field.toLowerCase()).join(", ")}.`;
  } else {
    summary = `Problems found: ${failing.map((f) => f.field.toLowerCase()).join(", ")}.`;
  }

  return { tier, fields, summary };
}
