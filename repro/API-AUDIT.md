# API conformance audit: stock @legendapp/list 3.3.7

Date: 2026-08-18. Stock commit measured: the vendored `repro/vendor/legend-3.3.7-stock.mjs` build
used throughout Tasks 1-8. `src/` was never modified for any measurement in this document.

## The question this audit answers

> Against stock 3.3.7, with zero library changes, how many of the nine scenarios can be made to
> pass by using the library's public API correctly and completely?

`repro/BASELINE.md` measured stock 3.3.7 at 5/9 with the harness's original prop configuration
and the fork's hand-rolled `scrollTargetSettle` at 8/9. Before spending any more of the fork diff
on the four failures (`hit-two-phase`, `hit-late-images`, `hit-prepend`, `page-up`), this audit
checks whether some or all of that gap is our own incomplete use of the public API rather than
something the library genuinely cannot do.

**Result: all four failures close on pure stock 3.3.7 by changing only how the jump is issued —
a full LegendList remount carrying `initialScrollIndex`, instead of an imperative `scrollToItem`
call onto an already-mounted list (variant F below). 9/9, zero library changes.** No variant in
this audit required touching `src/`.

## Variant mechanism

`repro/variants.ts` defines `VariantFlags` and `resolveVariant(id)` for variants `A`-`G`. The
active variant is read once at module load from the page's URL (`?variant=`, see
`variantFromSearch`), defaulting to `A` for anyone opening `index.html` directly. `chat.tsx`
takes a `variant` prop and derives every per-variant prop change from `resolveVariant`.
`app.tsx` exposes the active variant as `window.__repro.variant()` and renders it in the HUD
(`data-testid="variant-tag"`). `repro/run.mjs` gained `--variant=` (default `A`): it appends the
variant to the page URL, then calls `window.__repro.variant()` after load and aborts loudly if
the page reports back something other than what was requested — so a typo in `--variant` can
never silently measure the wrong configuration. The variant is recorded in every `--json` output
alongside `lib`, `n`, `results`, and `rows`, so a result file can never be misattributed to the
wrong variant.

## Variant definitions

All variants change only `repro/chat.tsx`/`repro/app.tsx` prop usage. `src/` is untouched in
every case.

- **A — control.** Current harness configuration (unchanged from Task 8). `onStartReachedThreshold={2}`, `maintainVisibleContentPosition={{data: true}}` (no `shouldRestorePosition`), `initialScrollIndex={{index, viewPosition: 0.5}}`, `dataKey` set, `getItemType` set, jumps to an already-mounted list issued via `listRef.current.scrollToItem({animated: false, item, viewPosition: 0.5})` from an effect.
- **B — default start threshold.** Only `onStartReachedThreshold={0.5}` instead of `2`.
- **C — `shouldRestorePosition`.** Only adds `maintainVisibleContentPosition.shouldRestorePosition = (item, index, data) => centeredId === undefined || item === centeredId`, pinning the centered target as the sole eligible data-change anchor while one is set. `item` here is the numeric message id (the harness's `data` is `number[]`), so no id lookup is needed.
- **D — chat example's shape.** `maintainVisibleContentPosition={true}` (bare, not `{data: true}`), `initialScrollIndex` as a bare number (no `viewPosition`), `getItemType` omitted, `dataKey` omitted. `maintainScrollAtEnd` stays conditional on `centeredId` (the example doesn't cover the centered case at all, so nothing to imitate there without breaking every hit scenario at mount).
- **E — no `dataKey`.** Only `dataKey` omitted; everything else stays at control.
- **F — mount-path jumps.** When `centeredId` changes on an already-mounted `<Chat>` (the `hit-warm`/`hit-two-phase`/`hit-prepend`/`hit-late-images`/`page-up` path — `hit-cold` already goes through `mountWith` and was never on the imperative path), instead of calling `scrollToItem` the list itself remounts (`key` bump) with `initialScrollIndex` already carrying the target — the same path `hit-cold` uses at first mount.
- **G — best combination.** F (the only single-variable variant that changed anything) + C (no effect alone, included to check it doesn't interact badly with F). B and D were not folded in: B did nothing, D actively regressed a passing scenario.

## Per-variant tables (`--lib=stock --n=30`, all nine scenarios)

### A — control

```
lib=stock  n=30  variant=A

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     771ms       0
hit-cold          30/30   0        0.3px     0.3px     754ms       3
hit-warm          30/30   0        0.3px     0.3px     1026ms      3
hit-two-phase     0/30    0        118.1px   118.1px   834ms       9
hit-prepend       0/30    30       -         -         771ms       9
hit-late-images   0/30    0        1297.7px  1297.7px  829ms       3
send-at-end       30/30   0        0.0px     0.0px     771ms       0
page-up           0/30    30       -         -         774ms       8
resize-at-end     30/30   0        0.0px     0.0px     876ms       0
```

5/9. Exactly reproduces `repro/BASELINE.md`'s stock table (same pass counts, same med/p95 err on
every scenario). Confirms nothing else moved since Task 8; the rest of this document's
comparisons are trustworthy.

