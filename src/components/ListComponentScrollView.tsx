// biome-ignore lint/style/useImportType: Leaving this out makes it crash in some environments
import * as React from "react";
import {
    type CSSProperties,
    forwardRef,
    type HTMLAttributes,
    type ReactElement,
    type ReactNode,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
} from "react";

import type { LayoutRectangle, NativeSyntheticEvent } from "@/platform/platform-types";
import { StyleSheet } from "@/platform/StyleSheet";
import { useArr$, useStateContext } from "@/state/state";
import { IS_DEV } from "@/utils/devEnvironment";
import { warnDevOnce } from "@/utils/helpers";
import { isInMVCPActiveMode } from "@/utils/isInMVCPActiveMode";
import { useRafCoalescer } from "@/utils/useRafCoalescer";
import {
    LEGEND_LIST_CONTENT_CONTAINER_CLASS,
    LEGEND_LIST_SCROLLBAR_X_HIDDEN_CLASS,
    LEGEND_LIST_SCROLLBAR_Y_HIDDEN_CLASS,
} from "./webConstants";
import {
    clampOffset,
    getContentSize,
    getElementDocumentPosition,
    getLayoutMeasurement,
    getLayoutRectangle,
    getMaxOffset,
    getScrollContentSize,
    getWindowScrollPosition,
    resolveScrollableNode,
    resolveScrollEventTarget,
    resolveWindowScrollTarget,
    type ScrollEventTarget,
} from "./webScrollUtils";

export type LayoutChangeEvent = NativeSyntheticEvent<{ layout: LayoutRectangle }>;

export interface ScrollViewMethods {
    getBoundingClientRect(): DOMRect | null | undefined;
    getCurrentScrollOffset(): number;
    getScrollableNode(): HTMLElement;
    getScrollEventTarget(): ScrollEventTarget | null;
    getScrollResponder(): HTMLElement | null;
    isWindowScroll?(): boolean;
    scrollBy(x: number, y: number): void;
    scrollTo(options: { x?: number; y?: number; animated?: boolean }): void;
    scrollToEnd(options?: { animated?: boolean }): void;
    scrollToOffset(params: { offset: number; animated?: boolean }): void;
}

export interface ListComponentScrollViewProps {
    className?: string;
    contentContainerClassName?: string;
    horizontal?: boolean;
    contentContainerStyle?: CSSProperties;
    contentOffset?: { x: number; y: number };
    maintainVisibleContentPosition?: { minIndexForVisible: number };
    onScroll?: (event: {
        nativeEvent: {
            contentOffset: { x: number; y: number };
            contentSize: { width: number; height: number };
            layoutMeasurement: { width: number; height: number };
        };
    }) => void;
    onInternalScrollEnd?: () => void;
    onMomentumScrollEnd?: (event: {
        nativeEvent: {
            contentOffset: { x: number; y: number };
        };
    }) => void;
    snapToOffsets?: number[];
    showsHorizontalScrollIndicator?: boolean;
    showsVerticalScrollIndicator?: boolean;
    refreshControl?: ReactElement;
    children: ReactNode;
    style: CSSProperties;
    useWindowScroll?: boolean;
    onLayout: (event: LayoutChangeEvent) => void;
}

interface ExtraPropsFromRN {
    contentInset?: { bottom?: number; left?: number; right?: number; top?: number };
    scrollEventThrottle?: number;
    ScrollComponent?: React.ComponentType<unknown>;
}

const SCROLLBAR_HIDDEN_STYLE_ID = "legend-list-scrollbar-axis-hidden-style";
const SCROLL_END_FALLBACK_MS = 200;
// Slack for comparing a measured document extent against a computed offset.
const SCROLL_EXTENT_EPSILON = 1;
// How many frames a scroll may wait for the content it was aimed at to commit. Generous enough to
// cover a slow commit, bounded so a request the content never grows to reach gives up.
const REACHABLE_RETRY_FRAMES = 30;
const SCROLLBAR_HIDDEN_STYLE = `.${LEGEND_LIST_SCROLLBAR_Y_HIDDEN_CLASS}::-webkit-scrollbar:vertical{width:0;display:none;}.${LEGEND_LIST_SCROLLBAR_X_HIDDEN_CLASS}::-webkit-scrollbar:horizontal{height:0;display:none;}`;

function ensureScrollbarHiddenStyle() {
    if (typeof document === "undefined" || document.getElementById(SCROLLBAR_HIDDEN_STYLE_ID)) {
        return;
    }

    const styleElement = document.createElement("style");
    styleElement.id = SCROLLBAR_HIDDEN_STYLE_ID;
    styleElement.textContent = SCROLLBAR_HIDDEN_STYLE;
    document.head.appendChild(styleElement);
}

