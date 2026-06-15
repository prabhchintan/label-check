/**
 * Verification pipeline: extraction (AI) → deterministic checks (code) →
 * rare judgment calls (AI, labeled) → verdict assembly.
 *
 * Kept separate from HTTP routing so it is unit-testable with a fake provider.
 */

import type { LabelExtraction, LabelImage, ModelProvider } from "./extract/types";
import { ExtractionError } from "./extract/types";
import {
  assembleVerdict,
  checkWarning,
  compareAbv,
  compareNames,
  compareNetContents,
  NET_CONTENTS_EMBOSSED_NOTE,
} from "./verify";
import type { FieldResult, Verdict } from "./verify";

export interface ApplicationFields {
  brand_name: string;
  class_type: string;
  abv: string;
  net_contents: string;
  /**
   * Optional declared source. When the agent marks a product domestic or
   * imported, the country-of-origin requirement becomes a deterministic rule
   * instead of one inferred from the label's own import markings. Empty =
   * auto-detect (the prior behavior).
   */
  source?: "domestic" | "imported" | "";
  /**
   * Optional declared beverage type. "malt" makes the alcohol-content
   * exemption (27 CFR 7) deterministic rather than inferred from class wording.
   * Empty = auto-detect.
   */
  beverage_type?: "wine" | "spirits" | "malt" | "";
}

export interface VerifyResponse {
  verdict: Verdict;
  /** Wall-clock processing time in milliseconds (the <5s requirement, made visible). */
  ms: number;
  /** Set when the images do not appear to contain an alcohol label at all. */
  unreadable?: boolean;
  extraction: {
    provider: string;
    producer_name: string | null;
    country_of_origin: string | null;
    /** Fanciful/product name when distinct from the brand, a real COLA concept (TTB F 5100.31). */
    fanciful_name: string | null;
    image_quality_note: string | null;
  };
}

async function checkName(
  provider: ModelProvider,
  fieldLabel: string,
  application: string,
  extracted: string | null,
  options: {
    /**
     * Class/type designations can differ completely in wording yet mean the
     * same thing ("Table Beer" vs "Ale with natural flavors", a style name
     * vs a statement of composition). Textual distance proves nothing there,
     * so "different" escalates to a judgment call instead of auto-failing.
     * Brand names stay strict: textual difference between names is meaningful.
     */
    judgeWhenDifferent?: boolean;
    /** Return a provisional row with pending:"judgment" instead of calling the model. */
    defer?: boolean;
  } = {},
): Promise<FieldResult> {
  const base = { field: fieldLabel, application, label: extracted };

  if (application.trim() === "") {
    return {
      ...base,
      status: "review",
      explanation: `No ${fieldLabel.toLowerCase()} was entered on the application side, so there is nothing to compare.`,
    };
  }
  if (!extracted) {
    return {
      ...base,
      status: "missing",
      explanation: `Could not find a ${fieldLabel.toLowerCase()} on the label.`,
    };
  }

  const cmp = compareNames(application, extracted);
  switch (cmp.kind) {
    case "exact":
      return {
        ...base,
        status: "pass",
        explanation: `Exact match: "${extracted}".`,
      };
    case "normalized":
      return { ...base, status: "pass", explanation: cmp.note };
    case "near-miss": {
      if (options.defer) {
        return {
          ...base,
          status: "review",
          pending: "judgment",
          explanation: `"${application}" and "${extracted}" are close but not identical, asking for an AI judgment…`,
        };
      }
      return judgeField(provider, fieldLabel, application, extracted);
    }
    case "different": {
      if (options.judgeWhenDifferent) {
        if (options.defer) {
          return {
            ...base,
            status: "review",
            pending: "judgment",
            explanation: `The wording differs ("${application}" vs "${extracted}"), asking for an AI judgment…`,
          };
        }
        return judgeField(provider, fieldLabel, application, extracted);
      }
      return {
        ...base,
        status: "fail",
        explanation: `Mismatch: application says "${application}", label shows "${extracted}".`,
      };
    }
  }
}

/**
 * Resolve one labeled AI judgment call into a field row. Also serves the
 * deferred path (/api/judge) so wording is identical either way.
 */
