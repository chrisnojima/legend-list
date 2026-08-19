# API conformance audit: stock @legendapp/list 3.3.7

Date: 2026-08-18, revised across five review rounds (this is the final round). Stock commit
measured: the vendored `repro/vendor/legend-3.3.7-stock.mjs` build used throughout Tasks 1-8.
`src/` was never modified for any measurement in this document.

**This document supersedes its first four drafts.** Draft 1 concluded "no library gap remains"
from variant F alone (which conflated two changes) and mismeasured corrections. Draft 2
over-corrected into "the fork still has a job" without a fork measurement. Draft 3 added variant I
and fork measurements but the tracker effect behind I's guard was ungated, making several
comparisons cross-build. Draft 4 gated the effect and re-measured I, stating the guard-scenario
result honestly (27-30/30, not resolved) — but never ran the one comparison that actually decides
the deletion question (fork+I on the four originally-failing scenarios), mislabeled one of its two
"before gating" data points (one was the fork, not a second stock run), asserted "ruling out a
library cause" from a single 30/30 sample that a base-rate calculation shows discriminates nothing,
and left three rows of the guard-scenario table on a stale (ungated) build. **This final draft runs
the decisive fork comparison, corrects the mislabeled data, quantifies the two statistical claims
instead of asserting them, and reports a new result found while closing the remaining cross-build
gap: variant H — which never touches the disputed tracker effect — shows the identical guard-
scenario failure on the corrected build, which is evidence against, not for, that effect being the
sole cause.**

## The question this audit answers

> Against stock 3.3.7, with zero library changes, how many of the nine scenarios can be made to
> pass by using the library's public API correctly and completely?

`repro/BASELINE.md` measured stock 3.3.7 at 5/9 with the harness's original prop configuration
and the fork's hand-rolled `scrollTargetSettle` at 8/9 (comparing to stock under that same,
control-shaped configuration — see "Fork measurements" below for exactly what that comparison
covers and doesn't).

