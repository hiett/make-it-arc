// Wraps the bundle entry's top-level executable statements in a
// `requireUserCode()` function and emits a call to it. The post-bundle
// `babel-plugin-defer-requires` pass recognises the `requireXxx()` call
// pattern and moves it to the very end of the bundle, alongside all the
// core-js `requireEs_*()` polyfill loaders. That guarantees user code only
// runs after Set/Map/URL/etc. have been polyfilled — otherwise top-level
// constructs like `new Set()` inside an imported library throw
// "undefined is not a constructor" because the polyfill installer hasn't
// run yet.
//
// Applied per-file during rollup's babel pass, but only to the entry file
// (src/index.ts). Other files in src/** stay untouched — wrapping them
// would relocate their `export const` initializers and break imports.
//
// Import/export declarations stay at module scope; only the remaining
// top-level statements are moved into the wrapper.

import path from "node:path";

const DEFAULT_ENTRY = path.join("src", "index.ts");

export default function ({ types: t }) {
    return {
        name: "wrap-userland-entry",
        visitor: {
            Program: {
                exit(programPath, state) {
                    const entry = (state.opts && state.opts.entry) || DEFAULT_ENTRY;
                    const filename = state.filename || "";
                    if (!filename.endsWith(entry)) return;

                    const body = programPath.node.body;
                    const top = [];
                    const inner = [];
                    for (const stmt of body) {
                        if (
                            t.isImportDeclaration(stmt) ||
                            t.isExportDeclaration(stmt) ||
                            t.isTSImportEqualsDeclaration?.(stmt)
                        ) {
                            top.push(stmt);
                        } else {
                            inner.push(stmt);
                        }
                    }
                    if (inner.length === 0) return;

                    const fn = t.functionDeclaration(
                        t.identifier("requireUserCode"),
                        [],
                        t.blockStatement(inner)
                    );
                    const call = t.expressionStatement(
                        t.callExpression(t.identifier("requireUserCode"), [])
                    );
                    programPath.node.body = [...top, fn, call];
                }
            }
        }
    };
}
