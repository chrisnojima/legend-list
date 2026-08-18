# API conformance audit: stock @legendapp/list 3.3.7

Date: 2026-08-18, revised same day after review round 2. Stock commit measured: the vendored
`repro/vendor/legend-3.3.7-stock.mjs` build used throughout Tasks 1-8. `src/` was never modified
for any measurement in this document.

**This document supersedes its first draft.** The first draft concluded "no library gap remains"
from variant F alone. Review round 2 identified that F changes two variables at once (deletes the
imperative `scrollToItem` call *and* forces a remount) and that the "0 corrections everywhere"
argument was measuring an instrumentation gap, not real behavior. A decisive control (variant H)
was added to separate the two variables. **The corrected conclusion is that a real library-level
asymmetry exists between mount-time and live-list scroll targeting, and the fork still has a job**
— see "Final classification" below. Everything from the first draft that review round 2 confirmed
accurate (the variant mechanism, A/B/C/D/E's measurements, F's raw numbers before the corrections
fix) is retained; what changed is corrected in place and the reasoning built on top of it.

## The question this audit answers

> Against stock 3.3.7, with zero library changes, how many of the nine scenarios can be made to
> pass by using the library's public API correctly and completely?

`repro/BASELINE.md` measured stock 3.3.7 at 5/9 with the harness's original prop configuration
and the fork's hand-rolled `scrollTargetSettle` at 8/9. Before spending any more of the fork diff
on the four failures (`hit-two-phase`, `hit-late-images`, `hit-prepend`, `page-up`), this audit
checks whether some or all of that gap is our own incomplete use of the public API rather than
something the library genuinely cannot do.

**Result: the four originally-failing scenarios close on pure stock 3.3.7 by deleting the app's
redundant imperative `scrollToItem` call (variant H) — but that same deletion regresses a
previously-passing scenario, `hit-warm`, from 30/30 to 1/30.** A full remount instead of deletion
(variant F) fixes all four *and* keeps `hit-warm` at 30/30, but a new guard scenario added in this
round (`hit-then-end-anchor`) fails at 0/30 in every variant tested, including F. Neither "delete
the call" nor "remount" is a clean, unconditional win. See "Final classification" for the
per-scenario breakdown and what remains a candidate for the fork.

## Variant mechanism

`repro/variants.ts` defines `VariantFlags` and `resolveVariant(id)` for variants `A`-`H`. The
active variant is read once at module load from the page's URL (`?variant=`, see
`variantFromSearch`), defaulting to `A` for anyone opening `index.html` directly. `chat.tsx`
takes a `variant` prop and derives every per-variant prop change from `resolveVariant`.
`app.tsx` exposes the active variant as `window.__repro.variant()` and renders it in the HUD
(`data-testid="variant-tag"`). `repro/run.mjs` gained `--variant=` (default `A`): it appends the
variant to the page URL, then calls `window.__repro.variant()` after load and aborts loudly if
the page reports back something other than what was requested — so a typo in `--variant` can
never silently measure the wrong configuration. The variant is recorded in every `--json` output
alongside `lib`, `n`, `results`, and `rows`, so a result file can never be misattributed to the
wrong variant. `--keep-log` (added in review round 2) captures the first run's full event trace
for every targeted scenario, pass or fail, so a variant that flips a verdict has a committed trace
to point to instead of relying only on the on-failure capture.

## Variant definitions

All variants change only `repro/chat.tsx`/`repro/app.tsx` prop and orchestration usage. `src/` is
untouched in every case.

