import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import "../setup";

import { beginScrollTargetSettle, clearScrollTargetSettle, settleScrollTarget } from "@/core/scrollTargetSettle";
import * as scrollToModule from "@/core/scrollTo";
import type { StateContext } from "@/state/state";
import { createMockContext } from "../__mocks__/createMockContext";

// 20 items of 100, viewport 300. Item 10 sits at 1000, so centring it asks for
// 1000 - (300 - 100) / 2 = 900.
const ITEM_SIZE = 100;
const ITEM_COUNT = 20;
const VIEWPORT = 300;

function createContext(scroll: number): StateContext {
    const ctx = createMockContext(
        {
            footerSize: 0,
            headerSize: 0,
            stylePaddingTop: 0,
            totalSize: ITEM_SIZE * ITEM_COUNT,
        },
        {
            scroll,
            scrollLength: VIEWPORT,
        },
    );
    const state = ctx.state;
    state.props.data = Array.from({ length: ITEM_COUNT }, (_v, i) => ({ id: `item-${i}` }));
    state.props.keyExtractor = (item: any) => item.id;
    setPositions(ctx, ITEM_SIZE);
    return ctx;
}

// Lay every item out at `size`, which is what moves a settle target: re-laying out with a bigger
// size is exactly the "rows above the target measured taller" case.
function setPositions(ctx: StateContext, size: number) {
    const state = ctx.state;
    const positions: number[] = [];
    const sizes = new Map<string, number>();
    state.indexByKey = new Map();
    for (let i = 0; i < ITEM_COUNT; i++) {
        const id = `item-${i}`;
        positions[i] = i * size;
        sizes.set(id, size);
        state.indexByKey.set(id, i);
        state.idCache[i] = id;
    }
    state.positions = positions as any;
    state.sizes = sizes as any;
    state.sizesKnown = new Map(sizes) as any;
    ctx.values.set("totalSize", size * ITEM_COUNT);
}

