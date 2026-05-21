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

- Stress-testing Arc against real libraries (currently
  [`@kaito-http/core`](https://github.com/kaito-http/kaito) is the canary).
- Finding concrete bugs / missing features in Arc — every monkey patch in
  `arc-monkey-patches.js` is a one-line description of something Arc gets
  wrong.
- Letting people write normal TypeScript today and run it on Arc *anyway*.

## What this is **not** good for

- Production. Anything. At all.
- Benchmarking Arc — the rewrites destroy any performance signal.

---

## Try it out

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

1. `bun prepare-for-arc` — runs Rollup, producing `dist/index.js`.
2. `bun run-arc` — `cd arc && gleam run -- ../dist/index.js`.

Edit `src/index.ts`, run `bun make-it-arc` again, watch it work (or break).

Arc is updated frequently by other contributors. **Always `git pull` inside
`arc/` before debugging a failure** — your patch list may already be
shorter than you think.

---

## The build chain, end to end

Source lives in `src/**/*.ts`. Output is a single CJS file at `dist/index.js`
which Arc loads. Between source and output there are roughly six stages:

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

### 3. Post-bundle: Babel passes on `dist/index.js`

Applied in this order (see `rollup.config.js`):

| Plugin | What it does | Why Arc needs it |
|---|---|---|
| `babel-plugin-defer-requires` | Moves every top-level `requireXxx()` call to the end of the bundle, preserving relative order. | core-js modules reference vars declared in *later* modules. Without reordering, you get forward-reference `TypeError`s. |
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
- **`arc-std-lib.js`** — also banner. Adds `Headers`, `Request`, `Response`.
  These aren't monkey patches — Arc just doesn't ship fetch primitives, so
  we provide our own. Synchronous under the hood (the body-reading methods
  return `Promise.resolve(x)` and the `strip-async` pass collapses them).
- **`arc-monkey-patches.js`** (footer half, below the `// FOOTER_BELOW`
  marker) — injected just before `requireUserCode()` is called, i.e.
  AFTER core-js has installed its polyfills. Use this for patches that
  need to *override* something core-js polyfilled (e.g.
  `String.prototype.startsWith`).

### 5. Output

`dist/index.js` — a single CJS bundle Arc can read.

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
  Arc can handle." Live in `babel/`, one file per plugin, wired into
  `rollup.config.js`. Apply post-bundle unless there's a reason not to.
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
arc/                       # Arc runtime checkout (git submodule / sibling). Do NOT edit.
arc-monkey-patches.js      # Temporary Arc-bug workarounds. Split by FOOTER_BELOW marker.
arc-std-lib.js             # Things Arc lacks but should always have: Headers/Request/Response.
babel/                     # Post-bundle Babel plugins. One file = one rewrite.
rollup.config.js           # Wires everything together.
src/                       # Your TypeScript code. Start here.
dist/index.js              # Build output. Never edit by hand.
```

## License

Experimental. No license yet — assume nothing.