- **A — control.** Current harness configuration (unchanged from Task 8). `onStartReachedThreshold={2}`, `maintainVisibleContentPosition={{data: true}}` (no `shouldRestorePosition`), `initialScrollIndex={{index, viewPosition: 0.5}}`, `dataKey` set, `getItemType` set, jumps to an already-mounted list issued via `listRef.current.scrollToItem({animated: false, item, viewPosition: 0.5})` from an effect.
- **B — default start threshold.** Only `onStartReachedThreshold={0.5}` instead of `2`.
- **C — `shouldRestorePosition`.** Only adds `maintainVisibleContentPosition.shouldRestorePosition = (item, index, data) => centeredId === undefined || item === centeredId`, pinning the centered target as the sole eligible data-change anchor while one is set. `item` here is the numeric message id (the harness's `data` is `number[]`), so no id lookup is needed.
- **D — chat example's shape.** `maintainVisibleContentPosition={true}` (bare, not `{data: true}`), `initialScrollIndex` as a bare number (no `viewPosition`), `getItemType` omitted, `dataKey` omitted. `maintainScrollAtEnd` stays conditional on `centeredId` (the example doesn't cover the centered case at all, so nothing to imitate there without breaking every hit scenario at mount).
- **E — no `dataKey`.** Only `dataKey` omitted; everything else stays at control.
- **F — mount-path jumps (two variables).** When `centeredId` changes on an already-mounted `<Chat>` (the `hit-warm`/`hit-two-phase`/`hit-prepend`/`hit-late-images`/`page-up` path — `hit-cold` already goes through `mountWith` and was never on the imperative path), instead of calling `scrollToItem` the list itself remounts (`key` bump) with `initialScrollIndex` already carrying the target. This simultaneously (1) removes the imperative call and (2) forces a fresh mount in place of the library's live-list freshData reset path. Which of the two does the work was not separable from F alone — that separation is what H is for.
- **G — best combination.** F (the only single-variable-looking change that moved a verdict, before H showed F is actually two variables) + C (no effect alone, included to check it doesn't interact badly with F).
- **H — decisive control: delete the imperative call, nothing else.** `repro/chat.tsx`'s `scrollToItem` effect is skipped entirely — no call, no remount, no other prop difference from A. Isolates variable (1) from F's two. The reasoning for why this is the right control: the harness already passes both `dataKey` and `initialScrollIndex`, so on the clear→refetch transition (`openAtHit`'s `setMessages([])` + `bumpDataset()` + `setCentered(500)` in one commit, then `full` messages in the next) the library already has what `src/core/initialScrollLifecycle.ts:131-140`'s `setInitialScrollTarget` needs once `previousDataLength === 0` and the data changes structurally (`shouldResetFreshDataLayout`, `src/components/LegendList.tsx:443-448`). Under control A, `scrollToItem` fires on top of that already-armed bootstrap — two scroll authorities aiming at the same target. H removes the second one and changes nothing else.

## Per-variant tables (`--lib=stock --n=30`, all nine original scenarios)

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
every scenario). Confirms nothing else moved since Task 8; the rest of this document's
comparisons are trustworthy. **Noted honestly, not as a red flag:** `resize-at-end`'s med settle
here (876ms) differs by ~108ms from `BASELINE.md`'s original 984ms, even though every oracle
figure (pass count, med/p95 err) matches exactly — ordinary timing jitter across separate
`--only=` invocations, the same kind of variance `BASELINE.md`'s own sweep-vs-chunked comparison
already documented (single-digit-to-low-double-digit ms differences on `med settle` while every
other figure agreed exactly).

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

5/9. Identical to A on every scenario, every figure (within run-to-run noise). Rules out the
aggressive `onStartReachedThreshold` as a cause of any of the four failures — Lead 2 from the
task brief is dead. None of these scenarios' failures are about prepends triggering during the
settle at a wider threshold than default.

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
logged (`probe.log("shouldRestorePosition.call", {centeredId, index, item, result})` in
`chat.tsx`). The **committed** first-failure logs already contain this evidence — no throwaway
script needed:

```
repro/results/hit-two-phase-variant-C-first-failure.json: 24 calls, 21/24 false, 3/24 true
    first: {centeredId:500, index:0, item:495, result:false}
    last:  {centeredId:500, index:20, item:500, result:true}
repro/results/hit-prepend-variant-C-first-failure.json:   24 calls, 24/24 false, 0/24 true
    first: {centeredId:500, index:2, item:482, result:false}
    last:  {centeredId:500, index:50, item:490, result:false}
repro/results/page-up-variant-C-first-failure.json:       24 calls, 24/24 false, 0/24 true
    first: {centeredId:500, index:2, item:482, result:false}
    last:  {centeredId:500, index:50, item:490, result:false}
```

The library called the predicate with real `(item, index, data)` arguments, and the predicate's
own logic (`item === centeredId`) produced the expected true/false split — e.g. `hit-two-phase`'s
last call is `item=500` (the `HIT_ID`) returning `true`. This rules out "the predicate was
supplied but never reached" as an explanation for C's null result.

**C's null result is weaker than the first draft stated, and here is why.** In `hit-prepend` and
`page-up`, **every single call returns `false`** — `item` ranges only over 482-490 (and similar
neighboring ids in the fuller log), and `500` (`HIT_ID`, the actual centered target) is **never
offered to the predicate at all** in either scenario. The predicate never gets a chance to say
"yes, keep this one" — because the target row is never among the candidate anchors the library
considers in the first place, `shouldRestorePosition` returning `false` for everything it's
actually asked about does not "pin the target"; it removes every available anchor. That also
explains the corrections drop the first draft left unmechanized (`hit-prepend` 9->3,
`page-up` 8->4 with settle rising 774ms->1094ms): with every offered candidate rejected, the
library does no anchor-based correction at all on those scenarios — less correction activity, not
better targeting. **The untried shape this leaves open:** a predicate that returns `true` for the
target when it *is* offered, and is permissive (returns `true`, not `false`) as a fallback when
the target is never offered — i.e., `(item) => centeredId === undefined || item === centeredId ||
!wasTargetEverOffered`. This audit did not build or measure that shape; it is recorded here as an
open question for whoever picks up `shouldRestorePosition` next, not as a dead lead. What this
audit *does* establish is narrower than the first draft claimed: the specific predicate tested
(pin-the-target-only) changes corrections behavior but not verdicts, because on two of the four
failing scenarios the target was never in the candidate set to begin with.

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

4/9 (regressed from 5/9). The four originally-failing scenarios are unchanged (`hit-two-phase`
118.3px vs. 118.1px is noise). `hit-warm` — which passed cleanly at 30/30 on every other variant
— regresses to 10/30, flaky, median error 1938.6px, `targetMissing: false` (the row is found, just
far off). First-failure evidence: `repro/results/hit-warm-variant-D-first-failure.json`
(`errPx: 1938.5625, fullyVisible: false, targetMissing: false, corrections: 1`).

**This regression is partly an oracle mismatch, and the first draft overstated it as evidence for
keeping the app's current prop shape.** Numeric `initialScrollIndex` drops `viewPosition: 0.5`;
the scenario's assertion always grades against `viewPosition: 0.5` (that field lives in
`scenarios.ts`'s fixed `Assertion` shape, unaffected by any variant). Two things are true at once:
(1) whatever the library's freshData bootstrap does under D's numeric `initialScrollIndex`, it is
not being asked to aim for 0.5 the way it is under every other variant — so grading it against 0.5
was always going to read as "wrong" for however many runs the bootstrap's own aim wins out; and
(2) `hit-warm`'s jump is still driven by the imperative `scrollToItem` call under D (D does not
touch `flags.remountOnJump`), which *does* pass `viewPosition: 0.5` explicitly — so this scenario
under D is a race between an imperative call aiming at 0.5 and a freshData bootstrap now aiming at
0 (top), which is exactly the two-scroll-authorities race variant H's design note describes for
control A, just with the two authorities disagreeing on `viewPosition` as well as on timing under
D. The 1938.6px magnitude was not further decomposed — it is larger than a single-viewport
top-vs-middle difference (~320px for a 640px-tall viewport) would predict from `viewPosition`
alone, so something beyond the `viewPosition` drop is also contributing, and this audit does not
have a full account of what. **Conclusion: D's `hit-warm` number is real (the scenario does fail,
30/30 -> 10/30, on real measured data), but it should not be read as "dropping `getItemType`/
`dataKey`/bare-MVCP is uniquely harmful" the way the first draft implied — a meaningful part of
the story is the numeric-`initialScrollIndex`/oracle interaction, which is orthogonal to whether
those other props are worth keeping.** D is not used as evidence for the recommendation section
below; E is used instead for `dataKey` specifically, and no comparably decomposed evidence exists
for `getItemType`.

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

