/**
 * Net contents normalization and comparison.
 *
 * "750 mL" == "750ml" == "750 ML" == "75 cl" == "0.75 L". Policy: exact after
 * unit normalization. Everything converts to milliliters. Same-system
 * comparisons allow 0.5 mL to absorb float noise; cross-system comparisons
 * (an application in mL against a label printed in fl oz) get a small
 * relative tolerance, because the printed equivalences themselves are
 * rounded, every 750 mL spirits bottle that also states "25.4 FL OZ" is
 * stating 751.2 mL.
 */

export interface ParsedNetContents {
  milliliters: number | null;
  /** Original text, for display. */
  raw: string;
  /**
   * Which measurement system the value came from. Dual statements
   * ("750 mL (25.4 FL OZ)") report "metric", the metric statement is
   * authoritative. Used to pick the comparison tolerance.
   */
  system: "metric" | "us" | null;
}

const UNIT_TO_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  millilitre: 1,
  millilitres: 1,
  cl: 10,
  centiliter: 10,
  centiliters: 10,
  centilitre: 10,
  centilitres: 10,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  "fl oz": 29.5735295625,
  "fluid ounce": 29.5735295625,
  "fluid ounces": 29.5735295625,
  oz: 29.5735295625, // on beverage labels, bare "oz" means fluid ounces
  pt: 473.176473,
  pint: 473.176473,
  pints: 473.176473,
  qt: 946.352946,
  quart: 946.352946,
  quarts: 946.352946,
  gal: 3785.411784,
  gallon: 3785.411784,
  gallons: 3785.411784,
};

const METRIC_UNIT = /^(ml|milli|cl|centi|l$|lit)/;

// Longest-first so "fl oz" wins over "oz", "milliliters" over "ml".
const UNIT_PATTERN = Object.keys(UNIT_TO_ML)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/\s+/g, "\\s*\\.?\\s*"))
  .join("|");

// Quantity allows a leading decimal (".75 L") and a decimal comma ("1,75 L").
const RE = new RegExp(
  `(\\d{1,5}(?:[.,]\\d{1,3})?|[.,]\\d{1,3})\\s*(${UNIT_PATTERN})\\b\\.?`,
  "gi",
);

export function parseNetContents(
  raw: string | null | undefined,
): ParsedNetContents {
  if (!raw) return { milliliters: null, raw: raw ?? "", system: null };
  const s = raw.replace(/\s+/g, " ").trim();
  // Multi-packs ("6 x 12 FL OZ"): whether the application states per-container
  // or total volume is ambiguous, leave the comparison to a human.
  if (/\d\s*[x×]\s*\d/i.test(s)) return { milliliters: null, raw: s, system: null };
  // "1,000 ml": a comma followed by exactly three digits is a thousands
  // separator, not a European decimal ("1,75 L" keeps its comma).
  const t = s.replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");

  // Compound US quantities sum across pairs ("1 PT. 9 FL. OZ." = 739.3 mL).
  // A dual statement ("750 mL (25.4 FL OZ)") is one quantity printed twice;
  // the metric side is authoritative.
  let metric = 0;
  let us = 0;
  let metricFound = false;
  let usFound = false;
  for (const m of t.matchAll(RE)) {
    if (!m[1] || !m[2]) continue;
    const qty = parseFloat(m[1].replace(",", "."));
    const unitKey = m[2].toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
    // Re-resolve compound keys like "floz" / "fl oz"
    const factor =
      UNIT_TO_ML[unitKey] ?? UNIT_TO_ML[unitKey.replace(/\s/g, "")];
    if (factor === undefined) continue;
    if (METRIC_UNIT.test(unitKey)) {
      metric += qty * factor;
      metricFound = true;
    } else {
      us += qty * factor;
      usFound = true;
    }
  }
  if (metricFound) return { milliliters: metric, raw: s, system: "metric" };
  if (usFound) return { milliliters: us, raw: s, system: "us" };
  return { milliliters: null, raw: s, system: null };
}

export interface NetContentsComparison {
  status: "pass" | "fail" | "review" | "missing";
  explanation: string;
}

/**
 * Net contents absent from the label text is not a violation: it may legally be
 * blown or embossed into the container itself (27 CFR 5.38 for spirits, routine
 * for keg collars). Shared so the pipeline's batch path says it identically.
 */
export const NET_CONTENTS_EMBOSSED_NOTE =
  "No net contents found in the label text. It may be embossed on the container itself, which the rules allow, please verify on the container.";

/** Same-system values must agree to the half-millilitre. */
const TOLERANCE_ML = 0.5;
/** Cross-system values absorb the rounding of printed equivalences (0.5%). */
const CROSS_SYSTEM_TOLERANCE = 0.005;

export function compareNetContents(
  application: string | null | undefined,
  label: string | null | undefined,
): NetContentsComparison {
  const app = parseNetContents(application);
  const lab = parseNetContents(label);

  if (lab.milliliters === null) {
    return { status: "review", explanation: NET_CONTENTS_EMBOSSED_NOTE };
  }
  if (app.milliliters === null) {
    return {
      status: "review",
      explanation: `Could not read net contents from the application ("${app.raw}"). Label shows "${lab.raw}".`,
    };
  }
  const tolerance =
    app.system === lab.system
      ? TOLERANCE_ML
      : Math.max(
          TOLERANCE_ML,
          CROSS_SYSTEM_TOLERANCE * Math.max(app.milliliters, lab.milliliters),
        );
  if (Math.abs(app.milliliters - lab.milliliters) <= tolerance) {
    const note =
      app.raw.toLowerCase() === lab.raw.toLowerCase()
        ? ""
        : ` ("${app.raw}" and "${lab.raw}" are the same quantity)`;
    return {
      status: "pass",
      explanation: `Net contents match: ${formatMl(lab.milliliters)}${note}.`,
    };
  }
  return {
    status: "fail",
    explanation: `Net contents mismatch: application says ${formatMl(app.milliliters)}, label shows ${formatMl(lab.milliliters)}.`,
  };
}

function formatMl(ml: number): string {
  if (ml >= 1000 && ml % 1000 === 0) return `${ml / 1000} L`;
  return `${Math.round(ml * 10) / 10} mL`;
}
