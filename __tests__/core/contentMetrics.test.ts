import { describe, expect, it, spyOn } from "bun:test";
import * as bootstrapInitialScrollModule from "../../src/core/bootstrapInitialScroll";
import { clampScrollOffset } from "../../src/core/clampScrollOffset";
import * as doMaintainScrollAtEndModule from "../../src/core/doMaintainScrollAtEnd";
import { setContentInsetOverride, setFooterSize, setHeaderSize } from "../../src/core/updateContentMetrics";
import { updateContentMetricsState } from "../../src/core/updateContentMetricsState";
import { Platform } from "../../src/platform/Platform";
import { getContentSize } from "../../src/state/getContentSize";
import * as requestAdjustModule from "../../src/utils/requestAdjust";
import { createMockContext } from "../__mocks__/createMockContext";

describe("updateContentMetrics", () => {
    it("counts padding on the active scroll axis", () => {
        const ctx = createMockContext(
            {
                footerSize: 20,
                headerSize: 10,
                stylePaddingTop: 100,
                totalSize: 100,
            },
            {
                props: {
                    horizontal: true,
                    stylePaddingBottom: 200,
                    stylePaddingLeft: 12,
                    stylePaddingRight: 18,
                },
            },
        );

        expect(getContentSize(ctx)).toBe(160);
    });

    it("excludes the trailing gap removed by the containers layer", () => {
        const ctx = createMockContext(
            { totalSize: 108 },
            {
                props: { data: [1] },
            },
        );
        ctx.scrollAxisGap = 8;

        expect(getContentSize(ctx)).toBe(100);
    });

    it("uses leading padding to absorb end inset for short vertical alignItemsAtEnd content", () => {
        const ctx = createMockContext(
            {
                totalSize: 84,
            },
            {
                contentInsetOverride: { bottom: 301 },
                props: {
                    alignItemsAtEnd: true,
                    alignItemsAtEndPaddingEnabled: true,
                    data: [1],
                },
                scrollLength: 664,
                totalSize: 84,
            },
        );

        updateContentMetricsState(ctx);

        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(279);
        expect(getContentSize(ctx)).toBe(664);
        expect(clampScrollOffset(ctx, 999)).toBe(0);
    });

    it("creates scroll range only for the end inset that exceeds available leading space", () => {
        const ctx = createMockContext(
            {
                totalSize: 500,
            },
            {
                contentInsetOverride: { bottom: 301 },
                props: {
                    alignItemsAtEnd: true,
                    alignItemsAtEndPaddingEnabled: true,
                    data: [1],
                },
                scrollLength: 664,
                totalSize: 500,
            },
        );

        updateContentMetricsState(ctx);

        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(0);
        expect(getContentSize(ctx)).toBe(801);
        expect(clampScrollOffset(ctx, 999)).toBe(137);
    });

    it("does not add leading padding when alignItemsAtEnd padding is disabled", () => {
        const ctx = createMockContext(
            {
                totalSize: 84,
            },
            {
                props: {
                    alignItemsAtEnd: true,
                    alignItemsAtEndPaddingEnabled: false,
                    data: [1],
                },
                scrollLength: 664,
                totalSize: 84,
            },
        );

        updateContentMetricsState(ctx);

        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(0);
    });

    it("releases animation runway when no maintain pass claims it", async () => {
        const ctx = createMockContext(
            { alignItemsAtEndPadding: 250, totalSize: 200 },
            {
                didContainersLayout: true,
                isWithinMaintainScrollAtEndThreshold: true,
                props: {
                    alignItemsAtEnd: true,
                    alignItemsAtEndPaddingEnabled: true,
                    data: [1],
                    maintainScrollAtEnd: { animated: true },
                },
                scrollLength: 400,
                totalSize: 200,
            },
        );

        updateContentMetricsState(ctx);
        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(250);

        await Promise.resolve();

        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(200);
    });

    it("coalesces animation runway fallback across synchronous content growth", async () => {
        const ctx = createMockContext(
            { alignItemsAtEndPadding: 250, totalSize: 200 },
            {
                didContainersLayout: true,
                isWithinMaintainScrollAtEndThreshold: true,
                props: {
                    alignItemsAtEnd: true,
                    alignItemsAtEndPaddingEnabled: true,
                    data: [1],
                    maintainScrollAtEnd: { animated: true },
                },
                scrollLength: 400,
                totalSize: 200,
            },
        );

        updateContentMetricsState(ctx);
        ctx.values.set("totalSize", 240);
        updateContentMetricsState(ctx);

        expect(ctx.state.scheduledWork.has("alignItemsAtEndPaddingFallback")).toBe(true);
        await Promise.resolve();

        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(160);
        expect(ctx.state.scheduledWork.has("alignItemsAtEndPaddingFallback")).toBe(false);
    });

    it("does not schedule fallback work after animated maintenance claims the runway", async () => {
        const ctx = createMockContext(
            { alignItemsAtEndPadding: 250, totalSize: 240 },
            {
                didContainersLayout: true,
                maintainingScrollAtEnd: "animated",
                props: {
                    alignItemsAtEnd: true,
                    alignItemsAtEndPaddingEnabled: true,
                    data: [1],
                    maintainScrollAtEnd: { animated: true },
                },
                scrollLength: 400,
                totalSize: 240,
            },
        );

        updateContentMetricsState(ctx);
        ctx.state.maintainingScrollAtEnd = undefined;
        await Promise.resolve();

        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(250);
    });

    it("updates content metrics when header size changes through the domain setter", () => {
        const ctx = createMockContext(
            {
                headerSize: 20,
                totalSize: 84,
            },
            {
                contentInsetOverride: { bottom: 301 },
                props: {
                    alignItemsAtEnd: true,
                    alignItemsAtEndPaddingEnabled: true,
                    data: [1],
                },
                scrollLength: 664,
                totalSize: 84,
            },
        );

        updateContentMetricsState(ctx);
        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(259);

        setHeaderSize(ctx, 0);

        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(279);
    });

    it("updates content metrics when reported content inset changes", () => {
        const ctx = createMockContext(
            {
                totalSize: 84,
            },
            {
                props: {
                    alignItemsAtEnd: true,
                    alignItemsAtEndPaddingEnabled: true,
                    data: [1],
                },
                scrollLength: 664,
                totalSize: 84,
            },
        );

        updateContentMetricsState(ctx);
        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(580);

        expect(setContentInsetOverride(ctx, { bottom: 301 })).toBe(true);
        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(279);
        expect(setContentInsetOverride(ctx, { bottom: 301 })).toBe(false);
    });

    it("updates content metrics when footer size changes through the domain setter", () => {
        const ctx = createMockContext(
            {
                footerSize: 20,
                totalSize: 84,
            },
            {
                contentInsetOverride: { bottom: 301 },
                props: {
                    alignItemsAtEnd: true,
                    alignItemsAtEndPaddingEnabled: true,
                    data: [1],
                },
                scrollLength: 664,
                totalSize: 84,
            },
        );

        updateContentMetricsState(ctx);
        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(259);

        expect(setFooterSize(ctx, 0)).toBe(true);

        expect(ctx.values.get("alignItemsAtEndPadding")).toBe(279);
    });

    it("reports unchanged footer sizes without updating content metrics", () => {
        const ctx = createMockContext(
            {
                footerSize: 12,
                totalSize: 1000,
            },
            {
                props: {},
            },
        );

        expect(setFooterSize(ctx, 12)).toBe(false);
        expect(ctx.values.get("footerSize")).toBe(12);
    });

    it("compensates web MVCP when a measured header changes above the viewport", () => {
        const prevPlatform = Platform.OS;
        Platform.OS = "web";
        const requestAdjustSpy = spyOn(requestAdjustModule, "requestAdjust");
        const ctx = createMockContext(
            {
                headerSize: 60,
                readyToRender: true,
                totalSize: 1000,
            },
            {
                didContainersLayout: true,
                didFinishInitialScroll: true,
                props: {
                    data: [1],
                    maintainVisibleContentPosition: { data: false, size: true },
                },
                scroll: 200,
                scrollLength: 500,
                totalSize: 1000,
            },
        );

        try {
            setHeaderSize(ctx, 60);
            expect(requestAdjustSpy).not.toHaveBeenCalled();

            requestAdjustSpy.mockClear();
            setHeaderSize(ctx, 120);

            expect(requestAdjustSpy).toHaveBeenCalledWith(ctx, 60);
        } finally {
            requestAdjustSpy.mockRestore();
            Platform.OS = prevPlatform;
        }
    });

    it("does not compensate the initial web MVCP header measurement", () => {
        const prevPlatform = Platform.OS;
        Platform.OS = "web";
        const requestAdjustSpy = spyOn(requestAdjustModule, "requestAdjust");
        const ctx = createMockContext(
            {
                readyToRender: true,
                totalSize: 1000,
            },
            {
                didContainersLayout: true,
                didFinishInitialScroll: true,
                props: {
                    data: [1],
                    maintainVisibleContentPosition: { data: false, size: true },
                },
                scroll: 200,
                scrollLength: 500,
                totalSize: 1000,
            },
        );

        try {
            setHeaderSize(ctx, 60);

            expect(requestAdjustSpy).not.toHaveBeenCalled();
        } finally {
            requestAdjustSpy.mockRestore();
            Platform.OS = prevPlatform;
        }
    });

    it("compensates the first non-zero web MVCP header measurement after a known absent header", () => {
        const prevPlatform = Platform.OS;
        Platform.OS = "web";
        const requestAdjustSpy = spyOn(requestAdjustModule, "requestAdjust");
        const ctx = createMockContext(
            {
                readyToRender: true,
                totalSize: 1000,
            },
            {
                didContainersLayout: true,
                didFinishInitialScroll: true,
                props: {
                    data: [1],
                    maintainVisibleContentPosition: { data: false, size: true },
                },
                scroll: 200,
                scrollLength: 500,
                totalSize: 1000,
            },
        );

        try {
            setHeaderSize(ctx, 0);
            expect(requestAdjustSpy).not.toHaveBeenCalled();

            requestAdjustSpy.mockClear();
            setHeaderSize(ctx, 60);

            expect(requestAdjustSpy).toHaveBeenCalledWith(ctx, 60);
        } finally {
            requestAdjustSpy.mockRestore();
            Platform.OS = prevPlatform;
        }
    });

    it("compensates the first measured web MVCP header size when replacing an estimate", () => {
        const prevPlatform = Platform.OS;
        Platform.OS = "web";
        const requestAdjustSpy = spyOn(requestAdjustModule, "requestAdjust");
        const ctx = createMockContext(
            {
                headerSize: 40,
                readyToRender: true,
                totalSize: 1000,
            },
            {
                didContainersLayout: true,
                didFinishInitialScroll: true,
                props: {
                    data: [1],
                    maintainVisibleContentPosition: { data: false, size: true },
                },
                scroll: 200,
                scrollLength: 500,
                totalSize: 1000,
            },
        );

        try {
            setHeaderSize(ctx, 60);

            expect(requestAdjustSpy).toHaveBeenCalledWith(ctx, 20);
        } finally {
            requestAdjustSpy.mockRestore();
            Platform.OS = prevPlatform;
        }
    });

    it("does not compensate web MVCP header changes while the header is visible", () => {
        const prevPlatform = Platform.OS;
        Platform.OS = "web";
        const requestAdjustSpy = spyOn(requestAdjustModule, "requestAdjust");
        const ctx = createMockContext(
            {
                headerSize: 60,
                readyToRender: true,
                totalSize: 1000,
            },
            {
                didContainersLayout: true,
                didFinishInitialScroll: true,
                didMeasureHeader: true,
                props: {
                    data: [1],
                    maintainVisibleContentPosition: { data: false, size: true },
                },
                scroll: 20,
                scrollLength: 500,
                totalSize: 1000,
            },
        );

        try {
            setHeaderSize(ctx, 120);

            expect(requestAdjustSpy).not.toHaveBeenCalled();
        } finally {
            requestAdjustSpy.mockRestore();
            Platform.OS = prevPlatform;
        }
    });
    it("follows the end when a header measures larger than its estimate mid initial scroll", () => {
        // Measured in the desktop app opening a one-to-one: the list scrolled to the end of 1631px of
        // content, the header then measured 100 -> 152, and nothing compensated it - MVCP was not
        // anchoring sizes and the initial scroll was still in flight, which is exactly when a header
        // first measures. Every message moved down by 52px and the thread sat 52px short of its
        // newest one.
        const prevPlatform = Platform.OS;
        Platform.OS = "web";
        const bootstrapSpy = spyOn(bootstrapInitialScrollModule, "handleBootstrapInitialScrollLayoutChange");
        const maintainSpy = spyOn(doMaintainScrollAtEndModule, "doMaintainScrollAtEnd");
        const ctx = createMockContext(
            {
                headerSize: 100,
                readyToRender: true,
                totalSize: 1631,
            },
            {
                didContainersLayout: true,
                didFinishInitialScroll: false,
                didMeasureHeader: true,
                props: {
                    data: [1],
                    maintainScrollAtEnd: { on: { headerLayout: true } },
                    maintainVisibleContentPosition: { data: true, size: false },
                },
                scroll: 844,
                scrollLength: 787,
                totalSize: 1631,
            },
        );

        try {
            setHeaderSize(ctx, 152);

            // The bootstrap re-aim is the half that covers this window: the end anchor declines a
            // scroll issued while the initial one is still in flight.
            expect(bootstrapSpy).toHaveBeenCalledWith(ctx);
            expect(maintainSpy).toHaveBeenCalledWith(ctx);
        } finally {
            bootstrapSpy.mockRestore();
            maintainSpy.mockRestore();
            Platform.OS = prevPlatform;
        }
    });

    it("re-aims an initial scroll on a header change without asking for the end trigger", () => {
        // The bootstrap re-aim is not a maintainScrollAtEnd behaviour: a list with an
        // initialScrollIndex and no end maintenance at all has the same header shift to answer for.
        const prevPlatform = Platform.OS;
        Platform.OS = "web";
        const bootstrapSpy = spyOn(bootstrapInitialScrollModule, "handleBootstrapInitialScrollLayoutChange");
        const maintainSpy = spyOn(doMaintainScrollAtEndModule, "doMaintainScrollAtEnd");
        const ctx = createMockContext(
            {
                headerSize: 100,
                readyToRender: true,
                totalSize: 1631,
            },
            {
                didContainersLayout: true,
                didFinishInitialScroll: false,
                didMeasureHeader: true,
                props: {
                    data: [1],
                    maintainScrollAtEnd: undefined,
                    maintainVisibleContentPosition: { data: true, size: false },
                },
                scroll: 844,
                scrollLength: 787,
                totalSize: 1631,
            },
        );

        try {
            setHeaderSize(ctx, 152);

            expect(bootstrapSpy).toHaveBeenCalledWith(ctx);
            expect(maintainSpy).not.toHaveBeenCalled();
        } finally {
            bootstrapSpy.mockRestore();
            maintainSpy.mockRestore();
            Platform.OS = prevPlatform;
        }
    });

    it("leaves the end alone for a header change the trigger is not asked for", () => {
        const prevPlatform = Platform.OS;
        Platform.OS = "web";
        const maintainSpy = spyOn(doMaintainScrollAtEndModule, "doMaintainScrollAtEnd");
        const ctx = createMockContext(
            {
                headerSize: 100,
                readyToRender: true,
                totalSize: 1631,
            },
            {
                didContainersLayout: true,
                didFinishInitialScroll: false,
                didMeasureHeader: true,
                props: {
                    data: [1],
                    maintainScrollAtEnd: { on: { itemLayout: true } },
                    maintainVisibleContentPosition: { data: true, size: false },
                },
                scroll: 844,
                scrollLength: 787,
                totalSize: 1631,
            },
        );

        try {
            setHeaderSize(ctx, 152);

            expect(maintainSpy).not.toHaveBeenCalled();
        } finally {
            maintainSpy.mockRestore();
            Platform.OS = prevPlatform;
        }
    });
});
