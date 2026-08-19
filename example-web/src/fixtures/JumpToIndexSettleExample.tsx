import React from "react";

import { LegendList } from "@legendapp/list/react";
import { random } from "../random";

type Row = { id: string };

const SEED = 17;
const TARGETS = [120, 320, 640, 880];
const ESTIMATED_ITEM_SIZE = 60;
const heights = new Map<string, number>();

// Rows are three to seven times the estimate, which is the situation this fixture is for: the offset
// that satisfies "centre row N" is resolved from estimates and is wrong by thousands of pixels until
// the rows above the target measure.
const getHeight = (id: string) => {
    if (heights.has(id)) {
        return heights.get(id)!;
    }
    const height = Math.floor(random(SEED) * 240) + 180;
    heights.set(id, height);
    return height;
};

export default function JumpToIndexSettleExample() {
    const ref = React.useRef<any>(null);
    const scrollerRef = React.useRef<HTMLDivElement | null>(null);
    const [lastJump, setLastJump] = React.useState<string>("no jump yet");
    const data = React.useMemo<Row[]>(() => Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })), []);

    // Reports how far the target's centre ended up from the viewport centre. Anything but ~0 means
    // the request was satisfied against sizes that were only estimates at the time.
    const measureLanding = React.useCallback((index: number) => {
        const scroller = scrollerRef.current;
        const row = scroller?.querySelector<HTMLElement>(`[data-jump-row="${index}"]`);
        if (!scroller || !row) {
            setLastJump(`row ${index} is not mounted`);
            return;
        }
        const scrollerBox = scroller.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        const error = Math.round(rowBox.top + rowBox.height / 2 - (scrollerBox.top + scrollerBox.height / 2));
        setLastJump(`row ${index} is ${error}px from the viewport centre`);
    }, []);

    const jumpTo = React.useCallback(
        (index: number) => {
            setLastJump(`jumping to ${index}...`);
            ref.current?.scrollToIndex?.({ animated: true, index, viewPosition: 0.5 });
            // Well after the animation and the measurement passes that follow it.
            setTimeout(() => measureLanding(index), 1500);
        },
        [measureLanding],
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
                {TARGETS.map((index) => (
                    <button key={index} onClick={() => jumpTo(index)} type="button">
                        Centre row {index}
                    </button>
                ))}
                <span className="text-sm">{lastJump}</span>
            </div>
            <div className="min-h-0 flex-1" ref={scrollerRef}>
                <LegendList<Row>
                    className="min-h-0 h-full rounded-lg"
                    data={data}
                    estimatedItemSize={ESTIMATED_ITEM_SIZE}
                    keyExtractor={(it) => it?.id}
                    maintainVisibleContentPosition
                    recycleItems
                    ref={ref}
                    renderItem={({ item, index }: { item: Row; index: number }) => (
                        <div
                            className="flex items-center justify-center"
                            data-jump-row={index}
                            style={{
                                background: index % 2 ? "#f0f0f0" : "#ccc",
                                height: getHeight(item.id),
                            }}
                        >
                            Row {item.id}
                        </div>
                    )}
                />
            </div>
        </div>
    );
}
