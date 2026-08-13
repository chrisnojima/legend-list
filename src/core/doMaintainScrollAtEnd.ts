import { EDGE_POSITION_EPSILON } from "@/constants";
import { clearScrollTargetSettle } from "@/core/scrollTargetSettle";
import { getContentSize } from "@/state/getContentSize";
import { peek$, type StateContext } from "@/state/state";
import { getLogicalHorizontalMaxOffset, isHorizontalRTL, toNativeHorizontalOffset } from "@/utils/rtl";

export function doMaintainScrollAtEnd(ctx: StateContext) {
    const state = ctx.state;
    const {
        didContainersLayout,
        pendingNativeMVCPAdjust,
        refScroller,
        props: { maintainScrollAtEnd },
    } = state;
    const isWithinMaintainScrollAtEndThreshold = peek$(ctx, "isWithinMaintainScrollAtEndThreshold");
    const shouldMaintainScrollAtEnd = !!(
        isWithinMaintainScrollAtEndThreshold &&
        maintainScrollAtEnd &&
        didContainersLayout
    );

    // Native MVCP can still be finishing its own clamp after data changes. Defer the end-anchor scroll
    // until that settles so maintainScrollAtEnd does not fight the platform's pending adjustment.
    if (pendingNativeMVCPAdjust) {
        state.pendingMaintainScrollAtEnd = shouldMaintainScrollAtEnd;
        return false;
    }

    // Run this only if scroll is at the bottom and after initial layout
    if (shouldMaintainScrollAtEnd) {
        state.pendingMaintainScrollAtEnd = false;
        // Set scroll to the bottom of the list so that checkAtTop/checkAtBottom is correct
        const contentSize = getContentSize(ctx);
        if (contentSize < state.scrollLength) {
            // If content fits within the viewport, we should be at scroll 0.
            state.scroll = 0;
        }

        if (!state.maintainingScrollAtEnd) {
            const pendingState = maintainScrollAtEnd.animated ? "pending-animated" : "pending-instant";
            const activeState = maintainScrollAtEnd.animated ? "animated" : "instant";
            const scrollAtRequest = state.scroll;
            state.maintainingScrollAtEnd = pendingState;
            // Released as the anchor is requested, not when it scrolls: this drives the scroller
            // directly rather than going through scrollTo, and a settle correction scheduled in the
            // same tick could otherwise run first and move the scroll out from under the check
            // below. The end anchor outranks a settling target.
            clearScrollTargetSettle(state);

            requestAnimationFrame(() => {
                const isStillWithinThreshold = peek$(ctx, "isWithinMaintainScrollAtEndThreshold");
                // A scroll the list issued is still settling a frame later, and on web it can be
                // re-issued against a larger extent, so the position a request read when it was made
                // is not the position it finds here - four frames of a thread opening moved through
                // 6104, 5930, 6020 and 6005 without the reader touching anything. Drift onto the
                // offset the platform was last told to go to is that settling; drift anywhere else is
                // the reader taking hold, and only that gives up the end.
                const lastIssued = state.lastIssuedScrollOffset;
                const isSettlingOntoIssuedScroll =
                    lastIssued !== undefined && Math.abs(state.scroll - lastIssued) <= EDGE_POSITION_EPSILON;
                const didScrollSinceRequest = state.scroll !== scrollAtRequest && !isSettlingOntoIssuedScroll;

                // Layout and content changes can move the end beyond the threshold while this request is pending.
                // Keep the original end anchor unless the scroll position changed in the meantime.
                if (isStillWithinThreshold || !didScrollSinceRequest) {
                    state.maintainingScrollAtEnd = activeState;

                    const scroller = refScroller.current;
                    if (state.props.horizontal && isHorizontalRTL(state)) {
                        const currentContentSize = getContentSize(ctx);
                        const logicalEndOffset = getLogicalHorizontalMaxOffset(state, currentContentSize);
                        const nativeOffset = toNativeHorizontalOffset(state, logicalEndOffset, currentContentSize);
                        scroller?.scrollTo({
                            animated: maintainScrollAtEnd.animated,
                            x: nativeOffset,
                            y: 0,
                        });
                    } else {
                        scroller?.scrollToEnd({
                            animated: maintainScrollAtEnd.animated,
                        });
                    }
                    setTimeout(
                        () => {
                            if (state.maintainingScrollAtEnd === activeState) {
                                state.maintainingScrollAtEnd = undefined;
                                if (state.pendingMaintainScrollAtEnd) {
                                    doMaintainScrollAtEnd(ctx);
                                }
                            }
                        },
                        maintainScrollAtEnd.animated ? 500 : 0,
                    );
                } else if (state.maintainingScrollAtEnd === pendingState) {
                    state.maintainingScrollAtEnd = undefined;
                    state.pendingMaintainScrollAtEnd = false;
                }
            });
        } else {
            // Coalesce follow-up requests while the current maintain pass is still settling.
            state.pendingMaintainScrollAtEnd = true;
        }

        return true;
    }

    state.pendingMaintainScrollAtEnd = false;
    return false;
}
