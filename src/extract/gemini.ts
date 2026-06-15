/**
 * Gemini provider: the same ModelProvider contract as Anthropic, reading labels
 * with the SAME shared prompts (src/extract/anthropic.ts) so a cross-model
 * comparison isolates the model as the only variable. Demonstrates the point of
 * the provider abstraction, a firewall-driven swap to Azure Gov or another
 * vendor (Marcus's reality) implements this interface and nothing else changes.
 *
 * Uses the Generative Language REST API via fetch, no SDK, tiny surface.
 */

import {
  FIELDS_PROMPT,
  WARNING_PROMPT,
  buildJudgePrompt,
} from "./anthropic";
import type {
  JudgmentResult,
  LabelExtraction,
  LabelImage,
  ModelProvider,
} from "./types";
import { ExtractionError } from "./types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** Fast multimodal reader, thinking disabled to hold the latency budget. */
const MODEL_FAST = "gemini-2.5-flash";
/** Stronger reader for the careful warning re-transcription (its read stands). */
const MODEL_CAREFUL = "gemini-2.5-pro";
const CALL_TIMEOUT_MS = 25_000;

interface GeminiPart {
  text?: string;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string };
}

export class GeminiProvider implements ModelProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey: string,
    private readonly fastModel = MODEL_FAST,
    private readonly carefulModel = MODEL_CAREFUL,
  ) {}

  private async call(
    model: string,
    images: LabelImage[],
    prompt: string,
    maxOutputTokens: number,
    disableThinking: boolean,
  ): Promise<string> {
    const generationConfig: Record<string, unknown> = {
      temperature: 0,
      maxOutputTokens,
      responseMimeType: "application/json",
    };
    // Flash supports turning thinking off entirely; Pro always reserves some.
    if (disableThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            ...images.map((img) => ({
              inline_data: { mime_type: img.mediaType, data: toBase64(img.bytes) },
            })),
            { text: prompt },
          ],
        },
      ],
      generationConfig,
    };

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "TimeoutError";
      throw new ExtractionError(
        `Network error calling Gemini API: ${String(e)}`,
        timedOut
          ? "The AI service took too long to respond. Please try again."
          : "Could not reach the AI service. Please try again in a moment.",
      );
    }

    const bodyText = await res.text();
    if (!res.ok) {
      let detail = "unknown";
      try {
        detail = (JSON.parse(bodyText) as GeminiResponse).error?.message ?? "unknown";
      } catch {
        detail = bodyText.slice(0, 200);
      }
      throw new ExtractionError(
        `Gemini API error ${res.status}: ${detail}`,
        res.status === 429 || res.status === 503
          ? "The AI service is busy. Please try again in a few seconds."
          : "The AI service returned an error. Please try again.",
      );
    }

    let data: GeminiResponse;
    try {
      data = JSON.parse(bodyText) as GeminiResponse;
    } catch {
      throw new ExtractionError(
        `Gemini returned non-JSON: ${bodyText.slice(0, 200)}`,
        "The AI service returned an unexpected response. Please try again.",
      );
    }
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new ExtractionError(
        `Gemini returned no text content: ${bodyText.slice(0, 200)}`,
        "The AI service returned an unexpected response. Please try again.",
      );
    }
    return text;
  }

  async extractLabel(images: LabelImage[]): Promise<LabelExtraction> {
    const [fieldsRaw, warning] = await Promise.all([
      this.call(this.fastModel, images, FIELDS_PROMPT, 800, true),
      this.warningCall(this.fastModel, images, true),
    ]);
    return { ...parseFields(fieldsRaw), warning };
  }

  async transcribeWarning(
    images: LabelImage[],
  ): Promise<LabelExtraction["warning"]> {
    return this.warningCall(this.carefulModel, images, false);
  }

  private async warningCall(
    model: string,
    images: LabelImage[],
    disableThinking: boolean,
  ): Promise<LabelExtraction["warning"]> {
    const raw = await this.call(model, images, WARNING_PROMPT, 600, disableThinking);
    const parsed = safeJson(raw);
    if (!parsed || typeof parsed.present !== "boolean") {
      throw new ExtractionError(
        `Malformed warning transcription: ${raw.slice(0, 200)}`,
        "The AI service returned an unexpected response. Please try again.",
      );
    }
    const text =
      typeof parsed.text === "string" && parsed.text.trim() !== "" ? parsed.text : null;
    const bold: boolean | "unknown" =
      parsed.appears_bold === true || parsed.appears_bold === false
        ? parsed.appears_bold
        : "unknown";
    return { present: parsed.present && text !== null, text, appears_bold: bold };
  }

  async judgeNames(
    field: string,
    application: string,
    label: string,
  ): Promise<JudgmentResult> {
    const raw = await this.call(
      this.fastModel,
      [],
      buildJudgePrompt(field, application, label),
      200,
      true,
    );
    const parsed = safeJson(raw);
    if (typeof parsed?.same !== "boolean" || typeof parsed?.rationale !== "string") {
      throw new ExtractionError(
        `Malformed judgment response: ${raw}`,
        "The AI service returned an unexpected response. Please try again.",
      );
    }
    return { same: parsed.same, rationale: parsed.rationale };
  }
}

function parseFields(raw: string): Omit<LabelExtraction, "warning"> {
  const o = safeJson(raw);
  if (!o || typeof o !== "object") {
    throw new ExtractionError(
      `Gemini did not return JSON: ${raw.slice(0, 200)}`,
      "The AI could not produce a structured reading of this label. Please try again or use a clearer image.",
    );
  }
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;
  return {
    brand_name: str(o.brand_name),
    fanciful_name: str(o.fanciful_name),
    class_type: str(o.class_type),
    alcohol_statement: str(o.alcohol_statement),
    net_contents: str(o.net_contents),
    producer_name: str(o.producer_name),
    country_of_origin: str(o.country_of_origin),
    image_quality_note: str(o.image_quality_note),
  };
}

function safeJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
