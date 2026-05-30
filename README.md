# make-it-arc

A build toolchain that mangles modern TypeScript hard enough to run inside
[**Arc**](https://github.com/alii/arc) — an experimental JS runtime written in
Gleam / Erlang that doesn't yet support all of modern JavaScript.

> **Pure science, pure experimental.** The toolchain works by polyfilling,
> stripping, and rewriting language features Arc doesn't understand yet. It
> adds a *huge* amount of bloat to the bundle and will make your code slower.
> The point isn't speed — it's seeing how far we can push Arc *today* using
> only Arc + a build step.
>
> As Arc grows, patches here will be deleted and replaced with the real
> runtime feature. This repo is meant to shrink over time, not grow.

## What this is good for

- A **standalone build step**: point `makeItArc()` at your TypeScript (a
  folder, a single file, or an in-memory file tree) and get back one
  Arc-ready bundle as a string. Use it from a Node script, a Bun script, or
  *directly in the browser*.
- Stress-testing Arc against real libraries (current canaries:
  [`@kaito-http/core`](https://github.com/kaito-http/kaito) and
  `react` + `react-dom/server` for SSR via `renderToString`).
- Finding concrete bugs / missing features in Arc — every monkey patch in
  `arc-monkey-patches.js` is a one-line description of something Arc gets
  wrong.
- Letting people write normal TypeScript today and run it on Arc *anyway*.

## What this is **not** good for

- Production. Anything. At all.
- Benchmarking Arc — the rewrites destroy any performance signal.

---

## Use it as a build step

The whole toolchain is exposed as a single function, `makeItArc(source)`,
which returns the finished Arc bundle as a `string`. There are two entry
points, both default-exporting the same function:

| Import | Environment | Accepts |
|---|---|---|
| `make-it-arc` (`make-it-arc.ts`) | Node / Bun / Deno | a **path** (string) *or* a **file tree** |
| `make-it-arc/browser` (`make-it-arc.browser.ts`) | the browser | a **file tree** only |

### Path mode (Node/Bun) — bundle real source on disk

Give it a directory (it looks for `index.{ts,tsx,js}`) or a single entry
file. This is the full pipeline — Rollup + `@rollup/plugin-commonjs` +
`@rollup/plugin-node-resolve` — so your entry can `import` real npm
packages (including CJS ones like `react`).

```ts
import { makeItArc } from "make-it-arc";
import fs from "node:fs";

const code = await makeItArc("./src");        // folder with index.ts
// const code = await makeItArc("./src/index.ts"); // or a single file
fs.writeFileSync("dist/index.js", code);
```

That is exactly what `build.js` in this repo does.

### Tree mode — bundle an in-memory virtual filesystem

Pass a `{ [path]: contents }` map (entry auto-detected as the lone
`index.*`), or `{ entry, files }` to be explicit. Tree mode uses a virtual
filesystem and resolves only relative imports between the files you hand it
— no node_modules, no disk access — so the **exact same input produces
byte-identical output in Node and in the browser** (there's a Playwright
parity test asserting this).

```ts
import { makeItArc } from "make-it-arc";

const code = await makeItArc({
  "index.ts": `import { greet } from "./greet.ts";\nconsole.log(greet("arc"));`,
  "greet.ts": `export const greet = (n: string) => "hello " + n;`,
});
```

### In the browser

The browser entry is the same API, backed by `@rollup/browser` (WASM) and
`@babel/standalone` instead of the Node toolchain:

```ts
import { makeItArc } from "make-it-arc/browser";

const code = await makeItArc({
  "index.ts": `console.log("hello from arc");`,
});
```

Lower-level pieces are exported too if you need them: `bundleTree(entry,
files)`, `normalizeTreeSource(source)`, `virtualFsPlugin(files)`, and the
`FileTree` / `MakeItArcSource` types.

---

## Try it out (the canary app)

You need [Bun](https://bun.sh) and [Gleam](https://gleam.run) installed.

```bash
# 1. Clone and grab Arc as a submodule / sibling checkout.
git clone https://github.com/hiett/make-it-arc.git
cd make-it-arc
git clone https://github.com/alii/arc.git arc

# 2. Install JS deps.
bun install

# 3. Build the bundle and run it on Arc.
bun make-it-arc
```

`bun make-it-arc` does two things:

1. `bun prepare-for-arc` — regenerates runtime assets (`bun run gen`) then
   runs `build.js`, which calls `makeItArc("./src")` and writes
   `dist/index.js`.
2. `bun run-arc` — `cd arc && gleam run -- ../dist/index.js`.

Edit `src/index.ts`, run `bun make-it-arc` again, watch it work (or break).

Arc is updated frequently by other contributors. **Always `git pull` inside
`arc/` before debugging a failure** — your patch list may already be
shorter than you think.

### Other scripts

| Script | What it does |
|---|---|
| `bun run gen` | Regenerates `runtime-assets.generated.ts` from `arc-monkey-patches.js` + `arc-std-lib/**`. Run automatically by the build/test scripts; run it by hand after editing a patch or std-lib file. |
| `bun run build` | `gen` + `tsc -p tsconfig.build.json` → compiles the tool itself into `lib/` (JS + `.d.ts`) for publishing/consuming as a package. |
| `bun test` | `gen` + Playwright parity test: builds the browser bundle, runs the same fixture through Node and the browser, asserts byte-identical output. |

---

## The build chain, end to end

Everything below lives in `make-it-arc.ts` (Node path mode) and
`make-it-arc-core.ts` (the shared tree-mode core that the browser build also
uses). The two share the same plugin ordering so output stays consistent.

Source goes in, a single **ESM** bundle comes out — Arc is ESM-native and
wants native `export`, not `module.exports`. Between source and output there
are roughly six stages:

### 1. Per-file: Babel (in-Rollup)

- `@babel/preset-typescript` — strips types.
- `@babel/preset-env` targeting **IE11**, with `useBuiltIns: "usage"` and
  `core-js@3` — this is what gives us polyfills for `Set`, `Map`, `URL`,
  `Promise`, iterators, etc.
- `babel-plugin-wrap-userland-entry` (entry file only) — wraps the top-level
  executable statements of `src/index.ts` into a `requireUserCode()`
  function. Why: stage 3 below moves all `requireXxx()` calls to the end of
  the bundle. Pretending the user's entry is just another core-js polyfill
  loader guarantees it runs *after* every polyfill has installed.

### 2. Bundling: Rollup + `@rollup/plugin-commonjs`

All the per-file output (plus the core-js CJS modules pulled in by
`preset-env`) gets bundled into one file. `strictRequires: true` keeps each
former-CJS module wrapped in its own `requireXxx()` function so we can
reorder them later.

### 3. Post-bundle: Babel passes on the bundled output

Each runs as a Rollup `renderChunk` pass, applied in this order (see the
`plugins` array in `make-it-arc.ts` / `make-it-arc-core.ts`):

| Plugin | What it does | Why Arc needs it |
|---|---|---|
| `babel-plugin-externals-to-require` | Rewrites the top-level `import X from 'util'` declarations that `format: 'es'` emits for externalized node builtins back into `var X = require('util')`. | Arc keeps native ESM `export` on the way out, but its module loader can't resolve bare-specifier `import`s — so builtins get routed through the `arc-std-lib` `require()` registry instead. |
| `babel-plugin-defer-requires` | Moves every top-level `requireXxx()` call to the end of the bundle, preserving relative order. Also defers `var x = requireY()` declarations emitted by rollup's commonjs plugin for user-driven CJS imports, plus any downstream `var z = fn(x)` whose initializer reads a deferred binding (transitively). `var` is hoisted, so only the *initialization* is delayed — function bodies declared earlier still see the binding by the time they're called. | core-js modules reference vars declared in *later* modules. Without reordering, you get forward-reference `TypeError`s. The transitive case shows up the moment user code imports a CJS library: `var React = getDefaultExportFromCjs(reactExports)` runs *between* the deferred `requireReact()` call and the polyfills, so we need to drag it (and `serverRenderReact`'s wiring) along to the deferred block too. |
| `babel-plugin-strip-async` | Rewrites `async`/`await`, `Promise.resolve`, `.then`, etc. into synchronous equivalents. | Arc has no event loop and no microtask queue. |
| `babel-plugin-bind-fexpr-names` | Wraps named `function NAME(...)` expressions so `NAME` is actually bound inside the body. | Arc's parser doesn't bind a named function expression's own name in its body — regenerator output blows up otherwise. |
| `babel-plugin-strip-symbol-throws` | Deletes core-js's `throw new TypeError('Cannot convert a Symbol value to a string')` guard. | Arc misclassifies some plain strings as `Symbol` via `@@toStringTag`, tripping the guard. |
| `babel-plugin-deregex` | Rewrites `/foo/g` → `new RegExp("foo", "g")`. | Arc's parser doesn't accept regex literals. |
| `babel-plugin-defilter-demap` | Rewrites `x.filter(cb)` / `x.map(cb)` into inline `for`-loop IIFEs. | Arc's `Array.prototype.filter`/`map` are broken. |
| `babel-plugin-trace-lines` (commented out) | Inserts `Arc.log("L<n>")` before every statement so you can locate crashes when Arc gives you no stack trace. | Enable when triaging a silent failure. |

### 4. Banner / footer injection

Around the bundle we wrap two pieces of hand-written runtime code:

- **`arc-monkey-patches.js`** (banner half) — prepended *above* the bundle.
  Runs BEFORE core-js installs polyfills. This is where we force-undefine
  Arc's broken-but-detected globals (`WeakMap`, `Set`, `Map`, `WeakSet`)
  so core-js takes its full-replacement code path instead of trying to
  "wrap" them. Also stubs `ArrayBuffer`, `DataView`, `queueMicrotask` and
  fixes `String`/`Number`/`Boolean` coercion + `Symbol[@@toPrimitive]`.
- **`arc-std-lib/**.js`** — also banner. A folder of small files, each
  filling in one thing Arc doesn't ship but should. These aren't monkey
  patches (no deletion criterion) — Arc is unlikely to grow `Headers` /
  `Request` / `Response` itself, and the Node built-in shims will always
  be needed in some form for libraries that `require()` them.

  At `bun run gen` time `scripts/build-runtime-assets.mjs` walks the folder
  recursively, sorts entries lexicographically by relative path, concatenates
  them, and inlines the result (plus the two halves of
  `arc-monkey-patches.js`) into `runtime-assets.generated.ts` as `BANNER` /
  `FOOTER` / `STD_LIB` string constants. Inlining at gen time is what lets the
  bundler run in the browser with no filesystem.
  Ordering, when it matters, is encoded as a numeric prefix on the
  filename (`00-`, `10-`, …). Today the only ordered dependency is the
  `require()` registry: `00-require-registry.js` must install the empty
  global before any `node-*.js` file writes a stub into it.

  Current contents:

  | File | What it provides |
  |---|---|
  | `00-require-registry.js` | Global `require(name)` plus an internal `__arcModules` registry. Throws for unknown module names so missing stubs are loud. |
  | `fetch.js` | `Headers`, `Request`, `Response` (incl. `Response.json` / `Response.error` / `Response.redirect`). Body-reading methods return `Promise.resolve(x)` and get collapsed by the `strip-async` pass. |
  | `node-async-hooks.js` | `require('async_hooks')` → `{ AsyncLocalStorage }` backed by a single hidden slot. |
  | `node-crypto.js` | `require('crypto')` → `{ createHash }` returning a no-op hasher (concat input, return concat). |
  | `node-stream.js` | `require('stream')` → `{ Readable }` empty constructor. Only the module-load reference matters; `renderToString` never reaches the streaming path. |
  | `node-util.js` | `require('util')` → `{ TextEncoder }`. `.encode()` returns the input string unchanged so HTML chunks precomputed at module init stay string-shaped through `renderToString`'s legacy destination. |
  | `process.js` | Global `process` with `env.NODE_ENV = "production"` (react picks the production codepath), synchronous `nextTick`, empty `versions`. |

  See `arc-std-lib/README.md` for how to add a new file.
- **`arc-monkey-patches.js`** (footer half, below the `// FOOTER_BELOW`
  marker) — injected just before `requireUserCode()` is called, i.e.
  AFTER core-js has installed its polyfills. Use this for patches that
  need to *override* something core-js polyfilled (e.g.
  `String.prototype.startsWith`).

### 5. Output

`makeItArc()` returns the finished bundle as a string — a single native-ESM
file Arc can read. In the canary app `build.js` writes it to `dist/index.js`.

### 6. Run

`bun run-arc` does `cd arc && gleam run -- ../dist/index.js`. Output goes
to your terminal via `Arc.log`.

---

## Contributing a new patch

When you hit a new Arc bug or missing feature, here's the playbook:

### Step 0 — confirm it's actually Arc

`bun make-it-arc` and read the error. Then ask:

- Is this a parser error from Gleam? You probably need a new **post-bundle
  Babel plugin** to rewrite away whatever syntax Arc rejects.
- Is this a runtime `TypeError` / `ReferenceError` / silent wrong answer?
  You probably need a new **monkey patch** in `arc-monkey-patches.js`.
- Does it involve `async`/`await`/`Promise`? Check `babel-plugin-strip-async.js`
  first — there might just be one more shape it doesn't cover yet.

If the error is from Gleam/Erlang itself (something like a BEAM crash, or
a runtime panic mentioning a Gleam module) - that's an Arc-side change, not a build-chain change.
Report to the Arc repo instead (or contribute a PR there!).

### Step 1 — minimal repro

Add the smallest possible thing that triggers the bug to `src/index.ts` (or
a sibling file). Don't try to fix the real failing library yet — get a
two-line repro first.

### Step 2 — decide: babel plugin or runtime patch?

- **Babel plugin** when the fix is "rewrite this AST shape into something
  Arc can handle." Live in `babel/`, one file per plugin, wired into the
  `plugins` array in **both** `make-it-arc.ts` and `make-it-arc-core.ts`
  (keep them in sync, or Node and browser output will diverge). Apply
  post-bundle unless there's a reason not to.
- **Banner monkey patch** when Arc's global *shouldn't be used at all* by
  core-js (force-`undefined` it so core-js polyfills it itself), or when
  you need to stub something *before* core-js init touches it.
- **Footer monkey patch** when core-js installs a broken polyfill and you
  need to replace it after the fact.

### Step 3 — write the patch with a "why" comment

Every monkey patch in `arc-monkey-patches.js` has a comment block above it
explaining:

1. What Arc gets wrong (in concrete terms — what you see in the crash).
2. Why this specific patch works around it.
3. The cue for when this patch can be **deleted** (usually: "remove once
   Arc ships X").

This is the most important part. The whole repo is supposed to shrink as
Arc matures. A patch with no "why" is a patch nobody will dare delete
later. Match the existing style.

### Step 4 — verify

`bun make-it-arc` and confirm:
- Your minimal repro now works.
- Nothing else in `src/index.ts` regressed (the existing test routes still
  print sane Request/Response output).

### Step 5 — file the Arc bug

If you found a genuine Arc bug, open an issue against
[alii/arc](https://github.com/alii/arc) and reference the patch you added
here. Future-you (or someone else) will use that link to know when to
delete the workaround.

---

## Layout

```
make-it-arc.ts             # Node entry. Path mode (rollup + commonjs + node-resolve) and tree mode.
make-it-arc-core.ts        # Shared, browser-safe tree-mode bundler (@rollup/browser + @babel/standalone).
make-it-arc.browser.ts     # Browser entry. Re-exports the core.
build.js                   # Canary-app driver: makeItArc("./src") -> dist/index.js.
scripts/                   # build-runtime-assets.mjs (the `gen` step).
runtime-assets.generated.ts# Generated. BANNER/FOOTER/STD_LIB inlined from the files below. Never edit by hand.
arc/                       # Arc runtime checkout (git submodule / sibling). Do NOT edit.
arc-monkey-patches.js      # Temporary Arc-bug workarounds. Split by FOOTER_BELOW marker.
arc-std-lib/               # Things Arc lacks but should always have. One file per feature, concatenated at gen time.
babel/                     # Babel plugins. One file = one rewrite.
src/                       # The canary TypeScript app. Start here.
test/                      # Playwright Node/browser parity test.
dist/index.js              # Canary build output. Never edit by hand.
lib/                       # `bun run build` output: the tool compiled for publishing.
```

## License

Experimental. No license yet — assume nothing.
