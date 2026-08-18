import type { FakeBackend, Msg } from "./mock";
import type { Probe } from "./probe";

export type Assertion = { kind: "at-end" } | { kind: "centered"; targetId: number; viewPosition: number };

export interface ScenarioCtx {
    appendNewest(count: number): void;
    backend: FakeBackend;
    bumpDataset(): void;
    probe: Probe;
    resize(height: number): void;
    setCentered(id: number | undefined): void;
    setMessages(msgs: Msg[]): void;
    setReady(r: boolean): void;
    wait(ms: number): Promise<void>;
}

export interface Scenario {
    name: string;
    proves: string;
    run(ctx: ScenarioCtx): Promise<Assertion>;
}

const PAGE = 40;
const HIT_ID = 500;

// A centered load in the app clears the thread first, so the list sees non-empty -> empty ->
// non-empty. Every hit scenario goes through this.
async function openAtHit(ctx: ScenarioCtx, opts: { partialFirst: boolean }): Promise<void> {
    ctx.setReady(false);
    ctx.setMessages([]);
    ctx.bumpDataset();
    ctx.setCentered(HIT_ID);
    const { full, partial } = await ctx.backend.loadCentered(HIT_ID, {
        pageSize: PAGE,
        partialFirst: opts.partialFirst,
    });
    if (partial) {
        ctx.setMessages(partial);
        ctx.setReady(true);
        await ctx.wait(60);
        ctx.setMessages(full);
    } else {
        ctx.setMessages(full);
        ctx.setReady(true);
    }
}

export const SCENARIOS: Scenario[] = [
    {
        name: "open-newest",
        proves: "mount with no centered target lands at the end",
        async run(ctx) {
            ctx.setCentered(undefined);
            ctx.setMessages(await ctx.backend.loadNewest(PAGE));
            ctx.setReady(true);
            return { kind: "at-end" };
        },
    },
    {
        name: "hit-cold",
        proves: "mounting straight into a centered hit lands on it",
        async run(ctx) {
            await openAtHit(ctx, { partialFirst: false });
            return { kind: "centered", targetId: HIT_ID, viewPosition: 0.5 };
        },
    },
    {
        name: "hit-warm",
        proves: "jumping to a hit from an open thread lands on it",
        async run(ctx) {
            ctx.setCentered(undefined);
            ctx.setMessages(await ctx.backend.loadNewest(PAGE));
            ctx.setReady(true);
            await ctx.wait(250);
            await openAtHit(ctx, { partialFirst: false });
            return { kind: "centered", targetId: HIT_ID, viewPosition: 0.5 };
        },
    },
    {
        name: "hit-two-phase",
        proves: "a cached partial replaced by the full response still lands on the hit",
        async run(ctx) {
            await openAtHit(ctx, { partialFirst: true });
            return { kind: "centered", targetId: HIT_ID, viewPosition: 0.5 };
        },
    },
    {
        name: "hit-prepend",
        proves: "older messages paging in during the settle do not move the hit",
        async run(ctx) {
            await openAtHit(ctx, { partialFirst: false });
            await ctx.wait(40);
            const older = await ctx.backend.loadOlder(HIT_ID - PAGE / 2, PAGE);
            ctx.setMessages([
                ...older,
                ...(await ctx.backend.loadCentered(HIT_ID, { pageSize: PAGE, partialFirst: false })).full,
            ]);
            return { kind: "centered", targetId: HIT_ID, viewPosition: 0.5 };
        },
    },
    {
        name: "hit-late-images",
        proves: "image rows above the hit growing late do not push it off target",
        async run(ctx) {
            await openAtHit(ctx, { partialFirst: false });
            // The image growth timers in chat.tsx fire at 150ms and 400ms; wait past both.
            await ctx.wait(500);
            return { kind: "centered", targetId: HIT_ID, viewPosition: 0.5 };
        },
    },
    {
        name: "send-at-end",
        proves: "appending while at the end keeps the list pinned there",
        async run(ctx) {
            ctx.setCentered(undefined);
            ctx.setMessages(await ctx.backend.loadNewest(PAGE));
            ctx.setReady(true);
            await ctx.wait(200);
            ctx.appendNewest(1);
            await ctx.wait(120);
            ctx.appendNewest(1);
            return { kind: "at-end" };
        },
    },
    {
        name: "page-up",
        proves: "a prepend while reading does not move the reading position",
        async run(ctx) {
            ctx.setCentered(HIT_ID);
            await openAtHit(ctx, { partialFirst: false });
            await ctx.wait(300);
            const older = await ctx.backend.loadOlder(HIT_ID - PAGE / 2, PAGE);
            ctx.setMessages([
                ...older,
                ...(await ctx.backend.loadCentered(HIT_ID, { pageSize: PAGE, partialFirst: false })).full,
            ]);
            return { kind: "centered", targetId: HIT_ID, viewPosition: 0.5 };
        },
    },
    {
        name: "resize-at-end",
        proves: "a viewport resize at the end keeps the end",
        async run(ctx) {
            ctx.setCentered(undefined);
            ctx.setMessages(await ctx.backend.loadNewest(PAGE));
            ctx.setReady(true);
            await ctx.wait(250);
            ctx.resize(420);
            await ctx.wait(120);
            ctx.resize(640);
            return { kind: "at-end" };
        },
    },
];