export async function judgeField(
  provider: ModelProvider,
  fieldLabel: string,
  application: string,
  extracted: string,
): Promise<FieldResult> {
  const base = { field: fieldLabel, application, label: extracted };
  try {
    const j = await provider.judgeNames(
      fieldLabel.toLowerCase(),
      application,
      extracted,
    );
    if (j.same) {
      return {
        ...base,
        status: "review",
        aiJudgment: true,
        explanation: `Likely the same (AI judgment): ${j.rationale} Flagged for agent confirmation.`,
      };
    }
    return {
      ...base,
      status: "fail",
      aiJudgment: true,
      explanation: `Likely different (AI judgment): ${j.rationale}`,
    };
  } catch (e) {
    const msg =
      e instanceof ExtractionError ? e.userMessage : "AI judgment unavailable.";
    return {
      ...base,
      status: "review",
      explanation: `"${application}" and "${extracted}" differ in wording. ${msg} Please compare by eye.`,
    };
  }
}

/**
 * Zero-tolerance checks deserve a second opinion before a rejection. The
 * fast pass occasionally drops a character when transcribing dense label
 * text, and a single dropped comma would be a false RED. So any warning
 * failure escalates to a careful, warning-only re-transcription by a
 * stronger reader, and THAT reading stands:
 *  - careful read also fails → rejection confirmed (and says so)
 *  - careful read passes     → pass, with the double-check noted
 * Clean labels never pay this cost.
 */
async function checkWarningVerified(
  provider: ModelProvider,
  extraction: LabelExtraction,
  images: LabelImage[],
  defer = false,
): Promise<FieldResult> {
  const first = checkWarning({
    text: extraction.warning.text,
    appearsBold: extraction.warning.appears_bold,
  });
  // A suspected violation OR a punctuation deviation earns the careful read,
  // a dropped colon is as easily a transcription slip as a real defect, and a
  // second, stronger reading decides which before anything is reported.
  const needsCareful =
    first.status === "fail" || first.status === "missing" || first.warningPunctuation === true;
  if (!needsCareful) return first;
  if (defer) {
    return {
      ...first,
      pending: "confirmation",
      explanation: `${first.explanation} Double-checking with a careful second read…`,
    };
  }
  return confirmWarning(provider, images, first);
}

/**
 * The careful second read that every zero-tolerance failure must survive.
 * Also serves the deferred path (/api/confirm-warning).
 */
export async function confirmWarning(
  provider: ModelProvider,
  images: LabelImage[],
  first: FieldResult,
): Promise<FieldResult> {
  let careful: LabelExtraction["warning"];
  try {
    careful = await provider.transcribeWarning(images);
  } catch {
    return { ...first, pending: undefined }; // careful read unavailable, keep the original finding
  }
  const recheck = checkWarning({
    text: careful.text,
    appearsBold: careful.appears_bold,
  });
  const stillFlagged =
    recheck.status === "fail" ||
    recheck.status === "missing" ||
    recheck.warningPunctuation === true;
  if (stillFlagged) {
    return {
      ...recheck,
      explanation: `${recheck.explanation} Confirmed by a careful second read of the label set.`,
    };
  }
  return {
    ...recheck,
    explanation: `${recheck.explanation} (A fast first read disagreed; a careful second read settled it.)`,
  };
}

/** Malt beverages are federally exempt from stating alcohol content (27 CFR 7). */
const MALT_WORDS = /\b(malt|beer|ale|lager|stout|porter|pilsner|pilsener)\b/i;
function isMaltBeverage(...classTypes: (string | null)[]): boolean {
  return classTypes.some((c) => c !== null && MALT_WORDS.test(c));
}

/**
 * Wine designated "table wine" or "light wine" (7-14% alcohol) may state that
 * designation in lieu of an alcohol content statement (27 CFR 4.36(b)).
 */
const EXEMPT_WINE_WORDS = /\b(table|light)\s+wine\b/i;
function isExemptWine(...classTypes: (string | null)[]): boolean {
  return classTypes.some((c) => c !== null && EXEMPT_WINE_WORDS.test(c));
}

/**
 * The federal rule that permits this class to omit alcohol content, if any.
 * An explicit beverage-type declaration of "malt" makes the exemption
 * deterministic; otherwise it is inferred from the class/type wording.
 */
