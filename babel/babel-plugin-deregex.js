// Rewrites regex literals into `new RegExp(pattern, flags)` calls so a
// runtime without regex-literal syntax can still parse the file. RegExp
// itself is provided by core-js polyfills (or by Arc).
//
//   /foo/g  ->  new RegExp("foo", "g")
//   /\d+/   ->  new RegExp("\\d+", "")

export default function ({ types: t }) {
    return {
        name: "deregex",
        visitor: {
            RegExpLiteral(path) {
                const { pattern, flags } = path.node;
                path.replaceWith(
                    t.newExpression(t.identifier("RegExp"), [
                        t.stringLiteral(pattern),
                        t.stringLiteral(flags || "")
                    ])
                );
            }
        }
    };
}
