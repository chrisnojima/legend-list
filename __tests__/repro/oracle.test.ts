import { describe, expect, test } from "bun:test";
import { PASS_THRESHOLD_PX, Probe, positionError, verdictFor } from "../../repro/probe";

describe("positionError", () => {
    const viewport = { viewportHeight: 600, viewportTop: 0 };

    test("is zero when the row centre sits at the requested centre", () => {
        // viewPosition 0.5 wants the row's centre at the viewport's centre: row spans 270..330.
        expect(positionError({ ...viewport, rowHeight: 60, rowTop: 270, viewPosition: 0.5 })).toBeCloseTo(0, 5);
    });

    test("is positive when the row sits below where it was asked to be", () => {
        expect(positionError({ ...viewport, rowHeight: 60, rowTop: 300, viewPosition: 0.5 })).toBeCloseTo(30, 5);
    });

    test("is negative when the row sits above", () => {
        expect(positionError({ ...viewport, rowHeight: 60, rowTop: 240, viewPosition: 0.5 })).toBeCloseTo(-30, 5);
    });

    test("handles viewPosition 0 (row top at viewport top)", () => {
        expect(positionError({ ...viewport, rowHeight: 60, rowTop: 0, viewPosition: 0 })).toBeCloseTo(0, 5);
    });

    test("handles viewPosition 1 (row bottom at viewport bottom)", () => {
        expect(positionError({ ...viewport, rowHeight: 60, rowTop: 540, viewPosition: 1 })).toBeCloseTo(0, 5);
    });

    test("accounts for a viewport that does not start at zero", () => {
        expect(
            positionError({ rowHeight: 60, rowTop: 370, viewPosition: 0.5, viewportHeight: 600, viewportTop: 100 }),
        ).toBeCloseTo(0, 5);
    });
});

describe("verdictFor", () => {
    test("passes inside the threshold when fully visible", () => {
        const v = verdictFor({ corrections: 1, errPx: 1.5, fullyVisible: true, settleMs: 120 });
        expect(v.pass).toBe(true);
    });

    test("fails outside the threshold", () => {
        expect(verdictFor({ corrections: 1, errPx: 9, fullyVisible: true, settleMs: 120 }).pass).toBe(false);
    });

    test("fails when the row is not fully visible even at zero error", () => {
        expect(verdictFor({ corrections: 1, errPx: 0, fullyVisible: false, settleMs: 120 }).pass).toBe(false);
    });

    test("uses the absolute error, so overshoot fails too", () => {
        expect(verdictFor({ corrections: 1, errPx: -40, fullyVisible: true, settleMs: 120 }).pass).toBe(false);
    });

    test("honours an overridden threshold", () => {
        expect(verdictFor({ corrections: 1, errPx: 20, fullyVisible: true, settleMs: 120, thresholdPx: 36 }).pass).toBe(
            true,
        );
    });

    test("default threshold is the exported constant", () => {
        expect(
            verdictFor({ corrections: 0, errPx: PASS_THRESHOLD_PX - 0.01, fullyVisible: true, settleMs: 0 }).pass,
        ).toBe(true);
        expect(
            verdictFor({ corrections: 0, errPx: PASS_THRESHOLD_PX + 0.01, fullyVisible: true, settleMs: 0 }).pass,
        ).toBe(false);
    });
});

describe("Probe", () => {
    test("records events in order with timestamps", () => {
        const probe = new Probe();
        probe.log("a", { x: 1 });
        probe.log("b");
        const events = probe.events();
        expect(events.map((e) => e.type)).toEqual(["a", "b"]);
        expect(events[0]!.detail).toEqual({ x: 1 });
        expect(events[1]!.t).toBeGreaterThanOrEqual(events[0]!.t);
    });

    test("clear resets events and corrections", () => {
        const probe = new Probe();
        probe.log("a");
        probe.markCorrection();
        probe.clear();
        expect(probe.events()).toEqual([]);
        expect(probe.corrections()).toBe(0);
    });

    test("counts corrections", () => {
        const probe = new Probe();
        probe.markCorrection();
        probe.markCorrection();
        expect(probe.corrections()).toBe(2);
    });

    test("waitForQuiescence resolves once activity stops", async () => {
        const probe = new Probe();
        const timer = setInterval(() => probe.noteActivity(), 10);
        setTimeout(() => clearInterval(timer), 60);
        const result = await probe.waitForQuiescence({ capMs: 2000, quietMs: 50 });
        expect(result.timedOut).toBe(false);
    });

    test("waitForQuiescence reports a timeout when activity never stops", async () => {
        const probe = new Probe();
        const timer = setInterval(() => probe.noteActivity(), 5);
        const result = await probe.waitForQuiescence({ capMs: 120, quietMs: 50 });
        clearInterval(timer);
        expect(result.timedOut).toBe(true);
    });
});
