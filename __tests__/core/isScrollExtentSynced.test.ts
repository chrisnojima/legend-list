import { beforeEach, describe, expect, it } from "bun:test";
import "../setup";

import { isScrollExtentSynced } from "../../src/core/isScrollExtentSynced";
import type { StateContext } from "../../src/state/state";
import { createMockContext } from "../__mocks__/createMockContext";

// totalSize 1000 with a 300 viewport, so the list believes 700 is scrollable.
function createContext(overrides?: { scrollLength?: number }): StateContext {
    return createMockContext(
        {
            footerSize: 0,
            headerSize: 0,
            stylePaddingTop: 0,
            totalSize: 1000,
        },
        {
            scrollLength: overrides?.scrollLength ?? 300,
        },
    );
}

function setScroller(ctx: StateContext, getMaxScrollOffset?: () => number) {
    ctx.state.refScroller.current = {
        flashScrollIndicators: () => {},
        getMaxScrollOffset,
        getScrollableNode: () => null,
        getScrollResponder: () => null,
        scrollTo: () => {},
        scrollToEnd: () => {},
    } as unknown as StateContext["state"]["refScroller"]["current"];
}

describe("isScrollExtentSynced", () => {
    let ctx: StateContext;

    beforeEach(() => {
        ctx = createContext();
    });

    it("treats a missing scroller as synced", () => {
        ctx.state.refScroller.current = null;
        expect(isScrollExtentSynced(ctx)).toBe(true);
    });

    it("treats a scroller without a measurable extent as synced", () => {
        // Native scrollers are not measured from a document, so they never report an extent.
        setScroller(ctx, undefined);
        expect(isScrollExtentSynced(ctx)).toBe(true);
    });

    it("is not synced while the platform extent lags the content size", () => {
        // The content element still has its pre-data-change size, so nothing is scrollable yet.
        setScroller(ctx, () => 0);
        expect(isScrollExtentSynced(ctx)).toBe(false);
    });

    it("is not synced while the platform extent is only partway caught up", () => {
        setScroller(ctx, () => 400);
        expect(isScrollExtentSynced(ctx)).toBe(false);
    });

    it("is synced once the platform extent reaches the content size", () => {
        setScroller(ctx, () => 700);
        expect(isScrollExtentSynced(ctx)).toBe(true);
    });

    it("tolerates sub-pixel rounding in the platform extent", () => {
        setScroller(ctx, () => 699.5);
        expect(isScrollExtentSynced(ctx)).toBe(true);
    });

    it("is synced when the platform extent exceeds the content size", () => {
        // Items were removed: the DOM is stale in the other direction, and every offset the list
        // can ask for is still reachable.
        setScroller(ctx, () => 5000);
        expect(isScrollExtentSynced(ctx)).toBe(true);
    });

    it("is synced when the content fits the viewport", () => {
        const shortCtx = createMockContext(
            { footerSize: 0, headerSize: 0, stylePaddingTop: 0, totalSize: 100 },
            { scrollLength: 300 },
        );
        setScroller(shortCtx, () => 0);
        expect(isScrollExtentSynced(shortCtx)).toBe(true);
    });

    it("is synced before the viewport has been measured", () => {
        // Nothing can be judged against a zero-height viewport, and gating here would delay the
        // first scroll of every list.
        const unmeasuredCtx = createContext({ scrollLength: 0 });
        setScroller(unmeasuredCtx, () => 0);
        expect(isScrollExtentSynced(unmeasuredCtx)).toBe(true);
    });
});