function abvExemption(
  beverageType: ApplicationFields["beverage_type"],
  ...classTypes: (string | null)[]
): string | null {
  if (beverageType === "malt" || isMaltBeverage(...classTypes))
    return "malt beverages are exempt from stating it under federal rules (27 CFR 7)";
  if (isExemptWine(...classTypes))
    return 'wine designated "table" or "light" may state that in lieu of an alcohol content (27 CFR 4.36)';
  return null;
}

/**
 * ABV check with the exemption nuances: a beer or table-wine label without an
 * alcohol statement is not a violation, flagging it would be exactly the
 * false positive that erodes agent trust.
 */
function checkAbv(
  application: string,
  extraction: LabelExtraction,
  appClassType: string | null,
  beverageType: ApplicationFields["beverage_type"] = "",
): FieldResult {
  // Wine carries a labeling tolerance (27 CFR 4.36(b)); spirits and malt do not.
  const isWine =
    beverageType === "wine" ||
    /\bwine\b/i.test(extraction.class_type ?? "") ||
    /\bwine\b/i.test(appClassType ?? "");
  const cmp = compareAbv(application, extraction.alcohol_statement, {
    wineTolerance: isWine,
  });
  const base = {
    field: "Alcohol content",
    application,
    label: extraction.alcohol_statement,
  };
  const exemption = abvExemption(beverageType, extraction.class_type, appClassType);
  if (cmp.status === "missing" && exemption) {
    return {
      ...base,
      status: "pass",
      explanation:
        `No alcohol content on the label, permitted: ${exemption}.` +
        (application.trim() ? ` The application's "${application}" could not be checked against the label.` : ""),
    };
  }
  if (cmp.status === "review" && application.trim() === "" && exemption) {
    return {
      ...base,
      status: "pass",
      explanation: `The application doesn't state an alcohol content, permitted: ${exemption}. Label shows "${extraction.alcohol_statement}".`,
    };
  }
  return { ...base, status: cmp.status, explanation: cmp.explanation };
}

/** Bottler/producer name and address: a mandatory label element. */
function checkBottler(producer: string | null): FieldResult {
  const base = { field: "Bottler / producer", application: null, label: producer };
  if (producer) {
    return {
      ...base,
      status: "pass",
      explanation: `Present on label: "${producer}".`,
    };
  }
  return {
    ...base,
    status: "review",
    explanation:
      "No bottler or producer statement found on the label, name and address are required. On kegs it may appear on the container; please verify.",
  };
}

/**
 * Country of origin: required for imports only. When the application declares
 * the source, the rule is deterministic; otherwise it is inferred from the
 * label's own import markings.
 */
function checkOrigin(
  extraction: LabelExtraction,
  source: ApplicationFields["source"] = "",
): FieldResult {
  const origin = extraction.country_of_origin;
  const base = { field: "Country of origin", application: null, label: origin };
  if (origin) {
    return {
      ...base,
      status: "pass",
      explanation: `Shown on label: "${origin}".`,
    };
  }
  if (source === "imported") {
    return {
      ...base,
      application: "Imported",
      status: "review",
      explanation:
        "The application marks this product as imported, but no country of origin was found on the label, required for imports. Please verify.",
    };
  }
  if (source === "domestic") {
    return {
      ...base,
      application: "Domestic",
      status: "pass",
      explanation:
        "Marked domestic on the application, a country of origin is required only for imported products.",
    };
  }
  const importMarkings = /\bimport/i.test(extraction.producer_name ?? "");
  if (importMarkings) {
    return {
      ...base,
      status: "review",
      explanation:
        "The label says the product is imported but no country of origin was found, required for imports. Please verify.",
    };
  }
  return {
    ...base,
    status: "pass",
    explanation:
      "No import markings on the label, a country of origin is required only for imported products.",
  };
}

/** Presence-only check for batch triage (no application data to compare against). */
function checkPresence(fieldLabel: string, extracted: string | null): FieldResult {
  if (extracted) {
    return {
      field: fieldLabel,
      application: null,
      label: extracted,
      status: "pass",
      explanation: `Present on label: "${extracted}".`,
    };
  }
  return {
    field: fieldLabel,
    application: null,
    label: null,
    status: "missing",
    explanation: `No ${fieldLabel.toLowerCase()} found on the label.`,
  };
}