**Result: variant I (a guarded deletion of the app's redundant imperative `scrollToItem` call)
reaches 9/9 on the nine original scenarios, on pure stock 3.3.7, with zero library changes — and,
measured this round, the fork shows no different behavior from stock on any of the four scenarios
that motivated it, once the call site is correctly guarded.** Neither library passes a guard
scenario added in review round 2 to cover this variant's own blind spot with certainty. See "Final
classification" for the precise, bounded statement.

## Variant mechanism

`repro/variants.ts` defines `VariantFlags` and `resolveVariant(id)` for variants `A`-`I`. The
active variant is read once at module load from the page's URL (`?variant=`), defaulting to `A`.
`chat.tsx` takes a `variant` prop and derives every per-variant prop/orchestration change from
`resolveVariant`, gated behind the relevant flag so that a variant whose flag is off runs the same
code path control does (see the note on `hasRenderedNonEmptyRef`'s tracker effect below — a case
where this discipline was violated and then fixed). `app.tsx` exposes the active variant as
`window.__repro.variant()`. `repro/run.mjs`'s `--variant=` appends the variant to the page URL and
aborts loudly if the page reports back something other than what was requested. The variant is
recorded in every `--json` output. `--keep-log` captures the first run's full event trace for
every targeted scenario, pass or fail, without double-writing when the on-failure capture already
covers run 0.

**One important build note, added this round:** `chat.tsx` bundles the SAME `bundle.js` for every
variant — the variant is chosen at runtime via the URL, not by rebuilding. That means a
harness-level source change that isn't correctly gated behind its owning variant's flag silently
changes what *every other variant's* measurements are running against, even though those
variants' own `resolveVariant` output is unchanged. This is exactly what happened with variant I's
tracker effect (below) and is why it mattered enough to require re-measurement rather than just a
note.

## Variant definitions

All variants change only `repro/chat.tsx`/`repro/app.tsx`/`repro/scenarios.ts` prop and
orchestration usage. `src/` is untouched in every case.

- **A — control.** `onStartReachedThreshold={2}`, `maintainVisibleContentPosition={{data: true}}`, `initialScrollIndex={{index, viewPosition: 0.5}}`, `dataKey` set, `getItemType` set, jumps to an already-mounted list via `listRef.current.scrollToItem({animated: false, item, viewPosition: 0.5})` from an effect.
- **B — default start threshold.** `onStartReachedThreshold={0.5}`.
- **C — `shouldRestorePosition`.** Pins the centered target as the sole eligible data-change anchor while one is set.
- **D — chat example's shape.** Bare `maintainVisibleContentPosition={true}`, numeric `initialScrollIndex`, no `getItemType`, no `dataKey`.
- **E — no `dataKey`.** Only that, alone.
- **F — mount-path jumps (two variables).** Remounts the list carrying `initialScrollIndex` instead of calling `scrollToItem`; simultaneously removes the imperative call and forces a fresh-mount code path.
- **G — F + C combined.**
- **H — decisive control: delete the imperative call, nothing else.** No call, no remount, nothing else changed from A.
- **I — the guarded deletion.** Keeps the imperative `scrollToItem` call only when the list has already rendered real, non-empty content before this jump; deletes it (behaves like H) otherwise. **Discriminator, exactly:** `chat.tsx`'s `hasRenderedNonEmptyRef` — a ref that becomes `true` the first time an effect observes `ready && messages.length > 0`, held for the `<Chat>` mount's lifetime (not reset on `datasetKey` changes, since `openAtHit` bumps the dataset on every centered jump including `hit-warm`'s). The jump-decision effect is declared *before* the ref-tracking effect, so within any single commit the decision reads the ref's value from *before* that commit. **The tracker effect is gated behind `flags.guardedDeleteImperativeScroll`** (fixed this round — see below) so it is a no-op for every other variant.

### Correction made this round: the tracker effect was ungated

Through review round 3, `hasRenderedNonEmptyRef`'s tracking `useEffect` ran unconditionally —
`React.useEffect(() => { if (ready && messages.length > 0) { hasRenderedNonEmptyRef.current = true; } }, [messages, ready])`
with no `flags` check. Because every variant shares one bundle, this meant **A/F/H's
previously-committed nine-scenario results were measured on a build that predates this effect
entirely** (it was added when variant I was implemented), while I's own results were measured on
a build where it ran unconditionally for every variant including the ones whose numbers I was
being compared against. Every "I matches H" / "I matches control A" statement in round 3's draft
was comparing across two different builds — material specifically because the leading (still
unconfirmed) theory for I's `hit-then-end-anchor` regression is that this same extra passive
effect perturbs timing.

**Fix:** gated the effect body behind `flags.guardedDeleteImperativeScroll`, so it returns
before touching `ready`/`messages`/the ref for every variant except I. **Precisely, not
overclaimed (round 5 correction):** this makes the effect **behaviorally inert** for non-I
variants, not byte-identical to a build without the effect — the hook is still declared, and the
callback is still scheduled and fires on every `messages`/`ready` change; gating assumes that cost
is negligible for A-H's *decision logic*, which is true (their scroll decisions never read this
ref), but does not prove the effect's mere scheduled presence has zero timing cost. On that
reasoning, round 4 re-measured only I, not A-H's nine original scenarios — those are unaffected by
construction, since A-H's decision logic never reads the ref regardless of build. **A-H's
`hit-then-end-anchor` rows were a different matter and were NOT re-measured in round 4** — see "The
`hit-then-end-anchor` regression, bounded" below for why that gap mattered and what closing it
found. All nine of I's original-scenario numbers below are from the gated build.

## Per-variant tables (`--lib=stock --n=30`, all nine original scenarios)

A/B/C/D/E/F/G/H's tables are unchanged from the previous draft (their behavior is provably
unaffected by the gating fix — the tracker effect body never touched their execution before or
after). I's table below is from the gated build; every table is regenerated directly from the
committed `repro/results/<variant>-<scenario>.json` files.

### A — control
```
lib=stock  n=30  variant=A
scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     771ms       0
hit-cold              30/30   0        0.3px     0.3px     754ms       3
hit-warm              30/30   0        0.3px     0.3px     1026ms      3
hit-two-phase         0/30    0        118.1px   118.1px   834ms       9
hit-prepend           0/30    30       -         -         771ms       9
hit-late-images       0/30    0        1297.7px  1297.7px  829ms       3
send-at-end           30/30   0        0.0px     0.0px     771ms       0
page-up               0/30    30       -         -         774ms       8
resize-at-end         30/30   0        0.0px     0.0px     876ms       0
```
5/9. Reproduces `repro/BASELINE.md`'s stock table exactly on every oracle figure.

