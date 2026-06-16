# Assumptions

The brief invites filling gaps independently. Here is each gap and the call that was made.

**1. Application data is typed in, not pulled from COLA.**
Marcus ruled out COLA integration for this standalone exercise. The form therefore asks for the four matched fields the take-home's sample label exercises (brand, class/type, alcohol content, net contents), plus two optional declarations, Source (domestic/imported) and Beverage type (wine/spirits/malt), that make the country-of-origin and ABV-exemption checks deterministic when supplied and are inferred from the label otherwise. In production all of these arrive from the application of record (TTB F 5100.31). The tool verifies mandatory *label* elements, not COLA administrative metadata (permit/formula/serial/status).

**2. The statutory warning text is the single source of truth, with a calibrated severity.**
27 CFR 16.21 wording is hardcoded as a constant and compared exactly. Whitespace/line-wrapping differences are formatting (labels wrap text); wording and prefix capitalization are substance. Body text is compared case-insensitively (the regulation mandates capitals only for "GOVERNMENT WARNING"). A substantive deviation, a word added, dropped, substituted, or a title-case/reworded prefix, fails RED. A *punctuation-only* deviation (a missing colon or comma, every word otherwise exact and the prefix capitalized) is named and flagged for the agent's **review**, not auto-failed: TTB's guidance treats the warning's punctuation as mandatory (its labeling resources and the **Beverage Alcohol Manual (BAM)** are explicit, "do not omit or change any punctuation… even a missing comma can fail a COLA"), yet TTB approves labels carrying these exact slips (Penn Square's colon, and the comma TTB *did* flag on Chaglasian). Applying one consistent standard and handing the agent the Accept/Reject decision is the value automation adds over inconsistent human review. The careful second read runs on any deviation first, so a dropped colon that is really a transcription slip is corrected, not reported.

**3. "About 5 seconds" is a hard budget, measured honestly.**
The banner reports two client-measured numbers: when first results landed (deterministic checks, 2-3 s in our testing, never gated on an AI opinion) and when deferred AI opinions settled. Server-side processing time is also returned in the API response (`ms`). Nothing is hidden in the timing.

**4. Field strictness varies by field.**
Names get a normalization ladder with AI judgment for near-misses only; numbers are format-tolerant but value-exact; the warning is character-standard exact. This interpretation comes directly from the stakeholder interviews (Dave's nuance vs. Jenny's exactness).

**5. Verdict tiers triage, they don't decide.**
GREEN/YELLOW/RED assist the agent. Nothing is auto-approved or auto-rejected. Any AI-influenced finding is labeled "AI judgment" in the result.

**6. No authentication in this standalone deployment.**
It handles no real application data and stores nothing. A production system needs PIV SSO and audit logging (see README → Path to Production).

**7. Nothing is stored.**
Images and form fields live for the duration of one request. This was a deliberate trade-off: batch state could have used KV, but client-side orchestration kept the system stateless and the security story simple. One scoped exception: the model's *reading* of a label set (extracted text, no image bytes) is cached for an hour, keyed by content hash, so identical artwork re-verifies instantly, the cache holds nothing an agent typed and nothing that could identify an applicant beyond what the label itself prints.

**8. Many labels without application records = triage, not full matching.**
A pile of images alone cannot be field-matched (there is nothing to match against). With the application details left blank, each image is screened for mandatory-element presence and warning exactness, which is precisely the routine screening Sarah's team does first. There is no separate "batch mode": the same one screen takes a single label set (with application details, full matching) or hundreds (without, triage). The bundled examples demonstrate full matching because their application records are known.

**9. Bold type cannot be proven from a photo.**
The vision model reports bold / not bold / unknown for the warning prefix. Anything short of a confident "bold" flags YELLOW for the agent. A false GREEN is treated as worse than a false YELLOW.

**10. Two kinds of examples, on purpose.**
The 12 real label sets come from the public COLA registry (manual collection, no crawling, never at app runtime) and prove behavior on messy real-world data, including a warning defect TTB itself documented. The 8 synthetic labels are generated programmatically (`scripts/generate-labels.py`) because the precision traps, title-case prefix, reworded warning, missing warning, require exact control over the rendered text.

**11. Model choice, measured, not assumed.**
Claude Haiku 4.5 (vision) reads every label fast (a median 2.3 s on the seven real COLA sets). Sonnet 4.6 reads them perfectly but at a median 4.0 s and up to 6.6 s, over the 5-second budget on 3 of the 7, the exact failure mode that killed the last vendor's pilot, so it is reserved for the rare careful warning re-read rather than used as the default. Haiku's occasional single-character transcription noise is contained by that re-read, and every Haiku miss is in the safe direction (over-flag for review). Full numbers and the cross-vendor finding: `docs/model-eval.md`. The provider interface makes the model swappable (Marcus's firewall scenario) without touching the pipeline.

**12. Wine carries a labeling tolerance; spirits and malt do not.**
For wine, a label and application ABV that differ but fall within the 27 CFR 4.36(b) spread (1.5% for wines at or below 14% ABV, 1.0% above) are surfaced for the agent's review rather than failed outright, since they may state the same product at the legally permitted tolerance. Spirits stay value-exact (proof is defined as exactly 2 x ABV), and malt beverages are ABV-exempt. A difference beyond the band fails RED for any class. This only ever softens a RED to a YELLOW; it never produces a GREEN, so it cannot mask a real mismatch.

**13. Abuse and cost controls are layered, not in one place.**
The demo is intentionally open (the deliverable is a prototype Treasury can test), so cost and abuse are bounded by defense in depth rather than a login: a hard spend cap on the model key (the backstop, worst case the demo stops, never a surprise bill), a request body-size limit that rejects oversized uploads before buffering them, a bounded single retry only on fast-failing model overloads, and a per-IP rate limit on `/api/*` shipped in code (Cloudflare's native rate-limiting binding, `src/index.ts` + `wrangler.jsonc`). The model key is a server-side Worker secret, never exposed to the browser, so only usage cost is ever at risk, not the key. The per-IP limit is set deliberately high (1200 requests / 60 s) so that the scenario this app is built to win, a single reviewer dumping 300 to 500 labels at once, is never the thing that gets throttled; the spend cap is the real cost backstop, and the limit still stops a runaway script. In production, where a whole TTB office can share one egress IP, the throttle would key on the authenticated PIV user instead, and sustained burst load would run through provisioned model capacity.

**14. Net contents: agreement is checked, standards of fill are not.**
The net-contents check verifies that the label and application agree after unit normalization. It deliberately does not enforce authorized container sizes (standards of fill): TTB largely deregulated wine and spirits fills in 2020, the authorized-size question is class-specific and better suited to the agent's judgment, and conflating "the two statements agree" with "this is a legal fill" would overstate what a deterministic check can claim. A non-standard size is left for the agent, not silently passed as compliant.

**15. Dependency advisories are dev-tooling only.**
The only production runtime dependency is `hono`; the Anthropic integration is hand-rolled `fetch` with no SDK. `npm audit` advisories trace exclusively to `esbuild` inside `wrangler` (a devDependency, `npm ls --omit=dev esbuild` is empty) and affect local build tooling, never the deployed Worker. They are noted here so a reviewer running `npm audit` reads them in context.
