import { clampScrollOffset } from "@/core/clampScrollOffset";
import { finishScrollTo } from "@/core/finishScrollTo";
import { initialScrollCompletion, initialScrollWatchdog } from "@/core/initialScrollSession";
import { getScrollTargetOffset, isEndAlignedLastItemTarget } from "@/core/scrollTargetOffset";
import { Platform } from "@/platform/Platform";
import { getContentSize } from "@/state/getContentSize";
import type { StateContext } from "@/state/state";

type ActiveScrollTarget = NonNullable<StateContext["state"]["scrollingTo"]>;
const INITIAL_SCROLL_MAX_FALLBACK_CHECKS = 20;
const INITIAL_SCROLL_COMPLETION_TARGET_EPSILON = 1;
const INITIAL_SCROLL_ZERO_TARGET_EPSILON = 1;
const SILENT_INITIAL_SCROLL_RETRY_DELAY_MS = 16;
const SILENT_INITIAL_SCROLL_TARGET_EPSILON = 1;

export function checkFinishedScroll(ctx: StateContext, options?: { onlyIfAligned?: boolean }) {
    const scrollingTo = ctx.state.scrollingTo;
    if (options?.onlyIfAligned) {
        if (!scrollingTo?.isInitialScroll || scrollingTo.animated) {
            return;
        }

        if (!getResolvedScrollCompletionState(ctx, scrollingTo).isAtResolvedTarget) {
            return;
        }
    }

    // Wait a frame because there may be some requestAdjust after this which
    // change things so it would need to wait longer
    ctx.state.scheduledWork.frame(() => checkFinishedScrollFrame(ctx), "checkFinishedScrollFrame");
}

function hasScrollCompletionOwnership(
    state: StateContext["state"],
    options: { clampedTargetOffset: number; scrollingTo: ActiveScrollTarget },
) {
    const { clampedTargetOffset, scrollingTo } = options;
    return (
        !scrollingTo.isInitialScroll ||
        state.hasScrolled ||
        clampedTargetOffset <= INITIAL_SCROLL_COMPLETION_TARGET_EPSILON
    );
}

function isSilentInitialDispatch(state: StateContext["state"], scrollingTo: ActiveScrollTarget | undefined) {
    return (
        !!scrollingTo?.isInitialScroll && initialScrollCompletion.didDispatchNativeScroll(state) && !state.hasScrolled
    );
}

function getInitialScrollWatchdogTargetOffset(state: StateContext["state"]) {
    return initialScrollWatchdog.get(state)?.targetOffset;
}

function isNativeInitialNonZeroTarget(state: StateContext["state"]) {
    const targetOffset = getInitialScrollWatchdogTargetOffset(state);
    return !state.didFinishInitialScroll && initialScrollWatchdog.hasNonZeroTargetOffset(targetOffset);
}

function shouldFinishInitialScrollWithoutNativeProgress(state: StateContext["state"], scrollingTo: ActiveScrollTarget) {
    if (!scrollingTo.isInitialScroll || scrollingTo.animated || !state.didContainersLayout) {
        return false;
    }

    if (state.initialScrollSession?.kind === "bootstrap") {
        return false;
    }

    const targetOffset = scrollingTo.targetOffset ?? scrollingTo.offset;
    if (
        initialScrollWatchdog.hasNonZeroTargetOffset(targetOffset) &&
        initialScrollCompletion.didDispatchNativeScroll(state) &&
        !state.hasScrolled
    ) {
        return false;
    }

    if (
        initialScrollWatchdog.isAtZeroTargetOffset(targetOffset) ||
        Math.abs(state.scroll - targetOffset) > 1 ||
        Math.abs(state.scrollPending - targetOffset) > 1
    ) {
        return false;
    }

    return !!scrollingTo.waitForInitialScrollCompletionFrame || isNativeInitialNonZeroTarget(state);
}

function shouldFinishInitialZeroTargetScroll(ctx: StateContext) {
    const { state } = ctx;
    return (
        !!state.scrollingTo?.isInitialScroll &&
        state.props.data.length > 0 &&
        getContentSize(ctx) <= state.scrollLength &&
        state.scrollPending <= INITIAL_SCROLL_ZERO_TARGET_EPSILON
    );
}

