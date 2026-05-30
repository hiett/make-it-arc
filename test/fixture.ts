// Test fixture for cross-environment parity. Kept deliberately simple:
// no async, no exotic globals, no things that would push preset-env into
// injecting different polyfills in different environments.
export const FIXTURE = {
    'index.ts':
        "const greet = (n: string) => 'hello ' + n;\n" +
        "const out: string = greet('arc');\n" +
        "console.log(out);\n"
};
