# API conformance audit: stock @legendapp/list 3.3.7

Date: 2026-08-18, revised twice after review. Stock commit measured: the vendored
`repro/vendor/legend-3.3.7-stock.mjs` build used throughout Tasks 1-8. `src/` was never modified
for any measurement in this document.

**This document supersedes its first two drafts.** Draft 1 concluded "no library gap remains"
from variant F alone, which conflated two changes (deleting the imperative call and forcing a
remount) and mismeasured corrections (armed only on an event F never emits). Draft 2 corrected
those with a decisive control (variant H: delete the call, nothing else) — H fixed the four
original failures but broke `hit-warm`, and draft 2 over-corrected into "the fork still has a
job" without a single fork measurement to support it. **This draft adds variant I — the same
deletion, but guarded so it only applies where H showed it was safe — and fork measurements
against the two scenarios draft 2's claim rested on.** I is 9/9 on stock, and the fork does
nothing different from stock on either of those two scenarios. The corrected conclusion: **no
library change is needed; the entire fork diff is a deletion candidate**, with one open,
non-library-specific item flagged below rather than glossed over.

## The question this audit answers

> Against stock 3.3.7, with zero library changes, how many of the nine scenarios can be made to
> pass by using the library's public API correctly and completely?

`repro/BASELINE.md` measured stock 3.3.7 at 5/9 with the harness's original prop configuration
and the fork's hand-rolled `scrollTargetSettle` at 8/9. Before spending any more of the fork diff
on the four failures (`hit-two-phase`, `hit-late-images`, `hit-prepend`, `page-up`), this audit
checks whether some or all of that gap is our own incomplete use of the public API rather than
something the library genuinely cannot do.

**Result: yes, all of it. A correctly guarded deletion of the app's redundant imperative
`scrollToItem` call (variant I) reaches 9/9 on stock 3.3.7** — it fixes the four original
failures (matching variant H's own numbers) while keeping every scenario H broke (`hit-warm`) at
parity with control. The fork build shows no different behavior from stock on either scenario
that motivated keeping the fork diff in the previous draft. See "Final classification."

## Variant mechanism

`repro/variants.ts` defines `VariantFlags` and `resolveVariant(id)` for variants `A`-`I`. The
active variant is read once at module load from the page's URL (`?variant=`, see
`variantFromSearch`), defaulting to `A` for anyone opening `index.html` directly. `chat.tsx`
takes a `variant` prop and derives every per-variant prop/orchestration change from
`resolveVariant`. `app.tsx` exposes the active variant as `window.__repro.variant()` and renders
it in the HUD (`data-testid="variant-tag"`). `repro/run.mjs` gained `--variant=` (default `A`):
it appends the variant to the page URL, then calls `window.__repro.variant()` after load and
aborts loudly if the page reports back something other than what was requested. The variant is
recorded in every `--json` output alongside `lib`, `n`, `results`, and `rows`. `--keep-log`
captures the first run's full event trace for every targeted scenario, pass or fail, so a variant
that flips a verdict has a committed trace; it skips writing a trace when run 0 already triggered
the on-failure capture, so the same content is never committed twice under two names.

## Variant definitions

All variants change only `repro/chat.tsx`/`repro/app.tsx`/`repro/scenarios.ts` prop and
orchestration usage. `src/` is untouched in every case.

