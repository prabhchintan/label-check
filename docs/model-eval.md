# Model evaluation: choosing the reader by experiment, on real labels

Everyone applying has the same frontier models, so the model choices here are
*demonstrated*, not asserted. Every candidate runs through the **identical**
verification pipeline, same prompts, same deterministic checks, only the model
swapped (the whole point of the `ModelProvider` interface), over seven real
adjudicated COLA label sets (the published comparison set, including the two carrying real
warning defects; the gallery now bundles twelve, but the later additions are clean and add no
model-discrimination signal, so the eval stays pinned to these seven).

Reproduce: `npx tsx scripts/eval-providers.ts` (needs `ANTHROPIC_API_KEY`, and
`GEMINI_API_KEY` for the cross-vendor row, in `.dev.vars`; writes
`docs/eval-results.json`). The harness scores a single **fast-pass** read per model
(no careful-read rescue) to isolate raw model fidelity. Temperature 0; results
reproduced across runs.

## Results (7 real COLA sets, fast-pass only)

| Model | Tier agreement | Warning verbatim | Median latency | Worst latency |
|---|---|---|---|---|
| Claude Haiku 4.5 | 4/7 | 4/7 | 2.3 s | 5.3 s |
| Claude Sonnet 4.6 | **7/7** | 6/7 | 4.0 s | 6.6 s |
| Claude Opus 4.8 | **7/7** | 6/7 | 3.8 s | 6.6 s |
| Gemini 2.5 Flash | 5/7 | 4/7 | **1.6 s** | 1.8 s |

(Claude Fable 5 is not available on this API tier, the endpoint returns 404.)

> **Policy note (regenerate to refresh).** This run was scored before the
> punctuation→review refinement: the checker now flags a *punctuation-only*
> warning deviation (a missing colon/comma, every word otherwise exact) as
> **YELLOW review** with the slip named, rather than RED, TTB treats the
> punctuation as mandatory but approves labels carrying it, so the agent
> decides. The two real defect cases (Penn Square, Chaglasian) are shown under
> the new policy below; the headline conclusions, faithful transcription
> *surfaces* the slip, fluent rewriting *hides* it, are unaffected by the tier
> label. Re-run `scripts/eval-providers.ts` for a fully refreshed table.

Two independent findings fall out of this table, and together they pin down the
production architecture.

## Finding 1: faithfulness beats fluency (why Claude, not Gemini)

Two of the seven labels carry real government-warning defects, the cases the tool
exists for:

- **Penn Square** omits the colon: `GOVERNMENT WARNING (1) …`
- **Chaglasian** is missing the comma after "MACHINERY" (the exact defect TTB itself
  flagged when it qualified this COLA in 2019).

On **both**, Gemini silently rewrote the label to the canonical statutory text,
inserting Penn Square's missing colon and Chaglasian's missing comma, and passed
them **GREEN**, hiding the deviation entirely. Every Claude model transcribed
verbatim, so the deterministic checker **surfaced both for the agent's review**
(a punctuation-only deviation is flagged YELLOW with the slip named and TTB's rule
cited, not auto-failed, because TTB itself approves labels carrying them; see the
warning module). The decisive contrast is *surfaced vs. hidden*:

```
penn-square (expected REVIEW, missing colon)
  claude:  "GOVERNMENT WARNING (1) ACCORDING TO THE SURGEON GENERAL, …"   → REVIEW ✓ (faithful, slip surfaced)
  gemini:  "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, …"  → GREEN  ✗ (colon invented, slip hidden)

chaglasian (expected REVIEW, missing comma after MACHINERY)
  claude:  "… OPERATE MACHINERY AND MAY CAUSE …"   → REVIEW ✓ (faithful, slip surfaced)
  gemini:  "… OPERATE MACHINERY, AND MAY CAUSE …"  → GREEN  ✗ (comma invented, slip hidden)
```

Models tuned to be helpful normalize text toward what it *should* say, excellent
for chat, **disqualifying for verbatim compliance transcription**, where the job is
to report what is actually printed, mistakes included. So the reader is Claude,
chosen on a domain-specific failure mode, not a leaderboard. This also rules Gemini
out of the careful re-read role: it would *overturn* correct rejections.

## Finding 2: the fast/careful split is the optimal operating point

The Claude ladder explains why the app pairs a fast reader with a stronger one
instead of just picking the "best" model:

- **Haiku 4.5 is fast but noisy on dense real labels (4/7).** Its three misses
  (Monkey 47, Black Maple Hill, Sierra Nevada) are **all false-REDs**, a dropped or
  altered character on a cramped back label (e.g. reading "SURGEON GENERAL**:**" on
  Sierra Nevada). Crucially, **every Haiku error is in the safe direction**:
  over-flagging for human review, never a missed violation.
- **Sonnet 4.6 reads these same labels perfectly (7/7)**, but at up to 6.6 s on the
  text-dense ones, which **blows Sarah's 5-second budget** if used as the default.
- **Opus 4.8 is no better than Sonnet (7/7, same verbatim score) and costs more**,
  so reaching for the biggest model buys nothing here. Sonnet is the right careful
  reader.

That is exactly the shipped design: **Haiku reads everything fast; a zero-tolerance
warning failure escalates to a Sonnet re-transcription whose reading stands.** The
careful read converts Haiku's fast-pass 4/7 into the production 7/7, and now we can
quantify what it's worth. (The demo recorder confirms all seven settle to their
adjudicated tiers through the live cascade.)

## The direction of error is the whole point

| | misses on these 7 | direction |
|---|---|---|
| Claude (any tier) | over-flags noisy reads | **false-RED → human review (safe)** |
| Gemini | auto-corrects defects | **false-GREEN → violation shipped (unsafe)** |

A compliance tool must fail safe. Claude's errors send a clean label to a human;
Gemini's errors send a defective label through. That asymmetry, not the headline
accuracy number, and not speed, is why the reader is Claude Haiku with a Claude
Sonnet backstop. Different strictness for different fields, extended to *which model
reads what*: the same domain insight the whole tool is built on.
