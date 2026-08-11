import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import "../setup";

import {
    beginScrollTargetSettle,
    clearScrollTargetSettle,
    SETTLE_MAX_CORRECTIONS,
    SETTLE_MAX_MS,
    settleScrollTarget,
} from "@/core/scrollTargetSettle";
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

    // Corrections are queued for the next frame rather than issued from inside the layout pass.
    async function flushCorrection() {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // A measurement at or above the target is what gives the settle something to re-aim at.
    async function settleAndFlush(options?: { isCompensating?: boolean; minIndexSizeChanged?: number }) {
        const result = settleScrollTarget(ctx, {
            isCompensating: options?.isCompensating,
            minIndexSizeChanged: options && "minIndexSizeChanged" in options ? options.minIndexSizeChanged : 0,
        });
        await flushCorrection();
        return result;
    }

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
        ctx.state.scheduledWork.dispose();
    });

    it("does nothing when no settle is active", async () => {
        expect(await settleAndFlush()).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("re-aims at the target after the rows above it grow", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        // Every row measures 20 taller, so item 10 moves from 1000 to 1200.
        setPositions(ctx, 120);

        expect(await settleAndFlush()).toBe(true);
        expect(scrolls).toEqual([
            expect.objectContaining({ animated: false, index: 10, offset: 1200, viewPosition: 0.5 }),
        ]);
        // 1200 - (300 - 120) / 2 = 1110
        expect(ctx.state.scroll).toBe(1110);
    });

    it("corrects on the next frame rather than from inside the layout pass", async () => {
        // Scrolling re-enters calculateItemsInView, so the correction must not be issued from the
        // middle of a pass.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);

        expect(settleScrollTarget(ctx, { minIndexSizeChanged: 0 })).toBe(true);
        expect(scrolls).toEqual([]);

        await flushCorrection();
        expect(scrolls).toHaveLength(1);
    });

    it("drops a queued correction when the settle is released first", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);
        settleScrollTarget(ctx, { minIndexSizeChanged: 0 });

        clearScrollTargetSettle(ctx.state);
        await flushCorrection();

        expect(scrolls).toEqual([]);
    });

    it("stops when a correction does not move the scroll", async () => {
        // A correction that leaves the scroll where it was - what a scroll adjustment does on
        // platforms that apply it directly - must not be retried forever.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        applyScroll = false;
        setPositions(ctx, 120);

        for (let i = 0; i < 20; i++) {
            await settleAndFlush();
        }

        expect(scrolls).toHaveLength(SETTLE_MAX_CORRECTIONS);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("stops at the deadline", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        applyScroll = false;
        setPositions(ctx, 120);

        expect(await settleAndFlush()).toBe(true);
        ctx.state.scrollTargetSettle!.deadline = Date.now() - 1;

        expect(await settleAndFlush()).toBe(false);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("releases once the target holds still", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        expect(await settleAndFlush()).toBe(false);
        expect(await settleAndFlush()).toBe(false);
        expect(scrolls).toEqual([]);

        // Released: a later move is no longer corrected.
        setPositions(ctx, 120);
        expect(await settleAndFlush()).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("converges after correcting a moved target", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        setPositions(ctx, 120);
        expect(await settleAndFlush()).toBe(true);

        // The scroll landed where the target now wants it, so the settle goes quiet and releases
        // instead of correcting again.
        expect(await settleAndFlush()).toBe(false);
        expect(await settleAndFlush()).toBe(false);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
        expect(scrolls).toHaveLength(1);
    });

    it("keeps correcting across successive measurement passes", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        setPositions(ctx, 120);
        expect(await settleAndFlush()).toBe(true);

        setPositions(ctx, 140);
        expect(await settleAndFlush()).toBe(true);
        expect(scrolls.map((s) => s.offset)).toEqual([1200, 1400]);
    });

    it("honours viewPosition 0 and a viewOffset", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 40, viewPosition: 0 });
        setPositions(ctx, 120);

        expect(await settleAndFlush()).toBe(true);
        expect(scrolls).toEqual([
            expect.objectContaining({ index: 10, offset: 1200, viewOffset: 40, viewPosition: 0 }),
        ]);
        expect(ctx.state.scroll).toBe(1160);
    });

    it("stands down while another controller is compensating", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);

        // MVCP already moved the scroll for this same layout, so correcting on top of it would
        // double count the movement.
        expect(await settleAndFlush({ isCompensating: true })).toBe(false);
        expect(scrolls).toEqual([]);

        // Still held: the correction lands on the next pass nobody else is adjusting.
        expect(await settleAndFlush()).toBe(true);
        expect(scrolls).toHaveLength(1);
    });

    it("does not release while another controller keeps compensating", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        expect(await settleAndFlush({ isCompensating: true })).toBe(false);
        expect(await settleAndFlush({ isCompensating: true })).toBe(false);
        expect(await settleAndFlush({ isCompensating: true })).toBe(false);
        expect(ctx.state.scrollTargetSettle).toBeDefined();

        setPositions(ctx, 120);
        expect(await settleAndFlush()).toBe(true);
        expect(scrolls).toHaveLength(1);
    });

    it("does not settle the last item at the end while an end anchor owns the scroll", async () => {
        // scrollToEnd lands on the last item with viewPosition 1; maintainScrollAtEnd owns that.
        ctx.state.props.maintainScrollAtEnd = { animated: false } as any;
        beginScrollTargetSettle(ctx, { index: ITEM_COUNT - 1, viewOffset: 0, viewPosition: 1 });
        setPositions(ctx, 120);

        expect(await settleAndFlush()).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("settles the last item when nothing is anchoring the end", async () => {
        // scrollToIndex fills in viewPosition 1 for the last item when the caller named none, so
        // refusing on the position alone means the most ordinary jump there is never gets held.
        ctx.state.props.maintainScrollAtEnd = undefined;
        ctx.state.props.alignItemsAtEnd = false;
        beginScrollTargetSettle(ctx, { index: ITEM_COUNT - 1, viewOffset: 0, viewPosition: 1 });
        setPositions(ctx, 120);

        expect(await settleAndFlush()).toBe(true);
        expect(scrolls.length).toBe(1);
    });

    it("stops when the target leaves the data", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        ctx.state.indexByKey.delete("item-10");

        expect(await settleAndFlush()).toBe(false);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
        expect(scrolls).toEqual([]);
    });

    it("stops once it has been cleared", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        clearScrollTargetSettle(ctx.state);
        setPositions(ctx, 120);

        expect(await settleAndFlush()).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("gives every request its own budget", async () => {
        // Corrections re-aim without re-arming, so reaching here means a genuinely new request -
        // including asking for the same target twice, which must not inherit a spent budget.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        applyScroll = false;
        setPositions(ctx, 120);
        await settleAndFlush();
        expect(ctx.state.scrollTargetSettle!.corrections).toBe(1);

        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        expect(ctx.state.scrollTargetSettle!.corrections).toBe(0);
        expect(ctx.state.scrollTargetSettle!.deadline).toBeGreaterThan(Date.now());
    });

    it("corrects without claiming the scroll session", async () => {
        // Claiming it would suppress the list's own user-scroll handling for as long as the settle
        // lives, and would re-arm the settle from inside its own correction.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);

        await settleAndFlush();

        expect(scrolls).toHaveLength(1);
        expect(scrolls[0].noScrollingTo).toBe(true);
    });

    it("needs more than one quiet pass to release", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        // One quiet pass can simply mean nothing measured in it while more is still queued.
        await settleAndFlush();
        expect(ctx.state.scrollTargetSettle).toBeDefined();

        await settleAndFlush();
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("drops a queued correction whose target was replaced", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);
        settleScrollTarget(ctx, { minIndexSizeChanged: 0 });

        // A different scroll supersedes this one before the queued correction runs.
        beginScrollTargetSettle(ctx, { index: 11, viewOffset: 0, viewPosition: 0.5 });
        await flushCorrection();

        expect(scrolls).toEqual([]);
    });

    it("drops a queued correction past the deadline", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);
        settleScrollTarget(ctx, { minIndexSizeChanged: 0 });

        ctx.state.scrollTargetSettle!.deadline = Date.now() - 1;
        await flushCorrection();

        expect(scrolls).toEqual([]);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("stops holding a target that is compensating past its deadline", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        ctx.state.scrollTargetSettle!.deadline = Date.now() - 1;

        expect(await settleAndFlush({ isCompensating: true })).toBe(false);
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("ignores an out of range index", async () => {
        beginScrollTargetSettle(ctx, { index: ITEM_COUNT + 5, viewOffset: 0, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle).toBeUndefined();
        expect(await settleAndFlush()).toBe(false);
    });

    it("does not correct when nothing was measured", async () => {
        // A scroll moves no item, so there is nothing to re-aim at. This is what keeps the settle
        // from fighting whoever moved the list, without having to work out who that was.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);

        expect(await settleAndFlush({ minIndexSizeChanged: undefined })).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("does not correct when only rows below the target were measured", async () => {
        // Rows after the target cannot have moved it.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);

        expect(await settleAndFlush({ minIndexSizeChanged: 11 })).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it("stops holding the target once its deadline passes, even with no layout passes", async () => {
        // Every other bound here is read from a layout pass. A list that goes idle runs none, so
        // the deadline is enforced by a timer as well.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle).toBeDefined();

        await new Promise((resolve) => setTimeout(resolve, SETTLE_MAX_MS + 100));

        expect(ctx.state.scrollTargetSettle).toBeUndefined();
        // And a measurement arriving afterwards finds nothing to correct.
        setPositions(ctx, 120);
        expect(await settleAndFlush()).toBe(false);
        expect(scrolls).toEqual([]);
    }, 5000);

    it("corrects when the measurement lands on the target itself", async () => {
        // The target's own row measuring is what moves it most often; the boundary between "above
        // the target" and "below it" has to include the target.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);

        expect(await settleAndFlush({ minIndexSizeChanged: 10 })).toBe(true);
        expect(scrolls).toHaveLength(1);
    });

    it("leaves a target that moved by less than a pixel alone", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        // Sub-pixel residue, which is what MVCP's own adjustments leave behind. Chasing it buys a
        // real platform scroll and a full recalculation for a difference nobody can see. Written as
        // literal pixels rather than in terms of the epsilon, so widening the epsilon fails here.
        (ctx.state.positions as any)[10] = 1000.4;

        expect(await settleAndFlush()).toBe(false);
        expect(scrolls).toEqual([]);

        // A move worth correcting still is. Just over a pixel, so widening the epsilon fails here.
        (ctx.state.positions as any)[10] = 1001.4;
        expect(await settleAndFlush()).toBe(true);
    });

    it("waits for a new measurement before correcting again", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);
        expect(await settleAndFlush()).toBe(true);

        // The target moves again, but nothing measured this pass: the last measurement was already
        // acted on, so this pass has no reason to believe the target moved.
        setPositions(ctx, 140);
        expect(await settleAndFlush({ minIndexSizeChanged: undefined })).toBe(false);
        expect(scrolls).toHaveLength(1);
    });

    it("keeps the lowest index measured since the last correction", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);

        // A row above the target measures on a pass another controller is compensating on, so the
        // correction has to wait. The next pass carries only a row below the target: keeping just
        // the latest value would lose the measurement that actually moved the target, and nothing
        // would ever re-aim.
        expect(await settleAndFlush({ isCompensating: true, minIndexSizeChanged: 5 })).toBe(false);
        expect(await settleAndFlush({ minIndexSizeChanged: 15 })).toBe(true);
    });

    it("holds through a pass another controller is adjusting", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });

        // Nothing can be concluded from a pass where MVCP is moving the scroll: the error measured
        // on it would double count the adjustment. The target survives to be corrected later.
        expect(await settleAndFlush({ isCompensating: true })).toBe(false);

        expect(ctx.state.scrollTargetSettle).toBeDefined();
    });

    it("drops a queued correction when the same target is asked for again", async () => {
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        setPositions(ctx, 120);
        expect(settleScrollTarget(ctx, { minIndexSizeChanged: 0 })).toBe(true);

        // A fresh request for the same item: the queued correction belongs to the request it
        // replaced, and firing it would spend the new budget on an aim nothing measured.
        beginScrollTargetSettle(ctx, { index: 10, viewOffset: 0, viewPosition: 0.5 });
        await flushCorrection();

        expect(scrolls).toEqual([]);
    });
});
