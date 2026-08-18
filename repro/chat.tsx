import React from "react";

import { LegendList, type LegendListRef } from "@legendapp/list/react";
import type { Msg } from "./mock";
import type { Probe } from "./probe";
import { resolveVariant, type VariantId } from "./variants";

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
    variant: VariantId;
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
    const { centeredId, datasetKey, messages, onEndReached, onStartReached, probe, ready, variant } = props;
    const flags = React.useMemo(() => resolveVariant(variant), [variant]);
    const listRef = React.useRef<LegendListRef | null>(null);
    const wrapperRef = React.useRef<HTMLDivElement | null>(null);

    const scrollerEl = React.useCallback((): HTMLElement | null => {
        const wrapper = wrapperRef.current;
        if (!wrapper) {
            return null;
        }
        // "First descendant that overflows" is not enough: a multiline row clips up to ~42
        // wrapped words inside a fixed-height overflow:hidden div, so a row's own scrollHeight
        // can exceed its clientHeight too. Requiring the candidate to also contain a row rules
        // rows themselves out (a row's own [data-msg-id] element is never inside itself) and
        // rules out any other unrelated overflowing box, leaving only the real scroll container.
        // querySelectorAll returns document order, so the first qualifying match is also the
        // outermost one. Do not simplify this back to first-overflowing-element.
        const candidates = wrapper.querySelectorAll<HTMLElement>("*");
        for (const el of Array.from(candidates)) {
            if (el.scrollHeight - el.clientHeight > 1 && el.querySelector("[data-msg-id]")) {
                return el;
            }
        }
        return null;
    }, []);

    React.useImperativeHandle(ref, () => ({ listRef, scrollerEl }), [scrollerEl]);

    // Mirrors useInitialScrollIndex in the app: start at the hit when there is one, else at the
    // end. Variant D (numericInitialScrollIndex) matches the library's own chat example, which
    // passes a bare index rather than {index, viewPosition}.
    const initialScrollIndex = React.useMemo(() => {
        if (centeredId === undefined) {
            return undefined;
        }
        const idx = messages.findIndex((m) => m.id === centeredId);
        if (idx < 0) {
            return undefined;
        }
        return flags.numericInitialScrollIndex ? idx : ({ index: idx, viewPosition: 0.5 } as const);
    }, [centeredId, flags.numericInitialScrollIndex, messages]);

    // Mirrors useScrollToCentered: send the list to the hit once per dataset (imperative path).
    // Variant F (remountOnJump) instead forces the whole LegendList to remount, so the jump goes
    // through initialScrollIndex — the same path hit-cold already uses at first mount — rather
    // than an imperative scrollToItem call onto a live list.
    const lastScrolledRef = React.useRef<number | undefined>(undefined);
    const [listMountSeq, setListMountSeq] = React.useState(0);
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
        if (flags.remountOnJump) {
            probe.log("scroll.remount", { id: centeredId });
            setListMountSeq((n) => n + 1);
            return;
        }
        if (flags.deleteImperativeScroll) {
            // Variant H: no scrollToItem call, no remount — nothing else changed from control.
            // The library's own freshData bootstrap (dataKey + initialScrollIndex already being
            // correct on this commit) is trusted to land the target on its own. scroll.expected
            // is logged only so corrections() has something to arm against; it triggers no
            // library call.
            probe.log("scroll.expected", { id: centeredId, viewPosition: 0.5 });
            return;
        }
        probe.log("scroll.request", { id: centeredId, viewPosition: 0.5 });
        void listRef.current?.scrollToItem({ animated: false, item: centeredId, viewPosition: 0.5 });
    }, [centeredId, datasetKey, flags.deleteImperativeScroll, flags.remountOnJump, messages, probe, ready]);

    const renderItem = React.useCallback(
        ({ item }: { item: number }) => {
            const msg = messages.find((m) => m.id === item);
            return msg ? <MemoRow msg={msg} probe={probe} /> : null;
        },
        [messages, probe],
    );

    const ids = React.useMemo(() => messages.map((m) => m.id), [messages]);

    // Variant C: pin the centered target as the sole eligible data-change anchor. Every call is
    // logged so a run can be checked afterward for whether the library actually consulted this
    // predicate (see repro/API-AUDIT.md).
    const shouldRestorePosition = React.useMemo(() => {
        if (!flags.shouldRestorePosition) {
            return undefined;
        }
        return (item: number, index: number, _data: readonly number[]) => {
            const result = centeredId === undefined || item === centeredId;
            probe.log("shouldRestorePosition.call", { centeredId, index, item, result });
            return result;
        };
    }, [centeredId, flags.shouldRestorePosition, probe]);

    const getItemType = React.useCallback(
        (item: number) => messages.find((m) => m.id === item)?.kind ?? "text",
        [messages],
    );

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
                dataKey={flags.dropDataKey ? undefined : datasetKey}
                drawDistance={250}
                estimatedItemSize={72}
                getItemType={flags.dropGetItemType ? undefined : getItemType}
                initialScrollAtEnd={initialScrollIndex === undefined}
                initialScrollIndex={initialScrollIndex}
                key={`list-${listMountSeq}`}
                keyExtractor={(item: number) => String(item)}
                ListFooterComponent={Footer}
                ListHeaderComponent={Header}
                maintainScrollAtEnd={centeredId === undefined}
                maintainVisibleContentPosition={flags.mvcpBare ? true : { data: true, shouldRestorePosition }}
                onEndReached={onEndReached}
                onScroll={onScroll}
                onStartReached={onStartReached}
                onStartReachedThreshold={flags.startThreshold}
                recycleItems={true}
                ref={listRef as React.Ref<LegendListRef>}
                renderItem={renderItem}
                style={{ height: "100%", outline: "none", overscrollBehavior: "contain", width: "100%" }}
            />
        </div>
    );
});
Chat.displayName = "Chat";
