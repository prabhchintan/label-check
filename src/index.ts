/**
 * Label Check, Worker entry point.
 * Serves the static UI (Workers assets) and the verification API.
 */

import { Hono } from "hono";
import { getProvider } from "./extract/provider";
import { ExtractionError } from "./extract/types";
import type { LabelExtraction, LabelImage, ModelProvider } from "./extract/types";
import { confirmWarning, judgeField, runVerification } from "./pipeline";
import type { ApplicationFields } from "./pipeline";
import { checkWarning } from "./verify";
import { sha256Hex } from "./extract/mock";

interface Env {
  ANTHROPIC_API_KEY?: string;
  ASSETS: Fetcher;
  /** Cloudflare native per-key rate limiter (configured in wrangler.jsonc). */
  API_RATE_LIMIT?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB, generous for label photos
const MAX_IMAGES = 5; // front, back, neck, strip, one spare
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// Reject an oversized body by its declared length BEFORE buffering it into
// memory. 5 images x 8 MB plus multipart overhead; the per-image caps still
// apply after parsing. Bounds a trivial memory-exhaustion vector.
const MAX_UPLOAD_BYTES = MAX_IMAGES * MAX_IMAGE_BYTES + 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024; // /api/judge carries only short strings

/** True when Content-Length is present and over the cap. */
function declaredTooLarge(c: { req: { header(name: string): string | undefined } }, max: number): boolean {
  const len = Number(c.req.header("content-length"));
  return Number.isFinite(len) && len > max;
}

const app = new Hono<{ Bindings: Env }>();

/**
 * Baseline security headers on every response (API and static assets).
 * The app is same-origin only: no third-party scripts, styles, or calls.
 * `blob:` in img-src covers the upload thumbnails (URL.createObjectURL).
 */
app.use("*", async (c, next) => {
  await next();
  c.res = new Response(c.res.body, c.res); // asset responses arrive immutable
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "no-referrer");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
      "font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; " +
      "base-uri 'self'; form-action 'self'",
  );
  // Static media does not change between deploys, so let the browser keep it
  // instead of revalidating every load (the asset layer defaults to max-age=0).
  // HTML, CSS, and JS keep revalidation so a deploy is picked up immediately.
  const path = new URL(c.req.url).pathname;
  if (path.endsWith(".woff2")) {
    c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (/\.(png|jpe?g|webp|gif|svg|ico)$/.test(path)) {
    c.res.headers.set("Cache-Control", "public, max-age=2592000");
  }
});

/**
 * Per-IP rate limit on the paid endpoints, so the open demo cannot be turned
 * into a cost or abuse vector. Health is exempt (it is free). This lives in
 * code (Cloudflare's native rate-limiting binding, no state in app logic) so
 * the protection ships with the repo rather than depending on a dashboard rule
 * a reviewer cannot see. The Anthropic spend cap remains the hard backstop. If
 * the binding is somehow absent, requests pass rather than fail closed.
 */
app.use("/api/*", async (c, next) => {
  if (c.req.path.endsWith("/health") || !c.env.API_RATE_LIMIT) return next();
  const ip = c.req.header("cf-connecting-ip") ?? "anon";
  const { success } = await c.env.API_RATE_LIMIT.limit({ key: ip });
  if (!success) {
    return c.json(
      { error: "Too many requests in a short time. Please wait a few seconds and try again." },
      429,
    );
  }
  return next();
});

/**
 * Identical artwork reads identically, so extraction results are cached on
 * the SHA-256 of the image set (Workers Cache API, 1 hour). A resubmitted or
 * re-checked label set verifies instantly; the deterministic checks still run
 * fresh against whatever the application says. Bump VERSION when prompts change.
 */
const EXTRACT_CACHE_VERSION = "v3";

