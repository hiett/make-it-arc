// Node entry. Tree input → shared core (identical output to the browser
// build). Path input → full pipeline (rollup + commonjs + node-resolve)
// so existing `src/index.ts` with CJS npm deps keeps working.

// @rollup/browser loads its WASM via `fetch(new URL('./bindings_wasm_bg.wasm',
// import.meta.url))`. In a real browser that's a normal http(s) fetch; in
// stock Node the URL is `file://...` and Node's built-in fetch refuses it
// ("not implemented... yet..."). Bun and Deno handle file:// natively, so
// only install the shim when we're plain Node.
(function installNodeFileFetchShim() {
    const g: any = globalThis as any;
    if (g.__arcFileFetchShimInstalled) return;
    if (typeof process === 'undefined') return;
    if (!(process as any).versions || !(process as any).versions.node) return;
    if (g.Bun || g.Deno) return;
    const orig: typeof fetch = g.fetch;
    g.fetch = async function (input: any, init?: any): Promise<Response> {
        const u =
            typeof input === 'string'
                ? input
                : input && (input.href || input.url);
        if (typeof u === 'string' && u.startsWith('file://')) {
            try {
                return await orig(input, init);
            } catch {
                const fsm = await import('node:fs');
                const um = await import('node:url');
                const filePath = um.fileURLToPath(u);
                const buf = fsm.readFileSync(filePath);
                return new Response(buf, {
                    headers: { 'content-type': 'application/wasm' }
                });
            }
        }
        return orig(input, init);
    };
    g.__arcFileFetchShimInstalled = true;
})();

import {
    makeItArc as makeItArcTree,
    bundleTree,
    normalizeTreeSource,
    type FileTree,
    type MakeItArcTreeSource
} from './make-it-arc-core.js';
import { BANNER, FOOTER, STD_LIB } from './runtime-assets.generated.js';

import { rollup, type Plugin } from 'rollup';
// @ts-ignore
import commonjs from '@rollup/plugin-commonjs';
// @ts-ignore
import babelPlugin from '@rollup/plugin-babel';
// @ts-ignore
import presetReact from '@babel/preset-react';
// @ts-ignore
import presetTypescript from '@babel/preset-typescript';
// @ts-ignore
import presetEnv from '@babel/preset-env';
// @ts-ignore
import transformClassProperties from '@babel/plugin-transform-class-properties';
// @ts-ignore
import transformClasses from '@babel/plugin-transform-classes';
import { transformSync } from '@babel/core';

// @ts-ignore
import stripAsync from './babel/babel-plugin-strip-async.js';
// @ts-ignore
import deregex from './babel/babel-plugin-deregex.js';
// @ts-ignore
import deferRequires from './babel/babel-plugin-defer-requires.js';
// @ts-ignore
import bindFexprNames from './babel/babel-plugin-bind-fexpr-names.js';
// @ts-ignore
import stripSymbolThrows from './babel/babel-plugin-strip-symbol-throws.js';
// @ts-ignore
import wrapUserlandEntry from './babel/babel-plugin-wrap-userland-entry.js';
// @ts-ignore
import defilterDemap from './babel/babel-plugin-defilter-demap.js';
// @ts-ignore
import externalsToRequire from './babel/babel-plugin-externals-to-require.js';

export type { FileTree, MakeItArcTreeSource } from './make-it-arc-core.js';
export { bundleTree, normalizeTreeSource } from './make-it-arc-core.js';
export type MakeItArcSource = string | MakeItArcTreeSource;

const EXTENSIONS = ['.js', '.ts', '.tsx'];

const postBundleBabel = (name: string, plugin: unknown): Plugin => ({
    name,
    renderChunk(code: string) {
        const result = transformSync(code, {
            babelrc: false,
            configFile: false,
            plugins: [plugin as any],
            sourceMaps: false,
            compact: false,
            comments: false
        });
        return { code: result!.code!, map: null };
    }
});

const inlineBabelConfig = (entry: string) => ({
    babelHelpers: 'bundled' as const,
    extensions: EXTENSIONS,
    babelrc: false,
    configFile: false,
    presets: [
        presetReact,
        presetTypescript,
        [
            presetEnv,
            {
                targets: { ie: '11' },
                useBuiltIns: 'usage',
                corejs: { version: '3.49', proposals: false },
                exclude: [
                    '@babel/plugin-transform-async-to-generator',
                    '@babel/plugin-transform-async-generator-functions',
                    '@babel/plugin-transform-regenerator',
                    'transform-async-to-generator',
                    'transform-async-generator-functions',
                    'transform-regenerator'
                ]
            }
        ]
    ],
    plugins: [
        transformClassProperties,
        transformClasses,
        [wrapUserlandEntry, { entry }]
    ]
});

async function bundleFromPath(source: string): Promise<string> {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const abs = path.isAbsolute(source) ? source : path.resolve(source);
    const stat = fs.statSync(abs);
    let entry: string;
    if (stat.isDirectory()) {
        const candidates = ['index.ts', 'index.tsx', 'index.js'];
        const hit = candidates.find((c) => fs.existsSync(path.join(abs, c)));
        if (!hit) throw new Error('makeItArc: no index.{ts,tsx,js} in ' + abs);
        entry = path.join(abs, hit);
    } else {
        entry = abs;
    }

    // @ts-ignore — no bundled types
    const nodeResolveMod = await import('@rollup/plugin-node-resolve');
    const nodeResolve = (nodeResolveMod as any).default ?? nodeResolveMod;

    const plugins: Plugin[] = [
        nodeResolve({ extensions: EXTENSIONS }),
        commonjs({ strictRequires: true }),
        babelPlugin(inlineBabelConfig(entry)),
        postBundleBabel('externals-to-require-post-bundle', externalsToRequire),
        postBundleBabel('defer-requires-post-bundle', deferRequires),
        postBundleBabel('strip-async-post-bundle', stripAsync),
        postBundleBabel('bind-fexpr-names-post-bundle', bindFexprNames),
        postBundleBabel('strip-symbol-throws-post-bundle', stripSymbolThrows),
        postBundleBabel('deregex-post-bundle', deregex),
        postBundleBabel('defilter-demap-post-bundle', defilterDemap),
        {
            name: 'inject-patches-before-user-code',
            renderChunk(code: string) {
                if (!FOOTER.trim()) return null;
                const marker = 'requireUserCode();';
                const idx = code.lastIndexOf(marker);
                if (idx === -1) return null;
                return {
                    code: code.slice(0, idx) + FOOTER + '\n' + code.slice(idx),
                    map: null
                };
            }
        }
    ];

    const bundle = await rollup({ input: entry, plugins });
    const { output } = await bundle.generate({
        format: 'es',
        banner: BANNER + '\n' + STD_LIB
    });
    await bundle.close();
    return output[0].code;
}

export async function makeItArc(source: MakeItArcSource): Promise<string> {
    if (typeof source === 'string') {
        return bundleFromPath(source);
    }
    return makeItArcTree(source);
}

export default makeItArc;
