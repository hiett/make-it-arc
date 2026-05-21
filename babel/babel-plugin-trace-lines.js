// Inserts Arc.log("L<lineno>") before every statement so a crash in the
// runtime (which has no stack trace) can be located by the last line logged.
//
// Line numbers reflect the file this plugin ran on. Run it AFTER bundling
// and AFTER strip-async, so the line numbers match dist/index.js — the file
// you'll actually be reading when triaging.

const MARK = Symbol("trace-line-injected");

export default function ({ types: t }) {
    const makeLog = (line) =>
        t.expressionStatement(
            t.callExpression(
                t.memberExpression(t.identifier("Arc"), t.identifier("log")),
                [t.stringLiteral("L" + line)]
            )
        );

    const visitStatement = (path) => {
        const node = path.node;
        if (node[MARK]) return;
        if (!node.loc) return;
        // Block bodies handle themselves via their inner statements.
        if (t.isBlockStatement(node)) return;

        // Skip directives like "use strict".
        if (t.isExpressionStatement(node) && t.isStringLiteral(node.expression) && path.parentPath.isProgram()) {
            return;
        }

        // Don't inject before a bare super() in a derived constructor —
        // it's legal here, but keeping super() first is the conservative move.
        if (
            t.isExpressionStatement(node) &&
            t.isCallExpression(node.expression) &&
            t.isSuper(node.expression.callee)
        ) {
            return;
        }

        // Only inject where statements can have siblings (block-ish parents).
        const parent = path.parentPath;
        const canInsertBefore =
            parent.isBlockStatement() ||
            parent.isProgram() ||
            parent.isSwitchCase() ||
            parent.isStaticBlock();

        const log = makeLog(node.loc.start.line);
        log[MARK] = true;
        log.expression[MARK] = true;

        if (canInsertBefore) {
            path.insertBefore(log);
            return;
        }

        // Single-statement bodies of if/for/while/etc. — wrap in a block.
        if (
            (parent.isIfStatement() && (parent.node.consequent === node || parent.node.alternate === node)) ||
            (parent.isForStatement() && parent.node.body === node) ||
            (parent.isForInStatement() && parent.node.body === node) ||
            (parent.isForOfStatement() && parent.node.body === node) ||
            (parent.isWhileStatement() && parent.node.body === node) ||
            (parent.isDoWhileStatement() && parent.node.body === node) ||
            (parent.isWithStatement() && parent.node.body === node) ||
            (parent.isLabeledStatement() && parent.node.body === node) ||
            (parent.isArrowFunctionExpression() && parent.node.body === node)
        ) {
            path.replaceWith(t.blockStatement([log, node]));
        }
    };

    return {
        name: "trace-lines",
        visitor: {
            Statement: visitStatement
        }
    };
}