### B — default start threshold

```
lib=stock  n=30  variant=B

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     772ms       0
hit-cold          30/30   0        0.3px     0.3px     761ms       3
hit-warm          30/30   0        0.3px     0.3px     1029ms      3
hit-two-phase     0/30    0        118.1px   118.1px   837ms       9
hit-prepend       0/30    30       -         -         768ms       9
hit-late-images   0/30    0        1297.7px  1297.7px  829ms       3
send-at-end       30/30   0        0.0px     0.0px     771ms       0
page-up           0/30    30       -         -         778ms       8
resize-at-end     30/30   0        0.0px     0.0px     874ms       0
```

5/9. Identical to A on every scenario, every figure (within run-to-run noise). Rules out the
aggressive `onStartReachedThreshold` as a cause of any of the four failures — Lead 2 from the
task brief is dead. None of these scenarios' failures are about prepends triggering during the
settle at a wider threshold than default.

### C — `shouldRestorePosition`

```
lib=stock  n=30  variant=C

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     772ms       0
hit-cold          30/30   0        0.3px     0.3px     760ms       3
hit-warm          30/30   0        0.3px     0.3px     1033ms      3
hit-two-phase     0/30    0        118.1px   118.1px   838ms       9
hit-prepend       0/30    30       -         -         831ms       3
hit-late-images   0/30    0        1297.7px  1297.7px  828ms       3
send-at-end       30/30   0        0.0px     0.0px     772ms       0
page-up           0/30    30       -         -         1094ms      4
resize-at-end     30/30   0        0.0px     0.0px     981ms       0
```

