/**
 * One-time dev script (run with `npx tsx scripts/record-real-extractions.ts`).
 *
 * Records ONE live extraction per real COLA label set into
 * src/extract/mockDataReal.ts, keyed by the SHA-256 of each image in the set.
 * This lets demo mode (no API key) replay the real-registry examples the same
 * honest way it replays the synthetic ones: pre-recorded, never fabricated.
 *
 * Requires ANTHROPIC_API_KEY in .dev.vars. Never used at app runtime.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicProvider } from "../src/extract/anthropic";
import { sha256Hex } from "../src/extract/mock";
import { checkWarning } from "../src/verify";
import { runVerification } from "../src/pipeline";
import { ExtractionError } from "../src/extract/types";
import type { LabelExtraction, LabelImage, ModelProvider } from "../src/extract/types";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function apiKey(): string {
  const line = fs.readFileSync(path.join(ROOT, ".dev.vars"), "utf8").trim();
  const m = line.match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (!m?.[1]) throw new Error("ANTHROPIC_API_KEY not found in .dev.vars");
  return m[1].trim();
}

const mediaTypeFor = (file: string) =>
  file.endsWith(".png") ? "image/png" : "image/jpeg";

async function main() {
  const provider = new AnthropicProvider(apiKey());
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public/real-labels/manifest.json"), "utf8"),
  ) as {
    records: {
      id: string;
      images: string[];
      expected: string;
      application: { brand_name: string; class_type: string; abv: string; net_contents: string };
    }[];
  };

  const out: Record<string, unknown> = {};

  /** Replays a fixed extraction the way demo mode will (no judgment calls). */
  const replayProvider = (extraction: LabelExtraction): ModelProvider => ({
    name: "replay",
    async extractLabel() {
      return extraction;
    },
    async transcribeWarning() {
      return extraction.warning;
    },
    async judgeNames() {
      throw new ExtractionError("no judgment in replay", "AI judgment unavailable.");
    },
  });

  for (const rec of manifest.records) {
    const images: LabelImage[] = rec.images.map((rel) => ({
      bytes: new Uint8Array(fs.readFileSync(path.join(ROOT, "public", rel))),
      mediaType: mediaTypeFor(rel),
    }));

    // A recorded fast-read flake would bake a wrong verdict into demo mode
    // forever. So: settle the warning through the careful read where the live
    // pipeline would, then validate the FULL verdict against the record's
    // expected tier, re-extracting on a flake (up to 3 attempts).
    let extraction: LabelExtraction | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const candidate = await provider.extractLabel(images);
      const w = checkWarning({
        text: candidate.warning.text,
        appearsBold: candidate.warning.appears_bold,
      });
      if (w.status === "fail" || w.status === "missing") {
        candidate.warning = await provider.transcribeWarning(images);
      }
      const verdict = await runVerification(
        replayProvider(candidate),
        rec.application,
        images,
      );
      if (verdict.verdict.tier === rec.expected) {
        extraction = candidate;
        console.log(`${rec.id}: recorded (tier ${verdict.verdict.tier}, attempt ${attempt})`);
        break;
      }
      console.log(`${rec.id}: attempt ${attempt} gave ${verdict.verdict.tier}, expected ${rec.expected}, retrying`);
    }
    if (!extraction) {
      throw new Error(`${rec.id}: could not record an extraction matching expected tier ${rec.expected}`);
    }

    for (const img of images) {
      out[await sha256Hex(img.bytes)] = extraction;
    }
  }

  const body =
    `/**\n * GENERATED FILE, do not edit by hand.\n * Produced by scripts/record-real-extractions.ts from ONE live extraction per\n * real COLA label set (public/real-labels/). Lets demo mode replay the real\n * registry examples without an API key, pre-recorded, never fabricated.\n * Every image of a set maps to the same whole-set extraction.\n */\n\n` +
    `import type { LabelExtraction } from "./types";\n\n` +
    `export const REAL_EXTRACTIONS: Record<string, LabelExtraction> = ` +
    JSON.stringify(out, null, 2) +
    `;\n`;
  fs.writeFileSync(path.join(ROOT, "src/extract/mockDataReal.ts"), body);
  console.log(`\nWrote src/extract/mockDataReal.ts (${Object.keys(out).length} image hashes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
