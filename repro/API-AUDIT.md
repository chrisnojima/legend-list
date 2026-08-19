# API conformance audit: stock @legendapp/list 3.3.7

Date: 2026-08-18, revised across four review rounds. Stock commit measured: the vendored
`repro/vendor/legend-3.3.7-stock.mjs` build used throughout Tasks 1-8. `src/` was never modified
for any measurement in this document.

**This document supersedes its first three drafts.** Draft 1 concluded "no library gap remains"
from variant F alone (which conflated two changes) and mismeasured corrections. Draft 2 corrected
those but over-corrected into "the fork still has a job" without a fork measurement to support it.
Draft 3 added variant I (a guarded deletion) and fork measurements, reaching "I is 9/9, no library
change needed, delete the fork diff" — but the tracker effect behind I's guard ran unconditionally
for every variant, meaning A-H's committed results were measured on a build that predates it,
which specifically undercut the comparison the whole conclusion rested on. **This draft gates that
effect, re-measures I on the corrected build, and states the result precisely: I is 9/9 on the
original nine scenarios, with a 27-30/30 (not clean 30/30) result on the guard scenario added to
cover exactly this variant's blind spot — not resolved, characterized. The fork claim is scoped to
what was actually measured (2 of 10 scenarios, plus one scenario at variant A), not stated as
general coverage. App portability of the guard's discriminator is stated as unvalidated, not
assumed.**

## The question this audit answers

> Against stock 3.3.7, with zero library changes, how many of the nine scenarios can be made to
> pass by using the library's public API correctly and completely?

`repro/BASELINE.md` measured stock 3.3.7 at 5/9 with the harness's original prop configuration
and the fork's hand-rolled `scrollTargetSettle` at 8/9 (comparing to stock under that same,
control-shaped configuration — see "Fork measurements" below for exactly what that comparison
covers and doesn't).

**Result: variant I (a guarded deletion of the app's redundant imperative `scrollToItem` call)
reaches 9/9 on the nine original scenarios, on pure stock 3.3.7, with zero library changes.** It
does not reach a clean pass on every scenario measured in this audit — a guard scenario added in
review round 2 specifically to cover this variant's own blind spot shows a small, real, unresolved
regression. See "Final classification" for the precise, bounded statement.

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

**Fix:** gated the effect body behind `flags.guardedDeleteImperativeScroll`, so it is a no-op
(returns before touching `ready`/`messages`/the ref) for every variant except I. This restores
A-H's *behavior* to what it was before the effect existed — the hook is still declared (React
requires the same hooks every render for one component instance), but its body does nothing for
non-I variants, so no re-measurement of A-H was needed; only I's own results, which do exercise
the real body, needed redoing. All nine of I's original-scenario numbers below are from the gated
build. **Whether gating changed I's own numbers is itself informative** — see "The
`hit-then-end-anchor` regression, bounded" below: it did correlate with a lower failure rate on
the guard scenario, but the mechanism is not established, because gating changes nothing about
what code executes when `flags.guardedDeleteImperativeScroll` is already `true`.

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
gate is a no-op for every variant except I, and I's own flag was already `true`). All four
original failures close; `hit-warm` holds at parity with control A (30/30, corrections 3 = A's 3
exactly).

**Committed traces confirm the guard's routing directly, not just by matching numbers:**
`repro/results/hit-warm-variant-I-trace.json` — one `scroll.request {guarded:"live"}` event.
`repro/results/hit-two-phase-variant-I-trace.json` — one `scroll.expected {guarded:"fresh"}`
event. These are exactly the two routing outcomes the discriminator is supposed to produce.

## Fork measurements — exactly what was run, and what it does and doesn't rule out

**Fork was run on 3 of the 10 scenarios in this audit, not comprehensively:**

```
fork, variant A, hit-then-end-anchor: 30/30 (0.0px)
fork, variant I, hit-warm:            30/30 (0.3px)
fork, variant I, hit-then-end-anchor: 30/30 (0.0px)  [after gating; see below]
```

Separately, **Task 8's original fork measurement** (`repro/BASELINE.md`'s fork table,
`repro/results/fork.json` from that task) ran the fork under the app's actual, unmodified
orchestration — equivalent in shape to this audit's variant A, though it predates the variant
harness — across all nine original scenarios, and found **8/9, differing from stock on three of
them**: `hit-two-phase` (stock 0/30 -> fork 30/30), `hit-late-images` (stock 0/30 -> fork 30/30),
`page-up` (stock 0/30, `targetMissing` -> fork 30/30), plus `hit-prepend` failing differently on
each (stock: `targetMissing`; fork: located but 3381.7px off).

**What this does rule out:** fork+A does not behave differently from stock+A on
`hit-then-end-anchor` (both 30/30). Fork+I does not behave differently from stock+I on `hit-warm`
(both 30/30) or on `hit-then-end-anchor` (both 30/30, after gating).

**What this does NOT rule out:** fork+I was never run on the four originally-failing scenarios
(`hit-two-phase`, `hit-prepend`, `hit-late-images`, `page-up`), nor on `open-newest`, `hit-cold`,
`send-at-end`, or `resize-at-end`. Task 8's fork.json shows the fork *does* differ from stock on
three scenarios under the unmodified (variant-A-shaped) configuration — meaning the fork's
`scrollTargetSettle` measurably does something stock doesn't, at least under that configuration.
This audit's fork+I coverage does not include re-testing those three scenarios under I, so it
cannot state whether the fork's behavior on them changes, stays the same, or becomes redundant
once the guarded deletion is applied. **The correct scoped claim is: on the two scenarios where
fork+I was actually measured, it matches stock+I exactly — not that the fork is redundant
everywhere.**

