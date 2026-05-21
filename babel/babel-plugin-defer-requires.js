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

    // Also defer top-level `var x = requireY()` declarations. These are emitted
    // by rollup's commonjs plugin for user-code-driven CJS imports (e.g.
    // `var server_nodeExports = requireServer_node();`) and run BEFORE the
    // deferred core-js polyfill calls, so the imported module evaluates while
    // Set/Map/etc. are still in their pre-polyfill state.
    //
    // Once a var declaration is deferred, any other top-level `var Y = ...`
    // that *reads* its identifiers must also be deferred — otherwise Y is
    // initialized from `undefined`. We compute the set of deferred bindings
    // by fixed-point iteration. `var` is hoisted, so moving the whole
    // statement to the end keeps the binding visible to function bodies
    // declared earlier; only the *initialization* is delayed.
    const isRequireVarDecl = (node) => {
        if (!t.isVariableDeclaration(node)) return false;
        if (node.kind !== "var") return false;
        return node.declarations.some(
            (d) => d.init && isRequireCall(d.init)
        );
    };

    const collectIdentifiers = (node, into) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
            for (const child of node) collectIdentifiers(child, into);
            return;
        }
        if (t.isIdentifier(node)) {
            into.add(node.name);
            return;
        }
        if (t.isMemberExpression(node)) {
            collectIdentifiers(node.object, into);
            if (node.computed) collectIdentifiers(node.property, into);
            return;
        }
        for (const key in node) {
            if (key === "loc" || key === "start" || key === "end" || key === "type") continue;
            const child = node[key];
            if (child && typeof child === "object") collectIdentifiers(child, into);
        }
    };

    const declaredNamesOf = (varDecl) => {
        const names = [];
        for (const d of varDecl.declarations) {
            if (t.isIdentifier(d.id)) names.push(d.id.name);
        }
        return names;
    };

    return {
        name: "defer-requires",
        visitor: {
            Program: {
                exit(path) {
                    const body = path.node.body;
                    const deferredIdx = new Set();
                    const deferredNames = new Set();

                    for (let i = 0; i < body.length; i++) {
                        const stmt = body[i];
                        if (t.isExpressionStatement(stmt) && isRequireCall(stmt.expression)) {
                            deferredIdx.add(i);
                        } else if (isRequireVarDecl(stmt)) {
                            deferredIdx.add(i);
                            for (const n of declaredNamesOf(stmt)) deferredNames.add(n);
                        }
                    }

                    let changed = true;
                    while (changed) {
                        changed = false;
                        for (let i = 0; i < body.length; i++) {
                            if (deferredIdx.has(i)) continue;
                            const stmt = body[i];
                            if (!t.isVariableDeclaration(stmt) || stmt.kind !== "var") continue;
                            const refs = new Set();
                            for (const d of stmt.declarations) {
                                if (d.init) collectIdentifiers(d.init, refs);
                            }
                            let triggers = false;
                            for (const name of refs) {
                                if (deferredNames.has(name)) { triggers = true; break; }
                            }
                            if (triggers) {
                                deferredIdx.add(i);
                                for (const n of declaredNamesOf(stmt)) deferredNames.add(n);
                                changed = true;
                            }
                        }
                    }

                    const deferred = [];
                    const kept = [];
                    for (let i = 0; i < body.length; i++) {
                        if (deferredIdx.has(i)) deferred.push(body[i]);
                        else kept.push(body[i]);
                    }
                    path.node.body = kept.concat(deferred);
                }
            }
        }
    };
}
