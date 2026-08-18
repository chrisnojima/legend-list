import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const found = args.find((a) => a.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : fallback;
};

const n = Number(flag("n", "20"));
const lib = flag("lib", "fork");
const only = flag("only", undefined);
const jsonOut = flag("json", undefined);
const headed = args.includes("--headed");
const variant = flag("variant", "A");
// Deliberately captures the first run's event trace for every targeted scenario, pass or fail —
// the normal first-failure capture only fires on failure, which leaves no committed trace for a
// scenario a variant makes pass. Used to document mechanism for any variant that flips a verdict.
const keepLog = args.includes("--keep-log");

// Always rebuild, so a run can never report on a stale bundle.
const build = spawnSync("bun", [path.join(here, "build.mjs"), `--lib=${lib}`], { encoding: "utf8", stdio: "inherit" });
if (build.status !== 0) {
    process.exit(build.status ?? 1);
}

const median = (xs) => {
    if (!xs.length) return Number.NaN;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const percentile = (xs, p) => {
    if (!xs.length) return Number.NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// Playwright's bundled chromium download is broken on this machine, so pin to the system Chrome
// channel instead of letting Playwright try (and fail) to fetch its own browser.
const browser = await chromium.launch({ channel: "chrome", headless: !headed });
const page = await browser.newPage({ viewport: { height: 900, width: 1280 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`file://${path.join(here, "index.html")}?variant=${variant}`);
await page.waitForFunction(() => Boolean(window.__repro));

// The page resolves an unknown variant string to "A" rather than throwing, so a typo in
// --variant would otherwise silently measure the control instead of failing loudly. Confirm the
// page actually reports back what was asked for before trusting anything it measures.
const activeVariant = await page.evaluate(() => window.__repro.variant());
if (activeVariant !== variant) {
    console.error(`requested --variant=${variant} but the page reports variant=${activeVariant}`);
    await browser.close();
    process.exit(1);
}

const names = await page.evaluate(() => window.__repro.names());
const targets = only ? names.filter((name) => name === only) : names;
if (!targets.length) {
    console.error(`no scenario matched --only=${only}. known: ${names.join(", ")}`);
    await browser.close();
    process.exit(1);
}

const results = {};
for (const name of targets) {
    results[name] = [];
    for (let i = 0; i < n; i++) {
        const verdict = await page.evaluate((scenario) => window.__repro.run(scenario), name);
        results[name].push(verdict);
        let firstFailureJustWritten = false;
        if (!verdict.pass && results[name].filter((v) => !v.pass).length === 1) {
            // Keep the log from the first failure of each scenario; that is the one worth reading.
            const log = await page.evaluate(() => window.__repro.log());
            fs.mkdirSync(path.join(here, "results"), { recursive: true });
            fs.writeFileSync(
                path.join(here, "results", `${name}-variant-${variant}-first-failure.json`),
                JSON.stringify(log, null, 2),
            );
            firstFailureJustWritten = true;
        }
        // Skip when run 0 just wrote -first-failure.json above: that file already holds this
        // exact run's event log, so writing an identical -trace.json would commit the same
        // content twice under two names.
        if (keepLog && i === 0 && !firstFailureJustWritten) {
            const log = await page.evaluate(() => window.__repro.log());
            fs.mkdirSync(path.join(here, "results"), { recursive: true });
            fs.writeFileSync(
                path.join(here, "results", `${name}-variant-${variant}-trace.json`),
                JSON.stringify(log, null, 2),
            );
        }
    }
}

const rows = targets.map((name) => {
    const runs = results[name];
    // errPx is NaN whenever a run reports targetMissing — a single NaN would poison median/p95
    // for the whole scenario, silently hiding the exact rows most worth quantifying. So the
    // error stats are computed over finite errPx values only; missing runs are tracked and
    // reported separately instead of folded into a NaN average.
    const finiteErrs = runs.map((r) => Math.abs(r.errPx)).filter((e) => Number.isFinite(e));
    const missing = runs.filter((r) => r.targetMissing).length;
    const resetTimedOut = runs.filter((r) => r.resetTimedOut).length;
    return {
        corrections: median(runs.map((r) => r.corrections)),
        hasFiniteErr: finiteErrs.length > 0,
        medErr: median(finiteErrs),
        medSettle: median(runs.map((r) => r.settleMs)),
        missing,
        name,
        p95Err: percentile(finiteErrs, 95),
        pass: runs.filter((r) => r.pass).length,
        resetTimedOut,
        total: runs.length,
    };
});

const fmtPx = (value, hasFiniteErr) => (hasFiniteErr ? `${value.toFixed(1)}px` : "-");

const pad = (s, w) => String(s).padEnd(w);
console.log(`\nlib=${lib}  n=${n}  variant=${variant}\n`);
console.log(
    `${pad("scenario", 22)}${pad("pass", 8)}${pad("missing", 9)}${pad("med err", 10)}${pad("p95 err", 10)}${pad("med settle", 12)}corrections`,
);
for (const r of rows) {
    console.log(
        `${pad(r.name, 22)}${pad(`${r.pass}/${r.total}`, 8)}${pad(r.missing, 9)}${pad(fmtPx(r.medErr, r.hasFiniteErr), 10)}${pad(fmtPx(r.p95Err, r.hasFiniteErr), 10)}${pad(`${r.medSettle.toFixed(0)}ms`, 12)}${r.corrections}`,
    );
}

const contaminated = rows.filter((r) => r.resetTimedOut > 0);
if (contaminated.length) {
    console.log(
        `\nreset timed out (results may be contaminated): ${contaminated.map((r) => `${r.name}=${r.resetTimedOut}/${r.total}`).join(", ")}`,
    );
}

if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ lib, n, results, rows, variant }, null, 2));
    console.log(`\nwrote ${jsonOut}`);
}

await browser.close();
process.exit(rows.every((r) => r.pass === r.total) ? 0 : 1);