### B — default start threshold
```
lib=stock  n=30  variant=B
scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     772ms       0
hit-cold              30/30   0        0.3px     0.3px     761ms       3
hit-warm              30/30   0        0.3px     0.3px     1029ms      3
hit-two-phase         0/30    0        118.1px   118.1px   837ms       9
hit-prepend           0/30    30       -         -         768ms       9
hit-late-images       0/30    0        1297.7px  1297.7px  829ms       3
send-at-end           30/30   0        0.0px     0.0px     771ms       0
page-up               0/30    30       -         -         778ms       8
resize-at-end         30/30   0        0.0px     0.0px     874ms       0
```
5/9, identical to A.

### C — `shouldRestorePosition`
```
lib=stock  n=30  variant=C
scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     772ms       0
hit-cold              30/30   0        0.3px     0.3px     760ms       3
hit-warm              30/30   0        0.3px     0.3px     1033ms      3
hit-two-phase         0/30    0        118.1px   118.1px   838ms       9
hit-prepend           0/30    30       -         -         831ms       3
hit-late-images       0/30    0        1297.7px  1297.7px  828ms       3
send-at-end           30/30   0        0.0px     0.0px     772ms       0
page-up               0/30    30       -         -         1094ms      4
resize-at-end         30/30   0        0.0px     0.0px     981ms       0
```
5/9. `shouldRestorePosition` confirmed consulted (committed evidence:
`repro/results/{hit-two-phase,hit-prepend,page-up}-variant-C-first-failure.json`). In
`hit-prepend`/`page-up` the target row is never offered to the predicate at all (24/24 calls
`false`) — it removes every anchor rather than pinning the target. Untried and left open: a
predicate returning `true` for the target when offered, permissive `true` fallback otherwise.

### D — chat example's shape
```
lib=stock  n=30  variant=D
scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     772ms       0
hit-cold              30/30   0        0.3px     0.3px     757ms       3
hit-warm              10/30   0        1938.6px  1938.6px  1029ms      1
hit-two-phase         0/30    0        118.3px   118.3px   836ms       9
hit-prepend           0/30    30       -         -         770ms       11
hit-late-images       0/30    0        1297.7px  1297.7px  828ms       3
send-at-end           30/30   0        0.0px     0.0px     776ms       0
page-up               0/30    30       -         -         777ms       8
resize-at-end         30/30   0        0.0px     0.0px     983ms       0
```
4/9. `hit-warm` regresses to 10/30, but numeric `initialScrollIndex` drops `viewPosition: 0.5`
while the assertion always grades against 0.5 and `hit-warm`'s jump is still imperative under D —
this is at least partly an artifact of that mismatch, not purely evidence against dropping
`getItemType`/`dataKey`. D is not used as evidence for the recommendation section; E is used for
`dataKey` specifically.

### E — no `dataKey`
```
lib=stock  n=30  variant=E
scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     774ms       0
hit-cold              30/30   0        0.3px     0.3px     768ms       3
hit-warm              30/30   0        0.3px     0.3px     1029ms      3
hit-two-phase         0/30    0        118.1px   118.1px   841ms       9
hit-prepend           0/30    30       -         -         770ms       9
hit-late-images       0/30    0        1297.7px  1297.7px  829ms       3
send-at-end           30/30   0        0.0px     0.0px     773ms       0
page-up               0/30    30       -         -         777ms       8
resize-at-end         30/30   0        0.0px     0.0px     788ms       0
```
5/9, identical to A; `hit-warm` stays 30/30, isolating D's regression away from `dataKey` alone.

