import { beforeEach, describe, expect, it, mock } from "bun:test";
import "../setup";

import * as React from "react";

import type { ScrollAdjustHandler } from "../../src/core/ScrollAdjustHandler";
import type { StateContext } from "../../src/state/state";
import type { LegendListRef } from "../../src/types";
import TestRenderer, { act } from "../helpers/testRenderer";

let lastListProps: any;
let scrollToIndexCalls: any[] = [];
const handlerInstances: ScrollAdjustHandler[] = [];

function registerImperativeScrollMocks() {
    mock.module("@/components/ListComponent", () => ({
        ListComponent: (props: any) => {
            lastListProps = props;
            return null;
        },
    }));

    mock.module("@/core/ScrollAdjustHandler", () => {
        return {
            ScrollAdjustHandler: class {
                context: StateContext;
                appliedAdjust = 0;
                pendingAdjust = 0;
                mounted = false;
                constructor(ctx: StateContext) {
                    this.context = ctx;
                    handlerInstances.push(this as any);
                }
                requestAdjust() {}
                setMounted() {
                    this.mounted = true;
                }
                getAdjust() {
                    return this.appliedAdjust;
                }
                commitPendingAdjust() {}
            },
        };
    });

    mock.module("@/core/scrollToIndex", () => ({
        scrollToIndex: (_ctx: unknown, params: any) => {
            scrollToIndexCalls.push(params);
        },
    }));
}

function createData(length: number) {
    return Array.from({ length }, (_value, index) => ({
        id: `item-${index}`,
        label: `Item ${index}`,
    }));
}

async function flushAsync() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function getContextFromRender() {
    for (let i = 0; i < 5; i++) {
        const handler = lastListProps?.scrollAdjustHandler ?? handlerInstances.at(-1);
        if (handler) {
            return (handler as any).context as StateContext;
        }
        await flushAsync();
    }
    throw new Error("scrollAdjustHandler not found after retries");
}

async function getStateFromRender() {
    return (await getContextFromRender()).state;
}

async function flushFrames(count: number) {
    for (let i = 0; i < count; i++) {
        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        });
    }
}

beforeEach(() => {
    registerImperativeScrollMocks();
    handlerInstances.length = 0;
    lastListProps = undefined;
    scrollToIndexCalls = [];
});

describe("LegendList imperative scrolls", () => {
    it("resolves scrollToEnd against data committed after the imperative call", async () => {
        const { LegendList } = await import("../../src/components/LegendList?imperative-scroll-commit");
        let sendMessage: () => void = () => {};

        function Harness() {
            const [data, setData] = React.useState(() => createData(2));
            const listRef = React.useRef<LegendListRef>(null);

            sendMessage = () => {
                setData((current) => [...current, { id: `item-${current.length}`, label: `Item ${current.length}` }]);
                listRef.current?.scrollToEnd({ animated: false });
            };

            return (
                <LegendList
                    data={data}
                    estimatedItemSize={50}
                    getFixedItemSize={() => 50}
                    keyExtractor={(item: { id: string }) => item.id}
                    recycleItems={false}
                    ref={listRef}
                    renderItem={() => null}
                />
            );
        }

        let renderer: ReturnType<typeof TestRenderer.create> | undefined;
        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
        });
        const state = await getStateFromRender();
        expect(state.props.data.length).toBe(2);

        await act(async () => {
            sendMessage();
        });

        expect(state.props.data.length).toBe(3);
        expect(scrollToIndexCalls).toEqual([
            expect.objectContaining({
                animated: false,
                index: 2,
                viewPosition: 1,
            }),
        ]);

        await act(async () => {
            renderer?.unmount();
        });
    });

    it("defers an imperative scroll until the platform scroll extent catches up", async () => {
        const { LegendList } = await import("../../src/components/LegendList?imperative-scroll-extent");
        let listRef: LegendListRef | null = null;

        function Harness() {
            const ref = React.useRef<LegendListRef>(null);
            listRef = ref.current;
            return (
                <LegendList
                    data={createData(100)}
                    estimatedItemSize={50}
                    getFixedItemSize={() => 50}
                    keyExtractor={(item: { id: string }) => item.id}
                    recycleItems={false}
                    ref={(instance: LegendListRef | null) => {
                        (ref as any).current = instance;
                        listRef = instance;
                    }}
                    renderItem={() => null}
                />
            );
        }

        let renderer: ReturnType<typeof TestRenderer.create> | undefined;
        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
        });
        const ctx = await getContextFromRender();
        const state = ctx.state;

        // A scroller whose extent still reflects the pre-data-change content: nothing is
        // scrollable yet even though the list knows the content is 5000 tall.
        let platformMaxScrollOffset = 0;
        state.scrollLength = 300;
        ctx.values.set("totalSize", 5000);
        state.refScroller.current = {
            flashScrollIndicators: () => {},
            getMaxScrollOffset: () => platformMaxScrollOffset,
            getScrollableNode: () => ({}) as any,
            getScrollResponder: () => null,
            scrollTo: () => {},
            scrollToEnd: () => {},
        } as any;

        await act(async () => {
            void listRef!.scrollToIndex({ animated: false, index: 90 });
        });
        await flushFrames(5);

        expect(scrollToIndexCalls).toHaveLength(0);

        platformMaxScrollOffset = 4700;
        await flushFrames(5);

        expect(scrollToIndexCalls).toEqual([expect.objectContaining({ animated: false, index: 90 })]);

        await act(async () => {
            renderer?.unmount();
        });
    });

    it("coalesces batched scrollToEnd requests onto the latest committed data", async () => {
        const { LegendList } = await import("../../src/components/LegendList?imperative-scroll-batched-commit");
        let sendBurst: () => void = () => {};
        const scrollPromises: Promise<void>[] = [];

        function Harness() {
            const [data, setData] = React.useState(() => createData(2));
            const listRef = React.useRef<LegendListRef>(null);

            sendBurst = () => {
                setData((current) => [...current, { id: `item-${current.length}`, label: `Item ${current.length}` }]);
                scrollPromises.push(listRef.current!.scrollToEnd({ animated: true }));
                setData((current) => [...current, { id: `item-${current.length}`, label: `Item ${current.length}` }]);
                scrollPromises.push(listRef.current!.scrollToEnd({ animated: true }));
            };

            return (
                <LegendList
                    data={data}
                    estimatedItemSize={50}
                    getFixedItemSize={() => 50}
                    keyExtractor={(item: { id: string }) => item.id}
                    recycleItems={false}
                    ref={listRef}
                    renderItem={() => null}
                />
            );
        }

        let renderer: ReturnType<typeof TestRenderer.create> | undefined;
        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
        });
        const state = await getStateFromRender();

        await act(async () => {
            sendBurst();
        });
        await Promise.all(scrollPromises);

        expect(state.props.data.length).toBe(4);
        expect(scrollPromises).toHaveLength(2);
        expect(scrollToIndexCalls).toEqual([
            expect.objectContaining({
                animated: true,
                index: 3,
                viewPosition: 1,
            }),
        ]);

        await act(async () => {
            renderer?.unmount();
        });
    });
});
