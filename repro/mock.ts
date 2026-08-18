export type MsgKind = "text" | "multiline" | "image";

export interface Msg {
    height: number;
    id: number;
    kind: MsgKind;
    text: string;
}

// mulberry32. Small, fast, and identical across runs — which is the whole point.
export function PRNG(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const WORDS = [
    "ship",
    "later",
    "meeting",
    "rebase",
    "landed",
    "broke",
    "again",
    "probably",
    "tomorrow",
    "reviewed",
    "scroll",
    "target",
];

// Heights deliberately straddle estimatedItemSize (72): short rows measure smaller than the
// estimate, image rows much larger. That mismatch is the mechanism under test.
export function makeMessages(count: number, seed: number): Msg[] {
    const rand = PRNG(seed);
    const out: Msg[] = [];
    for (let id = 0; id < count; id++) {
        const roll = rand();
        const kind: MsgKind = roll < 0.6 ? "text" : roll < 0.85 ? "multiline" : "image";
        const wordCount = kind === "multiline" ? 12 + Math.floor(rand() * 30) : 2 + Math.floor(rand() * 6);
        const words: string[] = [];
        for (let w = 0; w < wordCount; w++) {
            words.push(WORDS[Math.floor(rand() * WORDS.length)]!);
        }
        const height =
            kind === "image"
                ? 180 + Math.floor(rand() * 120)
                : kind === "multiline"
                  ? 96 + Math.floor(rand() * 90)
                  : 44 + Math.floor(rand() * 24);
        out.push({ height, id, kind, text: `#${id} ${words.join(" ")}` });
    }
    return out;
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

export class FakeBackend {
    private readonly latencyMs: number;
    private readonly messages: Msg[];

    constructor(opts: { latencyMs: number; messages: Msg[] }) {
        this.latencyMs = opts.latencyMs;
        this.messages = opts.messages;
    }

    async loadNewest(pageSize: number): Promise<Msg[]> {
        await sleep(this.latencyMs);
        return this.messages.slice(Math.max(0, this.messages.length - pageSize));
    }

    async loadOlder(oldestId: number, pageSize: number): Promise<Msg[]> {
        await sleep(this.latencyMs);
        const end = this.indexOfId(oldestId);
        if (end <= 0) {
            return [];
        }
        return this.messages.slice(Math.max(0, end - pageSize), end);
    }

    async loadNewer(newestId: number, pageSize: number): Promise<Msg[]> {
        await sleep(this.latencyMs);
        const start = this.indexOfId(newestId) + 1;
        if (start >= this.messages.length) {
            return [];
        }
        return this.messages.slice(start, start + pageSize);
    }

    // Mirrors the app: a centered load may serve a narrow cached bracket first, then replace it
    // with the full one.
    async loadCentered(
        id: number,
        opts: { pageSize: number; partialFirst: boolean },
    ): Promise<{ full: Msg[]; partial?: Msg[] }> {
        await sleep(this.latencyMs);
        const full = this.bracket(id, opts.pageSize);
        if (!opts.partialFirst) {
            return { full };
        }
        return { full, partial: this.bracket(id, Math.max(4, Math.floor(opts.pageSize / 4))) };
    }

    private bracket(id: number, size: number): Msg[] {
        const center = this.indexOfId(id);
        const half = Math.floor(size / 2);
        const start = Math.max(0, Math.min(center - half, this.messages.length - size));
        return this.messages.slice(Math.max(0, start), Math.max(0, start) + size);
    }

    private indexOfId(id: number): number {
        return this.messages.findIndex((m) => m.id === id);
    }
}
