import { createRoot } from "react-dom/client";

import { Chat } from "./chat";
import { makeMessages } from "./mock";
import { Probe } from "./probe";

declare const __REPRO_LIB__: string;

const messages = makeMessages(60, 1);
const probe = new Probe();

function noop() {}

function Smoke() {
    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
            <div data-testid="lib-tag" style={{ padding: 8 }}>
                lib={__REPRO_LIB__}
            </div>
            <div style={{ display: "flex", flexDirection: "column", height: 640 }}>
                <Chat
                    centeredId={undefined}
                    datasetKey="smoke"
                    messages={messages}
                    onEndReached={noop}
                    onStartReached={noop}
                    probe={probe}
                    ready={true}
                />
            </div>
        </div>
    );
}

createRoot(document.getElementById("root")!).render(<Smoke />);
