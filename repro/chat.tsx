import React from "react";

import { LegendList, type LegendListRef } from "@legendapp/list/react";
import type { Msg } from "./mock";
import type { Probe } from "./probe";

export interface ChatHandle {
    listRef: React.RefObject<LegendListRef | null>;
    scrollerEl: () => HTMLElement | null;
}

export interface ChatProps {
    centeredId: number | undefined;
    datasetKey: string;
    messages: Msg[];
    onEndReached: () => void;
    onStartReached: () => void;
    probe: Probe;
    ready: boolean;
}

// Image rows grow after mount, modelling decode. Two steps, so a fix that only survives one
// late layout still fails.
const IMAGE_GROWTH_STEPS = [
    { atMs: 150, extra: 40 },
    { atMs: 400, extra: 60 },
];

function Row({ msg, probe }: { msg: Msg; probe: Probe }) {
    const [extra, setExtra] = React.useState(0);

    React.useEffect(() => {
        if (msg.kind !== "image") {
            return;
        }
        setExtra(0);
        const timers = IMAGE_GROWTH_STEPS.map((step) =>
            setTimeout(() => {
                setExtra((prev) => prev + step.extra);
                probe.log("row.grew", { extra: step.extra, id: msg.id });
            }, step.atMs),
        );
        return () => {
            for (const t of timers) {
                clearTimeout(t);
            }
        };
    }, [msg.id, msg.kind, probe]);

    const height = msg.height + extra;

    React.useEffect(() => {
        probe.log("row.measured", { estimated: 72, height, id: msg.id });
    }, [height, msg.id, probe]);

    return (
        <div
            data-msg-id={msg.id}
            data-testid="row"
            style={{
                background: msg.kind === "image" ? "#1d2733" : "transparent",
                borderBottom: "1px solid #23282e",
                boxSizing: "border-box",
                height,
                overflow: "hidden",
                padding: "6px 12px",
            }}
        >
            <div style={{ color: "#8aa0b4", fontSize: 11 }}>
                #{msg.id} · {msg.kind}
            </div>
            <div>{msg.text}</div>
        </div>
    );
}

const MemoRow = React.memo(Row);

function Header() {
    return <div style={{ color: "#6d7d8c", padding: 12 }}>— beginning of conversation —</div>;
}

function Footer() {
    return <div style={{ height: 8 }} />;
}

export const Chat = React.forwardRef<ChatHandle, ChatProps>(function ChatComponent(props, ref) {
    const { centeredId, datasetKey, messages, onEndReached, onStartReached, probe, ready } = props;
    const listRef = React.useRef<LegendListRef | null>(null);
    const wrapperRef = React.useRef<HTMLDivElement | null>(null);

    const scrollerEl = React.useCallback((): HTMLElement | null => {
        const wrapper = wrapperRef.current;
        if (!wrapper) {
            return null;
        }
        // The scroller is the first descendant that actually overflows.
        const candidates = wrapper.querySelectorAll<HTMLElement>("*");
        for (const el of Array.from(candidates)) {
            if (el.scrollHeight - el.clientHeight > 1) {
                return el;
            }
        }
        return null;
    }, []);

    React.useImperativeHandle(ref, () => ({ listRef, scrollerEl }), [scrollerEl]);

    // Mirrors useInitialScrollIndex in the app: start at the hit when there is one, else at the end.
    const initialScrollIndex = React.useMemo(() => {
        if (centeredId === undefined) {
            return undefined;
        }
        const idx = messages.findIndex((m) => m.id === centeredId);
        return idx >= 0 ? ({ index: idx, viewPosition: 0.5 } as const) : undefined;
    }, [centeredId, messages]);

    // Mirrors useScrollToCentered: send the list to the hit once per dataset.
    const lastScrolledRef = React.useRef<number | undefined>(undefined);
    React.useLayoutEffect(() => {
        lastScrolledRef.current = undefined;
    }, [datasetKey]);

    React.useEffect(() => {
        if (!ready || centeredId === undefined) {
            lastScrolledRef.current = undefined;
            return;
        }
        if (lastScrolledRef.current === centeredId) {
            return;
        }
        if (!messages.some((m) => m.id === centeredId)) {
            return;
        }
        lastScrolledRef.current = centeredId;
        probe.log("scroll.request", { id: centeredId, viewPosition: 0.5 });
        void listRef.current?.scrollToItem({ animated: false, item: centeredId, viewPosition: 0.5 });
    }, [centeredId, datasetKey, messages, probe, ready]);

    const renderItem = React.useCallback(
        ({ item }: { item: number }) => {
            const msg = messages.find((m) => m.id === item);
            return msg ? <MemoRow msg={msg} probe={probe} /> : null;
        },
        [messages, probe],
    );

    const ids = React.useMemo(() => messages.map((m) => m.id), [messages]);

    const onScroll = React.useCallback(
        (e: unknown) => {
            const offset = (e as { nativeEvent?: { contentOffset?: { y?: number } } })?.nativeEvent?.contentOffset?.y;
            probe.log("scroll.observed", { offset: offset ?? scrollerEl()?.scrollTop ?? -1 });
        },
        [probe, scrollerEl],
    );

    return (
        <div ref={wrapperRef} style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
            <LegendList
                alignItemsAtEnd={true}
                data={ids}
                dataKey={datasetKey}
                drawDistance={250}
                estimatedItemSize={72}
                getItemType={(item: number) => messages.find((m) => m.id === item)?.kind ?? "text"}
                initialScrollAtEnd={initialScrollIndex === undefined}
                initialScrollIndex={initialScrollIndex}
                keyExtractor={(item: number) => String(item)}
                ListFooterComponent={Footer}
                ListHeaderComponent={Header}
                maintainScrollAtEnd={centeredId === undefined}
                maintainVisibleContentPosition={{ data: true }}
                onEndReached={onEndReached}
                onScroll={onScroll}
                onStartReached={onStartReached}
                onStartReachedThreshold={2}
                recycleItems={true}
                ref={listRef as React.Ref<LegendListRef>}
                renderItem={renderItem}
                style={{ height: "100%", outline: "none", overscrollBehavior: "contain", width: "100%" }}
            />
        </div>
    );
});
Chat.displayName = "Chat";
