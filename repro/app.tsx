import React from "react";
import { createRoot } from "react-dom/client";

import { Chat, type ChatHandle } from "./chat";
import { FakeBackend, type Msg, makeMessages } from "./mock";
import { Probe, type ProbeEvent, positionError, type Verdict, verdictFor } from "./probe";
import { type Assertion, SCENARIOS, type ScenarioCtx } from "./scenarios";

declare const __REPRO_LIB__: string;

const ALL_MESSAGES = makeMessages(1000, 20260818);
const probe = new Probe();
const INITIAL_VIEWPORT_HEIGHT = 640;

function App() {
    const [messages, setMessages] = React.useState<Msg[]>([]);
    const [centeredId, setCenteredId] = React.useState<number | undefined>(undefined);
    const [datasetSeq, setDatasetSeq] = React.useState(0);
    const [ready, setReady] = React.useState(false);
    const [viewportHeight, setViewportHeight] = React.useState(INITIAL_VIEWPORT_HEIGHT);
    const [runSeq, setRunSeq] = React.useState(0);
    const [verdict, setVerdict] = React.useState<Verdict | undefined>(undefined);
    const [running, setRunning] = React.useState<string | undefined>(undefined);
    const [events, setEvents] = React.useState<ProbeEvent[]>([]);

    const chatRef = React.useRef<ChatHandle | null>(null);
    const messagesRef = React.useRef(messages);
    messagesRef.current = messages;

    const backend = React.useMemo(() => new FakeBackend({ latencyMs: 20, messages: ALL_MESSAGES }), []);

    const measure = React.useCallback((assertion: Assertion): { errPx: number; fullyVisible: boolean } => {
        const scroller = chatRef.current?.scrollerEl();
        if (!scroller) {
            return { errPx: Number.NaN, fullyVisible: false };
        }
        if (assertion.kind === "at-end") {
            const distance = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
            return { errPx: distance, fullyVisible: true };
        }
        const row = scroller.querySelector<HTMLElement>(`[data-msg-id="${assertion.targetId}"]`);
        if (!row) {
            probe.log("oracle.targetMissing", { targetId: assertion.targetId });
            return { errPx: Number.NaN, fullyVisible: false };
        }
        const rowRect = row.getBoundingClientRect();
        const viewRect = scroller.getBoundingClientRect();
        const errPx = positionError({
            rowHeight: rowRect.height,
            rowTop: rowRect.top,
            viewPosition: assertion.viewPosition,
            viewportHeight: viewRect.height,
            viewportTop: viewRect.top,
        });
        const fullyVisible = rowRect.top >= viewRect.top - 0.5 && rowRect.bottom <= viewRect.bottom + 0.5;
        return { errPx, fullyVisible };
    }, []);

    const runScenario = React.useCallback(
        async (name: string): Promise<Verdict> => {
            const scenario = SCENARIOS.find((s) => s.name === name);
            if (!scenario) {
                throw new Error(`unknown scenario: ${name}`);
            }
            setRunning(name);
            setVerdict(undefined);

            // Reset to a known state between runs so one scenario cannot inherit another's scroll,
            // dataset, or viewport height. Bumping runSeq changes <Chat>'s key, forcing a genuinely
            // fresh mount rather than a reused one carrying scroll state, and we wait for that
            // reset to be *observed* quiescent before starting the scenario's own clock — a fixed
            // wait can lose the race against a previous scenario's still-settling list.
            setMessages([]);
            setCenteredId(undefined);
            setReady(false);
            setDatasetSeq((n) => n + 1);
            setViewportHeight(INITIAL_VIEWPORT_HEIGHT);
            setRunSeq((n) => n + 1);
            await probe.waitForQuiescence({ capMs: 1000, quietMs: 100 });

            // The reset has settled: clear now, not before, so reset activity is not counted into
            // this scenario's own corrections or event log. Start this scenario's clock here too.
            probe.clear();
            probe.log("scenario.start", { name });
            const startedAt = performance.now();
            const ctx: ScenarioCtx = {
                appendNewest: (count) => {
                    const current = messagesRef.current;
                    const lastId = current.length ? current[current.length - 1]!.id : -1;
                    const next = ALL_MESSAGES.filter((m) => m.id > lastId).slice(0, count);
                    setMessages([...current, ...next]);
                },
                backend,
                bumpDataset: () => setDatasetSeq((n) => n + 1),
                probe,
                resize: (height) => setViewportHeight(height),
                setCentered: setCenteredId,
                setMessages,
                setReady,
                wait: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
            };

            const assertion = await scenario.run(ctx);
            const quiescence = await probe.waitForQuiescence({ capMs: 3000, quietMs: 250 });
            const settleMs = quiescence.quiescedAt - startedAt;
            const { errPx, fullyVisible } = measure(assertion);
            const next = verdictFor({ corrections: probe.corrections(), errPx, fullyVisible, settleMs });
            probe.log("scenario.end", { ...next, timedOut: quiescence.timedOut });
            setVerdict(next);
            setEvents(probe.events());
            setRunning(undefined);
            return next;
        },
        [backend, measure],
    );

    React.useEffect(() => {
        (window as unknown as Record<string, unknown>).__repro = {
            log: () => probe.events(),
            names: () => SCENARIOS.map((s) => s.name),
            result: () => verdict,
            run: runScenario,
        };
    }, [runScenario, verdict]);

    const onStartReached = React.useCallback(() => probe.log("list.startReached"), []);
    const onEndReached = React.useCallback(() => probe.log("list.endReached"), []);

    return (
        <div style={{ display: "flex", gap: 12, padding: 12, width: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 340 }}>
                <div style={{ fontWeight: 600 }}>legend-list repro · lib={__REPRO_LIB__}</div>
                {SCENARIOS.map((s) => (
                    <button
                        data-testid={`run-${s.name}`}
                        disabled={running !== undefined}
                        key={s.name}
                        onClick={() => void runScenario(s.name)}
                        style={{ cursor: "pointer", padding: 6, textAlign: "left" }}
                        title={s.proves}
                        type="button"
                    >
                        {s.name}
                    </button>
                ))}
                <div data-testid="verdict" style={{ background: "#1b1f24", minHeight: 64, padding: 8 }}>
                    {verdict ? (
                        <>
                            <div style={{ color: verdict.pass ? "#5ac47c" : "#e2564a", fontWeight: 600 }}>
                                {verdict.pass ? "PASS" : "FAIL"}
                            </div>
                            <div>err {verdict.errPx.toFixed(1)}px</div>
                            <div>settle {verdict.settleMs.toFixed(0)}ms</div>
                            <div>visible {String(verdict.fullyVisible)}</div>
                        </>
                    ) : (
                        <div>{running ? `running ${running}…` : "no run yet"}</div>
                    )}
                </div>
                <button
                    onClick={() => void navigator.clipboard.writeText(JSON.stringify(events, null, 2))}
                    type="button"
                >
                    copy log
                </button>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, maxHeight: 260, overflow: "auto" }}>
                    {events.slice(-80).map((e, i) => (
                        <div key={`${e.t}-${i}`}>
                            {e.t.toFixed(0)} {e.type} {JSON.stringify(e.detail)}
                        </div>
                    ))}
                </div>
            </div>
            <div
                style={{
                    border: "1px solid #2a2f35",
                    display: "flex",
                    flexDirection: "column",
                    height: viewportHeight,
                    width: 520,
                }}
            >
                <Chat
                    centeredId={centeredId}
                    datasetKey={`ds-${datasetSeq}`}
                    key={`chat-${runSeq}`}
                    messages={messages}
                    onEndReached={onEndReached}
                    onStartReached={onStartReached}
                    probe={probe}
                    ready={ready}
                    ref={chatRef}
                />
            </div>
        </div>
    );
}

createRoot(document.getElementById("root")!).render(<App />);
