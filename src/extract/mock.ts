/**
 * Mock provider: serves pre-recorded extractions for the bundled demo labels,
 * keyed by SHA-256 of the image bytes.
 *
 * Why this exists:
 *  - The deployed demo works end-to-end with zero API key and zero model cost.
 *  - Evaluators (and Marcus's firewall) can exercise the full pipeline offline.
 *  - The deterministic verification path is identical in mock and live mode,
 *    only the extraction source differs, which is exactly the point of the
 *    provider abstraction.
 *
 * Honesty note: the mock never pretends to be AI on unknown images. Anything
 * not in the demo set gets a clear "live extraction not configured" message.
 */

import type {
  JudgmentResult,
  LabelExtraction,
  LabelImage,
  ModelProvider,
} from "./types";
import { ExtractionError } from "./types";
import { DEMO_EXTRACTIONS } from "./mockData";
import { REAL_EXTRACTIONS } from "./mockDataReal";

/** Synthetic demo labels + recorded real COLA label sets, all hash-keyed. */
const RECORDED: Record<string, LabelExtraction> = {
  ...DEMO_EXTRACTIONS,
  ...REAL_EXTRACTIONS,
};

export class MockProvider implements ModelProvider {
  readonly name = "mock";

  async extractLabel(images: LabelImage[]): Promise<LabelExtraction> {
    for (const img of images) {
      const found = RECORDED[await sha256Hex(img.bytes)];
      if (found) return structuredClone(found);
    }
    throw new ExtractionError(
      `No mock extraction for any of ${images.length} image(s)`,
      "This deployment is running in demo mode without a live AI key, so only the built-in demo labels can be processed. Try one of the demo labels below, or deploy with an ANTHROPIC_API_KEY to verify your own images.",
    );
  }

  async transcribeWarning(
    images: LabelImage[],
  ): Promise<LabelExtraction["warning"]> {
    // Deterministic: the careful read returns the same recorded warning, so
    // demo-mode rejections are always "confirmed", same as a real violation.
    const extraction = await this.extractLabel(images);
    return extraction.warning;
  }

  async judgeNames(): Promise<JudgmentResult> {
    // Never fabricate an AI opinion. The caller treats this error as
    // "needs human review", which is the safe default.
    throw new ExtractionError(
      "Judgment calls unavailable in mock mode",
      "AI judgment is unavailable in demo mode, flagged for human review.",
    );
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
