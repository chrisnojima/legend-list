import type { StateContext } from "@/state/state";

// A scroll event that arrives just after a programmatic scroll completes describes that scroll, not
// a new gesture. The scroller reports the landing on its own schedule, so the event can outlive
// state.scrollingTo by a frame or two - and a jump longer than the viewport then looks exactly like
// a reader flinging the list, which resets anchors and forces a visible-first pass on content the
// app itself asked for. Suppress that inference for a short window after the scroll finishes.
const IMPERATIVE_SCROLL_SETTLE_MS = 250;

type InternalState = StateContext["state"];

export function markImperativeScrollSettling(state: InternalState) {
    state.imperativeScrollSettlingUntil = Date.now() + IMPERATIVE_SCROLL_SETTLE_MS;
}

export function clearImperativeScrollSettling(state: InternalState) {
    state.imperativeScrollSettlingUntil = undefined;
}

export function isImperativeScrollSettling(state: InternalState, now: number) {
    const settlingUntil = state.imperativeScrollSettlingUntil;
    if (settlingUntil === undefined) {
        return false;
    }
    if (now > settlingUntil) {
        state.imperativeScrollSettlingUntil = undefined;
        return false;
    }
    return true;
}
