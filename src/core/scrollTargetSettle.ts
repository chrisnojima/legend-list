import { calculateOffsetWithOffsetPosition } from "@/core/calculateOffsetWithOffsetPosition";
import { clampScrollOffset } from "@/core/clampScrollOffset";
import { scrollTo } from "@/core/scrollTo";
import type { StateContext } from "@/state/state";
import type { InternalState } from "@/types.internal";
import { getId } from "@/utils/getId";
import { getItemSizeAtIndex } from "@/utils/getItemSize";

// Below this the target reads as settled; chasing the remainder only fights MVCP's own sub-pixel
// adjustments.
const SETTLE_POSITION_EPSILON = 0.5;
// Two quiet passes rather than one: a single pass can be quiet simply because no sizes changed in
// it, while more measurements are still queued behind it.
const SETTLE_QUIET_PASSES_TO_RELEASE = 2;
// Backstop for a target whose measurements never converge, so a settle cannot outlive the scroll
// that started it by more than a moment. Refreshed on every correction.
const SETTLE_TTL_MS = 500;
// Hard deadline measured from the scroll that opened the settle. Unlike the TTL this is never
// extended, so re-aiming can never keep itself alive indefinitely.
const SETTLE_MAX_MS = 1000;
// Belt and braces alongside the deadline: however a platform responds to the re-aiming scroll, a
// settle can only issue this many corrections before it gives up.
const SETTLE_MAX_CORRECTIONS = 8;

export interface ScrollTargetSettleParams {
    index: number;
    viewOffset: number;
    viewPosition: number;
}

export function clearScrollTargetSettle(state: InternalState) {
    state.scrollTargetSettle = undefined;
}

/**
 * Start holding a scroll target in place while item measurements arrive.
 *
 * `scrollToIndex` resolves its offset from the positions known at the time, which for unmeasured
 * items are estimates. As those items lay out at their real sizes the target moves, so the offset
 * the scroll landed on is no longer the offset that satisfies the request. The initial scroll
 * already re-resolves itself this way (see `advanceMeasuredInitialScroll`); this does the same for
 * imperative scrolls.
 *
 * Tracked by item id rather than index so a prepend, which shifts every index, does not silently
 * re-aim at a different item.
 */
export function beginScrollTargetSettle(ctx: StateContext, params: ScrollTargetSettleParams) {
    const state = ctx.state;
    const { index, viewOffset, viewPosition } = params;
    const { data } = state.props;

    // The last item aligned to the end is maintainScrollAtEnd's job, and correcting it here would
    // fight the end-anchoring adjustments it makes.
    const isEndAlignedLastItem = index === data.length - 1 && viewPosition === 1;
    if (index < 0 || index >= data.length || isEndAlignedLastItem) {
        clearScrollTargetSettle(state);
        return;
    }

    const now = Date.now();
    const id = getId(state, index);
    // Re-aiming dispatches a real scroll, which lands back here; keep the original deadline so a
    // target that never converges still stops on time.
    const existing = state.scrollTargetSettle;
    const isSameTarget = existing?.id === id;

    state.scrollTargetSettle = {
        corrections: isSameTarget ? existing.corrections : 0,
        deadline: isSameTarget ? existing.deadline : now + SETTLE_MAX_MS,
        expiresAt: now + SETTLE_TTL_MS,
        id,
        quietPasses: 0,
        viewOffset,
        viewPosition,
    };
}

function getSettleTargetOffset(
    ctx: StateContext,
    settle: NonNullable<InternalState["scrollTargetSettle"]>,
    index: number,
    position: number,
) {
    const params = { index, viewOffset: settle.viewOffset, viewPosition: settle.viewPosition };
    return clampScrollOffset(ctx, calculateOffsetWithOffsetPosition(ctx, position, params), params);
}

/**
 * Re-aim at the active settle target, if it has moved. Returns whether the scroll was corrected.
 *
 * `isCompensating` marks a pass in which another controller has already moved the scroll for this
 * layout - maintainVisibleContentPosition applying an adjustment, or an adjustment still queued for
 * the platform. Neither is reflected in `state.scroll` yet, so the error measured here would double
 * count it: correcting on top of it overshoots, the other controller pulls back, and the two trade
 * corrections every pass. Waiting for a pass that nobody else is adjusting keeps one controller on
 * the scroll position at a time.
 */
export function settleScrollTarget(ctx: StateContext, isCompensating?: boolean) {
    const state = ctx.state;
    const settle = state.scrollTargetSettle;
    if (!settle) {
        return false;
    }

    if (isCompensating) {
        // Not settled, just not measurable this pass: hold the target open without counting a quiet
        // pass so the correction happens once the position stops moving underneath it.
        settle.quietPasses = 0;
        settle.expiresAt = Date.now() + SETTLE_TTL_MS;
        return false;
    }

    const index = state.indexByKey.get(settle.id);
    const position = index === undefined ? undefined : state.positions[index];
    if (index === undefined || position === undefined) {
        // The target left the data, so there is nothing left to hold on to.
        clearScrollTargetSettle(state);
        return false;
    }

    const now = Date.now();
    if (now > settle.expiresAt || now > settle.deadline) {
        clearScrollTargetSettle(state);
        return false;
    }

    const targetOffset = getSettleTargetOffset(ctx, settle, index, position);
    const diff = targetOffset - state.scroll;
    if (Math.abs(diff) <= SETTLE_POSITION_EPSILON) {
        settle.quietPasses++;
        if (settle.quietPasses >= SETTLE_QUIET_PASSES_TO_RELEASE) {
            clearScrollTargetSettle(state);
        }
        return false;
    }

    if (settle.corrections >= SETTLE_MAX_CORRECTIONS) {
        clearScrollTargetSettle(state);
        return false;
    }

    settle.quietPasses = 0;
    settle.corrections++;
    settle.expiresAt = now + SETTLE_TTL_MS;

    // Re-aim with a real scroll rather than a scroll adjustment. An adjustment translates the
    // content without moving the scroll position, which on platforms that apply it directly leaves
    // the measured error unchanged - the same correction would then be requested on every pass.
    // This mirrors how the initial scroll re-resolves itself through dispatchInitialScroll.
    scrollTo(ctx, {
        animated: false,
        index,
        itemSize: getItemSizeAtIndex(ctx, index),
        offset: position,
        viewOffset: settle.viewOffset,
        viewPosition: settle.viewPosition,
    });
    return true;
}
