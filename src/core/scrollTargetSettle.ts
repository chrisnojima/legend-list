import { calculateOffsetWithOffsetPosition } from "@/core/calculateOffsetWithOffsetPosition";
import { clampScrollOffset } from "@/core/clampScrollOffset";
import { scrollTo } from "@/core/scrollTo";
import type { StateContext } from "@/state/state";
import type { InternalState } from "@/types.internal";
import { getId } from "@/utils/getId";
import { getItemSizeAtIndex } from "@/utils/getItemSize";

// Below this the target reads as settled; chasing the remainder only fights MVCP's own sub-pixel
// adjustments. A whole pixel, matching what the rest of the list treats as arrived.
export const SETTLE_POSITION_EPSILON = 1;
// Two settled passes rather than one before letting go. A single settled pass can be sub-pixel
// residue from MVCP's own adjustments, with a real move still to come; releasing on it drops the
// target while the list is still working towards it.
export const SETTLE_QUIET_PASSES_TO_RELEASE = 2;
// Hard deadline measured from the scroll that opened the settle. Never extended, so re-aiming
// cannot keep a target alive indefinitely.
export const SETTLE_MAX_MS = 1000;
// Belt and braces alongside the deadline: however a platform responds to the re-aiming scroll, a
// settle can only issue this many corrections before it gives up.
export const SETTLE_MAX_CORRECTIONS = 8;

export interface ScrollTargetSettleParams {
    index: number;
    viewOffset: number;
    viewPosition: number;
}

