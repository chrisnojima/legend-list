import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import "../setup";

import { calculateItemsInView } from "@/core/calculateItemsInView";
import { cancelImperativeScroll } from "@/core/cancelImperativeScroll";
import { doMaintainScrollAtEnd } from "@/core/doMaintainScrollAtEnd";
import * as doScrollToModule from "@/core/doScrollTo";
import { onScroll } from "@/core/onScroll";
import { clearScrollTargetSettle } from "@/core/scrollTargetSettle";
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
        // What a real measurement records: the lowest index whose size changed. The settle corrects
        // only when this says something at or above its target moved.
        state.minIndexSizeChanged = 0;
    }

    // A real prepend: older items arrive at the front, every index shifts, and the target's offset
    // moves without any item having measured. Positions are rebuilt the way a data-change pass does.
    function prependItems(count: number) {
        const added = Array.from({ length: count }, (_v, i) => ({ id: `older_${i}` }));
        state.props.data = [...added, ...state.props.data];
        state.indexByKey = new Map();
        state.idCache = [];
        let position = 0;
        for (let i = 0; i < state.props.data.length; i++) {
            const id = (state.props.data[i] as { id: string }).id;
            const size = state.sizes.get(id) ?? ESTIMATED_SIZE;
            state.idCache[i] = id;
            state.indexByKey.set(id, i);
            setLayoutValue(state, "positions", id, position);
            state.sizes.set(id, size);
            state.sizesKnown.set(id, size);
            position += size;
        }
        ctx.values.set("totalSize", position);
        state.totalSize = position;
        // Nothing measured: a prepend moves offsets, it does not change any item's size.
        state.minIndexSizeChanged = undefined;
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

    // A scroll event as the platform reports it, which is what a user wheel or drag produces.
    function emitUserScroll(offset: number) {
        onScroll(ctx, {
            nativeEvent: {
                contentOffset: { x: 0, y: offset },
                contentSize: { height: ITEM_COUNT * ESTIMATED_SIZE, width: 100 },
                layoutMeasurement: { height: VIEWPORT, width: 100 },
            },
        } as any);
    }

    async function flushCorrection() {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it("re-aims the scroll after the rows above the target measure taller", async () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });

        // Landed against the estimates: the target is believed to be at 2000.
        const landedAt = platformScrolls.at(-1);
        expect(landedAt).toBe(TARGET_INDEX * ESTIMATED_SIZE - (VIEWPORT - ESTIMATED_SIZE) / 2);

        // Those rows now measure at twice the estimate, so the target moves to 4000 and the scroll
        // that already landed no longer centres it.
        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        const wanted = TARGET_INDEX * MEASURED_SIZE - (VIEWPORT - ESTIMATED_SIZE) / 2;
        expect(platformScrolls.at(-1)).toBe(wanted);
    });

    it("re-aims a top aligned target too", async () => {
        // scrollToIndex without a viewPosition still asks for a placement - the top of the
        // viewport - and measurement moves the target out of it just the same.
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX });
        expect(platformScrolls.at(-1)).toBe(TARGET_INDEX * ESTIMATED_SIZE);

        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(platformScrolls.at(-1)).toBe(TARGET_INDEX * MEASURED_SIZE);
    });

    it("does not re-aim a scroll to a raw offset", async () => {
        // No target item, so there is nothing to hold: the offset means what it said.
        scrollTo(ctx, { animated: false, offset: 1000 });
        const landedAt = platformScrolls.at(-1);

        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(platformScrolls.at(-1)).toBe(landedAt!);
    });

    it("does not re-aim an animated scroll", async () => {
        // The platform owns the scroll position for the length of an animation; re-aiming would
        // replace it with a jump.
        scrollToIndex(ctx, { animated: true, index: TARGET_INDEX, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle).toBeUndefined();

        const before = platformScrolls.length;
        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(platformScrolls).toHaveLength(before);
    });

    it("lets go when the platform reports the user taking hold", async () => {
        // The reported failure: jump to a hit, wait, then scroll to read around it - and get pulled
        // back. Scrolling is also what renders and measures new rows, so a measurement arriving
        // alongside the user's scroll is the normal case, not an edge one: what saves the reader is
        // the platform saying the scroll was theirs, not anything inferred from the numbers.
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const afterJump = platformScrolls.length;

        // What LegendList does from onScrollBeginDrag: the platform reporting a drag.
        clearScrollTargetSettle(state);

        emitUserScroll(state.scroll - 300);
        // Rows measure as that scroll renders them, which without the release above is exactly what
        // the settle would re-aim on.
        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(ctx.state.scrollTargetSettle).toBeUndefined();
        expect(platformScrolls).toHaveLength(afterJump);
    });

    it("stands down while a native MVCP adjustment is in flight", async () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const before = platformScrolls.length;

        // Native MVCP is moving the scroll itself, so state.scroll is deliberately out of sync and
        // any error measured against it is meaningless.
        state.pendingNativeMVCPAdjust = { startScroll: state.scroll } as any;
        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(platformScrolls).toHaveLength(before);
        expect(ctx.state.scrollTargetSettle).toBeDefined();
    });

    it("still corrects when layout runs many passes before the frame lands", async () => {
        // Items measuring fan out over many calculateItemsInView passes within a single frame, and
        // they all coalesce onto one queued correction. That must not exhaust the correction budget
        // before anything has actually scrolled.
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const before = platformScrolls.length;

        layoutItems(MEASURED_SIZE);
        for (let i = 0; i < 12; i++) {
            calculateItemsInView(ctx);
        }
        await flushCorrection();

        expect(platformScrolls.length).toBeGreaterThan(before);
        expect(platformScrolls.at(-1)).toBe(TARGET_INDEX * MEASURED_SIZE - (VIEWPORT - ESTIMATED_SIZE) / 2);
    });

    it("releases the target when maintainScrollAtEnd takes over", () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle).toBeDefined();

        // The end anchor drives the scroller directly rather than going through scrollTo, so it has
        // to release the target itself.
        state.props.maintainScrollAtEnd = { animated: false, onDataChange: true } as any;
        ctx.values.set("isWithinMaintainScrollAtEndThreshold", true);
        state.didContainersLayout = true;
        doMaintainScrollAtEnd(ctx);

        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("releases the target when an imperative scroll is cancelled", () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle).toBeDefined();

        cancelImperativeScroll(state);

        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("does not correct while the initial scroll is still bootstrapping", async () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const before = platformScrolls.length;

        // A bootstrapping initial scroll owns the scroll position, and its passes deliberately run
        // without side effects.
        state.initialScrollSession = { bootstrap: { scroll: state.scroll }, kind: "bootstrap" } as any;
        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(platformScrolls).toHaveLength(before);
    });

    it("releases the target when a scroll asks for a raw offset", () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle).toBeDefined();

        // No target item to hold: the new request means what it says.
        scrollTo(ctx, { animated: false, offset: 100 });

        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("releases the target when an animated scroll takes over", () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        expect(ctx.state.scrollTargetSettle).toBeDefined();

        // The platform owns the scroll position for the length of an animation.
        scrollToIndex(ctx, { animated: true, index: 5, viewPosition: 0.5 });

        expect(ctx.state.scrollTargetSettle).toBeUndefined();
    });

    it("keeps the target across a data change on a list that anchors sizes", async () => {
        // The default shape when the prop is never set. Releasing here would switch the feature off
        // for the ordinary flow of appending rows and jumping in the same tick.
        state.props.maintainVisibleContentPosition = { data: false, size: true } as any;
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });

        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx, { dataChanged: true } as any);

        expect(ctx.state.scrollTargetSettle).toBeDefined();
    });

    it("re-aims across a prepend on a list that anchors nothing across data changes", async () => {
        // maintainVisibleContentPosition.data off means prepareMVCP does nothing on a data change:
        // positions are rebuilt from the front, the target moves, and no item measured. Nothing else
        // is holding this scroll's position, so the pending request has to.
        state.props.maintainVisibleContentPosition = { data: false, size: true } as any;
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const landedAt = state.scroll;

        prependItems(5);
        calculateItemsInView(ctx, { dataChanged: true } as any);
        await flushCorrection();

        // Five rows of 100 arrived above the target, so where it has to sit moved by 500.
        expect(Math.round(state.scroll)).toBe(Math.round(landedAt + 5 * ESTIMATED_SIZE));
    });

    it("leaves a prepend alone on a list that holds its position across data changes", async () => {
        // With data anchoring on, holding the target across the prepend is prepareMVCP's job, and
        // re-aiming on top of it would be two controllers on one scroll position.
        state.props.maintainVisibleContentPosition = { data: true, size: true } as any;
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const before = platformScrolls.length;

        prependItems(5);
        calculateItemsInView(ctx, { dataChanged: true } as any);
        await flushCorrection();

        expect(platformScrolls).toHaveLength(before);
    });

    it("does not let a correction re-arm the settle it came from", async () => {
        // A correction is not a new imperative scroll. If it claimed the scroll session it would
        // arm a fresh settle - with a fresh budget - from inside the one already running, so the
        // cap and the deadline would never be reached.
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(ctx.state.scrollTargetSettle?.corrections).toBe(1);
    });

    it("re-aims the scroll that is still waiting to complete", async () => {
        // Completion is measured against scrollingTo.targetOffset. A correction that moved the
        // destination without updating it leaves that scroll unable to recognise its own arrival.
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const originalTarget = state.scrollingTo?.targetOffset;
        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(state.scrollingTo?.targetOffset).toBe(state.scroll);
        expect(state.scrollingTo?.targetOffset).not.toBe(originalTarget);
    });

    it("re-aims the waiting scroll across a prepend, where its index no longer matches", async () => {
        // The pending scroll records the index the caller asked for. A prepend shifts every index,
        // so that number and the target's index now disagree - which is exactly the case tracking
        // the target by id exists for, and exactly where matching them up by index would fail.
        state.props.maintainVisibleContentPosition = { data: false, size: true } as any;
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const requestedIndex = state.scrollingTo?.index;
        const originalTarget = state.scrollingTo?.targetOffset;

        prependItems(5);
        calculateItemsInView(ctx, { dataChanged: true } as any);
        await flushCorrection();

        expect(state.indexByKey.get(`item_${TARGET_INDEX}`)).not.toBe(requestedIndex);
        expect(state.scrollingTo?.targetOffset).not.toBe(originalTarget);
        expect(state.scrollingTo?.targetOffset).toBe(state.scroll);
    });

    it("lets go of a held target when an initial scroll takes over the position", async () => {
        // An initial scroll claims the pending-scroll slot and re-resolves itself through its own
        // path. A target left holding from an earlier request would be paired with that scroll and
        // start correcting against a destination it never asked for.
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        expect(state.scrollTargetSettle).toBeDefined();

        scrollTo(ctx, { animated: false, isInitialScroll: true, offset: 0 } as any);

        expect(state.scrollTargetSettle).toBeUndefined();
    });

    it("recalculates after correcting rather than waiting for the platform", async () => {
        const triggers: number[] = [];
        state.triggerCalculateItemsInView = () => {
            triggers.push(1);
        };
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });

        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        triggers.length = 0;
        await flushCorrection();

        // A correction can move the viewport a long way; waiting for the echo leaves a blank frame.
        expect(triggers.length).toBeGreaterThan(0);
    });

    it("stands down while an adjustment is still queued for the platform", async () => {
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const before = platformScrolls.length;

        ctx.values.set("scrollAdjustPending", 25);
        layoutItems(MEASURED_SIZE);
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(platformScrolls).toHaveLength(before);
    });

    it("corrects a measurement that arrived while another controller was compensating", async () => {
        // The pass carrying a measurement is often the pass MVCP is compensating on, and the value
        // only lives for that one pass. Dropping it there means the target moved and nothing ever
        // re-aims - the defect this whole feature exists to fix, silently reintroduced.
        scrollToIndex(ctx, { animated: false, index: TARGET_INDEX, viewPosition: 0.5 });
        const afterJump = platformScrolls.length;

        layoutItems(MEASURED_SIZE);
        state.pendingNativeMVCPAdjust = { startScroll: state.scroll } as any;
        calculateItemsInView(ctx);
        await flushCorrection();
        expect(platformScrolls).toHaveLength(afterJump);

        // The compensation finishes. Nothing measures again, but the target did move.
        state.pendingNativeMVCPAdjust = undefined;
        state.minIndexSizeChanged = undefined;
        state.scrollForNextCalculateItemsInView = undefined;
        calculateItemsInView(ctx);
        await flushCorrection();

        expect(platformScrolls.length).toBeGreaterThan(afterJump);
        expect(platformScrolls.at(-1)).toBe(TARGET_INDEX * MEASURED_SIZE - (VIEWPORT - ESTIMATED_SIZE) / 2);
    });
});
