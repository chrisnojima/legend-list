import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import "../setup"; // Import global test setup

import { calculateItemsInView } from "@/core/calculateItemsInView";
import { checkFinishedScrollFallback } from "@/core/checkFinishedScroll";
import * as doScrollToModule from "@/core/doScrollTo";
import { finishScrollTo } from "@/core/finishScrollTo";
import { clearScrollTargetAnchor } from "@/core/scrollTargetAnchor";
import { scrollToIndex } from "@/core/scrollToIndex";
import { updateItemSizesBatch } from "@/core/updateItemSizes";
import { updateScroll } from "@/core/updateScroll";
import { Platform } from "@/platform/Platform";
import { peek$, type StateContext } from "@/state/state";
import { normalizeMaintainVisibleContentPosition } from "@/utils/normalizeMaintainVisibleContentPosition";
import { createMockContext } from "../__mocks__/createMockContext";
import { setLayoutValue } from "../helpers/layoutArrays";

const NUM_ITEMS = 30;
const ESTIMATED_SIZE = 100;
const REAL_SIZE = 200;
const SCROLL_LENGTH = 500;
const TARGET_INDEX = 20;

// Offset that puts TARGET_INDEX's box in the middle of the viewport for a given row size.
function centeredOffsetFor(itemTop: number, itemSize: number) {
    return itemTop - 0.5 * (SCROLL_LENGTH - itemSize);
}

