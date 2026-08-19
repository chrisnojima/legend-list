import { addTotalSize } from "@/core/addTotalSize";
import { cancelScrollCompletionChecks } from "@/core/cancelImperativeScroll";
import { finishInitialScroll } from "@/core/finishInitialScroll";
import { markImperativeScrollSettling } from "@/core/imperativeScrollSettle";
import { recalculateSettledScroll } from "@/core/recalculateSettledScroll";
import { beginScrollTargetAnchor } from "@/core/scrollTargetAnchor";
import { PlatformAdjustBreaksScroll } from "@/platform/Platform";
import type { StateContext } from "@/state/state";

export function finishScrollTo(ctx: StateContext) {
    const state = ctx.state;
    if (state?.scrollingTo) {
        cancelScrollCompletionChecks(state);
        const resolvePendingScroll = state.pendingScrollResolve;
        state.pendingScrollResolve = undefined;

        // Save scrollingTo before clearing it so we can pass it to commitPendingAdjust
        const scrollingTo = state.scrollingTo;

        state.scrollHistory.length = 0;
        // The scroller still has this scroll's own landing event to deliver.
        markImperativeScrollSettling(state);
        state.scrollingTo = undefined;
        state.scrollTargetPinnedRange = undefined;
        // The rows above the target are still measuring in, so keep MVCP anchored on it rather than
        // handing the position straight back to the ordinary visible anchor.
        beginScrollTargetAnchor(ctx, scrollingTo);

        if (state.pendingTotalSize !== undefined) {
            addTotalSize(ctx, null, state.pendingTotalSize);
        }

        if (PlatformAdjustBreaksScroll) {
            state.scrollAdjustHandler.commitPendingAdjust(scrollingTo);
        }

        if (scrollingTo.isInitialScroll || state.initialScroll) {
            const isOffsetSession = state.initialScrollSession?.kind === "offset";
            const shouldPreserveResizeTarget =
                !!scrollingTo.isInitialScroll &&
                !state.clearPreservedInitialScrollOnNextFinish &&
                state.props.data.length > 0 &&
                state.initialScroll?.viewPosition === 1;
            finishInitialScroll(ctx, {
                onFinished: () => {
                    resolvePendingScroll?.();
                },
                preserveTarget: (isOffsetSession && state.props.data.length === 0) || shouldPreserveResizeTarget,
                recalculateItems: true,
                schedulePreservedTargetClear: shouldPreserveResizeTarget,
                syncObservedOffset: isOffsetSession,
                waitForCompletionFrame: !!scrollingTo.waitForInitialScrollCompletionFrame,
            });
            return;
        }

        recalculateSettledScroll(ctx);
        resolvePendingScroll?.();
    }
}
