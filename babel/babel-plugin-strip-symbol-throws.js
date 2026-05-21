// core-js's `toString` polyfill refuses to stringify Symbol values with:
//   throw new TypeError('Cannot convert a Symbol value to a string');
// On a host like Arc — where the classof("@@toStringTag") lookup can
// misclassify ordinary strings as 'Symbol' — this guard fires on real
// strings (e.g. isForced('RegExp') → normalize → 'RegExp'.replace(...)).
// Once stripped, the function falls through to `$String(argument)`,
// which works for actual symbols via the @@toPrimitive override in
// arc-std-lib.js. Apply this AFTER bundling.

const MESSAGE = "Cannot convert a Symbol value to a string";

export default function () {
    return {
        name: "strip-symbol-throws",
        visitor: {
            ThrowStatement(path) {
                const arg = path.node.argument;
                if (!arg || arg.type !== "NewExpression") return;
                if (arg.callee.type !== "Identifier" || arg.callee.name !== "TypeError") return;
                const first = arg.arguments[0];
                if (!first || first.type !== "StringLiteral") return;
                if (first.value !== MESSAGE) return;
                path.remove();
            },
        },
    };
}
