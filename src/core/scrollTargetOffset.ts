import { calculateOffsetForIndex } from "@/core/calculateOffsetForIndex";
import { calculateOffsetWithOffsetPosition } from "@/core/calculateOffsetWithOffsetPosition";
import { clampScrollOffset } from "@/core/clampScrollOffset";
import type { StateContext } from "@/state/state";
import type { ScrollTarget } from "@/types.internal";

export function isEndAlignedLastItemTarget(ctx: StateContext, target: ScrollTarget) {
    return target.index === ctx.state.props.data.length - 1 && target.viewPosition === 1;
}

// A target requested by index moves with its item. Indices shift on a prepend, so prefer the key the
// request was made with and only fall back to the requested index when the key is gone.
export function resolveScrollTargetIndex(ctx: StateContext, target: ScrollTarget) {
    const { key } = target;
    if (key !== undefined) {
        const indexForKey = ctx.state.indexByKey.get(key);
        if (indexForKey !== undefined) {
            return indexForKey;
        }
    }
    return target.index;
}

// An index target asks for a position relative to an item, not for an absolute offset. The offset
// that satisfies it is only as good as the sizes known when the request was made, so re-derive it
// from current positions whenever the item's position is resolved. Offset targets, and index targets
// whose position is still unknown, keep the offset the request was made with.
export function getScrollTargetOffset(ctx: StateContext, target: ScrollTarget) {
    const index = resolveScrollTargetIndex(ctx, target);
    const canRederive =
        index !== undefined &&
        (ctx.state.positions[index] !== undefined || isEndAlignedLastItemTarget(ctx, { ...target, index }));

    const requestedTargetOffset =
        canRederive && index !== undefined
            ? calculateOffsetWithOffsetPosition(ctx, calculateOffsetForIndex(ctx, index), { ...target, index })
            : (target.targetOffset ?? clampScrollOffset(ctx, target.offset - (target.viewOffset || 0), target));

    return clampScrollOffset(ctx, requestedTargetOffset, target);
}
