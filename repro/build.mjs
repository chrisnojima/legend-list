import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const forkRoot = path.resolve(here, "..");

// The fork's own src/ imports "react" directly, and esbuild resolves each bare specifier
// starting from its importer's directory — so without this, src/ imports would walk up to
// forkRoot/node_modules/react (19.1.0) while app.tsx's imports resolve to repro/node_modules
// (19.2.0), silently bundling two incompatible React copies. Anchor every "react"/"react-dom"
// resolution at repro/'s own node_modules instead, regardless of which file imports it.
const reproRequire = createRequire(path.join(here, "package.json"));

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const libArg = args.find((a) => a.startsWith("--lib="));
const lib = libArg ? libArg.slice("--lib=".length) : "fork";

if (lib !== "fork" && lib !== "stock") {
    console.error(`--lib must be "fork" or "stock", got "${lib}"`);
    process.exit(1);
}

// fork: bundle the library straight from TypeScript source, so an edit under src/ needs no
// intermediate `bun run build`. stock: the vendored 3.3.7 build committed in Task 1.
const libEntry =
    lib === "fork"
        ? path.join(forkRoot, "src", "react.ts")
        : path.join(here, "vendor", "legend-3.3.7-stock.mjs");

const options = {
    absWorkingDir: forkRoot,
    banner: { js: `/* legend-list repro harness — lib=${lib} */` },
    bundle: true,
    define: {
        __DEV__: "true",
        "process.env.NODE_ENV": '"development"',
        __REPRO_LIB__: JSON.stringify(lib),
    },
    entryPoints: [path.join(here, "app.tsx")],
    // iife, not esm: the page has to open over file://, where module scripts are blocked by CORS.
    format: "iife",
    jsx: "automatic",
    logLevel: "info",
    outfile: path.join(here, "bundle.js"),
    plugins: [
        {
            name: "legend-list-entry",
            setup(build) {
                build.onResolve({ filter: /^@legendapp\/list\/react$/ }, () => ({ path: libEntry }));
            },
        },
        {
            name: "single-react-copy",
            setup(build) {
                build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => {
                    try {
                        return { path: reproRequire.resolve(args.path) };
                    } catch (error) {
                        return { errors: [{ text: String(error) }] };
                    }
                });
            },
        },
    ],
    sourcemap: true,
    target: ["chrome120"],
    // Picks up the "@/*" -> "./src/*" paths mapping the library source relies on.
    tsconfig: path.join(forkRoot, "tsconfig.json"),
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log(`watching (lib=${lib})`);
} else {
    await esbuild.build(options);
    console.log(`built repro/bundle.js (lib=${lib})`);
}
