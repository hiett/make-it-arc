import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
import { transformSync } from '@babel/core';
import stripAsync from './babel/babel-plugin-strip-async.js';
import traceLines from './babel/babel-plugin-trace-lines.js';
import deregex from './babel/babel-plugin-deregex.js';
import deferRequires from './babel/babel-plugin-defer-requires.js';
import bindFexprNames from './babel/babel-plugin-bind-fexpr-names.js';
import stripSymbolThrows from './babel/babel-plugin-strip-symbol-throws.js';
import wrapUserlandEntry from './babel/babel-plugin-wrap-userland-entry.js';
import defilterDemap from './babel/babel-plugin-defilter-demap.js';
import fs from "node:fs";

const extensions = ['.js', '.ts'];

const postBundleBabel = (name, plugin) => ({
    name,
    renderChunk(code) {
        const result = transformSync(code, {
            babelrc: false,
            configFile: false,
            plugins: [plugin],
            sourceMaps: false,
            compact: false,
            comments: false
        });
        return { code: result.code, map: null };
    }
});

// arc-monkey-patches.js is split around the FOOTER_BELOW marker:
//   - banner half runs BEFORE core-js polyfills (prepended to bundle)
//   - footer half runs AFTER core-js polyfills, just before requireUserCode()
// arc-std-lib.js is appended after the monkey-patches banner — it doesn't
// care when it runs relative to core-js, but it must exist before user code.
const monkeyPatches = fs.readFileSync('./arc-monkey-patches.js', 'utf8').split('// FOOTER_BELOW');
const monkeyPatchesBanner = monkeyPatches[0];
const monkeyPatchesFooter = monkeyPatches[1] || '';
const stdLib = fs.readFileSync('./arc-std-lib.js', 'utf8');

export default {
    input: 'src/index.ts',
    output: {
        file: 'dist/index.js',
        format: 'cjs',
        banner: monkeyPatchesBanner + '\n' + stdLib
    },
    plugins: [
        resolve({ extensions }),
        commonjs({ strictRequires: true }),
        babel({
            babelHelpers: 'bundled',
            extensions,
            plugins: [[wrapUserlandEntry, { entry: 'src/index.ts' }]]
        }),
        postBundleBabel('defer-requires-post-bundle', deferRequires),
        postBundleBabel('strip-async-post-bundle', stripAsync),
        postBundleBabel('bind-fexpr-names-post-bundle', bindFexprNames),
        postBundleBabel('strip-symbol-throws-post-bundle', stripSymbolThrows),
        postBundleBabel('deregex-post-bundle', deregex),
        postBundleBabel('defilter-demap-post-bundle', defilterDemap),
        {
            // Inject the footer half of arc-monkey-patches.js just before
            // requireUserCode() is invoked. This sits AFTER core-js polyfill
            // installation, so our patches survive.
            name: 'inject-patches-before-user-code',
            renderChunk(code) {
                if (!monkeyPatchesFooter.trim()) return null;
                const marker = 'requireUserCode();';
                const idx = code.lastIndexOf(marker);
                if (idx === -1) return null;
                return { code: code.slice(0, idx) + monkeyPatchesFooter + '\n' + code.slice(idx), map: null };
            }
        },
        // postBundleBabel('trace-lines-post-bundle', traceLines)
    ]
};
