// With rollup `format: 'es'` the bundle keeps the entry's native `export`
// statements (Arc is ESM-native and wants `export function`/`export {}`,
// NOT `module.exports`/`exports.x`). But that same format also turns
// externalized node builtins into top-level `import X from 'util'` etc.,
// which Arc's module loader tries to resolve as files and fails on.
//
// The pre-existing `arc-std-lib/00-require-registry.js` shim already provides
// `require('util' | 'crypto' | 'async_hooks' | 'stream')`. So we rewrite the
// builtin `import` declarations back into `var X = require('...')` calls and
// let the shim resolve them — keeping native ESM `export` on the way out
// while routing builtins through the require registry.
//
// Only bare specifiers (no ./ or ../ prefix) are rewritten; relative imports
// are left untouched. Run as a post-bundle pass.

const isBareSpecifier = (source) =>
    typeof source === "string" &&
    !source.startsWith("./") &&
    !source.startsWith("../") &&
    !source.startsWith("/");

export default function ({ types: t }) {
    return {
        name: "externals-to-require",
        visitor: {
            ImportDeclaration(path) {
                const source = path.node.source.value;
                if (!isBareSpecifier(source)) return;

                const requireCall = t.callExpression(t.identifier("require"), [
                    t.stringLiteral(source)
                ]);

                const decls = [];
                for (const spec of path.node.specifiers) {
                    if (t.isImportDefaultSpecifier(spec)) {
                        // import X from 'm'  ->  var X = require('m')
                        decls.push(
                            t.variableDeclarator(t.identifier(spec.local.name), requireCall)
                        );
                    } else if (t.isImportNamespaceSpecifier(spec)) {
                        // import * as X from 'm'  ->  var X = require('m')
                        decls.push(
                            t.variableDeclarator(t.identifier(spec.local.name), requireCall)
                        );
                    } else if (t.isImportSpecifier(spec)) {
                        // import { a as b } from 'm'  ->  var b = require('m').a
                        const imported = t.isIdentifier(spec.imported)
                            ? t.memberExpression(requireCall, t.identifier(spec.imported.name))
                            : t.memberExpression(
                                  requireCall,
                                  t.stringLiteral(spec.imported.value),
                                  true
                              );
                        decls.push(
                            t.variableDeclarator(t.identifier(spec.local.name), imported)
                        );
                    }
                }

                if (decls.length === 0) {
                    // bare `import 'm'` side-effect import -> require('m')
                    path.replaceWith(t.expressionStatement(requireCall));
                    return;
                }
                path.replaceWith(t.variableDeclaration("var", decls));
            }
        }
    };
}