export function clearScrollTargetSettle(state: InternalState) {
    state.scrollTargetSettle = undefined;
    state.scheduledWork.cancel("scrollTargetSettle");
    state.scheduledWork.cancel("scrollTargetSettleDeadline");
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
    const { alignItemsAtEnd, data, maintainScrollAtEnd } = state.props;

    // The last item aligned to the end is the end-anchoring controllers' territory, and correcting
    // it here would fight the adjustments they make. Only when one of them is actually running,
    // though: scrollToIndex quietly aligns the last item to the end when the caller named no
    // position at all, and refusing on that alone means a plain jump to the last item - the most
    // ordinary request there is - never gets held while the rows above it measure.
    const hasEndAnchoring = !!maintainScrollAtEnd || !!alignItemsAtEnd;
    const isEndAlignedLastItem = index === data.length - 1 && viewPosition === 1;
    if (index < 0 || index >= data.length || (isEndAlignedLastItem && hasEndAnchoring)) {
        clearScrollTargetSettle(state);
        return;
    }

    // A correction queued by the request this replaces would otherwise fire against the new
    // target, spending its budget on an aim nothing measured.
    clearScrollTargetSettle(state);

    const now = Date.now();
    // Only a new imperative scroll reaches here - corrections re-aim without re-arming - so every
    // call is a fresh request and gets a fresh budget.
    state.scrollTargetSettle = {
        corrections: 0,
        deadline: now + SETTLE_MAX_MS,
        id: getId(state, index),
        measuredIndex: undefined,
        quietPasses: 0,
        viewOffset,
        viewPosition,
    };
    // Bound by a timer as well as by the layout passes that read it, so a target cannot outlive its
    // deadline just because the list went idle.
    state.scheduledWork.timeout(() => clearScrollTargetSettle(state), SETTLE_MAX_MS, "scrollTargetSettleDeadline");
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
 * Re-aim with a real scroll rather than a scroll adjustment. An adjustment translates the content
 * without moving the scroll position, which on platforms that apply it directly leaves the measured
 * error unchanged, so the same correction would be requested on every pass. This mirrors how the
 * initial scroll re-resolves itself through dispatchInitialScroll.
 */
function applyScrollTargetCorrection(ctx: StateContext, id: string) {
    const state = ctx.state;
    const settle = state.scrollTargetSettle;
    // Anything that released or replaced the target between the layout pass and this frame wins.
    if (!settle || settle.id !== id) {
        return;
    }

    const index = state.indexByKey.get(id);
    const position = index === undefined ? undefined : state.positions[index];
    if (index === undefined || position === undefined || Date.now() > settle.deadline) {
        clearScrollTargetSettle(state);
        return;
    }

    // Counted here rather than where the correction is queued: layout runs many passes per frame
    // while items measure, and they all coalesce onto the single queued correction below.
    if (settle.corrections >= SETTLE_MAX_CORRECTIONS) {
        clearScrollTargetSettle(state);
        return;
    }
    settle.corrections++;
    settle.measuredIndex = undefined;

    scrollTo(ctx, {
        animated: false,
        index,
        itemSize: getItemSizeAtIndex(ctx, index),
        // Correcting where a scroll already landed is not a new imperative scroll: claiming the
        // session would suppress the list's own handling of subsequent scroll events and re-arm
        // this settle from inside its own correction.
        noScrollingTo: true,
        offset: position,
        viewOffset: settle.viewOffset,
        viewPosition: settle.viewPosition,
    });
    // If the scroll being corrected is still waiting to complete, it is now waiting on a different
    // offset. Leaving it aimed at where the correction moved away from means completion can never
    // recognise it as arrived, and the scroll's promise falls back to a timer instead.
    // Any pending scroll here is this settle's own: a settle is only ever armed by scrollTo, in the
    // same block that assigns scrollingTo, and every path that replaces one replaces the other.
    // Deliberately not matched by comparing `scrollingTo.index` to the target's index now - a
    // prepend shifts every index and only one of those two numbers moves with it, so that
    // comparison fails in exactly the case tracking the target by id exists for.
    const scrollingTo = state.scrollingTo;
    if (scrollingTo) {
        // The scroll above resolved and clamped this same target into scrollPending; recomputing it
        // here would be the same arithmetic against the same positions.
        scrollingTo.targetOffset = state.scrollPending;
        scrollingTo.offset = position;
    }

    // That path skips the recalculation a claimed scroll would have done, so drive it here: a
    // correction can move the viewport a long way, and waiting for the platform to echo before
    // deciding what to render leaves a blank frame.
    state.triggerCalculateItemsInView?.();
}

/**
 * Re-aim at the active settle target, if it has moved. Returns whether a correction was queued.
 *
 * `isCompensating` marks a pass in which another controller has already moved the scroll for this
 * layout - maintainVisibleContentPosition applying an adjustment, or an adjustment still queued for
 * the platform. Neither is reflected in `state.scroll` yet, so the error measured here would double
 * count it: correcting on top of it overshoots, the other controller pulls back, and the two trade
 * corrections every pass. Waiting for a pass that nobody else is adjusting keeps one controller on
 * the scroll position at a time.
 */
export function settleScrollTarget(
    ctx: StateContext,
    options?: { isCompensating?: boolean; minIndexSizeChanged?: number },
) {
    const state = ctx.state;
    const settle = state.scrollTargetSettle;
    if (!settle) {
        return false;
    }

    // Remember what measured until it has been acted on. A pass that stands down still saw the
    // measurement, and clearing it there would drop the only signal that the target moved: the
    // value itself lives for one pass, and the passes that carry it are often the ones another
    // controller is compensating on.
    const measured = options?.minIndexSizeChanged;
    if (measured !== undefined) {
        settle.measuredIndex = Math.min(settle.measuredIndex ?? Number.POSITIVE_INFINITY, measured);
    }

    if (options?.isCompensating) {
        // Not settled, just not measurable this pass: hold the target so the correction happens once
        // the position stops moving underneath it. Still bound by the deadline, so a permanently
        // compensating controller cannot hold it forever.
        if (Date.now() > settle.deadline) {
            clearScrollTargetSettle(state);
            return false;
        }
        settle.quietPasses = 0;
        return false;
    }

    const index = state.indexByKey.get(settle.id);
    const position = index === undefined ? undefined : state.positions[index];
    if (index === undefined || position === undefined) {
        // The target left the data, so there is nothing left to hold on to.
        clearScrollTargetSettle(state);
        return false;
    }

    if (Date.now() > settle.deadline) {
        clearScrollTargetSettle(state);
        return false;
    }

    // Only a measurement at or above the target can have moved it.
    if (settle.measuredIndex === undefined || settle.measuredIndex > index) {
        return false;
    }

    const targetOffset = getSettleTargetOffset(ctx, settle, index, position);
    if (Math.abs(targetOffset - state.scroll) <= SETTLE_POSITION_EPSILON) {
        // The measurement has been accounted for: the target is where it was asked to be.
        settle.measuredIndex = undefined;
        settle.quietPasses++;
        if (settle.quietPasses >= SETTLE_QUIET_PASSES_TO_RELEASE) {
            clearScrollTargetSettle(state);
        }
        return false;
    }

    settle.quietPasses = 0;

    // Correct on the next frame rather than from inside this layout pass. Scrolling re-enters
    // calculateItemsInView, and doing that from its middle leaves the outer pass finishing against
    // state the nested one has already rewritten.
    state.scheduledWork.frame(() => applyScrollTargetCorrection(ctx, settle.id), "scrollTargetSettle");
    return true;
}