describe("scrollTargetSettle", () => {
    let ctx: StateContext;
    let scrollToSpy: ReturnType<typeof spyOn>;
    let scrolls: any[] = [];
    // The platform moves the scroll position in response to a scroll; a scroll adjustment would
    // not, which is what makes an adjustment the wrong primitive for re-aiming.
    let applyScroll = true;

    beforeEach(() => {
        scrolls = [];
        applyScroll = true;
        ctx = createContext(900);
        scrollToSpy = spyOn(scrollToModule, "scrollTo").mockImplementation((_ctx: any, params: any) => {
            scrolls.push(params);
            if (applyScroll) {
                const itemSize = ctx.state.sizesKnown.get(ctx.state.idCache[params.index]!)!;
                ctx.state.scroll = params.offset - params.viewPosition * (VIEWPORT - itemSize) - params.viewOffset;
            }
        });
    });

    afterEach(() => {
        scrollToSpy.mockRestore();
    });

    it("does nothing when no settle is active", () => {
        expect(settleScrollTarget(ctx)).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("re-aims at the target after the rows above it grow", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        // Every row measures 20 taller, so item 10 moves from 1000 to 1200.
        setPositions(ctx, 120);

        expect(settleScrollTarget(ctx)).toBe(true);
        expect(scrolls).toEqual([
            expect.objectContaining({ animated: false, index: 10, offset: 1200, viewPosition: 0.5 }),
        ]);
        // 1200 - (300 - 120) / 2 = 1110
        expect(ctx.state.scroll).toBe(1110);
    });

    it("re-aims with a scroll rather than a scroll adjustment", () => {
        // A scroll adjustment translates the content without moving the scroll position, so the
        // measured error would never close and the same correction would repeat on every pass.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        applyScroll = false;
        setPositions(ctx, 120);

        expect(settleScrollTarget(ctx)).toBe(true);
        expect(scrolls).toHaveLength(1);

        // A correction that does not take is retried, but only until the deadline - never forever.
        expect(settleScrollTarget(ctx)).toBe(true);
        ctx.state.scrollTargetSettle!.deadline = Date.now() - 1;
        expect(settleScrollTarget(ctx)).toBe(false);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("gives up after a bounded number of corrections", () => {
        // Whatever the platform does with the re-aiming scroll, the settle cannot keep issuing
        // corrections indefinitely.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        applyScroll = false;
        setPositions(ctx, 120);

        for (let i = 0; i < 20; i++) {
            settleScrollTarget(ctx);
        }

        expect(scrolls.length).toBeLessThanOrEqual(8);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("releases once the target holds still", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        expect(settleScrollTarget(ctx)).toBe(false);
        expect(settleScrollTarget(ctx)).toBe(false);
        expect(scrolls).toEqual([]);

        // Released: a later move is no longer corrected.
        setPositions(ctx, 120);
        expect(settleScrollTarget(ctx)).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("converges after correcting a moved target", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        setPositions(ctx, 120);
        expect(settleScrollTarget(ctx)).toBe(true);

        // The scroll landed where the target now wants it, so the settle goes quiet and releases
        // instead of correcting again.
        expect(settleScrollTarget(ctx)).toBe(false);
        expect(settleScrollTarget(ctx)).toBe(false);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
        expect(scrolls).toHaveLength(1);
    });

    it("keeps correcting across successive measurement passes", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        setPositions(ctx, 120);
        expect(settleScrollTarget(ctx)).toBe(true);

        setPositions(ctx, 140);
        expect(settleScrollTarget(ctx)).toBe(true);
        expect(scrolls.map((s) => s.offset)).toEqual([1200, 1400]);
    });

    it("honours viewPosition 0 and a viewOffset", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 40, viewPosition: 0 });
        setPositions(ctx, 120);

        expect(settleScrollTarget(ctx)).toBe(true);
        expect(scrolls).toEqual([
            expect.objectContaining({ index: 10, offset: 1200, viewOffset: 40, viewPosition: 0 }),
        ]);
        expect(ctx.state.scroll).toBe(1160);
    });

    it("stands down while another controller is compensating", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);

        // MVCP already moved the scroll for this same layout, so correcting on top of it would
        // double count the movement.
        expect(settleScrollTarget(ctx, true)).toBe(false);
        expect(scrolls).toEqual([]);

        // Still held: the correction lands on the next pass nobody else is adjusting.
        expect(settleScrollTarget(ctx)).toBe(true);
        expect(scrolls).toHaveLength(1);
    });

    it("does not release while another controller keeps compensating", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        expect(settleScrollTarget(ctx, true)).toBe(false);
        expect(settleScrollTarget(ctx, true)).toBe(false);
        expect(settleScrollTarget(ctx, true)).toBe(false);
        expect(ctx.state.scrollTargetSettle).toBeDefined();

        setPositions(ctx, 120);
        expect(settleScrollTarget(ctx)).toBe(true);
        expect(scrolls).toHaveLength(1);
    });

    it("does not settle a request to align the last item at the end", () => {
        // scrollToEnd lands on the last item with viewPosition 1; maintainScrollAtEnd owns that.
        beginScrollTargetSettle(ctx, { index: ITEM_COUNT - 1, viewOffset: 0, viewPosition: 1 });
        setPositions(ctx, 120);

        expect(settleScrollTarget(ctx)).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("stops when the target leaves the data", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        ctx.state.indexByKey.delete("item-10");

        expect(settleScrollTarget(ctx)).toBe(false);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
        expect(scrolls).toEqual([]);
    });

    it("stops once it has been cleared", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        clearScrollTargetSettle(ctx.state);
        setPositions(ctx, 120);

        expect(settleScrollTarget(ctx)).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("keeps the original deadline when a re-aim restarts the settle", () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        const deadline = ctx.state.scrollTargetSettle!.deadline;

        // The re-aiming scroll runs beginScrollTargetSettle again for the same target.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle!.deadline).toBe(deadline);

        // A different target starts its own deadline.
        beginScrollTargetSettle(ctx, { index: 11, viewOffset: 0, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle!.deadline).toBeGreaterThanOrEqual(deadline);
    });

    it("ignores an out of range index", () => {
        beginScrollTargetSettle(ctx, { index: ITEM_COUNT + 5, viewOffset: 0, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
        expect(settleScrollTarget(ctx)).toBe(false);
    });
});