export interface VerifyOptions {
  /**
   * Batch triage mode: no application form data. Checks that mandatory
   * elements are present and that the government warning is exact,
   * field-by-field matching still requires the application record.
   */
  labelOnly?: boolean;
  /**
   * Progressive mode: deterministic results return immediately; AI judgment
   * calls and the careful warning confirmation are marked pending and the
   * client fetches them as follow-ups. First results land in one model
   * round-trip, always.
   */
  defer?: boolean;
}

export async function runVerification(
  provider: ModelProvider,
  app: ApplicationFields,
  images: LabelImage[],
  options: VerifyOptions = {},
): Promise<VerifyResponse> {
  const start = Date.now();

  const extraction = await provider.extractLabel(images);

  // Nothing label-like found at all? Say so plainly instead of listing
  // seven missing fields, the graceful path for a photo of a cat.
  if (
    !extraction.brand_name &&
    !extraction.class_type &&
    !extraction.alcohol_statement &&
    !extraction.net_contents &&
    !extraction.producer_name &&
    !extraction.warning.text
  ) {
    return {
      unreadable: true,
      verdict: { tier: "YELLOW", fields: [], summary:
        "This doesn't look like an alcohol beverage label, or the photo is too rough to read. Try a clear, straight-on shot of the label itself." },
      ms: Date.now() - start,
      extraction: {
        provider: provider.name,
        producer_name: null,
        country_of_origin: null,
        fanciful_name: null,
        image_quality_note: extraction.image_quality_note,
      },
    };
  }

  if (options.labelOnly) {
    const labelOnlyExemption =
      extraction.alcohol_statement === null
        ? abvExemption("", extraction.class_type)
        : null;
    const abvPresence: FieldResult = labelOnlyExemption
      ? {
          field: "Alcohol content",
          application: null,
          label: null,
          status: "pass",
          explanation: `No alcohol content on the label, permitted: ${labelOnlyExemption}.`,
        }
      : checkPresence("Alcohol content", extraction.alcohol_statement);
    const netPresence: FieldResult =
      extraction.net_contents === null
        ? {
            field: "Net contents",
            application: null,
            label: null,
            status: "review",
            explanation: NET_CONTENTS_EMBOSSED_NOTE,
          }
        : checkPresence("Net contents", extraction.net_contents);
    const verdict = assembleVerdict([
      checkPresence("Brand name", extraction.brand_name),
      checkPresence("Class / type", extraction.class_type),
      abvPresence,
      netPresence,
      checkBottler(extraction.producer_name),
      checkOrigin(extraction),
      await checkWarningVerified(provider, extraction, images, options.defer),
    ]);
    return {
      verdict,
      ms: Date.now() - start,
      extraction: {
        provider: provider.name,
        producer_name: extraction.producer_name,
        country_of_origin: extraction.country_of_origin,
        fanciful_name: extraction.fanciful_name ?? null,
        image_quality_note: extraction.image_quality_note,
      },
    };
  }

  // Deterministic checks (pure code) + judgment calls only where warranted.
  const [brand, classType] = await Promise.all([
    checkName(provider, "Brand name", app.brand_name, extraction.brand_name, {
      defer: options.defer,
    }),
    checkName(provider, "Class / type", app.class_type, extraction.class_type, {
      judgeWhenDifferent: true,
      defer: options.defer,
    }),
  ]);

  const abv = checkAbv(app.abv, extraction, app.class_type || null, app.beverage_type);

  const netCmp = compareNetContents(app.net_contents, extraction.net_contents);
  const net: FieldResult = {
    field: "Net contents",
    application: app.net_contents,
    label: extraction.net_contents,
    status: netCmp.status,
    explanation: netCmp.explanation,
  };

  const warning = await checkWarningVerified(
    provider,
    extraction,
    images,
    options.defer,
  );

  const verdict = assembleVerdict([
    brand,
    classType,
    abv,
    net,
    checkBottler(extraction.producer_name),
    checkOrigin(extraction, app.source),
    warning,
  ]);

  return {
    verdict,
    ms: Date.now() - start,
    extraction: {
      provider: provider.name,
      producer_name: extraction.producer_name,
      country_of_origin: extraction.country_of_origin,
      fanciful_name: extraction.fanciful_name ?? null,
      image_quality_note: extraction.image_quality_note,
    },
  };
}
