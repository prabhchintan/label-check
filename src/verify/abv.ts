/**
 * Alcohol content parsing and comparison.
 *
 * Labels express the same value many ways: "45% Alc./Vol. (90 Proof)",
 * "ALC. 45% BY VOL.", "45% ABV", "90 PROOF". The application form may say
 * simply "45%". Policy: tolerant of FORMAT, exact on VALUE. Parsing is
 * deterministic; no model is consulted.
 */

export interface ParsedAbv {
  /** Percent alcohol by volume, e.g. 45. */
  abv: number | null;
  /** Proof, if stated, e.g. 90. */
  proof: number | null;
}

const NUM = "(\\d{1,3}(?:[.,]\\d{1,2})?)";
/**
 * No digit or decimal separator immediately before the number, so a garbage or
 * mis-read value like "1234%" cannot silently truncate to a believable "234%".
 * Without this, the unparseable-number safety path (review, never a silent
 * pass) would be defeated by the regex grabbing the last three digits.
 */
const NB = "(?<![\\d.,])";

/** A stated range ("40-42% alc/vol") is not a single verifiable value. */
const RANGE_RE = /\d\s*[-–—]\s*\d{1,3}(?:[.,]\d{1,2})?\s*(?:%|proof|alc)/i;

function toNumber(s: string): number {
  return parseFloat(s.replace(",", "."));
}

/** Parse an alcohol-content statement. Returns nulls when nothing parseable found. */
export function parseAbv(raw: string | null | undefined): ParsedAbv {
  if (!raw) return { abv: null, proof: null };
  const s = raw.replace(/\s+/g, " ").trim();

  let abv: number | null = null;
  let proof: number | null = null;

  // Proof: "90 proof", "(90 Proof)"
  const proofMatch = s.match(new RegExp(`${NB}${NUM}\\s*proof`, "i"));
  if (proofMatch?.[1]) proof = toNumber(proofMatch[1]);

  // A percentage anchored to an alcohol keyword: "45% alc./vol.", "45% ABV",
  // "45 % alcohol by volume", "13,5% vol", "alc. 45% by vol."
  const pctMatch =
    s.match(new RegExp(`${NB}${NUM}\\s*%\\s*(?:alc|abv|alcohol|by\\s*vol|vol)`, "i")) ??
    s.match(new RegExp(`(?:alc(?:ohol)?\\.?\\s*)${NB}${NUM}\\s*%`, "i"));
  if (pctMatch?.[1]) abv = toNumber(pctMatch[1]);

  // A bare "45%" counts only when it is the sole percentage in the statement,
  // "100% de agave, 40% Alc./Vol." must read 40, never 100.
  if (abv === null) {
    const all = [...s.matchAll(new RegExp(`${NB}${NUM}\\s*%`, "gi"))];
    if (all.length === 1 && all[0]?.[1]) abv = toNumber(all[0][1]);
  }

  // "alc 45 by vol" without a % sign (rare, but seen on real labels)
  if (abv === null) {
    const bare = s.match(
      new RegExp(`alc(?:ohol)?\\.?\\s*${NB}${NUM}\\s*(?:by\\s*vol|/?\\s*vol)`, "i"),
    );
    if (bare?.[1]) abv = toNumber(bare[1]);
  }

  return { abv, proof };
}

export interface AbvComparison {
  status: "pass" | "fail" | "review" | "missing";
  explanation: string;
}

const EPSILON = 0.001; // value-exact; tolerance only absorbs float noise

/**
 * The application form often holds a bare number ("45") with no % sign or
 * keyword. Accepted for the APPLICATION side only, label statements must
 * carry their own units.
 */
function bareApplicationNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,3}(?:[.,]\d{1,2})?)$/);
  if (!m?.[1]) return null;
  const n = toNumber(m[1]);
  return n > 0 && n <= 100 ? n : null;
}

export interface AbvOptions {
  /**
   * Apply the 27 CFR 4.36(b) wine labeling tolerance: a label and application
   * ABV that differ but fall within the permitted spread (1.5% for wines at or
   * below 14% ABV, 1.0% above) are surfaced for review rather than failed, since
   * they may state the same product at the legally allowed tolerance. Spirits
   * (proof = 2 x ABV by definition) and malt (ABV-exempt) stay value-exact.
   */
  wineTolerance?: boolean;
}

/**
 * Compare application alcohol content against the label's.
 * Proof is cross-checked when present: proof must equal 2 × ABV.
 */
export function compareAbv(
  application: string | null | undefined,
  label: string | null | undefined,
  opts: AbvOptions = {},
): AbvComparison {
  // A stated range ("40-42% alc/vol") is not a single value to verify against;
  // never let the parser collapse it to one endpoint and pass it silently.
  if (label && RANGE_RE.test(label)) {
    return {
      status: "review",
      explanation: `The label states alcohol content as a range, not a single value ("${label.trim()}"). Confirm the exact figure by eye.`,
    };
  }

  const app = parseAbv(application);
  const lab = parseAbv(label);

  // Resolve each side to an ABV number, deriving from proof when needed.
  const appAbv =
    app.abv ??
    (app.proof !== null ? app.proof / 2 : null) ??
    bareApplicationNumber(application);
  const labAbv = lab.abv ?? (lab.proof !== null ? lab.proof / 2 : null);

  if (labAbv === null) {
    return {
      status: "missing",
      explanation:
        "No alcohol content found on the label. (Some wine and beer categories are exempt, agent to confirm.)",
    };
  }
  if (appAbv === null) {
    return {
      status: "review",
      explanation: `Could not read an alcohol content from the application ("${application ?? ""}"). Label shows ${labAbv}% ABV.`,
    };
  }

  // Internal consistency: if the label states both % and proof, they must agree.
  if (lab.abv !== null && lab.proof !== null) {
    if (Math.abs(lab.proof - 2 * lab.abv) > EPSILON) {
      return {
        status: "fail",
        explanation: `Label is internally inconsistent: ${lab.abv}% ABV would be ${2 * lab.abv} proof, but the label says ${lab.proof} proof.`,
      };
    }
  }

  if (Math.abs(appAbv - labAbv) <= EPSILON) {
    const viaProof =
      lab.abv === null && lab.proof !== null
        ? ` (label states ${lab.proof} proof = ${labAbv}% ABV)`
        : "";
    return {
      status: "pass",
      explanation: `Alcohol content matches: ${appAbv}% ABV${viaProof}.`,
    };
  }

  // Wine labeling tolerance (27 CFR 4.36(b)): a difference within the permitted
  // spread is a judgment call for the agent, not an automatic violation.
  if (opts.wineTolerance) {
    const diff = Math.abs(appAbv - labAbv);
    const tolerance = Math.max(appAbv, labAbv) <= 14 ? 1.5 : 1.0;
    if (diff <= tolerance) {
      return {
        status: "review",
        explanation:
          `Alcohol content differs by ${diff.toFixed(1)} percentage points: application says ${appAbv}% ABV, label shows ${labAbv}% ABV. ` +
          `That is within the ${tolerance}% wine labeling tolerance (27 CFR 4.36(b)), so it may be the same product stated at the permitted spread. The agent should confirm.`,
      };
    }
  }

  return {
    status: "fail",
    explanation: `Alcohol content mismatch: application says ${appAbv}% ABV, label shows ${labAbv}% ABV.`,
  };
}