describe("an index scroll target is re-aimed at where its item ends up", () => {
    let ctx: StateContext;
    let scrolls: Array<{ animated: boolean; y: number }>;
    let originalPlatform: typeof Platform.OS;
    let originalSetTimeout: typeof globalThis.setTimeout;
    let originalClearTimeout: typeof globalThis.clearTimeout;
    let originalRequestAnimationFrame: typeof globalThis.requestAnimationFrame;
    let queue: Array<() => void>;

    const flushTimers = (count: number) => {
        for (let i = 0; i < count; i++) {
            const cb = queue.shift();
            if (!cb) {
                return;
            }
            cb();
        }
    };

    // Give every row `size`, which moves everything below the first one.
    const setAllRowSizes = (size: number) => {
        for (let i = 0; i < NUM_ITEMS; i++) {
            const itemKey = `item_${i}`;
            ctx.state.sizes.set(itemKey, size);
            setLayoutValue(ctx.state, "positions", itemKey, i * size);
        }
        ctx.state.totalSize = NUM_ITEMS * size;
        ctx.values.set("totalSize", NUM_ITEMS * size);
    };

    beforeEach(() => {
        originalPlatform = Platform.OS;
        originalSetTimeout = globalThis.setTimeout;
        originalClearTimeout = globalThis.clearTimeout;
        originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        queue = [];
        globalThis.setTimeout = ((callback: TimerHandler) => {
            queue.push(callback as () => void);
            return queue.length as unknown as ReturnType<typeof setTimeout>;
        }) as typeof globalThis.setTimeout;
        globalThis.clearTimeout = (() => undefined) as typeof globalThis.clearTimeout;
        globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof globalThis.requestAnimationFrame;

        Platform.OS = "ios";
        scrolls = [];

        ctx = createMockContext(
            {
                headerSize: 0,
                numContainers: NUM_ITEMS,
                readyToRender: true,
                stylePaddingTop: 0,
            },
            {
                didContainersLayout: true,
                didFinishInitialScroll: true,
                endBuffered: NUM_ITEMS - 1,
                props: {
                    data: Array.from({ length: NUM_ITEMS }, (_, i) => ({ id: i })),
                    estimatedItemSize: ESTIMATED_SIZE,
                    // The configuration a real consumer runs: the library's own anchoring is on.
                    maintainVisibleContentPosition: normalizeMaintainVisibleContentPosition(true),
                },
                refScroller: {
                    current: {
                        scrollTo: ({ animated, y }: { animated: boolean; y: number }) => {
                            scrolls.push({ animated, y });
                        },
                    } as any,
                },
                scrollLength: SCROLL_LENGTH,
                startBuffered: 0,
                totalSize: NUM_ITEMS * ESTIMATED_SIZE,
            },
        );

        for (let i = 0; i < NUM_ITEMS; i++) {
            const itemKey = `item_${i}`;
            ctx.state.idCache[i] = itemKey;
            ctx.state.indexByKey.set(itemKey, i);
            ctx.values.set(`containerItemKey${i}` as any, itemKey as any);
            ctx.state.containerItemKeys.set(itemKey, i);
        }
        setAllRowSizes(ESTIMATED_SIZE);
    });

    afterEach(() => {
        Platform.OS = originalPlatform;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    });

    // Puts the list in the state an animated scroll leaves behind: parked on the offset the request
    // resolved from estimates, with the rows above the target now measured at their real size.
    const landAnimatedScrollThenMeasureRows = () => {
        const requestedOffset = ctx.state.scrollingTo!.targetOffset!;
        ctx.state.scroll = requestedOffset;
        ctx.state.scrollPending = requestedOffset;
        ctx.state.hasScrolled = true;
        setAllRowSizes(REAL_SIZE);
        return requestedOffset;
    };

    // The flow a chat app takes to jump to a search hit: a non-animated scrollToIndex that completes
    // immediately at the offset the estimates resolved to, followed by the real measurement.
    const completeNonAnimatedScrollToTarget = () => {
        const doScrollToSpy = spyOn(doScrollToModule, "doScrollTo").mockImplementation(
            (c: StateContext, params: { animated?: boolean; offset: number }) => {
                if (!params.animated) {
                    c.state.scroll = params.offset;
                    c.state.scrollPending = params.offset;
                }
            },
        );
        try {
            scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        } finally {
            doScrollToSpy.mockRestore();
        }
        // The scroll itself is correct, and it is over.
        expect(ctx.state.scroll).toBeCloseTo(centeredOffsetFor(TARGET_INDEX * ESTIMATED_SIZE, ESTIMATED_SIZE), 0);
        const requestedOffset = ctx.state.scroll;
        finishScrollTo(ctx);
        expect(ctx.state.scrollingTo).toBeUndefined();
        return requestedOffset;
    };

    // The scroller reports the jump on its own schedule, so its landing event can arrive after the
    // scroll has already been finished. Measured in the app at 2929.5 -> 0 across a 779px viewport,
    // 55-91ms after the anchor was created: a delta larger than the viewport, with no scroll in
    // flight any more, which the large-jump heuristic used to read as the reader taking over.
    const deliverSettlingScrollEvent = (landingOffset: number) => {
        // The event arrives before the list has processed the jump, so it carries the whole jump
        // distance as its delta against the position the list still believes it is at.
        ctx.state.scroll = 0;
        ctx.state.scrollPending = 0;
        ctx.state.scrollLastCalculate = undefined;
        expect(Math.abs(landingOffset - ctx.state.scroll)).toBeGreaterThan(SCROLL_LENGTH);
        updateScroll(ctx, landingOffset, false, { fromNativeScrollEvent: true });
        expect(ctx.state.scroll).toBe(landingOffset);
    };

    const measureAllRowsTaller = () => {
        updateItemSizesBatch(
            ctx,
            Array.from({ length: NUM_ITEMS }, (_, i) => ({
                containerId: i,
                itemKey: `item_${i}`,
                size: { height: REAL_SIZE, width: 400 },
            })),
        );
    };

    it("keeps the target at its requested position when rows measure after the scroll completes", () => {
        const requestedOffset = completeNonAnimatedScrollToTarget();

        // The scroll's own landing event lands first, and must not be mistaken for a reader taking
        // over - doing so drops the anchor before a single correction has been applied.
        deliverSettlingScrollEvent(requestedOffset);
        expect(ctx.state.scrollTargetAnchor).toBeDefined();

        // Every row above the target measures at twice its estimate, pushing the target far below
        // where the completed scroll left the viewport.
        measureAllRowsTaller();

        const measuredTop = ctx.state.positions[TARGET_INDEX]!;
        expect(measuredTop).toBe(TARGET_INDEX * REAL_SIZE);
        expect(ctx.state.scroll).toBeCloseTo(centeredOffsetFor(measuredTop, REAL_SIZE), 0);
        expect(scrolls).toHaveLength(0);
    });

    it("releases the target anchor once the target has held still", () => {
        completeNonAnimatedScrollToTarget();
        measureAllRowsTaller();
        expect(ctx.state.scrollTargetAnchor).toBeDefined();

        // Two passes that move nothing are enough to hand the list back to the ordinary anchor.
        for (let i = 0; i < 2; i++) {
            ctx.state.scrollForNextCalculateItemsInView = undefined;
            calculateItemsInView(ctx, { doMVCP: true });
        }

        expect(ctx.state.scrollTargetAnchor).toBeUndefined();
    });

    it("drops the target anchor when a touch takes over", () => {
        completeNonAnimatedScrollToTarget();
        expect(ctx.state.scrollTargetAnchor).toBeDefined();

        // What onScrollBeginDrag does once the reader grabs the list.
        clearScrollTargetAnchor(ctx.state);
        measureAllRowsTaller();

        // The list stays where the reader left it instead of chasing the target.
        expect(ctx.state.scroll).toBeCloseTo(centeredOffsetFor(TARGET_INDEX * ESTIMATED_SIZE, ESTIMATED_SIZE), 0);
    });

    it("does not move the list while the animated scroll is still running", () => {
        const doScrollToSpy = spyOn(doScrollToModule, "doScrollTo").mockImplementation(() => undefined);

        try {
            scrollToIndex(ctx, { index: TARGET_INDEX, viewPosition: 0.5 });

            // The measurement pass scrollTo forces so the pinned target range mounts must not turn
            // into a correction: the animation owns the viewport until it finishes.
            calculateItemsInView(ctx);

            expect(ctx.state.scroll).toBe(0);
            expect(peek$(ctx, "scrollAdjust")).toBe(0);
            expect(doScrollToSpy).toHaveBeenCalledTimes(1);
            expect(doScrollToSpy.mock.calls[0][1].animated).toBe(true);
            expect(scrolls).toHaveLength(0);
        } finally {
            doScrollToSpy.mockRestore();
        }
    });

    it("re-issues the scroll at the target's measured position once the animation lands", () => {
        const doScrollToSpy = spyOn(doScrollToModule, "doScrollTo").mockImplementation(() => undefined);
        try {
            scrollToIndex(ctx, { index: TARGET_INDEX, viewPosition: 0.5 });
        } finally {
            doScrollToSpy.mockRestore();
        }

        const requestedOffset = landAnimatedScrollThenMeasureRows();
        expect(requestedOffset).toBeCloseTo(centeredOffsetFor(TARGET_INDEX * ESTIMATED_SIZE, ESTIMATED_SIZE), 0);

        checkFinishedScrollFallback(ctx);
        flushTimers(2);

        const measuredTop = ctx.state.positions[TARGET_INDEX]!;
        expect(scrolls).toHaveLength(1);
        expect(scrolls[0].animated).toBe(false);
        expect(scrolls[0].y).toBeCloseTo(centeredOffsetFor(measuredTop, REAL_SIZE), 0);
    });

    it("stands down once a touch has taken the list somewhere else", () => {
        const doScrollToSpy = spyOn(doScrollToModule, "doScrollTo").mockImplementation(() => undefined);
        try {
            scrollToIndex(ctx, { index: TARGET_INDEX, viewPosition: 0.5 });
        } finally {
            doScrollToSpy.mockRestore();
        }

        landAnimatedScrollThenMeasureRows();
        // What onScrollBeginDrag records when the reader grabs the list mid-request.
        ctx.state.scrollingTo!.userInterrupted = true;

        checkFinishedScrollFallback(ctx);
        flushTimers(6);

        expect(scrolls).toHaveLength(0);
        expect(ctx.state.scrollingTo).toBeUndefined();
    });

    it("gives up after a bounded number of re-aims when the target never holds still", () => {
        const doScrollToSpy = spyOn(doScrollToModule, "doScrollTo").mockImplementation(() => undefined);
        try {
            scrollToIndex(ctx, { index: TARGET_INDEX, viewPosition: 0.5 });
        } finally {
            doScrollToSpy.mockRestore();
        }

        landAnimatedScrollThenMeasureRows();

        // Every pass the rows grow again, so the target never stops moving and the list never
        // reaches it. The retry budget, not convergence, has to end this.
        checkFinishedScrollFallback(ctx);

        let size = REAL_SIZE;
        for (let i = 0; i < 20 && ctx.state.scrollingTo; i++) {
            size += 40;
            setAllRowSizes(size);
            ctx.state.scrollPending = ctx.state.scrollingTo.targetOffset ?? ctx.state.scrollPending;
            ctx.state.scroll = ctx.state.scrollPending;
            flushTimers(1);
        }

        expect(ctx.state.scrollingTo).toBeUndefined();
        expect(scrolls.length).toBeLessThanOrEqual(6);
        expect(scrolls.length).toBeGreaterThan(0);
    });
});
