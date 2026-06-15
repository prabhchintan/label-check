/**
 * Offline cross-model eval (run with `npx tsx scripts/eval-providers.ts`).
 *
 * Runs the IDENTICAL verification pipeline on each real COLA label set with two
 * vision providers (Claude Haiku 4.5 and Gemini 2.5 Flash) and reports, per set:
 *   - verdict tier vs the manifest's expected tier (does the app reach the right
 *     call on this model?)
 *   - government-warning transcription: exact agreement with the recorded
 *     reference, plus the deterministic warning-check status (the bottleneck, 
 *     a single dropped character here would be a false rejection)
 *   - wall-clock latency (the <5s requirement)
 *
 * Live extraction only, never used at app runtime. Reads both keys from
 * .dev.vars. Writes docs/eval-results.json for the README table.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicProvider } from "../src/extract/anthropic";
import { GeminiProvider } from "../src/extract/gemini";
import { runVerification } from "../src/pipeline";
import { checkWarning } from "../src/verify";
import { REAL_EXTRACTIONS } from "../src/extract/mockDataReal";
import { sha256Hex } from "../src/extract/mock";
import { ExtractionError } from "../src/extract/types";
import type { LabelExtraction, LabelImage, ModelProvider } from "../src/extract/types";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readKey(name: string): string {
  const env = fs.readFileSync(path.join(ROOT, ".dev.vars"), "utf8");
  const m = env.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (!m?.[1]) throw new Error(`${name} not found in .dev.vars`);
  return m[1].trim();
}

const mediaTypeFor = (file: string) =>
  file.endsWith(".png") ? "image/png" : "image/jpeg";

interface Rec {
  id: string;
  title: string;
  images: string[];
  expected: string;
  application: { brand_name: string; class_type: string; abv: string; net_contents: string };
}

interface ProviderRun {
  tier: string;
  ms: number;
  warningText: string | null;
  warningStatus: string;
  warningExactVsReference: boolean | null;
  brand: string | null;
  classType: string | null;
  abv: string | null;
  net: string | null;
  error?: string;
}

/** Replays a fixed extraction so the verdict scores the exact read we measured. */
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

async function runOne(
  provider: ModelProvider,
  rec: Rec,
  images: LabelImage[],
  referenceWarning: string | null,
): Promise<ProviderRun> {
  try {
    // ONE real extraction; time it; score the verdict and the warning from
    // that same read (fast-pass tier, no careful-read rescue, so the metric
    // reflects raw model vision quality, the apples-to-apples question).
    // Free-tier providers rate-limit per minute; back off and retry so the
    // eval completes (this pacing is eval-only, never on the app's hot path).
    let ext: LabelExtraction | null = null;
    let ms = 0;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const t0 = Date.now();
        ext = await provider.extractLabel(images);
        ms = Date.now() - t0; // only the successful read; excludes backoff waits
        break;
      } catch (e) {
        if (/429|quota|RESOURCE_EXHAUSTED/i.test(String(e)) && attempt < 4) {
          console.log(`    …${provider.name} rate-limited, waiting 25s (attempt ${attempt})`);
          await new Promise((r) => setTimeout(r, 25_000));
          continue;
        }
        throw e;
      }
    }
    if (!ext) throw new Error("no extraction");
    const r = await runVerification(replayProvider(ext), rec.application, images);
    const wStatus = checkWarning({
      text: ext.warning.text,
      appearsBold: ext.warning.appears_bold,
    }).status;
    return {
      tier: r.verdict.tier,
      ms,
      warningText: ext.warning.text,
      warningStatus: wStatus,
      warningExactVsReference:
        referenceWarning == null ? null : ext.warning.text === referenceWarning,
      brand: ext.brand_name,
      classType: ext.class_type,
      abv: ext.alcohol_statement,
      net: ext.net_contents,
    };
  } catch (e) {
    return {
      tier: "ERROR",
      ms: 0,
      warningText: null,
      warningStatus: "error",
      warningExactVsReference: null,
      brand: null,
      classType: null,
      abv: null,
      net: null,
      error: String(e),
    };
  }
}

interface Contender {
  label: string;
  provider: ModelProvider;
}

/** The models under test: the Claude tier ladder, plus Gemini for cross-vendor
 *  context if a key is present. Same pipeline + prompts for every one, only
 *  the model changes. Edit this list to add/remove contenders. */
