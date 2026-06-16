# Label Check

In 2019 a TTB reviewer caught a missing comma in a Chaglasian wine label's government warning and qualified the approval. A near-identical slip, a missing colon after "GOVERNMENT WARNING", was approved on a Penn Square label the same era. Both are real adjudicated COLA records. Both are in this app. Human review at 150,000 labels a year cannot be perfectly consistent. A checker can. That gap is the point.

Label Check reads an alcohol label, compares it to the application, and returns a verdict on each of the seven required elements, with a reason for every call.

**Live demo:** https://prabhchintan.com/ttb

## Try it (a minute)

One screen, one label or a whole stack. Fill the application details for a field-by-field match; leave them blank and drop many, and each image is screened alone.

1. Click any of the **twelve real COLA label sets**. The application fills itself and the check runs.
2. Legal checks land first; model opinions stream in behind. Chaglasian reproduces the 2019 comma catch; Penn Square flags the colon TTB let through.
3. Each of the **seven elements** gets a verdict and a reason. Save a CFR-cited **printable record**, built in the browser, nothing stored.
4. Press **Stress test: screen 300** (or drop your own folder): 300 labels triage into a live grid with one-click CSV. A photo of your lunch comes back as not a label.
5. `/tests.html` runs the interview notes as tests: the brief's Old Tom sample, Dave's "STONE'S THROW", Jenny's title-case warning and angled photo, plus two real labels the tool cannot yet read.

## The finding that set the architecture

Treat the government warning like any other field and you build the wrong tool. Its job is to report exactly what is **printed**, defect and all, not what the text should say. That cuts against how vision models are trained.

Every model ran the same pipeline over seven real COLA sets, fast pass only, to isolate transcription fidelity:

| Model | Tier agreement | Warning verbatim | Median latency |
|---|---|---|---|
| Claude Haiku 4.5 | 4/7 *(every miss over-flags, the safe direction)* | 4/7 | **2.3 s** |
| Claude Sonnet 4.6 | **7/7** | 6/7 | 4.0 s |
| Claude Opus 4.8 | 7/7 *(no better than Sonnet, costs more)* | 6/7 | 3.8 s |
| Gemini 2.5 Flash | 5/7 | 4/7 | 1.6 s |

Two of the seven carry real warning defects, the cases this tool exists to catch. **Gemini silently fixed both**, inserting Penn Square's colon and the Chaglasian comma, and passed them GREEN. Claude transcribed them verbatim, so the checker caught them. A model trained to be helpful normalizes text toward what it *should* say, which is disqualifying for a field whose job is to report what is on the bottle. Here, helpfulness is a safety bug.

So Haiku reads fast, and a warning failure escalates to a Sonnet re-read of the warning alone, turning Haiku's 4/7 into the shipped 7/7 without Sonnet's latency on clean labels. The model is chosen for measured behavior, not brand. Full writeup and one-command reproduction: [`docs/model-eval.md`](docs/model-eval.md).

**No vendor is load-bearing.** Every backend sits behind one `ModelProvider` interface, and Gemini is a working second implementation. Moving to whatever runs inside Treasury's boundary, Azure OpenAI or self-hosted, is one file; re-run `scripts/eval-providers.ts` to confirm verbatim transcription before it ships. The check is the contract, not the brand.

## Model reads, code checks, agent decides

- **The model reads and weighs.** It transcribes the label and judges whether "STONE'S THROW" and "Stone's Throw" are the same brand. Dave's nuance is a judgment, so a model makes it.
- **The exact checks run in code.** The government warning (27 CFR 16.21), ABV, proof, and net contents are verified by 107 unit-tested TypeScript checks against the statute. A character-exact rule wants an exact comparison, not a neural net that might round it.
- **The agent decides, and it holds up.** The tool triages GREEN / YELLOW / RED and never approves or rejects. Code checks return the same result every time, no model in the loop; model conclusions are tagged; a named agent signs each call into the record. A determination questioned later has a reproducible result, a cited rule, and an accountable human, enough to survive an IG audit, a FOIA request, or a hearing.

## Built for the 300-label dump

Peak season is an importer dropping 200 to 300 applications at once, the load that sank the last vendor's pilot. Drop a folder, or press **Stress test: screen 300**: the pile fans through a fixed concurrency window, each image downscaled only when its turn comes, so memory stays flat from five labels to five hundred (a 300-run holds a few MB of heap). Results triage into a live grid as they land, with one-click CSV. Each check is an independent stateless edge request, so throughput scales with model capacity, not the app, and the rate limit is set high so a real batch is never throttled.

## What it checks

