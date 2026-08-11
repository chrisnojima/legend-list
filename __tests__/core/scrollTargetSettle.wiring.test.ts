import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import "../setup";

import { calculateItemsInView } from "@/core/calculateItemsInView";
import * as doScrollToModule from "@/core/doScrollTo";
import { scrollTo } from "@/core/scrollTo";
import { scrollToIndex } from "@/core/scrollToIndex";
import type { StateContext } from "@/state/state";
import type { InternalState } from "@/types.internal";
import { createMockContext } from "../__mocks__/createMockContext";
import { setLayoutValue } from "../helpers/layoutArrays";

// Every offset the list asked the platform to scroll to, in order.
let platformScrolls: number[] = [];

const ITEM_COUNT = 40;
const ESTIMATED_SIZE = 100;
const MEASURED_SIZE = 200;
const TARGET_INDEX = 20;
const VIEWPORT = 400;

describe("scroll target settling wiring", () => {
    let ctx: StateContext;
    let state: InternalState;

    // Lay out the items above the target at `sizeAbove`, which is what a measurement pass does when
    // the estimate was too small.
    function layoutItems(sizeAbove: number) {
        let position = 0;
        for (let i = 0; i < ITEM_COUNT; i++) {
            const id = `item_${i}`;
            const size = i < TARGET_INDEX ? sizeAbove : ESTIMATED_SIZE;
            state.idCache[i] = id;
            state.indexByKey.set(id, i);
            setLayoutValue(state, "positions", id, position);
            state.sizes.set(id, size);
            state.sizesKnown.set(id, size);
            position += size;
        }
        ctx.values.set("totalSize", position);
        state.totalSize = position;
    }

    let doScrollToSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        platformScrolls = [];
        // Stand in for the platform scroller: record the request and move the scroll position,
        // which is what a real scroll does and a scroll adjustment does not.
        doScrollToSpy = spyOn(doScrollToModule, "doScrollTo").mockImplementation(
            (scrollCtx: any, params: { offset: number }) => {
                platformScrolls.push(Math.round(params.offset));
                scrollCtx.state.scroll = params.offset;
                scrollCtx.state.scrollPending = params.offset;
            },
        );
        ctx = createMockContext(
            { headerSize: 0, numColumns: 1, numContainers: 10, stylePaddingTop: 0, totalSize: 0 },
            {},
        );
        state = ctx.state;
        state.props.data = Array.from({ length: ITEM_COUNT }, (_v, i) => ({ id: `item_${i}` }));
        state.props.keyExtractor = (item: any) => item.id;
        state.props.drawDistance = 0;
        state.props.scrollBuffer = 0;
        state.scroll = 0;
        state.scrollLength = VIEWPORT;
        state.didContainersLayout = true;
        layoutItems(ESTIMATED_SIZE);
    });

    afterEach(() => {
        doScrollToSpy.mockRestore();
        state.scheduledWork.dispose();
    });

    it("re-aims the scroll after the rows above the target measure taller", () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });

        // Landed against the estimates: the target is believed to be at 2000.
        const landedAt = platformScrolls.at(-1);
        expect(landedAt).toBe(TARGET_INDEX * ESTIMATED_SIZE - (VIEWPORT - ESTIMATED_SIZE) / 2);

        // Those rows now measure at twice the estimate, so the target moves to 4000 and the scroll
        // that already landed no longer centres it.
        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);

        const wanted = TARGET_INDEX * MEASURED_SIZE - (VIEWPORT - ESTIMATED_SIZE) / 2;
        expect(platformScrolls.at(-1)).toBe(wanted);
    });

    it("re-aims a top aligned target too", () => {
        // scrollToIndex without a viewPosition still asks for a placement - the top of the
        // viewport - and measurement moves the target out of it just the same.
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX });
        expect(platformScrolls.at(-1)).toBe(TARGET_INDEX * ESTIMATED_SIZE);

        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);

        expect(platformScrolls.at(-1)).toBe(TARGET_INDEX * MEASURED_SIZE);
    });

    it("does not re-aim a scroll to a raw offset", () => {
        // No target item, so there is nothing to hold: the offset means what it said.
        scrollTo(ctx, { animated: false, offset: 1000 });
        const landedAt = platformScrolls.at(-1);

        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);

        expect(platformScrolls.at(-1)).toBe(landedAt!);
    });
});
