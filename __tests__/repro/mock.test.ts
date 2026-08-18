import { describe, expect, test } from "bun:test";
import { FakeBackend, makeMessages, PRNG } from "../../repro/mock";

describe("PRNG", () => {
    test("is deterministic for a seed", () => {
        const a = PRNG(42);
        const b = PRNG(42);
        expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    });

    test("differs across seeds", () => {
        expect(PRNG(1)()).not.toEqual(PRNG(2)());
    });
});

describe("makeMessages", () => {
    test("is deterministic for a seed", () => {
        expect(makeMessages(50, 7)).toEqual(makeMessages(50, 7));
    });

    test("ids ascend from 0 so index equals id", () => {
        const msgs = makeMessages(10, 1);
        expect(msgs.map((m) => m.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test("heights straddle the 72px estimate in both directions", () => {
        const heights = makeMessages(200, 3).map((m) => m.height);
        expect(heights.some((h) => h < 72)).toBe(true);
        expect(heights.some((h) => h > 72)).toBe(true);
    });

    test("produces all three row kinds", () => {
        const kinds = new Set(makeMessages(200, 3).map((m) => m.kind));
        expect(kinds).toEqual(new Set(["text", "multiline", "image"]));
    });
});

describe("FakeBackend", () => {
    test("loadNewest returns the last page in ascending order", async () => {
        const messages = makeMessages(100, 1);
        const backend = new FakeBackend({ latencyMs: 0, messages });
        const page = await backend.loadNewest(20);
        expect(page.length).toBe(20);
        expect(page[0]!.id).toBe(80);
        expect(page[19]!.id).toBe(99);
    });

    test("loadOlder returns the page immediately before the given id", async () => {
        const backend = new FakeBackend({ latencyMs: 0, messages: makeMessages(100, 1) });
        const page = await backend.loadOlder(80, 20);
        expect(page[0]!.id).toBe(60);
        expect(page[19]!.id).toBe(79);
    });

    test("loadOlder clamps at the start and can return empty", async () => {
        const backend = new FakeBackend({ latencyMs: 0, messages: makeMessages(100, 1) });
        expect((await backend.loadOlder(10, 20)).map((m) => m.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(await backend.loadOlder(0, 20)).toEqual([]);
    });

    test("loadNewer returns the page immediately after the given id", async () => {
        const backend = new FakeBackend({ latencyMs: 0, messages: makeMessages(100, 1) });
        const page = await backend.loadNewer(59, 20);
        expect(page[0]!.id).toBe(60);
        expect(page[19]!.id).toBe(79);
    });

    test("loadCentered brackets the target", async () => {
        const backend = new FakeBackend({ latencyMs: 0, messages: makeMessages(100, 1) });
        const { full } = await backend.loadCentered(50, { pageSize: 40, partialFirst: false });
        expect(full[0]!.id).toBe(30);
        expect(full[full.length - 1]!.id).toBe(69);
        expect(full.some((m) => m.id === 50)).toBe(true);
    });

    test("loadCentered with partialFirst returns a narrower partial containing the target", async () => {
        const backend = new FakeBackend({ latencyMs: 0, messages: makeMessages(100, 1) });
        const { full, partial } = await backend.loadCentered(50, { pageSize: 40, partialFirst: true });
        expect(partial).toBeDefined();
        expect(partial!.length).toBeLessThan(full.length);
        expect(partial!.some((m) => m.id === 50)).toBe(true);
    });

    test("latency is honoured", async () => {
        const backend = new FakeBackend({ latencyMs: 30, messages: makeMessages(10, 1) });
        const start = performance.now();
        await backend.loadNewest(5);
        expect(performance.now() - start).toBeGreaterThanOrEqual(25);
    });
});
