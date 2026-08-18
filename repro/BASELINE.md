# Baseline: stock @legendapp/list 3.3.7 vs. this fork

Date: 2026-08-18
Fork commit measured: `c57aa1faa4c9f96c0835f80ca3f0f8925c89f87a`

Both runs used `bun repro/run.mjs --n=30` in system Chrome (Playwright, `channel: "chrome"`, headless).

## Methodology note

The stock run (`--lib=stock`) executed as a single `--n=30` sweep across all nine scenarios in
one page load, exactly as `run.mjs` runs it end to end, and wrote `repro/results/stock.json`
directly.

The fork run (`--lib=fork`) was executed as nine separate `--only=<scenario>` invocations of
`--n=30`, one scenario per foreground command, because a full nine-scenario `--n=30` sweep (270
scenario executions) exceeded the foreground command time budget available while producing this
document. Each fork scenario's 30 runs therefore happened in its own page load, not in one
continuous sweep the way the stock run did. The nine per-scenario result files were merged into
`repro/results/fork.json` with a throwaway script (not committed) that concatenates the `results`
arrays and recomputes the summary `rows` using the same median/percentile/pass logic as
`run.mjs`, so the merged table below is produced by the same arithmetic the tool itself uses. No
verdict objects were altered — `targetMissing` and `resetTimedOut` are preserved exactly as
recorded by the probe.

Neither run reported any `resetTimedOut` runs (0 across all scenarios, both libs), so no result
here is flagged as possibly contaminated by incomplete reset between runs.

## Stock 3.3.7 (`--lib=stock --n=30`, single sweep)

```
lib=stock  n=30

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     779ms       0
hit-cold          30/30   0        0.3px     0.3px     765ms       3
hit-warm          30/30   0        0.3px     0.3px     1027ms      3
hit-two-phase     0/30    0        118.1px   118.1px   838ms       9
hit-prepend       0/30    30       -         -         768ms       9
hit-late-images   0/30    0        1297.7px  1297.7px  829ms       3
send-at-end       30/30   0        0.0px     0.0px     771ms       0
page-up           0/30    30       -         -         775ms       8
resize-at-end     30/30   0        0.0px     0.0px     975ms       0
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
   what stock 3.3.7 does on `hit-prepend` and `page-up` — the scroll lands far enough away
   (`hit-prepend` involves a prepend that shifts content by roughly 4000px) that the target row is
   outside the range LegendList has drawn, so there is no element to measure an offset against.
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