function cachedProvider(
  inner: ModelProvider,
  ctx: ExecutionContext,
): ModelProvider {
  return {
    name: inner.name,
    async extractLabel(images: LabelImage[]): Promise<LabelExtraction> {
      const hashes = await Promise.all(images.map((i) => sha256Hex(i.bytes)));
      // Sorted: the same label set re-uploaded in a different order is the
      // same artwork and should hit the same cache entry.
      const key = new Request(
        `https://cache.internal/extract/${EXTRACT_CACHE_VERSION}/${[...hashes].sort().join("-")}`,
      );
      // workers-types models caches.default only on the service-worker global type.
      const cache = (caches as unknown as { default: Cache }).default;
      const hit = await cache.match(key);
      if (hit) return (await hit.json()) as LabelExtraction;
      const fresh = await inner.extractLabel(images);
      // An all-null reading is more likely a transient bad read than a true
      // not-a-label, don't pin it for an hour; let a retry read fresh.
      const unreadable =
        !fresh.brand_name &&
        !fresh.class_type &&
        !fresh.alcohol_statement &&
        !fresh.net_contents &&
        !fresh.producer_name &&
        !fresh.warning.text;
      if (!unreadable) {
        ctx.waitUntil(
          cache.put(
            key,
            new Response(JSON.stringify(fresh), {
              headers: { "cache-control": "max-age=3600" },
            }),
          ),
        );
      }
      return fresh;
    },
    transcribeWarning: (images) => inner.transcribeWarning(images),
    judgeNames: (f, a, l) => inner.judgeNames(f, a, l),
  };
}

/** Parse and validate the multipart "image" parts shared by two routes. */
async function readImages(
  form: FormData,
): Promise<{ images: LabelImage[] } | { error: string }> {
  const isFile = (v: unknown): v is File =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as File).arrayBuffer === "function";
  const files = (form.getAll("image") as unknown[]).filter(isFile);
  if (files.length === 0) {
    return { error: "Please choose a label image before verifying." };
  }
  if (files.length > MAX_IMAGES) {
    return { error: `Please upload at most ${MAX_IMAGES} images of one label set.` };
  }
  for (const image of files) {
    if (image.size === 0) {
      return { error: `"${image.name}" appears to be empty. Please re-select it.` };
    }
    if (image.size > MAX_IMAGE_BYTES) {
      return { error: `"${image.name}" is larger than 8 MB. Please use a smaller file.` };
    }
    if (!ALLOWED_TYPES.has(image.type || "image/png")) {
      return {
        error: `"${image.name}" doesn't look like an image we can read. Please upload a PNG, JPEG, WebP, or GIF.`,
      };
    }
  }
  const images = await Promise.all(
    files.map(async (f) => ({
      bytes: new Uint8Array(await f.arrayBuffer()),
      mediaType: f.type || "image/png",
    })),
  );
  return { images };
}

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    mode: c.env.ANTHROPIC_API_KEY ? "live" : "demo (mock extraction)",
  }),
);

app.post("/api/verify", async (c) => {
  if (declaredTooLarge(c, MAX_UPLOAD_BYTES)) {
    return c.json({ error: "That upload is too large. Please use images under 8 MB each." }, 413);
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(
      { error: "Could not read the upload. Please try again." },
      400,
    );
  }

  const parsed = await readImages(form);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  // Optional declared source / beverage type, accept only the known values,
  // anything else (incl. empty) falls back to auto-detect.
  const sourceRaw = String(form.get("source") ?? "").trim();
  const source = sourceRaw === "domestic" || sourceRaw === "imported" ? sourceRaw : "";
  const bevRaw = String(form.get("beverage_type") ?? "").trim();
  const beverageType =
    bevRaw === "wine" || bevRaw === "spirits" || bevRaw === "malt" ? bevRaw : "";

  // Bound each field's length. A real brand/class/ABV/net-contents is short; the
  // body cap alone would still allow a single multi-megabyte field of whitespace
  // to feed the parsing regexes and burn Worker CPU, so cap before any matching.
  const field = (name: string) => String(form.get(name) ?? "").trim().slice(0, 200);
  const fields: ApplicationFields = {
    brand_name: field("brand_name"),
    class_type: field("class_type"),
    abv: field("abv"),
    net_contents: field("net_contents"),
    source,
    beverage_type: beverageType,
  };
  // Batch triage mode: no application data, check mandatory elements +
  // warning exactness only. Used when agents bulk-screen incoming images.
  const labelOnly = String(form.get("label_only") ?? "") === "1";
  // Progressive mode: deterministic results now, AI opinions as follow-ups.
  const defer = String(form.get("defer") ?? "") === "1";

  const provider = cachedProvider(getProvider(c.env), c.executionCtx);
  try {
    const result = await runVerification(provider, fields, parsed.images, {
      labelOnly,
      defer,
    });
    return c.json(result);
  } catch (e) {
    if (e instanceof ExtractionError) {
      console.error("extraction error:", e.message);
      return c.json({ error: e.userMessage }, 422);
    }
    console.error("unexpected error:", e);
    return c.json(
      { error: "Something went wrong on our side. Please try again." },
      500,
    );
  }
});