| Field | How | Why |
|---|---|---|
| Brand, Class/type | Normalize, then model judgment on a real difference | Case and punctuation noise is routine; a genuine mismatch is not |
| Alcohol content | Numeric, exact after parsing | "45% Alc./Vol. (90 Proof)" equals "45%" equals "90 proof"; proof cross-checked as 2x ABV; wine carries the 27 CFR 4.36(b) tolerance |
| Net contents | Exact after unit normalization | 750 mL equals 750ml equals 75 cl equals 0.75 L; 750 is not 700 |
| Government warning | Exact wording, in code, calibrated severity | 27 CFR 16.21. Reworded, missing, or title-case fails RED. A punctuation-only slip is named and flagged YELLOW, not auto-failed: TTB treats the warning as mandatory yet has approved labels carrying such slips, so the call is the agent's |
| Bottler, Country of origin | Presence, conditional on imports | Origin is exact when the Source field is set, otherwise a best-effort hint flagged for review, never a silent pass |

Two optional declarations, **Source** and **Beverage type**, make the origin and malt-ABV-exemption checks fully determined when supplied. The tool verifies mandatory *label* elements, not COLA administrative metadata (permit, formula, status), which lives in the application of record (TTB F 5100.31).

## Real labels

The twelve are real adjudicated COLA sets, photographed as submitted, each exercising what synthetic data cannot fake: the Chaglasian comma and the Penn Square colon; Black Maple Hill's ABV on a neck strip; kanji front labels; imported single malts and a Japanese shochu; a sideways can wrap; a clean Spanish import showing "Product of Spain". Two sit past the edge of vision transcription, shown as **limits** on `/tests.html`. All were collected by hand from public records; the deployed app never contacts ttbonline.gov.

## Limits

- The warning's **wording** (16.21) is checked exactly; its **type size and placement** (16.22) and bold weight cannot be proven from a photo, so those stay a visual check, with any doubt flagged YELLOW, never a false GREEN.
- A pile of images with no application records gets presence and warning checks only; full field-matching needs COLA integration.
- The malt, table/light-wine, and embossed-net-contents exemptions are implemented, since a false flag on a legal omission erodes trust fastest. Wine vintage and appellation are out of scope.

## How it runs

```
Browser (static UI, no framework, no build step)
   |  multipart POST: label image(s) + application fields
   v
Cloudflare Worker (Hono)
   |- 1. Vision read: two parallel fast calls (Claude Haiku 4.5) over the label
   |       set; they overlap, so wall-clock is the slower one, not the sum.
   |       Cached on the image-set SHA-256 for instant re-checks.
   |- 2. Legal verification (pure TS, 107 unit tests): warning exact-match, ABV
   |       and proof, net-contents normalization, name ladder, bottler and origin.
   |- 3. First response here (about 2 to 3 s); model opinions defer and stream in.
   |- 4. Near-miss name judgment, only when a name is close but not identical.
   |- 5. Careful warning re-read, only on a warning failure: a stronger model
   |       re-transcribes the warning alone, and its reading stands.
   v
UI renders the label beside per-field rows; pending rows resolve in place.
```

**Stateless on purpose.** No database, no stored images; a content-hash cache holds only model readings, for an hour. Nothing to retain, leak, or purge, and each request is a Cloudflare edge isolate, so it scales horizontally with no servers; the limit at volume is model budget, not the app. With no key the app runs in demo mode, replaying all 20 bundled examples (12 real sets plus 8 synthetic stress tests) from recorded readings; the pipeline is identical and the mock never invents a reading.

## Production path

To productionize: FedRAMP hosting, with the `ModelProvider` seam porting to Azure Government or Azure OpenAI inside the firewall, egress allow-listed to one endpoint; PIV SSO and per-agent audit logging, seeded by the printable record; COLA integration to end re-keying and unlock full-matching batch; and a pilot measuring false-flag and missed-defect rates before any scale decision. Whether triage recovers agent-hours is the pilot's question, not the prototype's claim. The dominant cost is one Haiku call per label, so spend at 150k/year is small against an agent-hour and capped at the key.

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

The front end uses the public-domain U.S. Web Design System and Public Sans. The Treasury seal and official-government banner are left off; every page carries a non-affiliation notice.

## Repository map

```
src/verify/     legal verification (the auditable core) + tests
src/extract/    ModelProvider interface: Anthropic (prod), Gemini (eval), mock
src/pipeline.ts orchestration: read, verify, verdict, with deferred model follow-ups
src/index.ts    Hono API + static assets + rate limit + base-path handling
public/         UI (plain HTML/CSS/JS, no build step) + tests.html
docs/           model evaluation (reproducible via scripts/eval-providers.ts)
ASSUMPTIONS.md  gaps in the brief and how each was filled
```
