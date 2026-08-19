import { beforeEach, describe, expect, it } from "bun:test";
import "../setup"; // Import global test setup

import { getScrollTargetOffset, resolveScrollTargetIndex } from "@/core/scrollTargetOffset";
import type { StateContext } from "@/state/state";
import type { ScrollTarget } from "@/types.internal";
import { normalizeMaintainVisibleContentPosition } from "@/utils/normalizeMaintainVisibleContentPosition";
import { createMockContext } from "../__mocks__/createMockContext";
import { setLayoutValue } from "../helpers/layoutArrays";

const NUM_ITEMS = 30;
const ITEM_SIZE = 100;
const SCROLL_LENGTH = 500;
const TARGET_INDEX = 20;

// Offset that puts an item's box in the middle of the viewport.
function centeredOffsetFor(itemTop: number, itemSize: number) {
    return itemTop - 0.5 * (SCROLL_LENGTH - itemSize);
}

function seedItems(ctx: StateContext, keys: string[], sizes: number[]) {
    ctx.state.indexByKey.clear();
    ctx.state.idCache.length = 0;
    let top = 0;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        ctx.state.idCache[i] = key;
        ctx.state.indexByKey.set(key, i);
        ctx.state.sizes.set(key, sizes[i]);
        setLayoutValue(ctx.state, "positions", key, top);
        top += sizes[i];
    }
    ctx.state.totalSize = top;
    ctx.values.set("totalSize", top);
}

describe("getScrollTargetOffset", () => {
    let ctx: StateContext;

    beforeEach(() => {
        ctx = createMockContext(
            { headerSize: 0, readyToRender: true, stylePaddingTop: 0 },
            {
                didContainersLayout: true,
                didFinishInitialScroll: true,
                props: {
                    data: Array.from({ length: NUM_ITEMS }, (_, i) => ({ id: i })),
                    estimatedItemSize: ITEM_SIZE,
                    // The realistic configuration: the library's own anchoring is on.
                    maintainVisibleContentPosition: normalizeMaintainVisibleContentPosition(true),
                },
                scrollLength: SCROLL_LENGTH,
            },
        );
        seedItems(
            ctx,
            Array.from({ length: NUM_ITEMS }, (_, i) => `item_${i}`),
            Array.from({ length: NUM_ITEMS }, () => ITEM_SIZE),
        );
    });

    it("re-derives an index target from where its item is now, not from the requested offset", () => {
        const target: ScrollTarget = {
            index: TARGET_INDEX,
            key: `item_${TARGET_INDEX}`,
            offset: TARGET_INDEX * ITEM_SIZE,
            targetOffset: centeredOffsetFor(TARGET_INDEX * ITEM_SIZE, ITEM_SIZE),
            viewPosition: 0.5,
        };

        expect(getScrollTargetOffset(ctx, target)).toBeCloseTo(target.targetOffset!, 0);

        // Every row above the target measures at twice its estimate, which is the whole reason an
        // offset resolved at request time goes stale.
        seedItems(
            ctx,
            Array.from({ length: NUM_ITEMS }, (_, i) => `item_${i}`),
            Array.from({ length: NUM_ITEMS }, () => ITEM_SIZE * 2),
        );

        const measuredTop = ctx.state.positions[TARGET_INDEX]!;
        expect(measuredTop).toBe(TARGET_INDEX * ITEM_SIZE * 2);
        expect(getScrollTargetOffset(ctx, target)).toBeCloseTo(centeredOffsetFor(measuredTop, ITEM_SIZE * 2), 0);
    });

    it("follows the target's key when a prepend shifts every index", () => {
        const target: ScrollTarget = {
            index: TARGET_INDEX,
            key: `item_${TARGET_INDEX}`,
            offset: TARGET_INDEX * ITEM_SIZE,
            targetOffset: centeredOffsetFor(TARGET_INDEX * ITEM_SIZE, ITEM_SIZE),
            viewPosition: 0.5,
        };

        const PREPEND = 10;
        const keys = [
            ...Array.from({ length: PREPEND }, (_, i) => `pre_${i}`),
            ...Array.from({ length: NUM_ITEMS }, (_, i) => `item_${i}`),
        ];
        ctx.state.props.data = Array.from({ length: keys.length }, (_, i) => ({ id: i }));
        seedItems(
            ctx,
            keys,
            keys.map(() => ITEM_SIZE),
        );

        expect(resolveScrollTargetIndex(ctx, target)).toBe(TARGET_INDEX + PREPEND);
        expect(getScrollTargetOffset(ctx, target)).toBeCloseTo(
            centeredOffsetFor((TARGET_INDEX + PREPEND) * ITEM_SIZE, ITEM_SIZE),
            0,
        );
    });

    it("keeps the requested offset for an offset target", () => {
        const target: ScrollTarget = { offset: 640, targetOffset: 640 };
        expect(getScrollTargetOffset(ctx, target)).toBe(640);
    });

    it("keeps the requested offset while the target's position is still unresolved", () => {
        const target: ScrollTarget = {
            index: TARGET_INDEX,
            key: `item_${TARGET_INDEX}`,
            offset: 0,
            targetOffset: 320,
            viewPosition: 0.5,
        };
        ctx.state.positions[TARGET_INDEX] = undefined as unknown as number;

        // Re-deriving here would read the position as 0 and aim at the top of the list, which is
        // worse than the offset the request already resolved.
        expect(getScrollTargetOffset(ctx, target)).toBe(320);
    });
});