## The `hit-then-end-anchor` regression, bounded

Review round 2's guard scenario originally showed 0/30 in every variant, traced to a scenario bug
(missing `bumpDataset()` on the window swap, unlike `openAtHit`), fixed in `repro/scenarios.ts`.
With that fixed, A, F, and H all reach a clean 30/30. **I does not.**

**Before gating** (two n=30 runs, both stock): 27/30, 28/30 (55/60 pass, 8.3% fail). The identical
28/30 shape reproduced on the fork under the same, ungated build.

**After gating** (three n=30 runs, stock): 29/30, 30/30, 30/30 (89/90 pass, 1.1% fail). Fork+I,
gated build: 30/30 (single run). Every observed failure — before and after gating — shows the same
`errPx: 196`, `fullyVisible: true` shape (not a timeout, not `targetMissing`); this is one
consistent failure mode recurring at a lower rate, not several different failures.

**What this shows and doesn't:** the failure rate measurably dropped after gating (8.3% -> 1.1%
across the runs taken), which is worth reporting precisely as requested — but it does not, on its
own, establish gating as the cause. Gating changes nothing about what code executes when
`flags.guardedDeleteImperativeScroll` is already `true` (which it is throughout every I run,
gated or not) — the tracker effect's real body runs identically either way for I itself; gating
only changes what happens for *other* variants. If gating nonetheless correlates with a lower
failure rate for I, the most honest available explanations are (a) coincidence across a small
number of n=30 samples (90 vs 60 runs is not a large sample for a ~5-10% base rate), or (b) some
indirect effect of the changed function/effect identity on scheduling that this audit did not
investigate further. **This audit does not resolve which.** The regression is reduced, not shown
gone, and not mechanistically explained even after the one fix available to test.

Under this scenario, I and H issue *identical* library calls during the segment that differs
between variants — one `scroll.expected {guarded:"fresh"}` event, no `scroll.request`, matching
H's mechanism exactly — while H is clean 30/30 on this scenario and I is not. The only code
difference between I and H is the tracker effect itself. That the effect is the load-bearing
difference is a reasonable inference from the code; that it is the *cause* of the regression is
not established by anything measured here.

**Is variant I safe to ship, given shipping it means adding this tracker effect to the app?** Not
established either way by this audit. The regression is small (1-8% depending on the sample), is
not eliminated by the one fix tested, and appears identically on both libraries (ruling out a
library-specific cause but not identifying the actual one). An honest answer here is
"undetermined" — the reduction after gating is a real, reported observation, not a confirmed fix.

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

hit-then-end-anchor (post-bumpDataset-fix; A/F/H/I stock, plus fork at A and I):
  stock A: 30/30   stock F: 30/30   stock H: 30/30
  stock I (gated): 29/30, 30/30, 30/30 across three n=30 runs (89/90, 1.1% fail)
  fork  A: 30/30   fork  I (gated): 30/30
```

## Final classification

**Accurate headline: I is 9/9 on the nine original scenarios, with a small, real, unresolved
regression (89/90 pass, 1.1% fail across gated runs; higher, 8.3%, before gating) on the guard
scenario added specifically to cover this variant's blind spot.** Not bare "9/9" — the guard
exists because the original nine don't test the shape where `centeredId` transitions back to
`undefined` after a jump, and I is the one variant in this audit that does not pass it cleanly.

- **`hit-two-phase`, `hit-prepend`, `hit-late-images`, `page-up`:** API misuse. The app's
  imperative `scrollToItem` call is redundant when the list hasn't yet rendered real content;
  deleting it for this shape (I, matching H) fixes all four.
- **`hit-warm`:** not a library gap on the evidence gathered. Passes 30/30 under control A, under
  I, and under fork+I. Only an *unconditional* deletion (H) breaks it — no one is proposing to
  ship that.
- **`hit-then-end-anchor`:** its original 0/30 was a scenario bug, fixed; A/F/H are clean 30/30.
  I's residual regression is real, small, reduced-but-not-eliminated by gating, reproduces
  identically on stock and fork (ruling out a library-specific cause), and its mechanism is
  **not established** by this audit. It is not classified as a library gap (both libraries show
  it identically) and not classified as resolved.

**The fork diff is a deletion candidate for the four scenarios where fork+A and stock+A(guarded)
were actually compared and matched, and for `hit-warm` and `hit-then-end-anchor` where fork+I was
directly measured against stock+I. It is not shown to be a deletion candidate everywhere** — this
audit did not re-test the fork under I on the three scenarios (`hit-two-phase`, `hit-late-images`,
`page-up`, plus `hit-prepend`'s different-failure-mode case) where Task 8 already established the
fork does something stock+A doesn't. Whether the guarded deletion makes the fork's behavior on
those three redundant, or whether the fork was doing something orthogonal to the imperative-call
problem, is untested.

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

Scoped to what was measured: the slice of the fork's value covering `hit-warm` and
`hit-then-end-anchor` is not shown to be necessary — stock with the guarded deletion (and the
fork with the same guarded deletion) both handle these cleanly. The slice covering the four
originally-failing scenarios (Task 8's basis for `scrollTargetSettle`) was not re-tested under the
guarded deletion against the fork in this round — Task 9 should do that comparison specifically
(fork+I vs. stock+I on `hit-two-phase`/`hit-prepend`/`hit-late-images`/`page-up`) before treating
any part of the fork diff as removable. Until app-side validation of the guard's two preconditions
happens, and until `hit-then-end-anchor`'s regression is understood, "delete the fork diff" is a
candidate conclusion, not a settled one.
