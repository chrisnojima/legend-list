# Baseline: stock @legendapp/list 3.3.7 vs. this fork

Date: 2026-08-18
Fork commit measured: `c57aa1faa4c9f96c0835f80ca3f0f8925c89f87a`

Both runs used `bun repro/run.mjs --only=<scenario> --n=30`, invoked once per scenario (nine
invocations per lib), in system Chrome (Playwright, `channel: "chrome"`, headless). See
"Methodology note" below for why per-scenario invocations were used, and for a check that this
chunked method agrees with a single continuous sweep.

## Pass criterion, and a trap in the raw JSON

A run passes when `fullyVisible && Math.abs(errPx) <= PASS_THRESHOLD_PX` (`repro/probe.ts`). The
two conditions are independent and a scenario can fail on either alone: stock `hit-two-phase` is
`fullyVisible: true` in all 30 runs and fails purely on the 118.1px offset, while stock
`hit-late-images` and fork `hit-prepend` are `fullyVisible: false` in all 30 runs — the row is
found (in `hit-late-images`'s and `hit-prepend`'s case) but not fully in view, in addition to being
far from its target offset. The tables below report only the pixel error column; this paragraph is
the key to reading `fullyVisible` failures that a pixel number alone doesn't show.

**Trap when recomputing statistics from the committed JSON:** when a run has `targetMissing: true`,
`errPx` is `NaN` at runtime, and `JSON.stringify` serializes `NaN` as `null`. `Math.abs(null)` is
`0`, not `NaN` — so any recomputation that doesn't explicitly exclude `errPx === null` before
taking medians or percentiles will silently count every missing-target run as a 0px error. This is
exactly the bug the (uncommitted) merge script used to build these tables originally had; it was
found and fixed before this document was finalized, but the trap is inherent to the data format,
not just that script, so anyone else recomputing from `repro/results/stock.json` or
`repro/results/fork.json` needs to filter `errPx === null` first.

## Methodology note

Both tables below were produced by the same method: nine separate `--only=<scenario>` foreground
invocations of `--n=30`, one scenario per command, merged afterward into
`repro/results/stock.json` and `repro/results/fork.json` with a throwaway script (not committed)
that concatenates the `results` arrays and recomputes the summary `rows` using the same
median/percentile/pass logic as `run.mjs`. Each scenario's 30 runs happened in its own page load —
neither table is a single continuous nine-scenario sweep. This was done because a full
nine-scenario `--n=30` sweep (270 scenario executions) exceeds the foreground command time budget
available while producing this document, and — after an initial draft compared a single-sweep
stock table against a chunked fork table — because measuring the two builds by different methods
would leave any part of the 5-vs-8 pass-count difference potentially attributable to methodology
rather than library behavior, given this harness's known sensitivity to run context (the
inter-scenario reset had to be made deterministic in Task 6 specifically because pass counts moved
with it). No verdict objects were altered in the merge — `targetMissing` and `resetTimedOut` are
preserved exactly as recorded by the probe.

**Sweep vs. chunked comparison, stock only.** Before switching to the chunked method for stock, a
single continuous `--n=30` sweep was also run (`--lib=stock` with no `--only`, all nine scenarios
in one page load). Comparing that sweep against the chunked re-run, scenario by scenario:

```
scenario          pass (sweep -> chunked)   med err (sweep -> chunked)   p95 err (sweep -> chunked)
open-newest       30 -> 30                  0.0px -> 0.0px               0.0px -> 0.0px
hit-cold          30 -> 30                  0.3px -> 0.3px               0.3px -> 0.3px
hit-warm          30 -> 30                  0.3px -> 0.3px               0.3px -> 0.3px
hit-two-phase     0  -> 0                   118.1px -> 118.1px           118.1px -> 118.1px
hit-prepend       0  -> 0                   - -> -                       - -> -
hit-late-images   0  -> 0                   1297.7px -> 1297.7px         1297.7px -> 1297.7px
send-at-end       30 -> 30                  0.0px -> 0.0px               0.0px -> 0.0px
page-up           0  -> 0                   - -> -                       - -> -
resize-at-end     30 -> 30                  0.0px -> 0.0px               0.0px -> 0.0px
```