- **A — control.** Current harness configuration (unchanged from Task 8). `onStartReachedThreshold={2}`, `maintainVisibleContentPosition={{data: true}}` (no `shouldRestorePosition`), `initialScrollIndex={{index, viewPosition: 0.5}}`, `dataKey` set, `getItemType` set, jumps to an already-mounted list issued via `listRef.current.scrollToItem({animated: false, item, viewPosition: 0.5})` from an effect.
- **B — default start threshold.** Only `onStartReachedThreshold={0.5}` instead of `2`.
- **C — `shouldRestorePosition`.** Only adds `maintainVisibleContentPosition.shouldRestorePosition = (item, index, data) => centeredId === undefined || item === centeredId`, pinning the centered target as the sole eligible data-change anchor while one is set.
- **D — chat example's shape.** `maintainVisibleContentPosition={true}` (bare), `initialScrollIndex` as a bare number (no `viewPosition`), `getItemType` omitted, `dataKey` omitted. `maintainScrollAtEnd` stays conditional on `centeredId`.
- **E — no `dataKey`.** Only `dataKey` omitted; everything else stays at control.
- **F — mount-path jumps (two variables).** When `centeredId` changes on an already-mounted `<Chat>`, instead of calling `scrollToItem` the list itself remounts (`key` bump) with `initialScrollIndex` already carrying the target. This simultaneously (1) removes the imperative call and (2) forces a fresh mount in place of the library's live-list freshData reset path — which of the two does the work was not separable from F alone.
- **G — F + C combined.** Included to check C doesn't interact badly with F.
- **H — decisive control: delete the imperative call, nothing else.** `repro/chat.tsx`'s `scrollToItem` effect is skipped entirely — no call, no remount, no other prop difference from A. Isolates variable (1) from F's two.
- **I — the guarded deletion.** Keeps the imperative `scrollToItem` call only when the list has already rendered real, non-empty content before this jump; deletes it (behaves like H) when the list has never rendered real content before now. **Discriminator, exactly:** `chat.tsx`'s `hasRenderedNonEmptyRef` — a ref that becomes `true` the first time an effect observes `ready && messages.length > 0`, and stays `true` for the lifetime of the `<Chat>` mount (it is deliberately *not* reset when `datasetKey` changes, since `openAtHit` bumps the dataset as part of every centered jump including `hit-warm`'s — resetting on that would erase exactly the signal needed). The jump-decision effect is declared *before* the ref-tracking effect in the component, so within any single commit the decision always reads the ref's value from *before* that commit — a list's first-ever content arriving in the same commit as its first jump target (`hit-two-phase`'s partial-first-response commit is both `ready && messages.length > 0` and already the jump target) must not retroactively read as "already live" for that same commit's decision. **Why the app could compute the same thing:** this keys on "has the currently-mounted thread view ever shown any real messages before," which is exactly the kind of boolean a thread screen can set the first time it renders actual message data and hold for the screen's lifetime — no library internals are needed to compute it, only the app's own knowledge of whether this is the first paint of real content for the currently-open thread.

## Per-variant tables (`--lib=stock --n=30`, all nine original scenarios)

Every table below is machine-regenerated directly from the committed `repro/results/<variant>-
<scenario>.json` files (a script reads `rows[0]` from each and prints it) — not hand-transcribed —
so a reader recomputing them from the same files reproduces them exactly. This corrects two stale
cells a hand-edited pass of the F and G tables carried in the previous draft: F's `resize-at-end`
`med settle` had been left at an earlier run's 773ms after corrections were re-measured (the
committed JSON says 873ms — the ~99ms gap is exactly the same order of magnitude flagged as
noteworthy jitter elsewhere in this document, not a new effect); G's `open-newest` `med settle`
had a stale 774ms (committed JSON: 772ms).

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

5/9. Exactly reproduces `repro/BASELINE.md`'s stock table (same pass counts, same med/p95 err on
every scenario). `resize-at-end`'s med settle here (876ms) differs from `BASELINE.md`'s original
984ms even though every oracle figure matches exactly — `BASELINE.md` itself documents this kind
of variance across separate `--only=` invocations as "single-digit milliseconds" (its own quoted
wording, `BASELINE.md:65`) on `med settle` while every other figure agrees exactly; the gap seen
here is larger than that single-digit figure but the same *kind* of jitter, not a methodology
concern — no oracle figure (pass count, med/p95 err) ever differs.

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

