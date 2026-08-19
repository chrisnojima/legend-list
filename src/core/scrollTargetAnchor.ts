import type { StateContext } from "@/state/state";
import type { ScrollTarget } from "@/types.internal";
import { getId } from "@/utils/getId";

// MVCP already keeps a scroll to an index steady while it is in flight, by anchoring on the target
// item's key and compensating for however far that item moves as the rows above it measure in. That
// anchor is gated on state.scrollingTo, so it is dropped the moment the scroll completes - which is
// where most of the measurement still lands, because the offset the request resolved to was derived
// from the estimates it could see. Everything below then slides out from under the target and the
// list hands itself back to the ordinary visible anchor, which has no opinion about the target.
//
// This holds the same anchor for a bounded window past completion. It is the target anchor, not a
// new mechanism: it only chooses which key MVCP anchors on, and MVCP still does the compensating.
const ANCHOR_QUIET_MS = 300;
// Never refreshed, unlike the quiet window. This is the hard bound on how long the anchor can live.
const ANCHOR_MAX_LIFETIME_MS = 1500;
const ANCHOR_QUIET_PASSES_TO_RELEASE = 2;
const ANCHOR_MAX_CORRECTIONS = 20;
const ANCHOR_POSITION_EPSILON = 0.1;

type InternalState = StateContext["state"];
export type ScrollTargetAnchor = NonNullable<InternalState["scrollTargetAnchor"]>;

export function clearScrollTargetAnchor(state: InternalState) {
    state.scrollTargetAnchor = undefined;
}

// Called as a scroll to an index finishes, so the anchor it was already using survives into the
// measurement that follows it.
export function beginScrollTargetAnchor(ctx: StateContext, scrollTarget: ScrollTarget) {
    const state = ctx.state;
    const { index, isInitialScroll, itemSize, viewPosition } = scrollTarget;

    if (index === undefined || viewPosition === undefined || isInitialScroll) {
        clearScrollTargetAnchor(state);
        return;
    }

    // The anchor is MVCP's, so it is only meaningful when MVCP anchors sizes at all.
    if (!state.props.maintainVisibleContentPosition.size) {
        clearScrollTargetAnchor(state);
        return;
    }

    const id = scrollTarget.key ?? (index >= 0 && index < state.props.data.length ? getId(state, index) : undefined);
    if (id === undefined || state.indexByKey.get(id) === undefined) {
        clearScrollTargetAnchor(state);
        return;
    }

    const now = Date.now();
    state.scrollTargetAnchor = {
        corrections: 0,
        expiresAt: now + ANCHOR_QUIET_MS,
        id,
        itemSize,
        maxExpiresAt: now + ANCHOR_MAX_LIFETIME_MS,
        quietPasses: 0,
        viewPosition,
    };
}

// Reads the anchor for this pass, dropping it once it is spent. Returns undefined while a scroll is
// in flight: that scroll owns the position and already carries its own target anchor, so this can
// never turn into a correction against a running scroll.
export function resolveScrollTargetAnchor(ctx: StateContext, now: number) {
    const state = ctx.state;
    const anchor = state.scrollTargetAnchor;
    if (!anchor) {
        return undefined;
    }

    if (state.scrollingTo) {
        return undefined;
    }

    if (
        now > anchor.expiresAt ||
        now > anchor.maxExpiresAt ||
        anchor.corrections >= ANCHOR_MAX_CORRECTIONS ||
        !state.props.maintainVisibleContentPosition.size ||
        state.indexByKey.get(anchor.id) === undefined
    ) {
        clearScrollTargetAnchor(state);
        return undefined;
    }

    return anchor;
}

// Releases the anchor once the target has held still, or once it has moved as many times as it is
// allowed to. The quiet window is refreshed while the target keeps moving; the lifetime is not.
export function settleScrollTargetAnchor(state: InternalState, anchor: ScrollTargetAnchor, positionDiff: number) {
    if (Math.abs(positionDiff) <= ANCHOR_POSITION_EPSILON) {
        anchor.quietPasses++;
        if (anchor.quietPasses >= ANCHOR_QUIET_PASSES_TO_RELEASE) {
            clearScrollTargetAnchor(state);
        }
        return;
    }

    anchor.quietPasses = 0;
    anchor.corrections++;
    anchor.expiresAt = Date.now() + ANCHOR_QUIET_MS;

    if (anchor.corrections >= ANCHOR_MAX_CORRECTIONS) {
        clearScrollTargetAnchor(state);
    }
}