### F — mount-path jumps
```
lib=stock  n=30  variant=F
scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     771ms       0
hit-cold              30/30   0        0.4px     0.4px     765ms       2
hit-warm              30/30   0        0.4px     0.4px     1038ms      2
hit-two-phase         30/30   0        0.3px     0.3px     832ms       8
hit-prepend           30/30   0        0.2px     0.2px     780ms       6
hit-late-images       30/30   0        0.4px     0.4px     829ms       2
send-at-end           30/30   0        0.0px     0.0px     771ms       0
page-up               30/30   0        0.2px     0.2px     777ms       5
resize-at-end         30/30   0        0.0px     0.0px     873ms       0
```
9/9. Corrections are real (armed on `scroll.remount` after the `probe.ts` fix). Committed traces:
`repro/results/{hit-two-phase,hit-prepend,hit-late-images,page-up}-variant-F-trace.json`.

### G — F + C combined
```
lib=stock  n=30  variant=G
scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     772ms       0
hit-cold              30/30   0        0.4px     0.4px     758ms       2
hit-warm              30/30   0        0.4px     0.4px     1031ms      2
hit-two-phase         30/30   0        0.3px     0.3px     835ms       8
hit-prepend           30/30   0        0.2px     0.2px     782ms       6
hit-late-images       30/30   0        0.4px     0.4px     829ms       2
send-at-end           30/30   0        0.0px     0.0px     774ms       0
page-up               30/30   0        0.2px     0.2px     778ms       5
resize-at-end         30/30   0        0.0px     0.0px     982ms       0
```
9/9, indistinguishable from F alone. Committed traces:
`repro/results/{hit-two-phase,hit-prepend,hit-late-images,page-up}-variant-G-trace.json`.