/** Deferred judgment call: resolves one pending name/class row. */
app.post("/api/judge", async (c) => {
  if (declaredTooLarge(c, MAX_JSON_BYTES)) {
    return c.json({ error: "Bad request." }, 413);
  }
  let body: { field?: string; application?: string; label?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad request." }, 400);
  }
  const field = String(body.field ?? "").slice(0, 60);
  const application = String(body.application ?? "").slice(0, 300);
  const label = String(body.label ?? "").slice(0, 300);
  if (!field || !application || !label) {
    return c.json({ error: "Bad request." }, 400);
  }
  const provider = getProvider(c.env);
  return c.json(await judgeField(provider, field, application, label));
});

/** Deferred careful read: confirms or overturns a pending warning failure. */
app.post("/api/confirm-warning", async (c) => {
  if (declaredTooLarge(c, MAX_UPLOAD_BYTES)) {
    return c.json({ error: "That upload is too large. Please use images under 8 MB each." }, 413);
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Could not read the upload. Please try again." }, 400);
  }
  const parsed = await readImages(form);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const provider = cachedProvider(getProvider(c.env), c.executionCtx);
  try {
    // Recreate the deterministic first finding from the fast read so the
    // careful read has something to confirm or overturn.
    const extraction = await provider.extractLabel(parsed.images);
    const first = checkWarning({
      text: extraction.warning.text,
      appearsBold: extraction.warning.appears_bold,
    });
    // If the (possibly cached) fast read passes now, there is nothing to
    // confirm, return it without spending a careful model call.
    if (
      first.status !== "fail" &&
      first.status !== "missing" &&
      !first.warningPunctuation
    ) {
      return c.json(first);
    }
    return c.json(await confirmWarning(provider, parsed.images, first));
  } catch (e) {
    if (e instanceof ExtractionError) {
      return c.json({ error: e.userMessage }, 422);
    }
    console.error("unexpected error:", e);
    return c.json({ error: "Something went wrong on our side. Please try again." }, 500);
  }
});

// Everything else: static assets (UI, demo labels, manifest).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

/**
 * Base-path tolerance: the app may be served at the root of a subdomain
 * (ttb.example.com/) or under a path on the main site (example.com/ttb) via a
 * Worker route. The UI uses only relative URLs, so when served under the prefix
 * the prefix is stripped for routing AND a <base href="/ttb/"> is injected into
 * the HTML document, so relative URLs ("api/verify") resolve under the prefix
 * without forcing a trailing slash into the address bar.
 */
const BASE_PATH = "/ttb";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    let prefix = "";
    if (url.pathname === BASE_PATH || url.pathname.startsWith(BASE_PATH + "/")) {
      prefix = BASE_PATH;
      url.pathname = url.pathname.slice(BASE_PATH.length) || "/";
    }
    const res = await app.fetch(new Request(url.toString(), req), env, ctx);
    if (!prefix) return res;
    // The asset layer may redirect within the stripped namespace (for example
    // /tests.html -> /tests). Re-add the prefix so the redirect stays under
    // /ttb instead of escaping to the main site and 404ing.
    const loc = res.headers.get("location");
    if (loc && loc.startsWith("/") && loc !== prefix && !loc.startsWith(prefix + "/")) {
      const headers = new Headers(res.headers);
      headers.set("location", prefix + loc);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    if ((res.headers.get("content-type") ?? "").includes("text/html")) {
      return new HTMLRewriter()
        .on("head", {
          element(el) {
            el.prepend(`<base href="${prefix}/">`, { html: true });
          },
        })
        .transform(res);
    }
    return res;
  },
};