5/9. No verdict changes anywhere. Two side effects worth recording honestly, since the task
brief calls C the most important variant: `hit-prepend`'s corrections drop 9->3 and `page-up`'s
drop 8->4 (with `page-up`'s settle time rising 774ms->1094ms) once the predicate is supplied —
the library visibly does less scroll-fighting on those two scenarios — but neither scenario's
pass/fail verdict moves, and `errPx`/`targetMissing` are unchanged. This is reported as observed
behavior; no mechanism is claimed for it.

**How `shouldRestorePosition` was confirmed to be consulted, not just defined:** every call is
logged (`probe.log("shouldRestorePosition.call", {centeredId, index, item, result})` in
`chat.tsx`). A throwaway verification run (`bun repro/run.mjs`-equivalent single-page script,
not committed) loaded `?variant=C` and ran five scenarios, inspecting the resulting event log:

```
hit-two-phase   shouldRestorePosition calls=24   false results=21/24  (sample item=495->false, item=500->true)
hit-prepend     shouldRestorePosition calls=24   false results=24/24
page-up         shouldRestorePosition calls=24   false results=24/24
send-at-end     shouldRestorePosition calls=12   false results=0/12
hit-cold        shouldRestorePosition calls=9    false results=8/9
```

The library called the predicate with real `(item, index, data)` arguments on every data-changing
scenario, and the predicate's own logic (`item === centeredId`) produced the expected mix of
`true`/`false` results — e.g. `hit-two-phase` calls it 24 times across the scenario's several data
changes, returning `true` only for `item=500` (the centered target, `HIT_ID`) and `false` for
every other visible id. This rules out "the predicate was supplied but never reached" as an
explanation for C's null result — it was reached, correctly, and still didn't move any verdict.

### D — chat example's shape

```
lib=stock  n=30  variant=D

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     772ms       0
hit-cold          30/30   0        0.3px     0.3px     757ms       3
hit-warm          10/30   0        1938.6px  1938.6px  1029ms      1
hit-two-phase     0/30    0        118.3px   118.3px   836ms       9
hit-prepend       0/30    30       -         -         770ms       11
hit-late-images   0/30    0        1297.7px  1297.7px  828ms       3
send-at-end       30/30   0        0.0px     0.0px     776ms       0
page-up           0/30    30       -         -         777ms       8
resize-at-end     30/30   0        0.0px     0.0px     983ms       0
```

4/9 (regressed from 5/9). The four originally-failing scenarios are unchanged (`hit-two-phase`
118.3px vs. 118.1px is noise). But `hit-warm` — which passed cleanly at 30/30 on every other
variant — regresses to 10/30 with median error 1938.6px, and is flaky (10/30, not the uniform
0/30 or 30/30 every other scenario in this audit shows). This is evidence against matching the
example's shape wholesale: the example's own props don't cover the centered-jump case at all
(see the task brief), and bare `maintainVisibleContentPosition`/numeric `initialScrollIndex`/no
`getItemType`/no `dataKey`, in combination, break a scenario that previously worked. Guards
(`open-newest`, `send-at-end`, `resize-at-end`) hold at 30/30. First-failure evidence:
`repro/results/hit-warm-variant-D-first-failure.json`.

### E — no `dataKey`

```
lib=stock  n=30  variant=E

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     774ms       0
hit-cold          30/30   0        0.3px     0.3px     768ms       3
hit-warm          30/30   0        0.3px     0.3px     1029ms      3
hit-two-phase     0/30    0        118.1px   118.1px   841ms       9
hit-prepend       0/30    30       -         -         770ms       9
hit-late-images   0/30    0        1297.7px  1297.7px  829ms       3
send-at-end       30/30   0        0.0px     0.0px     773ms       0
page-up           0/30    30       -         -         777ms       8
resize-at-end     30/30   0        0.0px     0.0px     788ms       0
```

5/9. Identical to A on every scenario, and — critically — `hit-warm` stays 30/30, unlike D (which
also drops `dataKey`). This isolates D's `hit-warm` regression to something other than `dataKey`
alone: most likely `getItemType`, or the combination of bare `maintainVisibleContentPosition`
with numeric `initialScrollIndex`. `dataKey` by itself changes nothing measurable in this harness.

### F — mount-path jumps

```
lib=stock  n=30  variant=F

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     778ms       0
hit-cold          30/30   0        0.4px     0.4px     763ms       0
hit-warm          30/30   0        0.4px     0.4px     1039ms      0
hit-two-phase     30/30   0        0.3px     0.3px     834ms       0
hit-prepend       30/30   0        0.2px     0.2px     784ms       0
hit-late-images   30/30   0        0.4px     0.4px     829ms       0
send-at-end       30/30   0        0.0px     0.0px     772ms       0
page-up           30/30   0        0.2px     0.2px     774ms       0
resize-at-end     30/30   0        0.0px     0.0px     773ms       0
```

**9/9.** Every scenario passes, every scenario shows 0 corrections (the imperative-scroll
correction machinery never engages, because there's nothing to correct — the row is where it
should be from the first paint after remount), and every med/p95 error is <=0.4px. `hit-prepend`
is the standout: on control, stock's imperative path never even locates the target row
(`targetMissing` 30/30); the fork's own hand-rolled `scrollTargetSettle` (Task 8's 8/9 result)
still misses it at 3381.7px median error; here, on pure stock, it lands at 0.2px. Guards
(`open-newest`, `send-at-end`, `resize-at-end`) hold at 0 corrections, 0.0px — F does not trade
a hit scenario for a guard regression.

### G — best combination (F + C)