### H — decisive control: delete the imperative call, nothing else
```
lib=stock  n=30  variant=H
scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     771ms       0
hit-cold              30/30   0        0.4px     0.4px     764ms       2
hit-warm              1/30    29       0.2px     0.2px     1026ms      1
hit-two-phase         30/30   0        0.3px     0.3px     832ms       8
hit-prepend           30/30   0        0.7px     0.7px     773ms       6
hit-late-images       30/30   0        0.4px     0.4px     829ms       2
send-at-end           30/30   0        0.0px     0.0px     772ms       0
page-up               30/30   0        0.7px     0.7px     774ms       5
resize-at-end         30/30   0        0.0px     0.0px     985ms       0
```
8/9. Fixes the four original failures cleanly but regresses `hit-warm` to 1/30. Corrections here
(and I's, below) arm on `scroll.expected`, which requests nothing — a related but not identical
quantity to F's/A's request- or remount-armed corrections.

### I — the guarded deletion (gated build)
```
lib=stock  n=30  variant=I  (gated build — see the correction note above)
scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     774ms       0
hit-cold              30/30   0        0.4px     0.4px     757ms       2
hit-warm              30/30   0        0.3px     0.3px     1029ms      3
hit-two-phase         30/30   0        0.3px     0.3px     834ms       8
hit-prepend           30/30   0        0.7px     0.7px     772ms       6
hit-late-images       30/30   0        0.4px     0.4px     829ms       2
send-at-end           30/30   0        0.0px     0.0px     772ms       0
page-up               30/30   0        0.7px     0.7px     773ms       5
resize-at-end         30/30   0        0.0px     0.0px     975ms       0
```
**9/9 on the nine original scenarios**, unchanged from the ungated measurement (as expected — the
gate makes the effect behaviorally inert for every variant except I (see the correction
note above), and I's own flag was already `true`). All four
original failures close; `hit-warm` holds at parity with control A (30/30, corrections 3 = A's 3
exactly).

**Committed traces confirm the guard's routing directly, not just by matching numbers:**
`repro/results/hit-warm-variant-I-trace.json` — one `scroll.request {guarded:"live"}` event.
`repro/results/hit-two-phase-variant-I-trace.json` — one `scroll.expected {guarded:"fresh"}`
event. These are exactly the two routing outcomes the discriminator is supposed to produce.

## Fork measurements — the decisive comparison, run this round

Draft 4 asserted things about the fork resting on 2 of 10 scenarios and never ran the comparison
that actually decides the deletion question. **This round ran it: fork + variant I on the four
scenarios Task 8 showed the fork differing from stock on.**

```
fork, variant I, hit-two-phase:    30/30  0.3px  8 corrections
fork, variant I, hit-prepend:      30/30  0.7px  6 corrections
fork, variant I, hit-late-images:  30/30  0.4px  2 corrections
fork, variant I, page-up:          30/30  0.7px  5 corrections
```

**Every figure — pass count, med err, p95 err, corrections — is identical to stock+I on all four
scenarios.** Under a correctly guarded call site, the fork provably adds nothing on the four
scenarios it was built to fix. This is the sentence the previous draft tried to earn without the
measurement; it is earned now.

**Full fork inventory, stated exactly (7 runs across 6 distinct scenarios — corrected from the
previous draft's "3 of 10," which undercounted both the run and scenario totals even before this
round's new runs):**

```
fork, variant A, hit-then-end-anchor: 30/30 (0.0px)
fork, variant I, hit-warm:            30/30 (0.3px)
fork, variant I, hit-then-end-anchor: 30/30 (0.0px)   [gated build]
fork, variant I, hit-two-phase:       30/30 (0.3px)   [this round]
fork, variant I, hit-prepend:         30/30 (0.7px)   [this round]
fork, variant I, hit-late-images:     30/30 (0.4px)   [this round]
fork, variant I, page-up:             30/30 (0.7px)   [this round]
```

Separately, **Task 8's original fork measurement** (`repro/BASELINE.md`'s fork table,
`repro/results/fork.json`) ran the fork under the app's unmodified orchestration
(variant-A-shaped, predating the variant harness) across all nine scenarios: 8/9, differing from
stock+A on `hit-two-phase`, `hit-late-images`, `page-up` (stock fails, fork passes) and
`hit-prepend` (both fail, differently).

**What the full set does and does not establish:** fork+I now matches stock+I on 6 of the 9
original scenarios, including all four scenarios where Task 8 showed a fork/stock difference
existed under variant A. It has not been run on `open-newest`, `hit-cold`, `send-at-end`, or
`resize-at-end` under I — those are guard/passing scenarios with no prior evidence of a
fork/stock difference under any configuration, so this is a lower-priority gap than the four just
closed, but it is a real, named gap rather than an implied "everywhere."

## The `hit-then-end-anchor` result — corrected numbers, quantified uncertainty, and a new finding

Review round 2's guard scenario originally showed 0/30 in every variant, traced to a scenario bug
(missing `bumpDataset()` on the window swap, unlike `openAtHit`), fixed in `repro/scenarios.ts`.

### Corrected "before gating" comparison (round 5 fix)

The previous draft stated "two n=30 runs, both stock: 27/30, 28/30 (55/60, 8.3%)." **This was
wrong — one of those two runs was the fork, not a second stock run.** Recovered from git history
and recommitted under distinct names
(`repro/results/I-hit-then-end-anchor-ungated.json`,
`repro/results/fork-I-hit-then-end-anchor-ungated.json`) so both sides of the comparison exist at
HEAD, not only in git history:

```
ungated build, stock, variant I:  27/30  (3/30 fail = 10.0%)
ungated build, fork,  variant I:  28/30  (2/30 fail = 6.7%)   [a separate data point, not a second stock run]
gated build,   stock, variant I:  29/30, 30/30, 30/30 across three separate n=30 runs (89/90 fail = 1.1%)
gated build,   fork,  variant I:  30/30  (0/30 fail)
```

**Quantified, not asserted (round 5 fix):** a two-tailed Fisher exact test on ungated-stock (3
fails/30) vs. gated-stock (1 fail/90) gives **p ≈ 0.048** (computed via
`scipy.stats.fisher_exact([[3,27],[1,89]], alternative="two-sided")`, cross-checked by hand-summing
the hypergeometric distribution: 0.0478). Borderline significance, for a comparison this document
correctly says has no established mechanism — a reader should not read the raw percentages
(10.0% -> 1.1%) as a large, reliable drop; the statistical margin is thin.

**The "ruling out a library-specific cause" claim from the previous draft is softened here.** It
rested on the single gated-build fork run being 30/30. At a 1.1% underlying rate,
`P(0 failures in 30 draws) ≈ (1 - 0.0111)^30 ≈ 0.72` — a clean 30/30 is the *expected* outcome even
if the fork's true failure rate matched stock's exactly, so that single run discriminates nothing.
**Corrected statement: the failure has not been observed to differ between stock and fork on the
runs taken, but the evidence is too thin to rule anything out** — not "ruling out a
library-specific cause," present tense, as previously stated.

### New finding from closing the A/F/H cross-build gap (round 5)

A/F/H's `hit-then-end-anchor` rows were last measured at `63d76e9d` — which postdates the commit
that introduced the ungated tracker effect (`ef48b294`), so those rows were on the *ungated*
build, while I's rows (from round 4 onward) were on the *gated* build. This was the one comparison
where a timing-perturbation mechanism was the nominated explanation, and it was still cross-build.
Re-measured all three rows on the current (gated) build:

```
gated build, stock, variant A: 30/30 (0.0px)
gated build, stock, variant F: 30/30 (0.0px)
gated build, stock, variant H: 28/30 (0.0px med, 196.0px p95) — was 30/30 on the ungated build
```

**H's result changed, and this is the most important new finding of this round.** H's own
decision logic never reads `hasRenderedNonEmptyRef` — H is `flags.deleteImperativeScroll`, a
different flag from I's `flags.guardedDeleteImperativeScroll`, and the tracker effect's body only
ever executes when the latter is true. Gating could not have changed anything about what code
runs during an H measurement; the tracker effect was already irrelevant to H's own scroll decision
on both builds. **Yet H flipped from clean (30/30, ungated) to showing the identical failure
signature (`errPx: 196`, `fullyVisible: true`) on the gated build.** This is evidence *against*
the tracker effect being a sufficient explanation for the failure pattern previously attributed to
it under variant I — a build change that provably does not touch H's code path correlates with H
acquiring the same failure.

**Full run inventory for this scenario, both builds, all four variants tested:**

```
variant   ungated             gated                              total
A         30/30 (63d76e9d)    30/30 (this round)                 60/60 clean
F         30/30 (63d76e9d)    30/30 (this round)                 60/60 clean
H         30/30 (63d76e9d)    28/30 (this round)                 58/60
I         27/30 (recovered)   29/30, 30/30, 30/30 (three runs)   116/120
```

**The pattern, stated as an observation, not a confirmed mechanism:** A and F — which always issue
an explicit scroll action for the initial jump (an imperative call, or a remount) — are clean
across every measurement taken. H and I — which both skip the imperative call under some or all
conditions, relying on the library's freshData bootstrap alone for the initial jump — show this
failure at a combined rate of 6/180 (3.3%) across both builds. This correlates with "skips the
explicit call" rather than with "the tracker effect specifically," since H never executes that
effect's real body. **This audit does not have the evidence to confirm this as the mechanism** —
confirming it would need more A/F samples (to raise confidence they are genuinely near 0% and not
merely lucky at n=60 each) and instrumentation of what differs internally when the call is
skipped, neither of which is in this round's bounded scope.

**Is variant I safe to ship, given shipping it means adding this tracker effect to the app?** Not
established either way. What round 5 adds is that the tracker effect specifically is now less
likely to be the explanation, since H shows the same failure without ever executing it — the
open question has shifted from "does this one effect perturb timing" to "why do H and I both show
a low-rate failure that A and F don't," which this audit has not answered. **What would settle
this:** more n=30 samples of A and F (confirm they hold near 0%), and repeated measurements of H
specifically on both its ungated and gated build states (H's own logic is identical on both, so
any variance there isolates a build-level effect from the "skips the call" hypothesis). Neither
was run this round — named here as the honest next step, not assumed.

## Summary table: scenario x variant (pass/fail)

```
scenario              A     B     C     D     E     F     G     H     I
open-newest           PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS
hit-cold              PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS
hit-warm              PASS  PASS  PASS  FAIL  PASS  PASS  PASS  FAIL  PASS
hit-two-phase         FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS  PASS  PASS
hit-prepend           FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS  PASS  PASS
hit-late-images       FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS  PASS  PASS
send-at-end           PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS
page-up               FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS  PASS  PASS
resize-at-end         PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS

totals                5/9   5/9   5/9   4/9   5/9   9/9   9/9   8/9   9/9

hit-then-end-anchor (post-bumpDataset-fix, all on the current gated build unless noted):
  stock A: 30/30 clean (60/60 across ungated+gated)   stock F: 30/30 clean (60/60 across ungated+gated)
  stock H: 28/30 (58/60 across ungated+gated — was 30/30 before this round's re-measurement)
  stock I: 29/30, 30/30, 30/30 across three n=30 runs (116/120 across ungated+gated, 1.1% gated-only)
  fork  A: 30/30   fork  I: 30/30 (gated); 28/30 on the superseded ungated build

fork + variant I, the four originally-failing scenarios (new this round — the decisive comparison):
  hit-two-phase 30/30, hit-prepend 30/30, hit-late-images 30/30, page-up 30/30 —
  every figure identical to stock+I.
```

## Final classification

**Accurate headline: I is 9/9 on the nine original scenarios — on both stock and, for the four
scenarios that most needed checking, fork — with a small, real, statistically-borderline
(p ≈ 0.048 vs. the superseded ungated build), mechanistically unconfirmed failure rate (~3.3%
combined across builds) on the guard scenario added specifically to cover this variant's blind
spot, a failure rate now also observed under variant H.** Not bare "9/9" — the guard exists
because the original nine don't test the shape where `centeredId` transitions back to `undefined`
after a jump, and neither H nor I passes it with certainty.

- **`hit-two-phase`, `hit-prepend`, `hit-late-images`, `page-up`:** API misuse. Deleting the
  redundant imperative call for the fresh-list shape (I, matching H) fixes all four **on both
  stock and fork**, with every figure (pass count, med/p95 err, corrections) identical between the
  two libraries. This is the most fully-evidenced part of this audit's conclusion — see "Fork
  measurements" above for the run that established it this round.
- **`hit-warm`:** not a library gap on the evidence gathered. Passes 30/30 under control A, under
  I, and under fork+I. Only an *unconditional* deletion (H) breaks it — no one is proposing to
  ship that.
- **`hit-then-end-anchor`:** its original 0/30 was a scenario bug, fixed. On the current (gated)
  build, A and F are clean (60/60 each across both builds); H and I both show the same
  `errPx: 196` failure at a combined rate of 6/180 (3.3%) — including H, whose own decision logic
  never executes the code round 4 blamed for I's version of this failure. It is **not** classified
  as a library gap (present at a comparable rate on both stock and fork) and **not** classified as
  resolved or as caused by any single identified mechanism. See "what would settle this" in the
  section above.

**The fork diff's redundancy claim, corrected and now measured directly (round 5 fix):** the
previous draft asserted deletion-candidate status for "the four scenarios where fork+A and
stock+A(guarded) were actually compared" — that comparison never existed (`stock+A(guarded)` is
not a real configuration; A is unguarded by definition), and the sentence's own next clause
admitted those four were never retested. **That gap is closed this round:** fork+I now matches
stock+I exactly on all four originally-failing scenarios (see "Fork measurements" above) — this is
the real basis for calling that slice of the fork's value redundant under a guarded call site, not
an inferred or assumed one. It does not extend to `open-newest`/`hit-cold`/`send-at-end`/
`resize-at-end` under I (never tested), and it says nothing about the `hit-then-end-anchor`
failure pattern, which is present on both libraries at a comparable rate and has no confirmed
cause on either.

**App portability of the guard is unvalidated — do not read this audit as having built or proven
the discriminator for the real app.** Two preconditions the app-side implementation must satisfy,
named explicitly rather than left implicit in "a boolean the thread screen sets":

1. **The tracker must be declared *after* the jump-decision effect in the same component,** so the
   decision reads the ref's value from before the current commit, not the current commit's own
   arriving content. A tracker declared earlier, a store-level flag set during a render phase, or
   any implementation that makes the "has rendered" signal available *within the same commit* as
   the content that produces it, breaks the discriminator: it would read `true` at
   `hit-two-phase`'s decision commit (that commit is itself the first arrival of real, non-empty
   content) and keep the imperative call for exactly the shape that needs it deleted.
