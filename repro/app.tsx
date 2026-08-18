import React from "react";
import { createRoot } from "react-dom/client";

import { Chat, type ChatHandle } from "./chat";
import { FakeBackend, type Msg, makeMessages } from "./mock";
import { Probe, type ProbeEvent, positionError, type Verdict, verdictFor } from "./probe";
import { type Assertion, SCENARIOS, type ScenarioCtx } from "./scenarios";
import { variantFromSearch } from "./variants";

declare const __REPRO_LIB__: string;

const ALL_MESSAGES = makeMessages(1000, 20260818);
const probe = new Probe();
const INITIAL_VIEWPORT_HEIGHT = 640;
// Read once at module load: the harness never changes variant mid-session, only across page
// loads (repro/run.mjs's --variant flag sets it via the URL before navigating).
const VARIANT = variantFromSearch(window.location.search);

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
    // result() must be correct immediately after run() resolves; the `verdict` state above only
    // reflects what React has committed, which can still be the previous run's value at that
    // point. Backed by a ref instead, written synchronously alongside the state.
    const verdictRef = React.useRef<Verdict | undefined>(undefined);
    // Serializes window.__repro.run calls: the HUD buttons are guarded by `running`, but the
    // automation surface was not, and two overlapping runs would share and corrupt one Probe.
    const runLockRef = React.useRef<Promise<unknown>>(Promise.resolve());

    const backend = React.useMemo(() => new FakeBackend({ latencyMs: 20, messages: ALL_MESSAGES }), []);

    const measure = React.useCallback(
        (assertion: Assertion): { errPx: number; fullyVisible: boolean; targetMissing: boolean } => {
            const scroller = chatRef.current?.scrollerEl();
            if (!scroller) {
                return { errPx: Number.NaN, fullyVisible: false, targetMissing: false };
            }
            if (assertion.kind === "at-end") {
                const distance = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
                return { errPx: distance, fullyVisible: true, targetMissing: false };
            }
            const row = scroller.querySelector<HTMLElement>(`[data-msg-id="${assertion.targetId}"]`);
            if (!row) {
                probe.log("oracle.targetMissing", { targetId: assertion.targetId });
                return { errPx: Number.NaN, fullyVisible: false, targetMissing: true };
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
            return { errPx, fullyVisible, targetMissing: false };
        },
        [],
    );

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
            const resetQuiescence = await probe.waitForQuiescence({ capMs: 1000, quietMs: 100 });

            // The reset has settled (or gave up): clear now, not before, so reset activity is not
            // counted into this scenario's own corrections or event log. Start this scenario's
            // clock here too. A reset timeout is not silently swallowed: it is logged into this
            // scenario's own event log and carried onto the verdict, so a contaminated run is
            // visible instead of trusted.
            probe.clear();
            probe.log("scenario.start", { name });
            if (resetQuiescence.timedOut) {
                probe.log("reset.timedOut", { name });
            }
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
                mountWith: (args) => {
                    // Same commit: React 18 batches these, so <Chat> mounts (fresh, via the runSeq
                    // key bump) already holding messages and centeredId instead of mounting empty
                    // and correcting imperatively afterward.
                    setCenteredId(args.centeredId);
                    setMessages(args.messages);
                    setReady(true);
                    setDatasetSeq((n) => n + 1);
                    setRunSeq((n) => n + 1);
                },
                probe,
                resize: (height) => setViewportHeight(height),
                setCentered: setCenteredId,
                setMessages,
                setReady,
                wait: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
            };

            const assertion = await scenario.run(ctx);
            // quietMs must clear the 250ms gap between chat.tsx's IMAGE_GROWTH_STEPS (150ms and
            // 400ms), or quiescence can fire mid-growth and measure a still-settling list — this
            // is exactly what moved hit-cold's errPx from -0.31 to 1297.69 on a harness-only
            // change. capMs (3000) comfortably clears the last growth step plus this quiet window
            // (400 + 300 = 700).
            const quiescence = await probe.waitForQuiescence({ capMs: 3000, quietMs: 300 });
            const settleMs = quiescence.quiescedAt - startedAt;
            const { errPx, fullyVisible, targetMissing } = measure(assertion);
            const next = verdictFor({
                corrections: probe.corrections(),
                errPx,
                fullyVisible,
                resetTimedOut: resetQuiescence.timedOut,
                settleMs,
                targetMissing,
            });
            probe.log("scenario.end", { ...next, timedOut: quiescence.timedOut });
            verdictRef.current = next;
            setVerdict(next);
            setEvents(probe.events());
            setRunning(undefined);
            return next;
        },
        [backend, measure],
    );

    // The automation surface's run(): serializes overlapping calls through runLockRef so two
    // concurrent runs can never share and corrupt the single module-level Probe.
    const runExclusive = React.useCallback(
        (name: string): Promise<Verdict> => {
            const queued = runLockRef.current.catch(() => undefined).then(() => runScenario(name));
            runLockRef.current = queued;
            return queued;
        },
        [runScenario],
    );

    React.useEffect(() => {
        (window as unknown as Record<string, unknown>).__repro = {
            log: () => probe.events(),
            names: () => SCENARIOS.map((s) => s.name),
            result: () => verdictRef.current,
            run: runExclusive,
            variant: () => VARIANT,
        };
    }, [runExclusive]);

    const onStartReached = React.useCallback(() => probe.log("list.startReached"), []);
    const onEndReached = React.useCallback(() => probe.log("list.endReached"), []);

    return (
        <div style={{ display: "flex", gap: 12, padding: 12, width: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 340 }}>
                <div style={{ fontWeight: 600 }}>
                    legend-list repro · lib=<span data-testid="lib-tag">{__REPRO_LIB__}</span> · variant=
                    <span data-testid="variant-tag">{VARIANT}</span>
                </div>
                {SCENARIOS.map((s) => (
                    <button
                        data-testid={`run-${s.name}`}
                        disabled={running !== undefined}
                        key={s.name}
                        onClick={() => void runExclusive(s.name)}
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
                    variant={VARIANT}
                />
            </div>
        </div>
    );
}

createRoot(document.getElementById("root")!).render(<App />);
