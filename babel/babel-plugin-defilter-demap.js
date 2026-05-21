// Rewrites `x.filter(cb)` and `x.map(cb)` into inline for-loops via an IIFE,
// because Arc's runtime Array.prototype.filter/map are broken.
//
// Caveats:
// - Static: any `.filter(fn)` / `.map(fn)` call gets rewritten, regardless of
//   whether the receiver is actually an Array. Avoid using these method names
//   on non-array objects in this project.
// - Second argument (`thisArg`) is not supported and silently dropped.
// - Computed access (`x["filter"](cb)`) is not rewritten.

export default function defilterDemap({ types: t }) {
    const makeIIFE = (receiverExpr, cbExpr, kind) => {
        const arrId = t.identifier("__a");
        const cbId = t.identifier("__cb");
        const outId = t.identifier("__r");
        const iId = t.identifier("__i");

        const decls = t.variableDeclaration("var", [
            t.variableDeclarator(arrId, receiverExpr),
            t.variableDeclarator(cbId, cbExpr),
            t.variableDeclarator(
                outId,
                kind === "map"
                    ? t.newExpression(t.identifier("Array"), [
                          t.memberExpression(arrId, t.identifier("length"))
                      ])
                    : t.arrayExpression([])
            )
        ]);

        const callCb = t.callExpression(cbId, [
            t.memberExpression(arrId, iId, true),
            iId,
            arrId
        ]);

        const body =
            kind === "map"
                ? t.expressionStatement(
                      t.assignmentExpression(
                          "=",
                          t.memberExpression(outId, iId, true),
                          callCb
                      )
                  )
                : t.ifStatement(
                      callCb,
                      t.expressionStatement(
                          t.assignmentExpression(
                              "=",
                              t.memberExpression(
                                  outId,
                                  t.memberExpression(outId, t.identifier("length")),
                                  true
                              ),
                              t.memberExpression(arrId, iId, true)
                          )
                      )
                  );

        const forLoop = t.forStatement(
            t.variableDeclaration("var", [
                t.variableDeclarator(iId, t.numericLiteral(0))
            ]),
            t.binaryExpression(
                "<",
                iId,
                t.memberExpression(arrId, t.identifier("length"))
            ),
            t.updateExpression("++", iId),
            t.blockStatement([body])
        );

        const fn = t.functionExpression(
            null,
            [],
            t.blockStatement([decls, forLoop, t.returnStatement(outId)])
        );

        return t.callExpression(fn, []);
    };

    return {
        name: "defilter-demap",
        visitor: {
            CallExpression(path) {
                const { node } = path;
                const callee = node.callee;
                if (!t.isMemberExpression(callee)) return;
                if (callee.computed) return;
                if (!t.isIdentifier(callee.property)) return;
                const name = callee.property.name;
                if (name !== "filter" && name !== "map") return;
                if (node.arguments.length < 1) return;
                // Skip spread/non-expression args.
                const cb = node.arguments[0];
                if (!t.isExpression(cb)) return;

                path.replaceWith(makeIIFE(callee.object, cb, name));
            }
        }
    };
}