2. **Messages and the centered target must arrive in the same commit.** This harness's `openAtHit`
   batches `setMessages(...)` and `setCentered(...)` together; the app's real data sources are
   `useConversationCenter()` and `useThreadListData()` — two different stores. If real messages
   land one commit *before* `centeredOrdinal` is set (a plausible sequencing given they're
   separate stores), the ref flips to `true` on that earlier commit, and the guard keeps the
   imperative call on the fresh-list shape it's supposed to delete it for.

Neither precondition was checked against the app's actual store/effect structure — that
investigation is out of scope for this task. The conclusion is: **the guarded-deletion mechanism
is validated in this harness and is a promising candidate, but the fork diff should be treated as
a deletion candidate pending app-side validation of the guard, not as a settled deletion.**

## Variants that could not be expressed through the public API

None. All nine variants (A-I) were fully expressible as prop and orchestration changes in
`repro/chat.tsx`/`repro/app.tsx`/`repro/scenarios.ts`; `src/` was never touched.

## Caveats on a remount-based approach (F/G), if I's guard cannot be ported safely

A full LegendList remount discards the previous DOM and recycled containers; every row re-renders
from scratch. In the real Keybase app, a keyed remount at either call site would discard
`HighlightableRow`'s local state (`settledFor`/`hoveredFor`) and restart the highlight animation —
a specific, concrete cost.

