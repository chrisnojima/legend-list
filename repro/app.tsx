import { createRoot } from "react-dom/client";

import { LegendList } from "@legendapp/list/react";

declare const __REPRO_LIB__: string;

const data = Array.from({ length: 200 }, (_, i) => i);

function Smoke() {
    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
            <div data-testid="lib-tag" style={{ padding: 8 }}>
                lib={__REPRO_LIB__}
            </div>
            <LegendList
                data={data}
                estimatedItemSize={72}
                keyExtractor={(item: number) => String(item)}
                recycleItems={true}
                renderItem={({ item }: { item: number }) => (
                    <div data-testid="row" style={{ borderBottom: "1px solid #2a2f35", padding: 24 }}>
                        row {item}
                    </div>
                )}
                style={{ flex: 1, minHeight: 0 }}
            />
        </div>
    );
}

createRoot(document.getElementById("root")!).render(<Smoke />);
