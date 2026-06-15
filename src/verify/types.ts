/**
 * Shared types for the deterministic verification module.
 *
 * This module is intentionally pure TypeScript with zero I/O and zero model
 * calls. Anywhere the regulation demands exactness (the government warning,
 * numeric values), verification happens here, deterministically, testably,
 * auditably. AI is reserved for extraction (reading the label) and rare
 * judgment calls (near-miss brand names). See README "Field-matching policy".
 */

/** Outcome for a single checked field. */
export type FieldStatus =
  | "pass" // verified match
  | "review" // needs human eyes, discrepancy explained, not auto-rejected
  | "fail" // clear mismatch or violation
  | "missing"; // required element absent

export interface FieldResult {
  field: string;
  status: FieldStatus;
  /** Value from the application form (what the applicant claims). */
  application: string | null;
  /** Value extracted from the label image. */
  label: string | null;
  /** Plain-language explanation an agent can act on. Written for Dave, not Jenny. */
  explanation: string;
  /** True when a model judgment call (not deterministic code) produced this result. */
  aiJudgment?: boolean;
  /**
   * Set when a deferred follow-up will refine this result: deterministic
   * findings render instantly and AI opinions stream in behind them.
   *  - "judgment":     a labeled AI judgment call is still due
   *  - "confirmation": a zero-tolerance failure awaits its careful second read
   */
  pending?: "judgment" | "confirmation";
  /**
   * Set on a government-warning result whose ONLY deviation from the statutory
   * text is punctuation (a missing colon/comma), every word present and
   * "GOVERNMENT WARNING" in caps. TTB treats warning punctuation as mandatory,
   * but approves labels with such deviations, so this is flagged for the agent
   * (review) rather than auto-failed, and still warrants the careful re-read,
   * since a dropped colon is also a classic transcription slip.
   */
  warningPunctuation?: boolean;
}

/** Overall tier: AI assists, the agent decides. */
export type Tier = "GREEN" | "YELLOW" | "RED";

export interface Verdict {
  tier: Tier;
  fields: FieldResult[];
  summary: string;
}

/** Result of comparing two names (brand, class/type). */
export type NameComparison =
  | { kind: "exact" }
  | { kind: "normalized"; note: string } // differs only in case/punctuation/spacing
  | { kind: "near-miss" } // close enough to warrant a judgment call
  | { kind: "different" };