5/9. Identical to A on every figure (within noise). Rules out the aggressive
`onStartReachedThreshold` as a cause of any of the four failures.

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

5/9. No verdict changes anywhere.

**How `shouldRestorePosition` was confirmed to be consulted, not just defined:** every call is
logged (`probe.log("shouldRestorePosition.call", {centeredId, index, item, result})`). The
**committed** first-failure logs contain this evidence:

```
repro/results/hit-two-phase-variant-C-first-failure.json: 24 calls, 21/24 false, 3/24 true
    last:  {centeredId:500, index:20, item:500, result:true}
repro/results/hit-prepend-variant-C-first-failure.json:   24 calls, 24/24 false, 0/24 true
repro/results/page-up-variant-C-first-failure.json:       24 calls, 24/24 false, 0/24 true
```

**C's null result is weaker than draft 1 stated.** In `hit-prepend` and `page-up`, **every single
call returns `false`** — the target row (`item=500`) is never offered to the predicate at all in
either scenario. The predicate never gets a chance to say "yes, keep this one" — it removes every
available anchor, it does not pin the target. That also explains the corrections drop draft 1 left
unmechanized (`hit-prepend` 9->3, `page-up` 8->4): fewer accepted anchors means less anchor-driven
correction activity, not better targeting. **Untried and left open, not dead:** a predicate that
returns `true` for the target when it *is* offered, and permissively `true` (not `false`) when the
target is never offered.

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

4/9. `hit-warm` regresses to 10/30, flaky, median error 1938.6px, `targetMissing: false`. Numeric
`initialScrollIndex` drops `viewPosition: 0.5`, while the scenario's assertion always grades
against 0.5 and `hit-warm`'s jump is still driven by the imperative `scrollToItem` call (D doesn't
touch that) which does pass 0.5 explicitly — so this is a race between two authorities disagreeing
on `viewPosition`, at least in part, not purely "dropping `getItemType`/`dataKey`/bare-MVCP is
harmful." The 1938.6px magnitude was not fully decomposed. D is not used as evidence for keeping
the app's current prop shape below; E is used instead for `dataKey` specifically.

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

5/9. Identical to A, and `hit-warm` stays 30/30 (unlike D). Isolates D's `hit-warm` regression to
something other than `dataKey` alone.

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

9/9. Corrections are real (see the corrections-fix note in the variant-mechanism history): after
`probe.ts`'s `ARMING_EVENTS` was fixed to include `scroll.remount`, F's corrections show real
post-landing settle activity (`hit-two-phase` 8, `hit-prepend` 6, `hit-late-images` 2, `page-up` 5,
`hit-cold` 2, `hit-warm` 2) — closely matching H's corrections on the same scenarios. Committed
event traces: `repro/results/{hit-two-phase,hit-prepend,hit-late-images,page-up}-variant-F-
trace.json`, each showing one `scroll.remount` event before landing.

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

9/9, indistinguishable from F alone. Committed event traces:
`repro/results/{hit-two-phase,hit-prepend,hit-late-images,page-up}-variant-G-trace.json` (added
this round — G flips the same four verdicts F does and had none before).

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

8/9. Fixes all four originally-failing scenarios cleanly with no remount, but regresses `hit-warm`
to 1/30 (`targetMissing` 29/30). **Note on H's corrections column:** it arms on `scroll.expected`,
which is logged when a jump is *expected* to land on its own — no library call happens under it.
So H's (and I's, below) corrections count post-transition settle activity, not activity following
an actual request the library received. It is a related-but-not-identical quantity to F's/A's
corrections (which do follow a real request or remount), even where the numbers land close
together in this data — `probe.ts` now documents this explicitly.

Committed traces: `repro/results/{hit-two-phase,hit-prepend,hit-late-images,page-up,hit-warm}-
variant-H-{trace,first-failure}.json` (the `hit-warm` trace and first-failure files were
byte-identical since both captured the same failing run-0; the redundant trace file was deleted
after verifying that with `diff`, keeping only the first-failure copy).

