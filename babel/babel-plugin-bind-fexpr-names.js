// Arc's JS host doesn't bind a named function expression's name inside
// its own body. Regenerator output like
//   _regenerator().m(function _callee(req) { ...; }, _callee)
// then throws ReferenceError: _callee at the inner `_callee` reference.
//
// Transform every `function NAME(args){body}` (FunctionExpression with id)
// into a real lexical binding:
//   (function(NAME){ return NAME = function(args){body}; })()
// The inner function closes over NAME via the wrapper's parameter, so all
// references to NAME inside body resolve to the assigned function.
// (Arrow functions are avoided — Arc's parser doesn't accept them.)
//
// Apply this AFTER bundling.

export default function ({ types: t }) {
    return {
        name: "bind-fexpr-names",
        visitor: {
            FunctionExpression(path) {
                const id = path.node.id;
                if (!id) return;
                const name = id.name;
                path.node.id = null;
                const fn = path.node;
                path.replaceWith(
                    t.callExpression(
                        t.functionExpression(
                            null,
                            [t.identifier(name)],
                            t.blockStatement([
                                t.returnStatement(
                                    t.assignmentExpression("=", t.identifier(name), fn)
                                ),
                            ])
                        ),
                        [],
                    ),
                );
                path.skip();
            },
        },
    };
}