function getContentInsetEndAdjustmentEnd(ctx: ReturnType<typeof useStateContext>) {
    const adjustment = ctx.state?.props?.contentInsetEndAdjustment;
    return Math.max(0, adjustment ?? 0);
}

function getFiniteSnapOffsets(snapToOffsets: number[] | undefined): number[] {
    if (!snapToOffsets?.length) {
        return [];
    }

    const snapOffsets: number[] = [];
    const seen = new Set<number>();
    for (const offset of snapToOffsets) {
        if (Number.isFinite(offset) && !seen.has(offset)) {
            seen.add(offset);
            snapOffsets.push(offset);
        }
    }
    return snapOffsets;
}

function getSnapAnchorStyle(offset: number, horizontal: boolean): CSSProperties {
    return {
        height: horizontal ? "100%" : 1,
        left: horizontal ? offset : 0,
        pointerEvents: "none",
        position: "absolute",
        scrollSnapAlign: "start",
        top: horizontal ? 0 : offset,
        width: horizontal ? 1 : "100%",
    };
}

// biome-ignore lint/nursery/noShadow: const function name shadowing is intentional
export const ListComponentScrollView = forwardRef(function ListComponentScrollView(
    {
        children,
        style,
        contentContainerClassName,
        contentContainerStyle,
        horizontal = false,
        contentOffset,
        maintainVisibleContentPosition,
        onScroll,
        onInternalScrollEnd,
        onMomentumScrollEnd: _onMomentumScrollEnd,
        showsHorizontalScrollIndicator = true,
        showsVerticalScrollIndicator = true,
        refreshControl,
        useWindowScroll = false,
        onLayout,
        ...props
    }: ListComponentScrollViewProps,
    ref: React.Ref<HTMLDivElement>,
) {
    const ctx = useStateContext();
    const [anchoredEndSpaceSize] = useArr$(["anchoredEndSpaceSize"]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const isWindowScroll = useWindowScroll;
    const getScrollTarget = useCallback(
        () => resolveScrollEventTarget(scrollRef.current, isWindowScroll),
        [isWindowScroll],
    );

    const getMaxScrollOffset = useCallback(() => {
        const scrollElement = scrollRef.current;
        const contentSize = getScrollContentSize(scrollElement, contentRef.current, isWindowScroll);
        const layoutMeasurement = getLayoutMeasurement(scrollElement, isWindowScroll, horizontal);
        return getMaxOffset(contentSize, layoutMeasurement, horizontal);
    }, [horizontal, isWindowScroll]);

    const getCurrentScrollOffset = useCallback(() => {
        const scrollElement = scrollRef.current;

        if (isWindowScroll) {
            const maxOffset = getMaxScrollOffset();
            const scroll = getWindowScrollPosition();
            const listPos = getElementDocumentPosition(scrollElement, scroll);
            const rawOffset = horizontal ? scroll.x - listPos.left : scroll.y - listPos.top;
            return clampOffset(rawOffset, maxOffset);
        }

        if (!scrollElement) {
            return 0;
        }

        return horizontal ? scrollElement.scrollLeft : scrollElement.scrollTop;
    }, [getMaxScrollOffset, horizontal, isWindowScroll]);

    // The scroll extent is measured from the document, which lags a React commit: for a frame after
    // the content changes size the element still reports its previous extent, so a scroll issued in
    // that window is clamped to somewhere short of the request - often to 0 - and the caller has no
    // way to know. Re-issue it on later frames until the content the request was resolved against
    // has committed, bounded so a request the content never grows to reach cannot retry forever.
    //
    // Deliberately not gated on how far the request reaches. The offset is resolved from positions
    // that include estimates, so it can legitimately sit past the list's own totalSize while the DOM
    // extent it would be compared against is still 0 in the same frame. Measured on a chat thread
    // jumping to a search hit: offset 9047, committed extent 0.
    const reissueHandleRef = useRef(0);
    const scrollUntilReachable = useCallback(
        (offset: number, animated: boolean, run: (reachableOffset: number) => void) => {
            cancelAnimationFrame(reissueHandleRef.current);
            let attempts = 0;
            let previousMaxOffset = Number.NEGATIVE_INFINITY;
            const attempt = () => {
                const liveMaxOffset = getMaxScrollOffset();
                run(clampOffset(offset, liveMaxOffset));
                // Waiting is only worth anything while the content is still growing towards the
                // request. An extent that has stopped moving is the list saying this is all there
                // is - a page-down at the end of a list asks past the end every time, and retrying
                // that would scroll on top of the user for the length of the budget. The frame
                // count stays as a backstop for content that grows without pause.
                const isStillCommitting = liveMaxOffset > previousMaxOffset;
                previousMaxOffset = liveMaxOffset;
                // An animated scroll is left alone: re-issuing a smooth scroll restarts its
                // animation every frame, which is worse than landing short.
                if (
                    !animated &&
                    isStillCommitting &&
                    Number.isFinite(offset) &&
                    offset - liveMaxOffset > SCROLL_EXTENT_EPSILON &&
                    ++attempts < REACHABLE_RETRY_FRAMES
                ) {
                    reissueHandleRef.current = requestAnimationFrame(attempt);
                }
            };
            attempt();
        },
        [getMaxScrollOffset],
    );

    useEffect(() => () => cancelAnimationFrame(reissueHandleRef.current), []);

    const scrollToLocalOffset = useCallback(
        (offset: number, animated: boolean) => {
            const scrollElement = scrollRef.current;
            const target = getScrollTarget();
            if (!target || typeof target.scrollTo !== "function") {
                return;
            }

            const behavior = animated ? "smooth" : "auto";
            const options: ScrollToOptions = { behavior };

            if (isWindowScroll) {
                // The document, not this element, owns the extent here, so there is nothing local to
                // wait for: resolve against the window and issue it once.
                const scroll = getWindowScrollPosition();
                const listPos = getElementDocumentPosition(scrollElement, scroll);
                const { left, top } = resolveWindowScrollTarget({
                    clampedOffset: clampOffset(offset, getMaxScrollOffset()),
                    horizontal,
                    listPos,
                    scroll,
                });
                options.left = left;
                options.top = top;
                target.scrollTo(options);
                return;
            }

            scrollUntilReachable(offset, animated, (reachableOffset) => {
                if (horizontal) {
                    options.left = reachableOffset;
                } else {
                    options.top = reachableOffset;
                }
                target.scrollTo(options);
            });
        },
        [getMaxScrollOffset, getScrollTarget, horizontal, isWindowScroll, scrollUntilReachable],
    );

    useImperativeHandle(ref, () => {
        const api: ScrollViewMethods = {
            getBoundingClientRect: () => scrollRef.current?.getBoundingClientRect(),
            getCurrentScrollOffset,
            getScrollableNode: () => resolveScrollableNode(scrollRef.current, isWindowScroll)!,
            getScrollEventTarget: () => getScrollTarget(),
            getScrollResponder: () => resolveScrollableNode(scrollRef.current, isWindowScroll),
            isWindowScroll: () => isWindowScroll,
            scrollBy: (x: number, y: number) => {
                const target = getScrollTarget();
                if (!target || typeof target.scrollBy !== "function") {
                    return;
                }
                target.scrollBy({ behavior: "auto", left: x, top: y });
            },
            scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => {
                const { x = 0, y = 0, animated = true } = options;
                scrollToLocalOffset(horizontal ? x : y, animated);
            },
            scrollToEnd: (options: { animated?: boolean } = {}) => {
                const { animated = true } = options;
                // Deliberately the committed end: room borrowed by a scroll still in flight is not
                // content to scroll to.
                scrollToLocalOffset(getMaxScrollOffset(), animated);
            },
            scrollToOffset: (params: { offset: number; animated?: boolean }) => {
                const { offset, animated = true } = params;
                scrollToLocalOffset(offset, animated);
            },
        };
        return api as unknown as HTMLDivElement & ScrollViewMethods;
    }, [getCurrentScrollOffset, getMaxScrollOffset, getScrollTarget, horizontal, isWindowScroll, scrollToLocalOffset]);

    // DOM scroll events can fire multiple times inside one paint. Coalesce them into a single
    // RN-shaped event per frame so downstream scroll bookkeeping sees stable measurements.
    const emitScroll = useCallback(() => {
        if (!onScroll || !scrollRef.current) {
            return;
        }

        const contentSize = getContentSize(contentRef.current);
        const layoutMeasurement = getLayoutMeasurement(scrollRef.current, isWindowScroll, horizontal);
        const offset = getCurrentScrollOffset();

        const scrollEvent = {
            nativeEvent: {
                contentOffset: {
                    x: horizontal ? offset : 0,
                    y: horizontal ? 0 : offset,
                },
                contentSize: {
                    height: contentSize.height,
                    width: contentSize.width,
                },
                layoutMeasurement: {
                    height: layoutMeasurement.height,
                    width: layoutMeasurement.width,
                },
            },
        };

        onScroll(scrollEvent);
    }, [getCurrentScrollOffset, horizontal, isWindowScroll, onScroll]);

    const scrollEventCoalescer = useRafCoalescer(emitScroll);
    const scrollEndFallbackRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const emitScrollEnd = useCallback(() => {
        const timeout = scrollEndFallbackRef.current;
        if (timeout !== undefined) {
            clearTimeout(timeout);
            scrollEndFallbackRef.current = undefined;
        }
        scrollEventCoalescer.flush();
        onInternalScrollEnd?.();
    }, [onInternalScrollEnd, scrollEventCoalescer]);

    const handleScroll = useCallback(
        (_event: Event) => {
            if (!onScroll) {
                return;
            }

            const state = ctx.state;
            const shouldFlushImmediately =
                !!state?.scrollingTo ||
                (!!state?.initialScrollSession && !state.didFinishInitialScroll) ||
                (!!state?.initialScroll && !state.didFinishInitialScroll) ||
                (!!state && isInMVCPActiveMode(state));
            if (shouldFlushImmediately) {
                scrollEventCoalescer.flush();
            } else {
                scrollEventCoalescer.schedule();
            }

            if (onInternalScrollEnd) {
                const timeout = scrollEndFallbackRef.current;
                if (timeout !== undefined) {
                    clearTimeout(timeout);
                }
                scrollEndFallbackRef.current = setTimeout(emitScrollEnd, SCROLL_END_FALLBACK_MS);
            }
        },
        [ctx.state, emitScrollEnd, onInternalScrollEnd, onScroll, scrollEventCoalescer],
    );

    useLayoutEffect(() => {
        const target = getScrollTarget();
        if (!target) return;
        target.addEventListener("scroll", handleScroll, { passive: true });
        if ("onscrollend" in target) {
            target.addEventListener("scrollend", emitScrollEnd);
        }
        return () => {
            target.removeEventListener("scroll", handleScroll);
            if ("onscrollend" in target) {
                target.removeEventListener("scrollend", emitScrollEnd);
            }
            const timeout = scrollEndFallbackRef.current;
            if (timeout !== undefined) {
                clearTimeout(timeout);
                scrollEndFallbackRef.current = undefined;
            }
            scrollEventCoalescer.cancel();
        };
    }, [emitScrollEnd, getScrollTarget, handleScroll, scrollEventCoalescer]);

    // Set initial scroll offset
    useEffect(() => {
        const doScroll = () => {
            if (contentOffset) {
                scrollToLocalOffset(horizontal ? contentOffset.x || 0 : contentOffset.y || 0, false);
            }
        };
        doScroll();
        requestAnimationFrame(doScroll);
    }, [contentOffset?.x, contentOffset?.y, horizontal, scrollToLocalOffset]);

    // Handle layout callback and observe size changes at the ScrollView level
    useLayoutEffect(() => {
        if (!onLayout || !scrollRef.current) return;
        const element = scrollRef.current;

        const fireLayout = () => {
            onLayout({
                nativeEvent: {
                    layout: getLayoutRectangle(element, isWindowScroll, horizontal),
                },
            });
        };

        // Initial
        fireLayout();

        // Observe ScrollView size changes
        const resizeObserver = new ResizeObserver(() => {
            fireLayout();
        });
        resizeObserver.observe(element);

        const onWindowResize = () => {
            fireLayout();
        };
        if (isWindowScroll && typeof window !== "undefined" && typeof window.addEventListener === "function") {
            window.addEventListener("resize", onWindowResize);
        }

        return () => {
            resizeObserver.disconnect();
            if (isWindowScroll && typeof window !== "undefined" && typeof window.removeEventListener === "function") {
                window.removeEventListener("resize", onWindowResize);
            }
        };
    }, [isWindowScroll, onLayout]);

    const hiddenScrollIndicatorClassName =
        !isWindowScroll &&
        (horizontal
            ? !showsHorizontalScrollIndicator && LEGEND_LIST_SCROLLBAR_X_HIDDEN_CLASS
            : !showsVerticalScrollIndicator && LEGEND_LIST_SCROLLBAR_Y_HIDDEN_CLASS);

    useLayoutEffect(() => {
        if (hiddenScrollIndicatorClassName) {
            ensureScrollbarHiddenStyle();
        }
    }, [hiddenScrollIndicatorClassName]);

    const scrollViewStyle: CSSProperties = {
        ...(isWindowScroll
            ? {}
            : {
                  overflow: "auto",
                  overflowX: horizontal ? "auto" : showsHorizontalScrollIndicator ? "auto" : "hidden",
                  overflowY: horizontal ? (showsVerticalScrollIndicator ? "auto" : "hidden") : "auto",
                  WebkitOverflowScrolling: "touch", // iOS momentum scrolling
              }),
        ...StyleSheet.flatten(style),
        ...(maintainVisibleContentPosition
            ? {
                  // Chrome's native scroll anchoring can apply after LegendList's MVCP adjustment,
                  // causing the same header/item-size delta to be compensated twice.
                  overflowAnchor: "none",
              }
            : {}),
    };

    const contentInsetEndAdjustment = getContentInsetEndAdjustmentEnd(ctx);
    const anchoredEndInset = ctx.state?.props?.anchoredEndSpace && anchoredEndSpaceSize ? anchoredEndSpaceSize : 0;
    const renderedContentInsetEndAdjustment = Math.max(0, contentInsetEndAdjustment - anchoredEndInset);
    const contentInsetEndAdjustmentSpacerStyle: CSSProperties | undefined = renderedContentInsetEndAdjustment
        ? horizontal
            ? { flexShrink: 0, width: renderedContentInsetEndAdjustment }
            : { height: renderedContentInsetEndAdjustment }
        : undefined;
    const contentStyle: CSSProperties = {
        display: horizontal ? "flex" : "block",
        flexDirection: horizontal ? "row" : undefined,
        minHeight: horizontal ? undefined : "100%",
        minWidth: horizontal ? "100%" : undefined,
        ...StyleSheet.flatten(contentContainerStyle),
        ...(maintainVisibleContentPosition
            ? {
                  overflowAnchor: "none",
              }
            : {}),
    };
    const className = contentContainerClassName
        ? `${LEGEND_LIST_CONTENT_CONTAINER_CLASS} ${contentContainerClassName}`
        : LEGEND_LIST_CONTENT_CONTAINER_CLASS;

    const {
        contentContainerClassName: _contentContainerClassName,
        contentInset: _contentInset,
        scrollEventThrottle: _scrollEventThrottle,
        ScrollComponent: _ScrollComponent,
        snapToOffsets,
        useWindowScroll: _useWindowScroll,
        className: scrollViewClassNameProp,
        ...webProps
    } = props as ListComponentScrollViewProps & ExtraPropsFromRN & HTMLAttributes<HTMLDivElement>;
    const snapOffsets = !isWindowScroll ? getFiniteSnapOffsets(snapToOffsets) : [];
    if (snapOffsets.length > 0) {
        scrollViewStyle.scrollSnapType = horizontal ? "x mandatory" : "y mandatory";
        contentStyle.position = contentStyle.position ?? "relative";
    }
    const scrollViewClassName = hiddenScrollIndicatorClassName
        ? scrollViewClassNameProp
            ? `${scrollViewClassNameProp} ${hiddenScrollIndicatorClassName}`
            : hiddenScrollIndicatorClassName
        : scrollViewClassNameProp;

    if (IS_DEV) {
        if (
            /(?:^|\s)(?:[a-z0-9_-]+:)*gap(?:-[xy])?-(?:\[[^\]]+\]|[^\s]+)/.test(
                `${contentContainerClassName ?? ""} ${scrollViewClassNameProp ?? ""}`,
            )
        ) {
            warnDevOnce(
                "className-gap",
                "className/contentContainerClassName gap classes are not supported in LegendList because it needs to use exact values internally. Use contentContainerStyle={{ gap: ... }} or columnWrapperStyle instead.",
            );
        }
    }

    return (
        <div
            className={scrollViewClassName}
            ref={scrollRef}
            {...(webProps as HTMLAttributes<HTMLDivElement>)}
            style={scrollViewStyle}
        >
            {refreshControl}
            <div className={className} ref={contentRef} style={contentStyle}>
                {snapOffsets.map((offset) => (
                    <div
                        aria-hidden={true}
                        data-legend-list-snap-anchor={offset}
                        key={`snap-${offset}`}
                        style={getSnapAnchorStyle(offset, horizontal)}
                    />
                ))}
                {children}
                {contentInsetEndAdjustmentSpacerStyle ? (
                    <div aria-hidden={true} style={contentInsetEndAdjustmentSpacerStyle} />
                ) : null}
            </div>
        </div>
    );
});