function contenders(): Contender[] {
  const ak = readKey("ANTHROPIC_API_KEY");
  const claude = (label: string, model: string) => ({
    label,
    provider: new AnthropicProvider(ak, model, model, label),
  });
  const list: Contender[] = [
    claude("haiku-4.5", "claude-haiku-4-5"),
    claude("sonnet-4.6", "claude-sonnet-4-6"),
    claude("opus-4.8", "claude-opus-4-8"),
    // claude("fable-5", "claude-fable-5"), // not available on this API tier (404)
  ];
  try {
    list.push({ label: "gemini-2.5-flash", provider: new GeminiProvider(readKey("GEMINI_API_KEY")) });
  } catch {
    console.log("(no GEMINI_API_KEY, skipping cross-vendor contender)");
  }
  return list;
}

/**
 * The published comparison is scored over the original seven real sets (the two
 * carrying real warning defects, Penn Square and Chaglasian, plus five clean
 * controls). Later gallery additions are clean and add no model-discrimination
 * signal, so they are excluded and the set is pinned here, re-running this
 * script reproduces the committed table rather than silently rescoring over all
 * twelve.
 */
const EVAL_SET_IDS = new Set([
  "casamigos", "monkey-47", "black-maple-hill", "kaku-rei",
  "chaglasian", "penn-square", "sierra-nevada",
]);

async function main() {
  const models = contenders();
  console.log(`Models under test: ${models.map((m) => m.label).join(", ")}`);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public/real-labels/manifest.json"), "utf8"),
  ) as { records: Rec[] };

  const results: { id: string; title: string; expected: string; runs: Record<string, ProviderRun> }[] = [];

  for (const rec of manifest.records.filter((r) => EVAL_SET_IDS.has(r.id))) {
    const images: LabelImage[] = rec.images.map((rel) => ({
      bytes: new Uint8Array(fs.readFileSync(path.join(ROOT, "public", rel))),
      mediaType: mediaTypeFor(rel),
    }));
    // Reference warning = the recorded (validated) reading for this set.
    const firstImage = images[0];
    const refHash = firstImage ? await sha256Hex(firstImage.bytes) : "";
    const referenceWarning = REAL_EXTRACTIONS[refHash]?.warning.text ?? null;

    console.log(`\n=== ${rec.id}, ${rec.title} (expected ${rec.expected}) ===`);
    const runs: Record<string, ProviderRun> = {};
    // Sequential per model, keeps us under the shared Anthropic rate limit.
    for (const m of models) {
      const r = await runOne(m.provider, rec, images, referenceWarning);
      runs[m.label] = r;
      const mark = r.tier === rec.expected ? "✓" : "✗";
      console.log(
        `  ${m.label.padEnd(16)} tier ${r.tier}${mark} ${String(r.ms).padStart(6)}ms · warning ${r.warningStatus}` +
          (r.warningExactVsReference === null
            ? ""
            : r.warningExactVsReference
              ? " · warning-text=EXACT"
              : " · warning-text=DIFFERS") +
          (r.error ? ` · ERR ${r.error.slice(0, 80)}` : ""),
      );
    }
    // Surface the actual warning text for any model that missed the tier, that
    // is where the interesting transcription failures live.
    for (const m of models) {
      const r = runs[m.label];
      if (r && r.tier !== rec.expected && r.tier !== "ERROR") {
        console.log(`  ⚠ ${m.label} read: ${JSON.stringify(r.warningText)?.slice(0, 170)}`);
      }
    }
    results.push({ id: rec.id, title: rec.title, expected: rec.expected, runs });
  }

  // Aggregate per model.
  const agg = (label: string) => {
    const runs = results.map((res) => res.runs[label]).filter(Boolean) as ProviderRun[];
    const tierOk = results.filter((res) => res.runs[label]?.tier === res.expected).length;
    const warnExact = runs.filter((r) => r.warningExactVsReference === true).length;
    const warnScored = runs.filter((r) => r.warningExactVsReference !== null).length;
    const okMs = runs.filter((r) => r.ms > 0).map((r) => r.ms);
    const p50 = okMs.length ? okMs.slice().sort((a, b) => a - b)[Math.floor(okMs.length / 2)] : 0;
    return {
      tierAgreement: `${tierOk}/${results.length}`,
      warningVerbatim: `${warnExact}/${warnScored}`,
      medianMs: p50,
    };
  };
  const summary: Record<string, unknown> = {
    generatedFrom: "scripts/eval-providers.ts",
    sets: results.length,
    models: Object.fromEntries(models.map((m) => [m.label, agg(m.label)])),
  };

  console.log(`\n===== SUMMARY (${results.length} real COLA sets) =====`);
  for (const m of models) console.log(`  ${m.label.padEnd(16)}`, agg(m.label));

  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "docs/eval-results.json"),
    JSON.stringify({ summary, results }, null, 2),
  );
  console.log("\nWrote docs/eval-results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
