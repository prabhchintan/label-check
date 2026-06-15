# TTB label review in seconds

Upload an alcohol label and the app checks it against the application, returning a per-field verdict in seconds: AI where the work takes judgment, deterministic code where the law demands exactness, a human deciding every case.

**Live demo:** https://prabhchintan.com/ttb

## Try it (60 seconds)

1. Open the demo and click any of the **twelve real label sets from TTB's COLA registry**. The form fills itself and the check runs.
2. **First results in about 2-3 seconds.** The deterministic checks land immediately; the rare AI opinions stream in behind them. One card reproduces a missing comma a TTB reviewer caught by hand in 2019.
3. Each of the **seven required elements** gets a verdict and a plain-language reason. Export a **printable record**, CFR-cited, generated in the browser, nothing stored.
4. **Batch** screens an importer dump into a live grid with one-click CSV. Upload a photo of your lunch and it politely says that isn't a label.
5. `/tests.html` runs the **discovery notes as tests**: the brief's Old Tom sample, Dave's STONE'S THROW, Jenny's title-case warning and her angled photo, alongside the honest limits.

## Three decisions

Everyone has the same models. The decisions are the product.

1. **AI only for judgment**, reading the label, and deciding whether "STONE'S THROW" and "Stone's Throw" are the same brand. That is all it touches.
2. **Code for the law.** The government warning (27 CFR 16.21), ABV, proof, and net-contents math are checked by unit-tested TypeScript against the statute. A character standard needs an exact comparison, not a neural network.
3. **The human decides, and the verdict survives audit.** GREEN / YELLOW / RED triages; it never approves or rejects. The legally exact checks are deterministic (same label, same result, no model in the loop), AI conclusions are tagged, and a named human signs off in place, into the record. So a determination questioned later has a reproducible result, a cited rule, and an accountable human, which is what it takes to survive an IG audit, a FOIA request, or a hearing.

## Why Claude, by experiment

Every model ran the identical pipeline over seven real COLA sets, fast-pass only, to isolate raw fidelity.

| Model | Tier agreement | Warning verbatim | Median latency |
|---|---|---|---|
| Claude Haiku 4.5 | 4/7 *(every miss over-flags, the safe direction)* | 4/7 | **2.3 s** |
| Claude Sonnet 4.6 | **7/7** | 6/7 | 4.0 s |
| Claude Opus 4.8 | 7/7 *(no better than Sonnet, costs more)* | 6/7 | 3.8 s |
| Gemini 2.5 Flash | 5/7 | 4/7 | 1.6 s |

Two of the seven carry **real warning defects**, the cases this tool exists for. Gemini silently "corrected" both, inserting Penn Square's missing colon and the comma TTB itself flagged on Chaglasian in 2019, and passed them **GREEN**. Claude transcribed verbatim, so the checker surfaced them. A model tuned to be helpful normalizes text toward what it *should* say, which is disqualifying for the one field whose job is to report what is **printed**. Claude over-flags a clean label for a human (safe); Gemini ships a defect (unsafe). So Haiku reads everything fast and a warning failure escalates to a Sonnet re-read, which turns Haiku's 4/7 into the shipped 7/7. Full writeup and one-command reproduction: [`docs/model-eval.md`](docs/model-eval.md).

**No single vendor is load-bearing.** Every backend sits behind one `ModelProvider` interface (Gemini is a second, working implementation), so moving to whatever runs inside Treasury's boundary, Azure OpenAI or a self-hosted model, is one file, not a rewrite. If a model is pulled or a firewall blocks it, the app does not change; you re-run `scripts/eval-providers.ts` to confirm the replacement transcribes verbatim before it ships. The choice is a model's *behavior*, never its brand, the only way a compliance tool stays safe across a swap.

## How it works

```
Browser (static UI, no framework, no build step)
   |  multipart POST: label image(s) + application fields
   v
Cloudflare Worker (Hono)
   |- 1. Vision extraction: TWO PARALLEL fast calls (Claude Haiku 4.5) over the
   |       whole label set; the generations overlap, so wall-clock is the slower
   |       one, not the sum. Cached on the image-set SHA-256 for instant re-checks.
   |- 2. Deterministic verification (pure TS, 107 unit tests): warning exact-match,
   |       ABV/proof, net-contents normalization, name ladder, bottler/origin.
   |- 3. FIRST RESPONSE here (~2-3 s); AI opinions defer and stream in.
   |- 4. Judgment call, ONLY for a near-miss name (rare, labeled).
   |- 5. Careful read, ONLY on a warning failure: a stronger model re-transcribes
   |       just the warning, and its reading stands. No rejection on one fast read.
   v
UI renders the label beside per-field rows; pending rows resolve in place.
```