## Recommended changes to the Keybase app's list configuration

The app currently passes `onStartReachedThreshold={2}`, `maintainVisibleContentPosition={{data:
true}}`, `maintainScrollAtEnd={centered ? false : true}`, `dataKey`, `alignItemsAtEnd`,
`initialScrollAtEnd`/`initialScrollIndex`, and issues `scrollToItem({animated:false,
viewPosition:0.5})` from an effect.

- **Primary candidate, pending app-side validation: the guarded deletion (variant I).** Keep the
  imperative `scrollToItem` call only when the currently-open thread view has already rendered
  real message content before this jump; skip it otherwise. Validate the two preconditions above
  against the app's actual `useConversationCenter()`/`useThreadListData()` sequencing before
  relying on this — this audit did not check them. Also unresolved before shipping: the
  `hit-then-end-anchor` regression's cause, at whatever rate it turns out to occur at in the real
  app's effect timing.
- **No change: `onStartReachedThreshold`, `maintainVisibleContentPosition={{data: true}}`,
  `dataKey`, `getItemType`, object-form `initialScrollIndex`, `alignItemsAtEnd`,
  `maintainScrollAtEnd` conditional.** No variant isolated any of these as a cause of the four
  failures (see B, C, E, D's sections above for the specific caveats on each).
- **Fallback only if the guarded deletion cannot be validated for the app:** F's remount,
  uniformly. Measured 9/9 on the original nine (no guard-scenario regression observed under F),
  but pays a real cost (state loss, animation restart) on every jump.

## Consequence for the fork

**Earned this round:** on the four scenarios Task 8 showed the fork differing from stock
(`hit-two-phase`, `hit-prepend`, `hit-late-images`, `page-up`), a correctly guarded stock call
site (variant I) matches the fork exactly — every pass count, every med/p95 err, every corrections
figure. This is measured evidence that the fork's value on those four scenarios is redundant once
the call site is fixed, not asserted or inferred evidence. The same holds for `hit-warm`.

**Not earned:** whether this extends to the fork's behavior on the four scenarios that were never
tested under I (`open-newest`, `hit-cold`, `send-at-end`, `resize-at-end` — lower priority, no
prior evidence of a difference there, but untested is untested); and whether the
`hit-then-end-anchor` failure pattern — present on both libraries, at a comparable rate, on
variants (H and I) that share "skip the imperative call" rather than on the tracker effect
specifically — has any bearing on what the fork should or shouldn't do.

Task 9 should treat two things as separately settled: (1) the four-scenario slice of
`scrollTargetSettle` that Task 8 measured is redundant under a guarded call site — this round's
fork+I measurement establishes that directly; (2) "the entire fork diff can be deleted" is not yet
settled — it rests on app-side validation of the guard's two preconditions (named in "Final
classification" above) and on understanding the `hit-then-end-anchor` failure shared by H and I,
neither of which this audit resolved. Five rounds of review found real problems in every draft
through round 4; this round found no problems in its predecessor's methodology, only in scope
(the decisive fork run was missing) and in overreach (two claims stated with more certainty than
the evidence supported). Both are fixed here. What remains open is named, not glossed.