// True when the list is sitting where the request last aimed it, so the only thing left between it
// and its target is that the target moved.
function didReachRequestedScrollOffset(ctx: StateContext, scrollingTo: ActiveScrollTarget) {
    const requestedOffset = clampScrollOffset(
        ctx,
        scrollingTo.targetOffset ?? scrollingTo.offset - (scrollingTo.viewOffset || 0),
        scrollingTo,
    );
    return Math.abs(ctx.state.scrollPending - requestedOffset) < 1;
}

function getResolvedScrollCompletionState(ctx: StateContext, scrollingTo: ActiveScrollTarget) {
    const { state } = ctx;
    const scroll = state.scrollPending;
    const adjust = state.scrollAdjustHandler.getAdjust();
    const clampedTargetOffset = getScrollTargetOffset(ctx, scrollingTo);
    const maxOffset = clampScrollOffset(ctx, scroll, scrollingTo);
    const diff1 = Math.abs(scroll - clampedTargetOffset);
    const adjustedTargetOffset = clampedTargetOffset + adjust;
    const diff2 = Math.abs(scroll - adjustedTargetOffset);
    const canUseAdjustedCompletion = !scrollingTo.animated || Platform.OS === "ios";

    return {
        clampedTargetOffset,
        isAtResolvedTarget: Math.abs(scroll - maxOffset) < 1 && (diff1 < 1 || (canUseAdjustedCompletion && diff2 < 1)),
    };
}

function checkFinishedScrollFrame(ctx: StateContext) {
    const scrollingTo = ctx.state.scrollingTo;
    if (!scrollingTo) {
        return;
    }

    const { state } = ctx;
    const completionState = getResolvedScrollCompletionState(ctx, scrollingTo);
    if (
        completionState.isAtResolvedTarget &&
        hasScrollCompletionOwnership(state, {
            clampedTargetOffset: completionState.clampedTargetOffset,
            scrollingTo,
        })
    ) {
        finishScrollTo(ctx);
    }
}

function scrollToFallbackOffset(ctx: StateContext, offset: number) {
    ctx.state.refScroller.current?.scrollTo({
        animated: false,
        x: ctx.state.props.horizontal ? offset : 0,
        y: ctx.state.props.horizontal ? 0 : offset,
    });
}