```
lib=stock  n=30  variant=G

scenario          pass    missing  med err   p95 err   med settle  corrections
open-newest       30/30   0        0.0px     0.0px     774ms       0
hit-cold          30/30   0        0.4px     0.4px     758ms       0
hit-warm          30/30   0        0.4px     0.4px     1029ms      0
hit-two-phase     30/30   0        0.3px     0.3px     832ms       0
hit-prepend       30/30   0        0.2px     0.2px     781ms       0
hit-late-images   30/30   0        0.4px     0.4px     829ms       0
send-at-end       30/30   0        0.0px     0.0px     772ms       0
page-up           30/30   0        0.2px     0.2px     778ms       0
resize-at-end     30/30   0        0.0px     0.0px     981ms       0
```

9/9, statistically indistinguishable from F alone (every med/p95 err within 0.1px of F's,
corrections 0 everywhere in both). `shouldRestorePosition` adds nothing on top of the mount-path
change; F alone accounts for the entire result.

## Summary table: scenario x variant (pass/fail)

```
scenario          A     B     C     D     E     F     G
open-newest       PASS  PASS  PASS  PASS  PASS  PASS  PASS
hit-cold          PASS  PASS  PASS  PASS  PASS  PASS  PASS
hit-warm          PASS  PASS  PASS  FAIL  PASS  PASS  PASS
hit-two-phase     FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS
hit-prepend       FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS
hit-late-images   FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS
send-at-end       PASS  PASS  PASS  PASS  PASS  PASS  PASS
page-up           FAIL  FAIL  FAIL  FAIL  FAIL  PASS  PASS
resize-at-end     PASS  PASS  PASS  PASS  PASS  PASS  PASS

totals            5/9   5/9   5/9   4/9   5/9   9/9   9/9
```

(`hit-warm`'s D failure is flaky, 10/30 not 0/30 — the only non-uniform result in this audit; it
is still marked FAIL because it does not meet the pass bar and would not be reported as a passing
scenario.)

## Final classification

All four originally-failing scenarios are **our own API misuse — fixable with zero library
changes.**

- **`hit-two-phase`**: stock/control 0/30 (118.1px). Variant F: 30/30 (0.3px). Fixed entirely by
  issuing the second-phase jump through a remount instead of an imperative `scrollToItem`.
- **`hit-late-images`**: stock/control 0/30 (1297.7px). Variant F: 30/30 (0.4px). Same mechanism.
- **`hit-prepend`**: stock/control 0/30, `targetMissing` in every run (the row is never located
  at all). Variant F: 30/30 (0.2px). This is the strongest single data point in the audit: the
  fork's own hand-rolled fix does not resolve this scenario (Task 8: 0/30, 3381.7px), but the
  mount-path change resolves it completely on stock, with zero library changes.
- **`page-up`**: stock/control 0/30, `targetMissing` in every run. Variant F: 30/30 (0.2px). Same
  mechanism as `hit-prepend`.

Evidence that this is misuse and not a coincidence of one lucky variant: F is the only
single-variable change in this audit that moved any of the four verdicts, it moved all four
simultaneously, it did so with 0 corrections on every affected scenario (not a marginal
pass-by-threshold — the row lands right the first time), and G confirms adding
`shouldRestorePosition` on top of F changes nothing, so the result isn't fragile to exactly which
predicate is or isn't also supplied.

**No library gap remains as a candidate from this audit.** Every failure this audit set out to
classify closes through public API usage alone.

## Variants that could not be expressed through the public API

None. All seven variants (A-G) were fully expressible as prop and orchestration changes in
`repro/chat.tsx`/`repro/app.tsx`; `src/` was never touched for any measurement in this document.
This is itself informative: the audit did not run into a wall where the public API had no lever
for something we wanted to try.

## Caveats on variant F before treating it as the fix

This document measures only what the harness's oracle measures: DOM presence and pixel offset of
the target row after quiescence. It does not measure two things a real implementation of the
mount-path approach would need to account for:

1. **Visual cost of remounting.** A full LegendList remount discards the previous DOM and
   recycled containers; every row (including ones already on screen and unaffected by the jump)
   re-renders from scratch. In this harness that shows up as `hit-late-images`' image-growth
   timers restarting (`chat.tsx`'s `Row` component keys its growth `useEffect` on `msg.id`, which
   remounts along with everything else) — the scenario still settles within the quiescence cap,
   but a real chat view remounting on every message jump may show a visible flash or momentary
   blank state that this harness's pixel oracle cannot detect.
2. **Scroll momentum / mid-scroll interruption.** The scenarios in this repro always jump from a
   settled state. Whether remounting mid-gesture (e.g., a fast search-result tap while the list is
   still decelerating from a previous scroll) behaves as cleanly is untested here.

Task 9 (or whatever task implements the app-side change) should treat "remount on jump" as the
mechanism this audit recommends measuring further, not as a drop-in fix to ship without
UX verification.

## Recommended changes to the Keybase app's list configuration

The app currently passes `onStartReachedThreshold={2}`, `maintainVisibleContentPosition={{data:
true}}`, `maintainScrollAtEnd={centered ? false : true}`, `dataKey`, `alignItemsAtEnd`,
`initialScrollAtEnd`/`initialScrollIndex`, and issues `scrollToItem({animated:false,
viewPosition:0.5})` from an effect.

- **Change: route jumps to an already-open thread's target message through a remount that
  carries `initialScrollIndex`, instead of the imperative `scrollToItem` effect.** This is the
  one change this audit found that matters. Concretely: key the list (or the component tree that
  wraps it) on something that changes when the jump target changes — a "jump generation" counter,
  or the target message id itself when a jump is in flight — so the list mounts fresh with
  `initialScrollIndex={{index, viewPosition: 0.5}}` set from the first commit, the same way the
  app's "open directly on a hit" cold-start path (`hit-cold`) already works. This closes all four
  scenarios this audit and Task 8 identified as failing, on stock 3.3.7, with no fork changes.
  See the caveats above before shipping this unconditionally — verify the remount doesn't
  introduce a visible flash in the real app.
- **No change: `onStartReachedThreshold`.** Variant B (default `0.5`) was statistically identical
  to control on all nine scenarios. The app's `2` is not implicated in any of these failures and
  does not need to move for this bug; any change to it should be motivated by paging behavior,
  not this bug.
- **No change: `maintainVisibleContentPosition={{data: true}}`.** Confirmed not misuse
  (controller finding, restated: `{data: true}` normalizes identically to bare `true`). Adding
  `shouldRestorePosition` (variant C) is harmless but adds nothing once the mount-path change is
  in place (variant G). Not recommended as a required change; keeping it as-is is fine.
  **Do not conclude from this that `shouldRestorePosition` is the mechanism behind the fork's
  Task 8 improvement on `hit-two-phase`/`hit-late-images`** — C alone left both scenarios failing
  identically to control, so whatever the fork's `scrollTargetSettle` does to fix those two, it
  is not simply "the app should have supplied `shouldRestorePosition`."
- **No change: `dataKey`.** Variant E (dropped) was statistically identical to control. Keep it;
  there is no evidence it is either necessary or harmful for this bug, and D's regression when it
  was dropped in combination with other changes suggests removing it is not free elsewhere.
- **No change: `getItemType`, object-form `initialScrollIndex`, `alignItemsAtEnd`,
  `maintainScrollAtEnd` conditional.** No variant isolated any of these as a cause of the four
  failures; variant D changed several of these together and regressed a previously-passing
  scenario (`hit-warm`, 30/30 -> 10/30), which is evidence to keep the app's current shape here,
  not evidence to imitate the library's example.

## Consequence for the fork

Everything the fork's diff does whose only measured effect is on `hit-two-phase`,
`hit-late-images`, `hit-prepend`, or `page-up` is now a candidate for deletion: this audit shows
stock 3.3.7 gets all four right once the app issues the jump through the mount path instead of
the imperative one. Task 9 should re-run the fork's 8/9 comparison against an app-side mount-path
fix rather than assuming the fork's `scrollTargetSettle` is required — it may turn out the fork
diff was solving a problem that a correct call site does not have.