Every scenario agrees exactly on pass count, median error, and p95 error between the two methods.
`med settle` varied by single-digit milliseconds across the two methods (e.g. `resize-at-end`
974.7ms swept vs. 983.9ms chunked) — consistent with ordinary timing jitter, not a methodology
effect. This is evidence the instrument is stable across sweep and chunked measurement for stock,
which strengthens confidence that the fork table (chunked only) is not an artifact of that method
either. The table below is the chunked run, used because it is now methodologically identical to
the fork table.

Neither run reported any `resetTimedOut` runs (0 across all scenarios, both libs), so no result
here is flagged as possibly contaminated by incomplete reset between runs.

## Stock 3.3.7 (`--lib=stock --n=30`, assembled from nine per-scenario runs)

```
lib=stock  n=30

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     771ms       0
hit-cold          30/30   0        0.3px     0.3px     766ms       3
hit-warm          30/30   0        0.3px     0.3px     1030ms      3
hit-two-phase     0/30    0        118.1px   118.1px   835ms       9
hit-prepend       0/30    30       -         -         768ms       9
hit-late-images   0/30    0        1297.7px  1297.7px  829ms       3
send-at-end       30/30   0        0.0px     0.0px     771ms       0
page-up           0/30    30       -         -         777ms       8
resize-at-end     30/30   0        0.0px     0.0px     984ms       0
```

Stock result: **5/9 passing**.

## This fork (`--lib=fork --n=30`, assembled from nine per-scenario runs)

```
lib=fork  n=30

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     773ms       0
hit-cold          30/30   0        0.3px     0.3px     756ms       3
hit-warm          30/30   0        0.3px     0.4px     1025ms      3
hit-two-phase     30/30   0        0.3px     0.3px     834ms       9
hit-prepend       0/30    0        3381.7px  3381.7px  837ms       5
hit-late-images   30/30   0        0.3px     0.3px     829ms       3
send-at-end       30/30   0        0.0px     0.0px     772ms       0
page-up           30/30   0        0.8px     0.8px     774ms       6
resize-at-end     30/30   0        0.0px     0.0px     976ms       0
```

Fork result: **8/9 passing**.

## `hit-prepend`: the fork changes what fails, not whether it fails

This is the single most useful signal in this document for the next task. What is measured: on
stock 3.3.7, `hit-prepend` fails with `targetMissing: true` in 30/30 runs — the oracle cannot find
the target row's DOM node at all. On the fork, `hit-prepend` still fails (0/30), but
`targetMissing` is `false` in every run: the target row's DOM node is found, and sits a median
3381.7px from its requested position. So the observation is: stock never locates the row; the fork
always locates it, but far from where it should be.

Everything past that is inference, not measurement. One reading — call it a hypothesis for Task 9
to test, not a conclusion this data establishes — is that the fork fix restores the target row's
*identity* (LegendList locates and renders the correct row) without restoring its *position*
(where that row ends up on screen). The harness records DOM presence and pixel offset; it does not
instrument LegendList's internals, so it cannot itself distinguish "identity fixed, position not"
from any other internal explanation for the same external symptom. Task 9 should treat this as the
question to answer, not the answer.

## Guard sanity check

`open-newest`, `send-at-end`, and `resize-at-end` all pass 30/30 on stock 3.3.7, with median error
0.0px in every case. They also pass 30/30 on the fork. This is consistent with the harness
measuring a real library behavior rather than reporting a false failure from a misconfigured
scroller lookup. No further investigation of `scrollerEl()` was needed.

Each scenario's outcome is uniform across all 30 runs in both libs — every scenario is either
30/30 pass or 0/30 pass. No scenario landed in between (e.g. 24/30), so there is no flakiness to
report at `n=30` for either build.

## Scenarios stock 3.3.7 already handles

