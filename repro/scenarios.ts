import type { FakeBackend, Msg } from "./mock";
import type { Probe } from "./probe";

export type Assertion = { kind: "at-end" } | { kind: "centered"; targetId: number; viewPosition: number };

export interface ScenarioCtx {
    appendNewest(count: number): void;
    backend: FakeBackend;
    bumpDataset(): void;
    // Seeds messages and centeredId in the same commit as a fresh <Chat> mount, so the list
    // bootstraps with initialScrollIndex already set (instead of mounting empty and correcting
    // imperatively later). Use this to exercise the mount-time scroll path; setMessages +
    // setCentered on an already-mounted <Chat> only ever exercises the imperative path.
    mountWith(args: { centeredId: number | undefined; messages: Msg[] }): void;
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
// ALL_MESSAGES runs id 0..999 (see app.tsx). Anything loaded ending at or below this id leaves
// ids above it unused, so appendNewest has real, unseen ids to append instead of a no-op.
const SEND_WINDOW_NEWEST_ID = 900;

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
        proves: "mounting with data and a centered target already in hand (initialScrollIndex set, initialScrollAtEnd false at mount) lands on the hit",
        async run(ctx) {
            // Fetch before mounting: mountWith puts messages and centeredId into <Chat>'s very
            // first commit, so the list bootstraps through initialScrollIndex rather than
            // mounting empty and correcting imperatively later (that path is hit-warm).
            const { full } = await ctx.backend.loadCentered(HIT_ID, { pageSize: PAGE, partialFirst: false });
            ctx.mountWith({ centeredId: HIT_ID, messages: full });
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
            // loadNewest would end at id 999 (ALL_MESSAGES' newest), leaving appendNewest nothing
            // to add. Load a window that ends short of the newest id instead, so the two
            // appendNewest(1) calls below have real, unused ids to append.
            ctx.setMessages(await ctx.backend.loadOlder(SEND_WINDOW_NEWEST_ID + 1, PAGE));
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
    // Added for Task 8.5's audit round 2: the three existing guards all run with
    // centeredId === undefined for their whole run, so variant F's remountOnJump branch (which
    // only fires when centeredId transitions to a defined value on an already-mounted list) is
    // never reached by any of them — their 30/30 says nothing about the remount mechanism. This
    // scenario jumps to a hit first (reaching the remount branch under F/G), then leaves the hit
    // and requires end-anchoring to hold under appends, the same shape send-at-end checks.
    {
        name: "hit-then-end-anchor",
        proves: "jumping to a hit, then returning to a live end-anchored view, keeps appends pinned to the end — exercises the remount branch, not just the always-end-anchored guards",
        async run(ctx) {
            await openAtHit(ctx, { partialFirst: false });
            await ctx.wait(300);
            ctx.setCentered(undefined);
            // bumpDataset() here, same as openAtHit always does on its own clear+recenter: the
            // swap below replaces the ~480-520 hit window with a disjoint ~861-900 window, so
            // maintainVisibleContentPosition needs the same "this is a new dataset, not a
            // continuation" signal any other full-window swap gets. Omitting this was a bug in an
            // earlier version of this scenario — it handed the list an unrelated dataset under an
            // unchanged dataKey, a plausible cause of failure sitting underneath this scenario's
            // result on its own, independent of whichever variant is under test.
            ctx.bumpDataset();
            ctx.setMessages(await ctx.backend.loadOlder(SEND_WINDOW_NEWEST_ID + 1, PAGE));
            ctx.setReady(true);
            await ctx.wait(200);
            ctx.appendNewest(1);
            await ctx.wait(120);
            ctx.appendNewest(1);
            return { kind: "at-end" };
        },
    },
];
