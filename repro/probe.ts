// Starting threshold. Task 8 revises this from the first baseline if image rows make 2px
// unreasonable; it lives here so exactly one number moves.
export const PASS_THRESHOLD_PX = 2;

export interface ProbeEvent {
    detail: Record<string, unknown>;
    t: number;
    type: string;
}

export interface Verdict {
    corrections: number;
    errPx: number;
    fullyVisible: boolean;
    pass: boolean;
    settleMs: number;
}

// Where the row was asked to sit, minus where it ended up. Positive means it landed low.
export function positionError(args: {
    rowHeight: number;
    rowTop: number;
    viewPosition: number;
    viewportHeight: number;
    viewportTop: number;
}): number {
    const { rowHeight, rowTop, viewPosition, viewportHeight, viewportTop } = args;
    const wantedTop = viewportTop + viewPosition * (viewportHeight - rowHeight);
    return rowTop - wantedTop;
}

export function verdictFor(args: {
    corrections: number;
    errPx: number;
    fullyVisible: boolean;
    settleMs: number;
    thresholdPx?: number;
}): Verdict {
    const { corrections, errPx, fullyVisible, settleMs } = args;
    const thresholdPx = args.thresholdPx ?? PASS_THRESHOLD_PX;
    return {
        corrections,
        errPx,
        fullyVisible,
        pass: fullyVisible && Math.abs(errPx) <= thresholdPx,
        settleMs,
    };
}

const MAX_EVENTS = 2000;

export class Probe {
    private buffer: ProbeEvent[] = [];
    private correctionCount = 0;
    private lastActivity = 0;

    log(type: string, detail: Record<string, unknown> = {}): void {
        this.buffer.push({ detail, t: performance.now(), type });
        if (this.buffer.length > MAX_EVENTS) {
            this.buffer.shift();
        }
        this.noteActivity();
    }

    events(): ProbeEvent[] {
        return this.buffer.slice();
    }

    clear(): void {
        this.buffer = [];
        this.correctionCount = 0;
        this.lastActivity = performance.now();
    }

    markCorrection(): void {
        this.correctionCount++;
    }

    corrections(): number {
        return this.correctionCount;
    }

    noteActivity(): void {
        this.lastActivity = performance.now();
    }

    // Resolves once nothing has moved for quietMs, or gives up at capMs. Both scroll events and
    // row measurements count as activity, so a list still settling never reads as quiet.
    waitForQuiescence(
        opts: { capMs?: number; quietMs?: number } = {},
    ): Promise<{ quiescedAt: number; timedOut: boolean }> {
        const capMs = opts.capMs ?? 3000;
        const quietMs = opts.quietMs ?? 250;
        const startedAt = performance.now();
        this.noteActivity();
        return new Promise((resolve) => {
            const tick = () => {
                const now = performance.now();
                if (now - this.lastActivity >= quietMs) {
                    resolve({ quiescedAt: now, timedOut: false });
                    return;
                }
                if (now - startedAt >= capMs) {
                    resolve({ quiescedAt: now, timedOut: true });
                    return;
                }
                setTimeout(tick, 16);
            };
            setTimeout(tick, 16);
        });
    }
}