**Stateless by design.** No database, no stored images; a content-hash cache holds only model readings, for an hour. That is the security story (nothing to retain, leak, or purge) and the scale story: each request is a Cloudflare edge isolate, so it scales horizontally with no servers, and the governed limit at volume is the model budget, not the app. With no API key the app runs in demo mode, replaying all 20 bundled examples (12 real registry sets + 8 synthetic stress tests) from recorded readings; the pipeline is identical and the mock never fakes a reading.

## What it checks

| Field | Policy | Why |
|---|---|---|
| Brand, Class/type | Normalization ladder, then AI judgment | Case and punctuation noise is routine; a genuine difference matters (Dave's nuance) |
| Alcohol content | Numeric, exact after parsing | "45% Alc./Vol. (90 Proof)" == "45%" == "90 proof"; proof cross-checked as 2 x ABV; wine carries the 27 CFR 4.36(b) tolerance |
| Net contents | Exact after unit normalization | 750 mL == 750ml == 75 cl == 0.75 L; 750 != 700 |
| Government warning | **Exact wording, pure code, calibrated severity** | 27 CFR 16.21. Reworded, missing, or title-case fails RED. A punctuation-only slip is named and flagged YELLOW, not auto-failed: TTB treats it as mandatory yet approves labels carrying it, so the call is the agent's |
| Bottler, Country of origin | Presence, conditional on imports | Origin is exact when the optional Source field is set, otherwise a best-effort hint flags for review, never a silent pass |

Two optional declarations, **Source** and **Beverage type**, make the origin and ABV-exemption checks deterministic when supplied. The tool verifies mandatory *label* elements, not COLA administrative metadata (permit, formula, status), which belongs to the application of record (TTB F 5100.31).

## Real labels, real edges

The twelve are actual adjudicated COLA sets, photographed as submitted, each exercising what synthetic data cannot fake: Chaglasian's missing comma and Penn Square's missing colon (human review at 150k/year is inconsistent, TTB flagged one and let the other through; a deterministic check is not); Black Maple Hill's ABV hiding on the neck strip; kanji front labels; imported single malts and a Japanese shochu; a sideways can wrap; a clean Spanish-ale import with "Product of Spain" shown. Two labels at the edge of current vision transcription are shown as **documented limits** on `/tests.html`, not passed off as demos. Labels were collected by hand from public records; the deployed app never contacts ttbonline.gov.

## Honest limits

- The warning's **wording** (16.21) is exact; its **type size, placement** (16.22), and bold weight cannot be proven from a photo, so they stay a visual check on the artwork, with any uncertainty flagged YELLOW, never a false GREEN.
- Batch without application records does presence and warning checks only; full field-matching needs COLA integration.
- The malt, table/light-wine, and embossed-net-contents exemptions are implemented, because a false flag on a legal omission erodes trust fastest. Wine vintage and appellation are out of scope.

## Production path

Standalone by design. To productionize: FedRAMP hosting (the `ModelProvider` seam ports to Azure Government / Azure OpenAI behind the firewall, with egress allow-listed to a single endpoint); PIV SSO and per-agent audit logging (the printable record is the seed); COLA integration to end re-keying and unlock full-matching batch; and a pilot measuring false-flag and missed-defect rates before any scale decision. Whether triage recovers agent-hours is a pilot question, not a prototype's claim. The dominant cost is one Haiku call per label, so spend at 150k/year is small against an agent-hour and capped at the key.

## Run and deploy

```bash
npm install
npm test            # 107 unit tests, no network
npm run dev         # http://localhost:8787, demo mode, no key needed

# live extraction:
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars && npm run dev
```

```bash
npx wrangler deploy                          # Worker + static assets
npx wrangler secret put ANTHROPIC_API_KEY    # enables live extraction
```

The open demo is bounded in layers: a spend cap on the key, an in-code per-IP rate limit on `/api/*`, and a body-size cap, behind a strict same-origin CSP and standard hardening headers. The only runtime dependency is Hono; CI gates the suite with no secrets.

## Repository map

```
src/verify/    deterministic verification (the auditable core) + tests
src/extract/   ModelProvider interface: Anthropic (prod), Gemini (eval), mock
src/pipeline.ts orchestration: extract, verify, verdict, with deferred AI follow-ups
src/index.ts   Hono API + static assets + rate limit + base-path handling
public/        UI (plain HTML/CSS/JS, no build step) + tests.html
docs/          model evaluation (reproducible via scripts/eval-providers.ts)
ASSUMPTIONS.md gaps in the brief and how each was filled
```
