// Strips async/await and Promise-like constructs so the code can run
// in a blocking, event-loop-less runtime.
//
//   async function f() {}     -> function f() {}
//   await expr                -> expr
//   for await (x of y)        -> for (x of y)
//   Promise.resolve(x)        -> x
//   Promise.reject(x)         -> (() => { throw x })()
//   Promise.all([a, b])       -> [a, b]
//   Promise.allSettled(xs)    -> xs
//   x.then(f)                 -> f(x)
//   x.then(f, g)              -> f(x)        (rejection branch dropped)
//   x.catch(f)                -> x
//   x.finally(f)              -> (f(), x)
//   new Promise((res) => { res(v) })  -> left alone (too dynamic to rewrite safely)
//
// Apply this AFTER bundling, on the final single file.

export default function ({ types: t }) {
    return {
        name: "strip-async",
        visitor: {
            Function(path) {
                if (path.node.async) path.node.async = false;
            },

            AwaitExpression(path) {
                path.replaceWith(path.node.argument);
            },

            ForOfStatement(path) {
                if (path.node.await) path.node.await = false;
            },

            CallExpression(path) {
                const { callee, arguments: args } = path.node;
                if (callee.type !== "MemberExpression" || callee.computed) return;
                if (callee.property.type !== "Identifier") return;

                const method = callee.property.name;
                const receiver = callee.object;

                // Promise.* static calls
                if (receiver.type === "Identifier" && receiver.name === "Promise") {
                    const arg0 = args[0] || t.identifier("undefined");
                    if (method === "resolve" || method === "all" || method === "allSettled" || method === "race" || method === "any") {
                        path.replaceWith(arg0);
                        return;
                    }
                    if (method === "reject") {
                        path.replaceWith(
                            t.callExpression(
                                t.arrowFunctionExpression(
                                    [],
                                    t.blockStatement([t.throwStatement(arg0)])
                                ),
                                []
                            )
                        );
                        return;
                    }
                }

                // .then / .catch / .finally
                if (method === "then") {
                    const fn = args[0];
                    if (fn) path.replaceWith(t.callExpression(fn, [receiver]));
                    else path.replaceWith(receiver);
                    return;
                }
                if (method === "catch") {
                    path.replaceWith(receiver);
                    return;
                }
                if (method === "finally") {
                    const fn = args[0];
                    if (fn) {
                        const v = path.scope.generateUidIdentifier("v");
                        path.replaceWith(
                            t.callExpression(
                                t.arrowFunctionExpression(
                                    [v],
                                    t.sequenceExpression([t.callExpression(fn, []), v])
                                ),
                                [receiver]
                            )
                        );
                    } else {
                        path.replaceWith(receiver);
                    }
                    return;
                }
            }
        }
    };
};