/**
 * Government health warning verification, 27 CFR 16.21 (mandated wording).
 *
 * Zero tolerance, zero AI. The statute mandates exact wording with "GOVERNMENT
 * WARNING" in capital letters. Jenny's team rejects title-case prefixes and
 * reworded statements, so this check is pure code: an exact comparison against
 * the statutory text after whitespace normalization. A model is never consulted
 * on whether the warning "looks right".
 *
 * Two type-format requirements are NOT verified here, by design, because a photo
 * cannot prove them: bold type (reported as a separate best-effort signal that
 * can only soften a verdict to YELLOW, never produce a false GREEN) and the
 * minimum type size and separate placement of 27 CFR 16.22, which stay the
 * examiner's call on the original artwork (see README limitations).
 */

import type { FieldResult } from "./types";

/** Statutory text, verbatim from 27 CFR 16.21. */
export const STATUTORY_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not " +
  "drink alcoholic beverages during pregnancy because of the risk of birth " +
  "defects. (2) Consumption of alcoholic beverages impairs your ability to " +
  "drive a car or operate machinery, and may cause health problems.";

const PREFIX = "GOVERNMENT WARNING:";

/** Collapse all whitespace runs (incl. newlines from label line-wrapping) to single spaces. */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Normalize typography that varies between fonts/OCR but carries no meaning:
 * curly quotes/apostrophes and unicode dashes.
 */
function normalizeTypography(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[·∙•‧･]/g, ".");
}

/**
 * Canonical form for the pass/fail decision: spacing and hyphens are layout,
 * not substance. Real approved labels in the COLA registry wrap words across
 * lines with hyphens ("BEV-ERAGES"), set "WARNING :" with a space before the
 * colon, and run enumerators into words ("(1)ACCORDING"). None of those is a
 * wording violation. Commas, periods, and parentheses are KEPT, TTB itself
 * flags a missing comma as a defect (see real COLA 19115001001298).
 */
function canonical(s: string): string {
  return normalizeTypography(s).replace(/[\s-]+/g, "");
}

const PREFIX_CANONICAL = canonical(PREFIX); // "GOVERNMENTWARNING:"
/** The prefix as bare letters, for the presence/capitalization checks. */
const PREFIX_LETTERS = "GOVERNMENTWARNING";
/** Punctuation TTB treats as part of the mandated statement. */
const PUNCTUATION = /[.,:;()]/g;
function stripPunctuation(s: string): string {
  return s.replace(PUNCTUATION, "");
}

export interface WarningCheckInput {
  /** Warning text as read from the label, or null if not found. */
  text: string | null;
  /** Whether "GOVERNMENT WARNING" appears bold, best-effort from vision; "unknown" if unsure. */
  appearsBold: boolean | "unknown";
}

