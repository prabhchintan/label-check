/**
 * Extraction layer types, the single boundary between this app and any AI model.
 */

/** One image of a label set (front, back, neck, strip…). */
export interface LabelImage {
  bytes: Uint8Array;
  mediaType: string;
}

/** Structured data read from a label image by a vision model (or mock). */
export interface LabelExtraction {
  brand_name: string | null;
  /** Fanciful/product name when distinct from the brand (e.g. "Sweet Sunny South"). */
  fanciful_name?: string | null;
  class_type: string | null;
  /** Verbatim alcohol statement as printed, e.g. "45% Alc./Vol. (90 Proof)". */
  alcohol_statement: string | null;
  /** Verbatim net contents as printed, e.g. "750 mL". */
  net_contents: string | null;
  warning: {
    present: boolean;
    /** Verbatim warning text, preserving the exact letter case printed. */
    text: string | null;
    /** Whether "GOVERNMENT WARNING" appears in bold type. */
    appears_bold: boolean | "unknown";
  };
  producer_name: string | null;
  country_of_origin: string | null;
  /** Free-text note on image quality issues (glare, angle, blur), if any. */
  image_quality_note: string | null;
}

/** A judgment call on whether two near-miss names refer to the same thing. */
export interface JudgmentResult {
  same: boolean;
  rationale: string;
}

/**
 * The provider interface. Exactly two implementations:
 *  - AnthropicProvider: Claude vision + text (production)
 *  - MockProvider: hash-keyed demo extractions (no key, no network)
 *
 * Swapping to Azure Gov / self-hosted inference (Marcus's firewall reality)
 * means implementing this interface, nothing else in the app changes.
 */
export interface ModelProvider {
  readonly name: string;
  /**
   * Read structured fields from a label set. Real COLA submissions are
   * multi-image (front/back/neck), with mandatory elements split across
   * them, the warning usually lives on the back label.
   */
  extractLabel(images: LabelImage[]): Promise<LabelExtraction>;
  /**
   * Careful re-transcription of ONLY the government warning. Used to confirm
   * or overturn a zero-tolerance failure before it is reported, a stronger,
   * focused read, because fast-pass transcription noise must not become a
   * false rejection.
   */
  transcribeWarning(images: LabelImage[]): Promise<LabelExtraction["warning"]>;
  /** Decide whether two near-miss names are the same. */
  judgeNames(
    field: string,
    application: string,
    label: string,
  ): Promise<JudgmentResult>;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
  }
}
