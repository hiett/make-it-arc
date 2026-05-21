// @rollup/plugin-commonjs emits top-level `requireFoo()` side-effect calls
// at the position where each CJS module was first imported. For core-js,
// where modules reference vars declared in LATER modules, this causes
// forward-reference TypeErrors. Moving all top-level `requireXxx()` /
// `requireXxx.call(...)` / `xxx = requireYyy()` statements to the END of
// the program lets every `var fooStore = {...}` initializer run first.
//
// Preserves relative order among the deferred calls. Run AFTER bundling.

const isRequireName = (name) =>
    typeof name === "string" && name.length > "require".length && name.startsWith("require") &&
    name[7] === name[7].toUpperCase();

export default function ({ types: t }) {
    const isRequireCall = (node) => {
        if (!t.isCallExpression(node)) return false;
        let callee = node.callee;
        if (t.isMemberExpression(callee)) callee = callee.object;
        return t.isIdentifier(callee) && isRequireName(callee.name);
    };

    return {
        name: "defer-requires",
        visitor: {
            Program: {
                exit(path) {
                    const body = path.node.body;
                    const deferred = [];
                    const kept = [];
                    for (const stmt of body) {
                        if (t.isExpressionStatement(stmt) && isRequireCall(stmt.expression)) {
                            deferred.push(stmt);
                        } else {
                            kept.push(stmt);
                        }
                    }
                    path.node.body = kept.concat(deferred);
                }
            }
        }
    };
}