export function checkWarning(input: WarningCheckInput): FieldResult {
  const base = {
    field: "Government warning",
    application: "Statutory text (27 CFR 16.21)",
  };

  if (!input.text || normalizeWhitespace(input.text) === "") {
    return {
      ...base,
      label: null,
      status: "missing",
      explanation:
        "No government warning statement found on the label. This is mandatory on all alcohol beverages.",
    };
  }

  const cleaned = normalizeTypography(normalizeWhitespace(input.text));
  const canon = canonical(input.text);
  const canonStatute = canonical(STATUTORY_WARNING);

  // 1. The words "GOVERNMENT WARNING" must be present and in CAPITALS, the one
  //    place the statute mandates case. Reworded or title-case prefixes are
  //    substantive violations (Jenny's catch), not punctuation nits.
  const labelLetters = canon.replace(/[^A-Za-z]/g, "");
  if (!labelLetters.toUpperCase().startsWith(PREFIX_LETTERS)) {
    return {
      ...base,
      label: input.text,
      status: "fail",
      explanation:
        'Warning statement does not begin with "GOVERNMENT WARNING". The statement must start with that exact phrase in capital letters.',
    };
  }
  if (!labelLetters.startsWith(PREFIX_LETTERS)) {
    const found = cleaned.slice(0, PREFIX.length);
    return {
      ...base,
      label: input.text,
      status: "fail",
      explanation: `"GOVERNMENT WARNING" must be in all capital letters. Label shows "${found}".`,
    };
  }

  // 2. Wording AND punctuation, caps-folded (the prefix caps are already
  //    enforced above) and layout-insensitive (line-wrap hyphens, spacing).
  const strict = canon.toUpperCase();
  const strictStatute = canonStatute.toUpperCase();

  if (strict !== strictStatute) {
    // A genuine wording difference (a word added, dropped, or substituted) is a
    // substantive violation. If the WORDS all match and only punctuation differs
    // (a missing colon or comma), that is a different animal: TTB treats warning
    // punctuation as mandatory, yet routinely approves labels carrying exactly
    // these slips (real COLAs 19115001001298 and the Penn Square vodka among
    // them). So it is surfaced for the agent's decision, not auto-failed.
    if (stripPunctuation(strict) !== stripPunctuation(strictStatute)) {
      return {
        ...base,
        label: input.text,
        status: "fail",
        explanation:
          "Warning wording does not match the required statutory text word-for-word. " +
          firstDifference(
            normalizeWhitespace(STATUTORY_WARNING).toUpperCase(),
            undoLayout(cleaned).toUpperCase(),
          ),
      };
    }
    return {
      ...base,
      label: input.text,
      status: "review",
      warningPunctuation: true,
      explanation:
        `Every word is present and "GOVERNMENT WARNING" is in capital letters, but the punctuation differs from the statutory text, ${describePunctuation(input.text)}. ` +
        "TTB treats the warning's punctuation as mandatory (even a missing comma can fail a COLA), yet COLAs are approved with such slips, so whether to accept it is the agent's call.",
    };
  }

  // 3. Bold type, best-effort signal only. Can flag, never auto-pass silently.
  if (input.appearsBold === false) {
    return {
      ...base,
      label: input.text,
      status: "review",
      explanation:
        'Wording is exact, but "GOVERNMENT WARNING" may not be in bold type. Bold cannot be reliably confirmed from a photo, please verify on the original artwork.',
    };
  }
  if (input.appearsBold === "unknown") {
    return {
      ...base,
      label: input.text,
      status: "review",
      explanation:
        'Wording is exact and in capital letters. Could not determine from the image whether "GOVERNMENT WARNING" is bold, please verify on the original artwork.',
    };
  }

  return {
    ...base,
    label: input.text,
    status: "pass",
    explanation:
      "Exact match with the statutory warning, with “GOVERNMENT WARNING:” in capital letters and appearing bold. Type size and placement (27 CFR 16.22) are a visual check on the original artwork.",
  };
}

/**
 * Reverse the layout quirks the canonical form forgives (line-wrap hyphens,
 * run-in enumerators, space before the colon) so the word-by-word diff aligns
 * with what the pass/fail decision actually compared, otherwise a label with
 * a hyphen wrap AND a real violation would report the wrap word as the
 * "first difference" instead of the violation.
 */
function undoLayout(s: string): string {
  return s
    .replace(/(\w)-+\s*(?=\w)/g, "$1") // "BEV- ERAGES" → "BEVERAGES" (the statute contains no hyphens)
    .replace(/\((\d)\)(?=\S)/g, "($1) ") // "(1)ACCORDING" → "(1) ACCORDING"
    .replace(/\s+:/g, ":"); // "WARNING :" → "WARNING:"
}

/**
 * Name the specific punctuation deviation ("a missing colon after 'WARNING'")
 * so the agent's review row says exactly what is off, not just "punctuation".
 * Called only when the words already match, so the first character difference
 * between the two aligned strings is the punctuation in question.
 */
function describePunctuation(text: string): string {
  const a = normalizeWhitespace(STATUTORY_WARNING);
  const b = undoLayout(normalizeTypography(normalizeWhitespace(text)));
  const names: Record<string, string> = {
    ":": "colon",
    ",": "comma",
    ".": "period",
    ";": "semicolon",
    "(": "opening parenthesis",
    ")": "closing parenthesis",
  };
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a[i] ?? "";
    const cb = b[i] ?? "";
    if (ca.toUpperCase() !== cb.toUpperCase()) {
      const preceding = (a.slice(0, i).split(/[\s(]+/).filter(Boolean).pop() ?? "")
        .replace(/[^A-Za-z]/g, "");
      if (names[ca]) {
        return `a missing ${names[ca]}${preceding ? ` after "${preceding}"` : ""}`;
      }
      if (names[cb]) {
        return `an extra ${names[cb]} the statutory text does not contain`;
      }
      return "a punctuation difference";
    }
  }
  return "a punctuation difference";
}

/** Point the agent at the first word that differs, so review is fast. */
function firstDifference(expected: string, actual: string): string {
  const e = expected.split(" ");
  const a = actual.split(" ");
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (e[i] !== a[i]) {
      const exp = e[i] ?? "(end of statement)";
      const act = a[i] ?? "(missing)";
      return `First difference: expected "${exp}" but label reads "${act}".`;
    }
  }
  return "";
}