5/9. Identical to A on every scenario, and — critically — `hit-warm` stays 30/30, unlike D (which
also drops `dataKey`, among other changes). This isolates D's `hit-warm` regression to something
other than `dataKey` alone. `dataKey` by itself changes nothing measurable in this harness.

### F — mount-path jumps

```
lib=stock  n=30  variant=F

scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     778ms       0
hit-cold              30/30   0        0.4px     0.4px     763ms       2
hit-warm              30/30   0        0.4px     0.4px     1039ms      2
hit-two-phase         30/30   0        0.3px     0.3px     834ms       8
hit-prepend           30/30   0        0.2px     0.2px     784ms       6
hit-late-images       30/30   0        0.4px     0.4px     829ms       2
send-at-end           30/30   0        0.0px     0.0px     772ms       0
page-up               30/30   0        0.2px     0.2px     774ms       5
resize-at-end         30/30   0        0.0px     0.0px     773ms       0
```

**9/9.** (Corrections figures above are the re-measurement after the probe fix described below —
pass/fail and med/p95 err are unchanged from the first measurement on every scenario.)

**The "0 corrections everywhere" claim in the first draft was wrong and has been corrected.**
`corrections()` only counts `scroll.observed` events after something arms the counter
(`repro/probe.ts`), and the original arming condition was `type === "scroll.request"` only — an
event F's remount path never emits (it emits `scroll.remount` instead). So the first draft's F
table was structurally zero on every scenario, not because nothing needed correcting but because
nothing ever armed the counter; `hit-cold` showing 0 under F and 3 under A, on the same passing
scenario with the same landing, was the tell. `probe.ts`'s `ARMING_EVENTS` set now includes
`scroll.remount` (and `scroll.expected`, added for variant H below), and the corrected numbers
above show real correction activity: `hit-two-phase` 8, `hit-prepend` 6, `hit-late-images` 2,
`page-up` 5, `hit-cold` 2, `hit-warm` 2 — closely matching variant H's corrections on the same
scenarios (see H's table below). F does settle correctly by the end of the quiescence window on
every scenario (that's what `pass` and `errPx` measure), but it is not a "frictionless landing on
the first paint" the way the first draft described it; there is real settling activity afterward,
just as there is under every other variant.

`hit-prepend` is still the standout on raw pass/fail: on control, stock's imperative path never
even locates the target row (`targetMissing` 30/30); the fork's own hand-rolled `scrollTargetSettle`
(Task 8's 8/9 result) still misses it at 3381.7px median error; here, on pure stock, it lands at
0.2px. Guards (`open-newest`, `send-at-end`, `resize-at-end`) hold at 0 corrections, 0.0px.

**Committed event traces** (added in review round 2, `--keep-log`, n=1 each):
`repro/results/{hit-two-phase,hit-prepend,hit-late-images,page-up}-variant-F-trace.json`. Each
shows exactly one `scroll.remount` event followed by `row.measured`/`scroll.observed` activity and
`scenario.end`, e.g. `hit-prepend-variant-F-trace.json`: `scenario.start`(1), `scroll.remount`(1),
`row.measured`(24), `scroll.observed`(7), `row.grew`(2), `scenario.end`(1).

**Also not fully inert on the mount path it doesn't touch:** `hit-cold` (which goes through
`mountWith`, not the imperative-effect branch F changes) shows a small **signed** error flip
between variants — control A's signed median `errPx` for `hit-cold` is -0.3125px, F's is
+0.4375px (H's is also +0.4375px). Both are far under the 2px threshold and don't affect pass/fail
in either direction, but the sign flip means F (and H) are not perfectly inert on `hit-cold`'s own
code path the way "F only changes the imperative-jump branch" would predict. No mechanism is
claimed for this — it is recorded as observed, sub-pixel, and unexplained.

### G — best combination (F + C)

```
lib=stock  n=30  variant=G

scenario              pass    missing  med err   p95 err   med settle  corrections
open-newest           30/30   0        0.0px     0.0px     774ms       0
hit-cold              30/30   0        0.4px     0.4px     758ms       2
hit-warm              30/30   0        0.4px     0.4px     1031ms      2
hit-two-phase         30/30   0        0.3px     0.3px     835ms       8
hit-prepend           30/30   0        0.2px     0.2px     782ms       6
hit-late-images       30/30   0        0.4px     0.4px     829ms       2
send-at-end           30/30   0        0.0px     0.0px     774ms       0
page-up               30/30   0        0.2px     0.2px     778ms       5
resize-at-end         30/30   0        0.0px     0.0px     982ms       0
```

9/9, statistically indistinguishable from F alone (every med/p95 err and corrections figure within
noise of F's). `shouldRestorePosition` adds nothing on top of the remount change.

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

**8/9 — this is the decisive result.** All four originally-failing scenarios pass cleanly with
*no remount at all*, just deleting the redundant `scrollToItem` call: `hit-two-phase` 30/30
(0.3px), `hit-prepend` 30/30 (0.7px), `hit-late-images` 30/30 (0.4px), `page-up` 30/30 (0.7px) —
matching or close to F's own numbers. But `hit-warm`, which passes 30/30 under every other variant
in this audit including control, **regresses to 1/30**, with `targetMissing: true` in 29 of 30
runs. `hit-warm` is the one scenario in the whole suite where the harness loads real content,
settles it, and waits (250ms) *before* the centered jump — every other `hit-*` scenario calls
`openAtHit` as effectively the first action after the harness's own fresh `<Chat>` remount between
scenarios, so the list has barely diverged from a virgin mount when the jump happens. `hit-warm`
is the one case that is genuinely a *live*, previously-rendered, previously-scrolled list being
asked to retarget.

Committed evidence:
`repro/results/hit-warm-variant-H-first-failure.json` and
`repro/results/hit-warm-variant-H-trace.json` (n=1, `--keep-log`): the trace shows one
`scroll.expected` event (H's instrumentation-only marker — it triggers no library call, see
`probe.ts`), followed by `row.measured`/`scroll.observed` activity, then
`oracle.targetMissing`, then `scenario.end`. No corrective scrolling activity ever locates the
row. Compare against `repro/results/{hit-two-phase,hit-prepend,hit-late-images,page-up}-variant-
H-trace.json`, all of which land successfully with the same `scroll.expected` marker and no call.

**This is the answer to the reviewer's Critical 1.** H is not 9/9. The mount-vs-live-list
distinction that F's remount also carries is doing real, load-bearing work that a bare deletion of
the imperative call does not replicate — deleting the call is not a universally safe fix, because
it silently breaks the one scenario that represents a genuinely live jump. The first draft's "no
library gap remains" is **retracted**; see "Final classification."

## New guard: `hit-then-end-anchor` (A / F / H)

Added in review round 2 (Important 4): the three original guards (`open-newest`, `send-at-end`,
`resize-at-end`) all run with `centeredId === undefined` for their entire duration, so F's
`remountOnJump` branch (which only fires when `centeredId` transitions to a *defined* value on an
already-mounted list) is never reached by any of them. Their 30/30 says nothing about the remount
mechanism. This scenario (`repro/scenarios.ts`) jumps to a hit first — reaching the remount branch
under F — then returns to `centeredId === undefined` and requires end-anchoring under two
appends, the same shape `send-at-end` checks.

```
variant   pass    missing  med err   p95 err   med settle  corrections
A         0/30    0        3594.0px  3594.0px  1097ms      8
F         0/30    0        2851.0px  2851.0px  1067ms      1
H         0/30    0        2378.0px  2378.0px  1100ms      7
```

**0/30 in all three variants.** This is a genuinely new finding, and it is reported plainly rather
than folded into the four-scenario classification: it is not one of the scenarios Task 8's
original nine covered, and none of the eight variants measured in this audit have any code path
that reacts to `centeredId` transitioning back to `undefined` — `flags.remountOnJump`'s branch in
`chat.tsx` only fires entering a centered target, never leaving one. So on this transition, every
variant behaves identically to control: nothing explicitly tells the list to scroll to the end,
and `maintainScrollAtEnd` alone does not perform that jump when the list was previously scrolled
far from the end (as opposed to `send-at-end`, which starts empty/near-top and never has to cross
a large existing scroll distance). **F does not generalize to this round-trip.** The point-fixes
measured in this audit (deleting the call, or remounting) protect *landing on a hit*; they say
nothing about *returning from a hit to a live end-anchored view*, which is also part of a
realistic chat session. This is recorded as an open item for whoever designs the actual fix, not
resolved here — this task's scope is measurement, not deriving fixes.

## Summary table: scenario x variant (pass/fail)

```
scenario              A     B     C     D     E     F     G     H
open-newest           PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS
hit-cold              PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS
hit-warm              PASS  PASS  PASS  FAIL  PASS  PASS  PASS  FAIL
hit-two-phase         FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS  PASS
hit-prepend           FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS  PASS
hit-late-images       FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS  PASS
send-at-end           PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS
page-up               FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS  PASS
resize-at-end         PASS  PASS  PASS  PASS  PASS  PASS  PASS  PASS

totals                5/9   5/9   5/9   4/9   5/9   9/9   9/9   8/9

hit-then-end-anchor (A/F/H only, not part of the 9-scenario totals above): FAIL / FAIL / FAIL
```

(`hit-warm`'s D failure is flaky, 10/30 not 0/30; `hit-warm`'s H failure is nearly uniform, 1/30 —
both are marked FAIL because neither meets the pass bar.)

## Final classification

**Revised from the first draft.** The four originally-failing scenarios *can* be made to pass
with zero library changes, by two different means (F's remount, or H's bare deletion) — but the
means matters, because H's deletion is not safe as a blanket fix (it breaks `hit-warm`), and even
F's remount does not cover the new `hit-then-end-anchor` guard. The honest classification is more
nuanced than a single misuse/gap label per scenario:

- **`hit-two-phase`, `hit-prepend`, `hit-late-images`, `page-up`** (the four original failures):
  these close under both F and H, with H alone (no remount) sufficient — 30/30 on all four with
  H's bare deletion, matching or close to F's own error figures. **This part is best classified as
  API misuse**: the app's imperative `scrollToItem` call is redundant on these four scenarios,
  because they all reach the centered jump effectively at (or very near) the library's own
  freshData bootstrap, which already lands correctly without help — the imperative call actively
  fights it (racing, per the reviewer's trace analysis of `initialScrollLifecycle.ts` and
  `LegendList.tsx:443-448`) rather than assisting it.
- **`hit-warm`** (already passing under control A, so not one of "the four failures" — but
  decisive for what fixing the other four safely requires): H's deletion breaks it (1/30,
  `targetMissing` 29/30); F's remount keeps it passing (30/30). This is evidence of **a real
  library-level asymmetry, i.e. a library gap**: on a list that has genuinely rendered content and
  settled a real scroll position (not one that is still effectively fresh), the freshData
  bootstrap driven purely by props (`dataKey` + `initialScrollIndex`) does **not** reliably
  retarget the scroll on its own — something extra is required, and only an imperative nudge (the
  app's current approach) or a forced remount (F) supplies it. **"No library gap remains," the
  first draft's headline conclusion, is retracted.** The gap is narrower than "the library can't
  do centered scroll targeting" — mount-time and remount-time `initialScrollIndex` both work
  reliably (`hit-cold`, F on every scenario) — but live-list freshData-driven retargeting without
  any nudge does not, and that is squarely inside what a correct fix needs to handle.
- **`hit-then-end-anchor`** (new): fails in every tested variant including F, because no variant's
  code does anything differently on the transition this scenario tests (leaving a centered view).
  This is a second, independent gap-shaped finding — not yet classified as misuse or library gap,
  because no variant in this audit attempted a fix for it. Flagged for the next task, not resolved
  here.

**What this means for the fork:** the fork's `scrollTargetSettle` was measured (Task 8) at 8/9,
correctly fixing `hit-two-phase`/`hit-late-images`/`page-up` and failing only `hit-prepend`
(3381.7px). This audit shows `hit-prepend` and its three siblings are fixable on stock without any
fork changes, via deleting a redundant call — so that slice of the fork's value is real but
replaceable by a simpler app-side change. What this audit does **not** show is that the fork's
code protecting `hit-warm`-shaped live jumps, or anything resembling `hit-then-end-anchor`'s
transition, is unnecessary. Task 9 should not assume the fork diff can be deleted wholesale; it
should re-run the fork's comparison against an app-side deletion of the redundant call (not a
remount) and check specifically whether `hit-warm`-shaped and `hit-then-end-anchor`-shaped
behavior still needs library-side help once that deletion is in place.

## Variants that could not be expressed through the public API

None. All eight variants (A-H) were fully expressible as prop and orchestration changes in
`repro/chat.tsx`/`repro/app.tsx`/`repro/scenarios.ts`; `src/` was never touched for any
measurement in this document.

## Caveats on variant F if it is used anywhere

This document measures only what the harness's oracle measures: DOM presence and pixel offset of
the target row after quiescence. It does not measure:

1. **Visual cost of remounting.** A full LegendList remount discards the previous DOM and
   recycled containers; every row re-renders from scratch. In this harness that shows up as
   `hit-late-images`' image-growth timers restarting. In the real Keybase app, a keyed remount at
   either call site (open-thread-on-a-hit, or jump-to-hit-from-an-open-thread) would discard
   `HighlightableRow`'s local state (`settledFor`/`hoveredFor`) and restart the highlight
   animation — this is a specific, concrete cost, not a vague "possibly a flash."
2. **Scroll momentum / mid-scroll interruption.** Untested here: whether remounting mid-gesture
   (e.g., a fast search-result tap while the list is still decelerating from a previous scroll)
   behaves as cleanly as the settled-state scenarios in this repro.

## Recommended changes to the Keybase app's list configuration

The app currently passes `onStartReachedThreshold={2}`, `maintainVisibleContentPosition={{data:
true}}`, `maintainScrollAtEnd={centered ? false : true}`, `dataKey`, `alignItemsAtEnd`,
`initialScrollAtEnd`/`initialScrollIndex`, and issues `scrollToItem({animated:false,
viewPosition:0.5})` from an effect.

- **Primary recommendation, pending the caveat below: delete the redundant imperative
  `scrollToItem` call** for the transition shape `hit-two-phase`/`hit-prepend`/`hit-late-images`/
  `page-up` represent (jumping to a hit on a list that hasn't yet meaningfully rendered — e.g., a
  thread newly navigated into and centered on a search hit). This is a ~12-line deletion, not a
  remount, and variant H shows it is sufficient on its own for those four shapes. **Caveat: do not
  delete it unconditionally.** Variant H shows the same deletion breaks `hit-warm`'s shape (a jump
  issued from an already-open, already-rendered, already-scrolled thread) — which is also a real
  app flow (e.g., "jump to reply" or "jump to pinned message" from within an open conversation).
  The app needs *some* signal to distinguish "this jump is happening on a list that hasn't
  meaningfully rendered yet" from "this jump is happening on a live list" before it can safely
  apply H's deletion only to the former. This audit did not test or design that signal; it is the
  next thing to try, not something to assume exists.
- **Fallback recommendation: F's remount, uniformly, if no such signal is practical to build.**
  It is a safe (measured: 9/9 on the original nine scenarios including `hit-warm`) but more
  expensive choice — it pays the remount cost (state loss, animation restart, per the caveats
  above) on every jump, including the ones where a bare deletion would have been free. Prefer the
  conditional deletion above if the app can reliably tell the two cases apart; fall back to a
  uniform remount only if it cannot.
- **Neither recommendation addresses `hit-then-end-anchor`'s shape** (leaving a centered view and
  returning to a live end-anchored view). Every variant tested, including F, fails this
  transition uniformly, because no variant's code reacts to it at all. Whatever the app-side fix
  becomes, it needs an explicit answer for this transition too — most likely an imperative
  "return to end" trigger (a `scrollToEnd`/`scrollToOffset` call, or extending the app's own
  centered/end-anchored toggle logic to fire one) rather than relying on `maintainScrollAtEnd`
  alone to notice the transition.
- **No change: `onStartReachedThreshold`.** Variant B (default `0.5`) was statistically identical
  to control on all nine scenarios. The app's `2` is not implicated in any of these failures.
- **No change: `maintainVisibleContentPosition={{data: true}}`.** Confirmed not misuse
  (controller finding, restated: `{data: true}` normalizes identically to bare `true`). Adding
  `shouldRestorePosition` (variant C) changes corrections behavior on two scenarios but no verdict,
  and the untried permissive-fallback shape (see the C section above) remains open, not dead — it
  is not recommended as a required change on the evidence gathered here, but it has not been ruled
  out either. **Do not conclude `shouldRestorePosition` is the mechanism behind the fork's Task 8
  improvement on `hit-two-phase`/`hit-late-images`** — C alone left both scenarios failing
  identically to control.
- **No change: `dataKey`.** Variant E (dropped alone) was statistically identical to control.
- **No change: `getItemType`, object-form `initialScrollIndex`, `alignItemsAtEnd`,
  `maintainScrollAtEnd` conditional.** No variant cleanly isolated any of these as a cause of the
  four failures. Variant D's regression on `hit-warm` is not clean evidence here — see the D
  section above for why it is partly an oracle/viewPosition-drop artifact rather than solid
  evidence that dropping these specific props is uniquely harmful. Keep the current shape because
  nothing in this audit shows a reason to change it, not because D proves it is required.

## Consequence for the fork

Part, but not all, of the fork's diff is now a deletion candidate. The slice whose only measured
effect is on `hit-two-phase`, `hit-late-images`, `hit-prepend`, or `page-up` closes on stock via a
~12-line app-side deletion (variant H) — no remount, no fork changes required for those four
shapes specifically. But this audit also produced two pieces of evidence that a real gap remains:
`hit-warm`'s H regression (a live-list retargeting case that bare deletion breaks and that needs
either the current imperative call or a remount) and `hit-then-end-anchor`'s uniform failure
across every variant (a transition no variant's code addresses at all). Task 9 should not assume
the fork diff can be deleted wholesale. It should re-run the fork's 8/9 comparison against an
app-side deletion of the redundant call (guarded to not fire on `hit-warm`-shaped live jumps) and
determine whether `scrollTargetSettle` — or something like it — is still required for the
live-jump and leave-a-centered-view cases this audit could not close through public API usage
alone.
