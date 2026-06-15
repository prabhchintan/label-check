/**
 * Deterministic verification module, public surface.
 * Pure functions only. No I/O, no network, no model calls.
 */

export { STATUTORY_WARNING, checkWarning } from "./warning";
export type { WarningCheckInput } from "./warning";
export { parseAbv, compareAbv } from "./abv";
export {
  parseNetContents,
  compareNetContents,
  NET_CONTENTS_EMBOSSED_NOTE,
} from "./netContents";
export { normalizeName, levenshtein, compareNames } from "./names";
export { assembleVerdict } from "./verdict";
export type {
  FieldResult,
  FieldStatus,
  NameComparison,
  Tier,
  Verdict,
} from "./types";