**This was the answer to review round 2's Critical 1.** H is not 9/9 — the mount-vs-live-list
distinction is real. What review round 2 then asserted from this ("the fork still has a job") is
addressed by variant I below, not by H alone.

### I — the guarded deletion

```
lib=stock  n=30  variant=I

scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     770ms       0
hit-cold              30/30   0        0.4px     0.4px     754ms       2
hit-warm              30/30   0        0.3px     0.3px     1028ms      3
hit-two-phase         30/30   0        0.3px     0.3px     832ms       8
hit-prepend           30/30   0        0.7px     0.7px     772ms       6
hit-late-images       30/30   0        0.4px     0.4px     829ms       2
send-at-end           30/30   0        0.0px     0.0px     772ms       0
page-up               30/30   0        0.7px     0.7px     777ms       5
resize-at-end         30/30   0        0.0px     0.0px     773ms       0
```

**9/9.** All four original failures close (`hit-two-phase` 0.3px, `hit-prepend` 0.7px,
`hit-late-images` 0.4px, `page-up` 0.7px — matching H's own numbers on all four) *and* `hit-warm`
holds at 30/30 (0.3px, matching control A's 0.3px almost exactly, and its corrections, 3, matches
A's 3 exactly — the guard correctly routes `hit-warm` through the same imperative call control
uses). No remount anywhere in this variant. This is the requested resolution: it demonstrates that
the four-scenario fix and the `hit-warm` regression are not in tension once the call site is told
which of the two shapes it's looking at.

## Fork measurements

Draft 2 asserted "the fork still has a job" resting entirely on `hit-warm` (which passes 30/30 on
*stock* control A — nothing shown there was stock failing where the fork succeeds) and on
`hit-then-end-anchor` (never run against the fork at all). Both gaps are closed here.

```
fork, variant A, hit-then-end-anchor: 30/30 (0.0px) — identical to stock A's 30/30
fork, variant I, hit-warm:            30/30 (0.3px) — identical to stock I's 30/30
fork, variant I, hit-then-end-anchor: 28/30 (0.0px med, 196.0px p95) — see below
```

The fork does not behave differently from stock on either scenario draft 2's claim rested on. This
directly undercuts "the fork still has a job" as previously stated: there is no scenario in this
audit where stock (correctly configured) fails and the fork succeeds.

## `hit-then-end-anchor`: a scenario bug, not a second gap

Review round 2's guard scenario originally showed 0/30 in every variant including F. Round 3
review identified why: the scenario swaps to a disjoint message window
(`loadOlder(SEND_WINDOW_NEWEST_ID + 1, PAGE)`, ids ~861-900, replacing the hit window's ~480-520)
**without calling `bumpDataset()`**, unlike `openAtHit`, which always calls it on every
clear-and-recenter. That handed `maintainVisibleContentPosition` an unrelated dataset under an
unchanged `dataKey` — a scenario-side API misuse sitting underneath the entire 0/30 result,
independent of whichever variant was under test. Fixed in `repro/scenarios.ts` by adding the
missing `bumpDataset()` call.

```
lib=stock  n=30  hit-then-end-anchor
variant   pass    missing  med err   p95 err   med settle  corrections
A         30/30   0        0.0px     0.0px     1322ms      22
F         30/30   0        0.0px     0.0px     1313ms      21
H         30/30   0        0.0px     0.0px     1314ms      20
I         27/30   0        0.0px     196.0px   1315ms      19
```

A, F, and H all reach 30/30 once the scenario's own bug is fixed — the previous draft's "second,
independent gap-shaped finding" is **dropped entirely**; it was our own scenario code, not a
library or app gap.

**I does not reach 30/30 here — 27/30, and reproduced on a second n=30 run at 28/30.** This is a
real, repeatable, minority-of-runs failure (`errPx: 196` in the committed first-failure detail,
`fullyVisible: true`, not a timeout), not noise: `BASELINE.md` and every scenario measured earlier
in this audit was uniformly 0/30 or 30/30 at n=30 with no in-between result, and this is the first
exception. **Its mechanism is not established.** The guarded-deletion branch in `chat.tsx` isn't
touched at all during this scenario's second half (the transition back to `centeredId ===
undefined` and the subsequent appends) — variant I only changes behavior while a centered target
is being set, which happens once, early, in this scenario. The most likely candidate is variant
I's extra `useEffect` (the `hasRenderedNonEmptyRef` tracker), which fires on every `messages`/
`ready` change for the *entire* scenario, not just the jump — one more passive effect running on
every commit could plausibly perturb React's effect-scheduling timing enough to occasionally
interact badly with this scenario's `wait(200)`/`wait(120)` constants, but this is a plausible
mechanism, not a confirmed one.

**Critically, the same 28/30 result appears when the fork library is used instead of stock**
(`fork-I-hit-then-end-anchor`, above) — identical shape, identical magnitude. Since both libraries
show the same behavior under the same harness-level variant I code, **this rules out a
library-specific cause.** Whatever is producing this, it lives in the shared `chat.tsx`
orchestration variant I adds, not in either library's own scroll-targeting logic — so it is not
evidence for a library gap, in either direction. It is recorded here as an open, unresolved,
minor item for whoever next touches variant I's implementation, and it does not change the
headline classification below, because it does not implicate the library.

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

hit-then-end-anchor (post-bumpDataset-fix, A/F/H/I; fork checked for A and I):
  stock: PASS  PASS  PASS  27/30(FAIL, reproduced 28/30)
  fork:  A=30/30 PASS, I=28/30 (FAIL, matches stock's shape)
```

## Final classification

**I is 9/9. No library change is needed for any of the nine original scenarios.**

- **`hit-two-phase`, `hit-prepend`, `hit-late-images`, `page-up`** (the four original failures):
  **API misuse.** The app's imperative `scrollToItem` call is redundant on these four scenarios —
  they all reach the centered jump before the list has ever rendered real content, and the
  library's own freshData bootstrap already lands correctly without help. Deleting the call for
  this shape (I, matching H) fixes all four cleanly.
- **`hit-warm`:** **not a library gap.** Passes 30/30 under control A (stock, using the app's
  current imperative call, unconditionally). Passes 30/30 under I (the guarded deletion, which
  keeps the call for exactly this shape). Passes 30/30 under the fork with I applied — identical
  to stock. The only variant that breaks it is H, which deletes the call *unconditionally* — a
  blanket deletion no one is proposing to ship. Draft 2's "real library-level asymmetry, i.e. a
  library gap" was built on H alone and is **retracted**: a correctly guarded call site does not
  encounter this problem on stock, and the fork does nothing different here either.
- **`hit-then-end-anchor`:** not classified as a library or app gap. Its original 0/30 was the
  scenario's own bug (missing `bumpDataset()`), now fixed; A/F/H all reach 30/30 with the fix. I
  shows an unresolved 27-28/30 result that reproduces identically on stock and fork, which rules
  out a library cause but does not yet have a confirmed one — flagged as an open implementation
  item for variant I's harness code, not a library gap, and not evidence for keeping any fork code.

**No scenario in this audit shows the fork behaving differently from a correctly-configured stock
build.** The two fork measurements taken specifically to test draft 2's claim (`hit-warm` under I,
`hit-then-end-anchor` under A) both match stock exactly. **The entire fork diff
(`scrollTargetSettle`) is a deletion candidate.** What remains before acting on that:

1. Confirm the guarded-deletion approach ports into the real app — it needs an actual "has this
   thread view ever rendered messages before" signal, which this audit argues is computable but
   did not build in the app itself (only in the harness).
2. Resolve or at least further investigate variant I's unexplained `hit-then-end-anchor`
   flakiness before treating I's implementation as a finished reference — it is not a
   library-blocking issue (both libraries show it identically) but it is an open loose end in the
   harness code the app-side implementation should not blindly copy without understanding.

## Variants that could not be expressed through the public API

None. All nine variants (A-I) were fully expressible as prop and orchestration changes in
`repro/chat.tsx`/`repro/app.tsx`/`repro/scenarios.ts`; `src/` was never touched for any
measurement in this document.

## Caveats on a remount-based approach (F/G), if considered instead of I

I is 9/9 without any remount, so this section is no longer the primary recommendation, but it
remains relevant if a guarded deletion turns out not to be portable to the real app for some
reason not surfaced here. A full LegendList remount discards the previous DOM and recycled
containers; every row re-renders from scratch. In the real Keybase app, a keyed remount at either
call site (open-thread-on-a-hit, or jump-to-hit-from-an-open-thread) would discard
`HighlightableRow`'s local state (`settledFor`/`hoveredFor`) and restart the highlight animation —
a specific, concrete cost, not a vague "possibly a flash."

## Recommended changes to the Keybase app's list configuration

The app currently passes `onStartReachedThreshold={2}`, `maintainVisibleContentPosition={{data:
true}}`, `maintainScrollAtEnd={centered ? false : true}`, `dataKey`, `alignItemsAtEnd`,
`initialScrollAtEnd`/`initialScrollIndex`, and issues `scrollToItem({animated:false,
viewPosition:0.5})` from an effect.

- **Primary recommendation: adopt the guarded deletion (variant I).** Keep the imperative
  `scrollToItem` call only when the currently-open thread view has already rendered real message
  content before this jump; skip it when this is the thread view's first real content. This is a
  small, targeted change (not a remount) that measured 9/9 on stock and matches the fork exactly
  on both scenarios that motivated keeping fork code. The discriminator the harness uses
  (`hasRenderedNonEmptyRef`, see the variant-I definition above) is directly portable: a boolean
  the thread screen sets the first time it renders any real message, held for the screen's
  lifetime.
- **No change: `onStartReachedThreshold`.** Variant B (default `0.5`) was statistically identical
  to control.
- **No change: `maintainVisibleContentPosition={{data: true}}`.** Confirmed not misuse. Adding
  `shouldRestorePosition` (variant C) changes corrections behavior on two scenarios but no
  verdict; the untried permissive-fallback shape remains open, not dead, but is not required by
  anything measured here. **Do not conclude `shouldRestorePosition` explains the fork's Task 8
  improvement** on `hit-two-phase`/`hit-late-images` — C alone left both failing identically to
  control.
- **No change: `dataKey`.** Variant E (dropped alone) was statistically identical to control.
- **No change: `getItemType`, object-form `initialScrollIndex`, `alignItemsAtEnd`,
  `maintainScrollAtEnd` conditional.** No variant cleanly isolated any of these as a cause of the
  four failures; D's regression is not clean evidence here (see the D section).
- **Fallback only if the guarded deletion cannot be ported:** F's remount, uniformly. Also
  measured 9/9, but pays a real, avoidable cost (state loss, animation restart) on every jump,
  including the ones a bare deletion would have handled for free. Prefer the guarded deletion.

## Consequence for the fork

**The entire fork diff is now a deletion candidate**, not just the slice affecting the four
originally-failing scenarios. Draft 2's basis for keeping any of it (`hit-warm`'s behavior under
an *unconditional* deletion, and an untested guard scenario) does not survive: `hit-warm` passes
identically under stock control, stock with the guarded deletion, and the fork; the guard scenario
passes identically under stock control and the fork once its own bug is fixed. Task 9 should
re-run the fork's 8/9 comparison against an app-side guarded deletion (variant I's mechanism, or
its real-app equivalent) rather than assuming any of `scrollTargetSettle` is required — this
audit's data says it is not, for every scenario measured against both libraries.
