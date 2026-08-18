// Task 8.5: API-conformance audit variant selection. Every variant here changes ONLY how
// app.tsx/chat.tsx call the library's public API — src/ is never touched. See
// repro/API-AUDIT.md for what each variant tests and why.

export type VariantId = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export const VARIANT_IDS: VariantId[] = ["A", "B", "C", "D", "E", "F", "G"];

export interface VariantFlags {
    // D, E: omit the dataKey prop entirely.
    dropDataKey: boolean;
    // D: omit getItemType entirely.
    dropGetItemType: boolean;
    // D: maintainVisibleContentPosition={true} instead of {data: true}.
    mvcpBare: boolean;
    // D: initialScrollIndex is a bare number instead of {index, viewPosition}.
    numericInitialScrollIndex: boolean;
    // F: route an already-mounted jump (centeredId changing on a live list) through a full
    // LegendList remount carrying initialScrollIndex, instead of an imperative scrollToItem call.
    remountOnJump: boolean;
    // C: supply maintainVisibleContentPosition.shouldRestorePosition, pinning the centered
    // target as the sole eligible data-change anchor while one is set.
    shouldRestorePosition: boolean;
    // B: onStartReachedThreshold value (default 2, the app's current value).
    startThreshold: number;
}

const BASE: VariantFlags = {
    dropDataKey: false,
    dropGetItemType: false,
    mvcpBare: false,
    numericInitialScrollIndex: false,
    remountOnJump: false,
    shouldRestorePosition: false,
    startThreshold: 2,
};

export function resolveVariant(id: VariantId): VariantFlags {
    switch (id) {
        case "A":
            return { ...BASE };
        case "B":
            return { ...BASE, startThreshold: 0.5 };
        case "C":
            return { ...BASE, shouldRestorePosition: true };
        case "D":
            return {
                ...BASE,
                dropDataKey: true,
                dropGetItemType: true,
                mvcpBare: true,
                numericInitialScrollIndex: true,
            };
        case "E":
            return { ...BASE, dropDataKey: true };
        case "F":
            return { ...BASE, remountOnJump: true };
        case "G":
            // Filled in after A-F are measured, from whichever single-variable changes helped.
            // See repro/API-AUDIT.md for what this resolves to and why.
            return { ...BASE, remountOnJump: true, shouldRestorePosition: true };
        default:
            return { ...BASE };
    }
}

export function variantFromSearch(search: string): VariantId {
    const params = new URLSearchParams(search);
    const raw = params.get("variant");
    return (VARIANT_IDS as string[]).includes(raw ?? "") ? (raw as VariantId) : "A";
}
