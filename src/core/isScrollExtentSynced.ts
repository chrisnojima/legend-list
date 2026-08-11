import { getContentSize } from "@/state/getContentSize";
import type { StateContext } from "@/state/state";

// Sub-pixel slack: the platform extent is measured, the content size is computed.
const SCROLL_EXTENT_EPSILON = 1;

/**
 * Whether the platform scroller can reach every offset the list considers scrollable.
 *
 * On web the scroll extent is measured from the document, which lags a React commit: for a frame
 * after a data change the content element still has its previous size. A scroll issued in that
 * window is clamped to the stale extent — usually all the way to 0 — and silently lands short,
 * because the platform reports no error and the requested offset is already recorded as current.
 *
 * Scrollers that are not measured from a document (native) do not report an extent and are always
 * treated as synced.
 */
export function isScrollExtentSynced(ctx: StateContext) {
    const state = ctx.state;
    const platformMaxOffset = state.refScroller.current?.getMaxScrollOffset?.();
    if (platformMaxOffset === undefined) {
        return true;
    }

    // Nothing to compare against until the viewport has been measured, and gating here would
    // delay the first scroll of every list.
    if (state.scrollLength <= 0) {
        return true;
    }

    const contentMaxOffset = Math.max(0, getContentSize(ctx) - state.scrollLength);
    return platformMaxOffset >= contentMaxOffset - SCROLL_EXTENT_EPSILON;
}
