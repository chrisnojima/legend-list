import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import "../setup"; // Import global test setup

import * as doScrollToModule from "@/core/doScrollTo";
import { settleScrollTarget } from "@/core/scrollTargetSettle";
import { scrollToIndex } from "@/core/scrollToIndex";
import { updateItemSizesBatch } from "@/core/updateItemSizes";
import { Platform } from "@/platform/Platform";
import type { StateContext } from "@/state/state";
import { normalizeMaintainVisibleContentPosition } from "@/utils/normalizeMaintainVisibleContentPosition";
import { createMockContext } from "../__mocks__/createMockContext";
import { setLayoutValue } from "../helpers/layoutArrays";

const NUM_ITEMS = 30;
const ESTIMATED_SIZE = 100;
const REAL_SIZE = 200;
const SCROLL_LENGTH = 500;
const TARGET_INDEX = 20;

// Offset that puts TARGET_INDEX's box in the middle of the viewport, given the sizes the list
// currently believes in.
function centeredOffsetFor(itemTop: number, itemSize: number) {
    return itemTop - 0.5 * (SCROLL_LENGTH - itemSize);
}

describe("scrollToIndex viewPosition settles as sizes are measured", () => {
    let ctx: StateContext;

    beforeEach(() => {
        Platform.OS = "ios";

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
                    maintainVisibleContentPosition: normalizeMaintainVisibleContentPosition(false),
                },
                refScroller: {
                    current: {
                        scrollTo: () => undefined,
                    } as any,
                },
                scrollLength: SCROLL_LENGTH,
                startBuffered: 0,
                totalSize: NUM_ITEMS * ESTIMATED_SIZE,
            },
        );

        // Non-animated scrolls land immediately in this harness.
        spyOn(doScrollToModule, "doScrollTo").mockImplementation(
            (c: StateContext, params: { animated?: boolean; offset: number }) => {
                if (!params.animated) {
                    c.state.scroll = params.offset;
                    c.state.scrollPending = params.offset;
                }
            },
        );

        // Nothing is measured yet: every row is known only by estimatedItemSize.
        for (let i = 0; i < NUM_ITEMS; i++) {
            const itemKey = `item_${i}`;
            ctx.state.idCache[i] = itemKey;
            ctx.state.indexByKey.set(itemKey, i);
            ctx.values.set(`containerItemKey${i}` as any, itemKey as any);
            ctx.state.containerItemKeys.set(itemKey, i);
            setLayoutValue(ctx.state, "positions", itemKey, i * ESTIMATED_SIZE);
        }
    });

    it("re-centers once the target's position resolves, instead of stranding the list at 0", () => {
        // The target is outside the range the list has resolved positions for, so
        // calculateOffsetForIndex falls back to 0 and the scroll lands at the very top with the
        // target nowhere near the viewport.
        for (let i = TARGET_INDEX - 2; i < NUM_ITEMS; i++) {
            ctx.state.positions[i] = undefined;
        }

        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        expect(ctx.state.scroll).toBe(0);

        // Positions resolve on the next measurement pass. The request is still outstanding, so it
        // should be satisfied now rather than leaving the list parked at the top.
        updateItemSizesBatch(
            ctx,
            Array.from({ length: NUM_ITEMS }, (_, i) => ({
                containerId: i,
                itemKey: `item_${i}`,
                size: { height: REAL_SIZE, width: 400 },
            })),
        );

        const measuredTop = ctx.state.positions[TARGET_INDEX]!;
        expect(measuredTop).toBe(TARGET_INDEX * REAL_SIZE);
        expect(ctx.state.scroll).toBeCloseTo(centeredOffsetFor(measuredTop, REAL_SIZE), 0);
    });

    it("keeps holding the target when a prepend pushes it further down the list", () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        expect(ctx.state.scroll).toBe(centeredOffsetFor(TARGET_INDEX * ESTIMATED_SIZE, ESTIMATED_SIZE));

        // 10 older rows arrive above the target, which is what a load-older page does. The target
        // keeps its key but moves 10 slots down; the anchor is keyed by key, so it should follow.
        const PREPEND = 10;
        const prepended = Array.from({ length: PREPEND }, (_, i) => ({ id: -PREPEND + i }));
        ctx.state.props.data = [...prepended, ...ctx.state.props.data];
        ctx.state.indexByKey.clear();
        for (let i = 0; i < ctx.state.props.data.length; i++) {
            const itemKey = i < PREPEND ? `pre_${i}` : `item_${i - PREPEND}`;
            ctx.state.idCache[i] = itemKey;
            ctx.state.indexByKey.set(itemKey, i);
            setLayoutValue(ctx.state, "positions", itemKey, i * ESTIMATED_SIZE);
        }

        settleScrollTarget(ctx);

        const movedIndex = TARGET_INDEX + PREPEND;
        expect(ctx.state.indexByKey.get(`item_${TARGET_INDEX}`)).toBe(movedIndex);
        expect(ctx.state.scroll).toBeCloseTo(centeredOffsetFor(movedIndex * ESTIMATED_SIZE, ESTIMATED_SIZE), 0);
    });

    it("re-centers the target after rows above it measure taller than the estimate", () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });

        // First landing uses estimates: every row above the target counts as ESTIMATED_SIZE.
        expect(ctx.state.scroll).toBe(centeredOffsetFor(TARGET_INDEX * ESTIMATED_SIZE, ESTIMATED_SIZE));

        // Now the rows actually measure in, at twice the estimate. Everything below index 0 slides
        // down, so the target's real top is far from where the scroll was aimed.
        updateItemSizesBatch(
            ctx,
            Array.from({ length: NUM_ITEMS }, (_, i) => ({
                containerId: i,
                itemKey: `item_${i}`,
                size: { height: REAL_SIZE, width: 400 },
            })),
        );

        const measuredTop = ctx.state.positions[TARGET_INDEX]!;
        expect(measuredTop).toBe(TARGET_INDEX * REAL_SIZE);

        // The request was "center index 20", so the list should end up centered on where index 20
        // actually is, not where it was estimated to be.
        expect(ctx.state.scroll).toBeCloseTo(centeredOffsetFor(measuredTop, REAL_SIZE), 0);
    });
});
