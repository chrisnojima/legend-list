import { calculateOffsetWithOffsetPosition } from "@/core/calculateOffsetWithOffsetPosition";
import { clampScrollOffset } from "@/core/clampScrollOffset";
import type { StateContext } from "@/state/state";
import { getId } from "@/utils/getId";
import { requestAdjust } from "@/utils/requestAdjust";

// A scroll to an index with a viewPosition asks for a position relative to the viewport, but the
// offset that satisfies it is only as good as the sizes known when the request was made. Rows above
// the target are usually still estimates at that point, so the list lands somewhere near the target
// and then drifts as those rows measure in, or as a data change moves the target. Keep the request
// alive across that settle: recompute the offset from current positions on every pass until the
// target holds still.
const SETTLE_POSITION_EPSILON = 0.5;
const SETTLE_QUIET_PASSES_TO_RELEASE = 2;
// Refreshed on every correction, so the anchor lives as long as content keeps moving under it and
// releases shortly after it goes quiet.
const SETTLE_TTL_MS = 500;

type ScrollTargetSettle = NonNullable<StateContext["state"]["scrollTargetSettle"]>;

function getSettleTargetOffset(ctx: StateContext, settle: ScrollTargetSettle, index: number, position: number) {
    const params = { index, viewOffset: settle.viewOffset, viewPosition: settle.viewPosition };
    return clampScrollOffset(ctx, calculateOffsetWithOffsetPosition(ctx, position, params), params);
}

export function clearScrollTargetSettle(state: StateContext["state"]) {
    state.scrollTargetSettle = undefined;
}

export function beginScrollTargetSettle(
    ctx: StateContext,
    params: { index: number; viewOffset: number; viewPosition: number },
) {
    const state = ctx.state;
    const { index, viewOffset, viewPosition } = params;
    const { data } = state.props;

    // scrollToEnd-style targets already recompute their offset while scrolling and are owned by
    // maintainScrollAtEnd afterwards.
    const isEndAlignedLastItem = index === data.length - 1 && viewPosition === 1;
    if (index < 0 || index >= data.length || isEndAlignedLastItem) {
        clearScrollTargetSettle(state);
        return;
    }

    // Anchor by item key, not index, so the target survives prepends.
    state.scrollTargetSettle = {
        expiresAt: Date.now() + SETTLE_TTL_MS,
        id: getId(state, index),
        quietPasses: 0,
        viewOffset,
        viewPosition,
    };
}

// Returns true if the scroll offset was corrected, so callers can refresh anything derived from it.
export function settleScrollTarget(ctx: StateContext) {
    const state = ctx.state;
    const settle = state.scrollTargetSettle;
    if (!settle) {
        return false;
    }

    const index = state.indexByKey.get(settle.id);
    const position = index === undefined ? undefined : state.positions[index];
    // The target left the dataset, or its position is not resolved yet: nothing to hold on to.
    if (index === undefined || position === undefined) {
        clearScrollTargetSettle(state);
        return false;
    }

    const now = Date.now();
    if (now > settle.expiresAt) {
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

    settle.quietPasses = 0;
    settle.expiresAt = now + SETTLE_TTL_MS;

    // A scroll still in flight completes against the offset the target needs now, not the one it
    // needed when the request was made.
    if (state.scrollingTo?.index === index) {
        state.scrollingTo.offset = position;
        state.scrollingTo.targetOffset = targetOffset;
    }

    requestAdjust(ctx, diff);

    return true;
}
