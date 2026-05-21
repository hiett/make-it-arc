# arc-std-lib/

Hand-written runtime additions injected into the bundle before user code
runs. Each file fills in one thing Arc doesn't ship but should — they are
**not** monkey patches (those live in `arc-monkey-patches.js` and have a
deletion criterion). Std-lib files are expected to stick around: Arc is
unlikely to grow `Headers`/`Request`/`Response` itself, and the Node
built-in shims will always be needed in some form for libraries that
`require()` them.

## Build-time concatenation

`rollup.config.js` reads this folder recursively, sorts entries by their
path lexicographically, and prepends the concatenated result to the
bundle banner (after `arc-monkey-patches.js`'s banner half, before the
core-js polyfill loaders).

Only `.js` files are picked up. `README.md` and anything else is ignored.

## Ordering

Sort order is lexicographic on the relative path. Use a numeric prefix
(`00-`, `10-`, `20-`, …) when one file must run before another, leaving
gaps so new files can slot in. Files without a numeric prefix sort
*after* numeric-prefixed ones, which is fine for anything order-
independent.

The only ordered dependency today is the `require()` shim:
`00-require-registry.js` must install the empty global `require()` +
module registry before `node-*.js` files add their stubs to it.

## Files

| File | What it provides |
|---|---|
| `00-require-registry.js` | Global `require(name)` plus an internal `__arcModules` registry that later files write into. Throws for unknown module names. |
| `fetch.js` | `Headers`, `Request`, `Response` (incl. `Response.json` / `Response.error` / `Response.redirect`). Synchronous body-reading methods returning `Promise.resolve(x)` — the strip-async pass collapses them. |
| `node-async-hooks.js` | `require('async_hooks')` → `{ AsyncLocalStorage }` with `getStore` / `run` / `enterWith` / `exit` / `disable` backed by a single hidden slot. |
| `node-crypto.js` | `require('crypto')` → `{ createHash }` returning a no-op hasher (`update` concatenates input, `digest` returns the concatenation). |
| `node-stream.js` | `require('stream')` → `{ Readable }` empty constructor. `react-dom/server` references it at module load even when `renderToString` doesn't reach the streaming path. |
| `node-util.js` | `require('util')` → `{ TextEncoder }`. `encode()` returns the input string unchanged so HTML chunks precomputed at module init stay string-shaped and `result += chunk` works in the legacy `renderToString` destination. |
| `process.js` | Global `process` with `env.NODE_ENV = "production"` (so react picks the production code path), a synchronous-running `nextTick`, and an empty `versions`. |

## Adding a new file

1. Drop a `something.js` in here. No registration step needed.
2. If it must run before/after an existing file, give it a numeric prefix
   and document the dependency at the top of the file.
3. Re-run `bun make-it-arc`. The rollup config will pick it up.