`open-newest`, `hit-cold`, `hit-warm`, `send-at-end`, and `resize-at-end` pass cleanly on stock
3.3.7 and show no measurable difference from the fork (same 30/30, same order-of-magnitude med
err, well under 1px). These five are not part of the bug this fork fixes; any part of the fork
diff whose only effect is on these five scenarios is a candidate for deletion in Task 9, since
stock already gets them right.

## Scenarios that fail on stock and what the fork changes

- **`hit-two-phase`**: stock 0/30, med err 118.1px. Fork 30/30, med err 0.3px. Fixed by the fork.
- **`hit-late-images`**: stock 0/30, med err 1297.7px. Fork 30/30, med err 0.3px. Fixed by the fork.
- **`page-up`**: stock 0/30, `targetMissing` in all 30 runs (no finite error to report). Fork
  30/30, med err 0.8px, `targetMissing` 0/30. Fixed by the fork.
- **`hit-prepend`**: stock 0/30, `targetMissing` in all 30 runs. Fork 0/30, `targetMissing` 0/30
  but med err 3381.7px — **still fails, and the failure mode changed**. Stock cannot find the
  target row in the DOM at all after the prepend; the fork does find it, but lands roughly
  3382px away from it. This is the one scenario the fork does not fix, and it is worth flagging
  precisely because the nature of the failure is different, not merely "still broken."

## Failure descriptions (for a reader who has not run the harness)

Two distinct failure shapes appear in this data:

1. **Target row not rendered at all** (`targetMissing: true`): the oracle cannot find the row DOM
   node it is looking for anywhere in the document after the scroll-to-index call settles. This is
   what stock 3.3.7 does on `hit-prepend` and `page-up`. `errPx` is `null` for these runs — the
   artifacts record no landing offset at all, because there is no located row to measure one
   against.

   What is independently verifiable: the `scroll.observed` events recorded in
   `repro/results/hit-prepend-first-failure.json` (captured from a stock run) show the scroller's
   `scrollTop` moving from 332px to a final observed 4603px over the course of the scenario — a
   roughly 4271px jump, consistent with the prepend inserting a large amount of new content above
   the previously-visible position. The equivalent log for `page-up` shows the same shape: a final
   observed offset of 4823px. Both are measured facts from the event log. Where the target row
   itself ended up relative to that offset is not recorded — `targetMissing: true` means the oracle
   never located it to measure. Concluding that the row is "outside the range LegendList has drawn"
   is a plausible inference from the offset jump and the miss together, not something the harness
   measured directly, and it is offered here as inference, not fact.
2. **Target row rendered at the wrong offset** (finite `errPx`, `targetMissing: false`): the row
   exists in the DOM, but its position does not match where the scroll was asked to place it.
   Stock 3.3.7 shows this on `hit-two-phase` (118.1px median error) and dramatically on
   `hit-late-images` (1297.7px median error — over a full screen height in this 900px-tall
   viewport). The fork shows this same shape on `hit-prepend` (3381.7px median error) — the one
   case the fork does not fix.

These are different bugs from the harness's point of view: one is "nothing to measure," the other
is "measured and wrong by a specific, large amount." `hit-prepend` moved from the first category to
the second between stock and fork, rather than being resolved.

## Threshold decision

`PASS_THRESHOLD_PX` in `repro/probe.ts` is **unchanged at 2px**.

Evidence: across every passing scenario in both runs, median error is at most 0.8px (`page-up` on
the fork) and p95 error is at most 0.8px. Every other passing scenario — including the two
image-bearing ones, `hit-cold` and `hit-warm` — sits at 0.0-0.3px median and p95. There is no
image-heavy scenario showing a consistent error floor anywhere near 2px while still landing
visually correct; the passing population clusters at well under 1px, exactly the case the task
brief says to leave the threshold alone for. No changes were made to `repro/probe.ts`, so no
re-run was required to reconcile the tables with a changed threshold — the tables above are the
final, as-measured numbers.