// In case checkFinishedScroll does not work correctly, set a maximum timeout
// to make sure it does eventually get cleared, just waiting for scroll to end
export function checkFinishedScrollFallback(ctx: StateContext) {
    const state = ctx.state;
    if (state.scheduledWork.has("checkFinishedScrollFallback")) {
        return;
    }

    const scrollingTo = state.scrollingTo;
    const shouldFinishInitialZeroTarget = shouldFinishInitialZeroTargetScroll(ctx);
    const silentInitialDispatch = isSilentInitialDispatch(state, scrollingTo);
    const canFinishInitialWithoutNativeProgress =
        scrollingTo !== undefined ? shouldFinishInitialScrollWithoutNativeProgress(state, scrollingTo) : false;
    const slowTimeout =
        (scrollingTo?.isInitialScroll && !shouldFinishInitialZeroTarget && !canFinishInitialWithoutNativeProgress) ||
        !state.didContainersLayout;
    const initialDelay =
        shouldFinishInitialZeroTarget || canFinishInitialWithoutNativeProgress
            ? 0
            : silentInitialDispatch
              ? SILENT_INITIAL_SCROLL_RETRY_DELAY_MS
              : slowTimeout
                ? 500
                : 100;

    let numChecks = 0;
    const scheduleFallbackCheck = (delay: number) => {
        state.scheduledWork.timeout(checkHasScrolled, delay, "checkFinishedScrollFallback");
    };
    const checkHasScrolled = () => {
        const isStillScrollingTo = state.scrollingTo;
        if (isStillScrollingTo) {
            numChecks++;
            const isNativeInitialPending = isNativeInitialNonZeroTarget(state) && !state.hasScrolled;
            const maxChecks = silentInitialDispatch
                ? 5
                : isNativeInitialPending
                  ? INITIAL_SCROLL_MAX_FALLBACK_CHECKS
                  : 5;
            const shouldFinishZeroTarget = shouldFinishInitialZeroTargetScroll(ctx);
            const canFinishInitialScrollWithoutNativeProgress = shouldFinishInitialScrollWithoutNativeProgress(
                state,
                isStillScrollingTo,
            );
            const completionState = getResolvedScrollCompletionState(ctx, isStillScrollingTo);
            const canFinishAfterSilentNativeDispatch =
                Platform.OS === "android" &&
                silentInitialDispatch &&
                completionState.isAtResolvedTarget &&
                numChecks >= 1;
            const shouldRetrySilentInitialNativeScroll =
                Platform.OS === "android" &&
                canFinishAfterSilentNativeDispatch &&
                !initialScrollCompletion.didRetrySilentInitialScroll(state);
            const shouldFinishAfterObservedScroll =
                state.hasScrolled && (!isStillScrollingTo.isInitialScroll || completionState.isAtResolvedTarget);
            const shouldRetryUnalignedInitialScroll =
                isStillScrollingTo.isInitialScroll && !completionState.isAtResolvedTarget && numChecks <= maxChecks;
            const shouldRetryUnalignedEndScroll =
                Platform.OS === "ios" &&
                !isStillScrollingTo.isInitialScroll &&
                isEndAlignedLastItemTarget(ctx, isStillScrollingTo) &&
                !completionState.isAtResolvedTarget &&
                numChecks <= maxChecks;
            // An index target's offset is re-derived from where its item is now, so a scroll that
            // was aimed with estimated sizes can be short of it once those rows measure. Re-issue
            // it at the live offset, but only once the list actually reached the offset it was last
            // aimed at: stopping anywhere else means something interrupted the scroll, and taking
            // over then would fight whatever did. Bounded by maxChecks so this always terminates.
            const shouldRetryUnalignedIndexScroll =
                !isStillScrollingTo.isInitialScroll &&
                !isStillScrollingTo.userInterrupted &&
                isStillScrollingTo.index !== undefined &&
                !completionState.isAtResolvedTarget &&
                didReachRequestedScrollOffset(ctx, isStillScrollingTo) &&
                numChecks <= maxChecks;
            if (shouldRetrySilentInitialNativeScroll) {
                const targetOffset =
                    getInitialScrollWatchdogTargetOffset(state) ?? isStillScrollingTo.targetOffset ?? 0;
                const jiggleOffset =
                    targetOffset >= SILENT_INITIAL_SCROLL_TARGET_EPSILON
                        ? targetOffset - SILENT_INITIAL_SCROLL_TARGET_EPSILON
                        : targetOffset + SILENT_INITIAL_SCROLL_TARGET_EPSILON;
                initialScrollCompletion.markSilentInitialScrollRetry(state);
                scrollToFallbackOffset(ctx, jiggleOffset);
                state.scheduledWork.frame(
                    () => scrollToFallbackOffset(ctx, targetOffset),
                    "checkFinishedScrollRetryFrame",
                );
                scheduleFallbackCheck(SILENT_INITIAL_SCROLL_RETRY_DELAY_MS);
            } else if (shouldRetryUnalignedEndScroll || shouldRetryUnalignedIndexScroll) {
                if (shouldRetryUnalignedIndexScroll) {
                    // The re-aimed offset is the request now, so the next pass measures against it.
                    isStillScrollingTo.targetOffset = completionState.clampedTargetOffset;
                }
                scrollToFallbackOffset(ctx, completionState.clampedTargetOffset);
                scheduleFallbackCheck(100);
            } else if (
                shouldFinishZeroTarget ||
                shouldFinishAfterObservedScroll ||
                canFinishInitialScrollWithoutNativeProgress ||
                canFinishAfterSilentNativeDispatch ||
                numChecks > maxChecks
            ) {
                finishScrollTo(ctx);
            } else if ((isNativeInitialPending || shouldRetryUnalignedInitialScroll) && numChecks <= maxChecks) {
                const targetOffset =
                    getInitialScrollWatchdogTargetOffset(state) ??
                    isStillScrollingTo.targetOffset ??
                    state.scrollPending;
                scrollToFallbackOffset(ctx, targetOffset);
                scheduleFallbackCheck(silentInitialDispatch ? SILENT_INITIAL_SCROLL_RETRY_DELAY_MS : 100);
            } else {
                scheduleFallbackCheck(silentInitialDispatch ? SILENT_INITIAL_SCROLL_RETRY_DELAY_MS : 100);
            }
        }
    };
    scheduleFallbackCheck(initialDelay);
}
