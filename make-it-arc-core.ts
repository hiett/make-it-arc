// Shared tree-mode bundler. Browser-safe: uses @rollup/browser and
// @babel/standalone, no commonjs/node-resolve, no node:* imports.
// Both make-it-arc.ts (Node tree path) and make-it-arc.browser.ts
// route through this so identical inputs produce identical outputs
// regardless of environment.

import { rollup, type Plugin } from '@rollup/browser';
// @ts-ignore — UMD module, no precise types
import BabelStandalone from '@babel/standalone';

// @ts-ignore
import wrapUserlandEntry from './babel/babel-plugin-wrap-userland-entry.js';
// @ts-ignore
import deferRequires from './babel/babel-plugin-defer-requires.js';
// @ts-ignore
import stripAsync from './babel/babel-plugin-strip-async.js';
// @ts-ignore
import bindFexprNames from './babel/babel-plugin-bind-fexpr-names.js';
// @ts-ignore
import stripSymbolThrows from './babel/babel-plugin-strip-symbol-throws.js';
// @ts-ignore
import deregex from './babel/babel-plugin-deregex.js';
// @ts-ignore
import defilterDemap from './babel/babel-plugin-defilter-demap.js';
// @ts-ignore
import externalsToRequire from './babel/babel-plugin-externals-to-require.js';

import { BANNER, FOOTER, STD_LIB } from './runtime-assets.generated.js';

export type FileTree = Record<string, string>;

export type MakeItArcTreeSource =
    | FileTree
    | { entry?: string; files: FileTree };

const EXTENSIONS = ['.js', '.ts', '.tsx'];

const Babel: any =
    (BabelStandalone as any).default ?? (BabelStandalone as any);

function babelTransform(code: string, config: any): string {
    const result = Babel.transform(code, config);
    if (!result || typeof result.code !== 'string') {
        throw new Error('babel transform returned no code');
    }
    return result.code;
}

const PRESET_ENV_OPTIONS = {
    targets: { ie: '11' },
    useBuiltIns: false,
    modules: false,
    exclude: [
        '@babel/plugin-transform-async-to-generator',
        '@babel/plugin-transform-async-generator-functions',
        '@babel/plugin-transform-regenerator',
        'transform-async-to-generator',
        'transform-async-generator-functions',
        'transform-regenerator'
    ]
};

function babelTransformPlugin(entry: string): Plugin {
    return {
        name: 'babel-transform',
        transform(code: string, id: string) {
            if (!EXTENSIONS.some((ext) => id.endsWith(ext))) return null;
            const out = babelTransform(code, {
                babelrc: false,
                configFile: false,
                filename: id,
                sourceMaps: false,
                presets: [
                    'react',
                    'typescript',
                    ['env', PRESET_ENV_OPTIONS]
                ],
                plugins: [
                    'transform-class-properties',
                    'transform-classes',
                    [wrapUserlandEntry, { entry }]
                ]
            });
            return { code: out, map: null };
        }
    };
}

function postBundleBabel(name: string, plugin: unknown): Plugin {
    return {
        name,
        renderChunk(code: string) {
            const out = babelTransform(code, {
                babelrc: false,
                configFile: false,
                plugins: [plugin],
                sourceMaps: false,
                compact: false,
                comments: false
            });
            return { code: out, map: null };
        }
    };
}

function normalizeTreeKey(k: string): string {
    return k.replace(/\\/g, '/').replace(/^\.\//, '');
}

function pickEntry(files: FileTree): string {
    const keys = Object.keys(files);
    const candidates = keys.filter((k) => /(^|\/)index\.(ts|tsx|js)$/.test(k));
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length === 0) {
        throw new Error(
            'makeItArc: could not find an entry file (looking for index.ts/tsx/js); pass {entry, files}'
        );
    }
    candidates.sort((a, b) => a.length - b.length);
    return candidates[0]!;
}

export function normalizeTreeSource(source: MakeItArcTreeSource): {
    entry: string;
    files: FileTree;
} {
    if (!source || typeof source !== 'object') {
        throw new Error(
            'makeItArc: tree source must be a {entry,files} object or a file map'
        );
    }
    let files: FileTree;
    let entry: string | undefined;
    if ('files' in source && source.files && typeof source.files === 'object') {
        files = source.files;
        entry = source.entry;
    } else {
        files = source as FileTree;
    }
    const normalized: FileTree = {};
    for (const [k, v] of Object.entries(files)) {
        if (typeof v !== 'string')
            throw new Error('makeItArc: file contents must be strings (' + k + ')');
        normalized[normalizeTreeKey(k)] = v;
    }
    const resolvedEntry = entry ? normalizeTreeKey(entry) : pickEntry(normalized);
    if (normalized[resolvedEntry] === undefined) {
        throw new Error('makeItArc: entry "' + resolvedEntry + '" not found in files');
    }
    return { entry: resolvedEntry, files: normalized };
}

export function virtualFsPlugin(files: FileTree): Plugin {
    const tryResolve = (base: string): string | null => {
        if (files[base] !== undefined) return base;
        for (const ext of EXTENSIONS) {
            if (files[base + ext] !== undefined) return base + ext;
        }
        for (const ext of EXTENSIONS) {
            const idx = base + '/index' + ext;
            if (files[idx] !== undefined) return idx;
        }
        return null;
    };
    const joinPosix = (a: string, b: string): string => {
        const parts = (a + '/' + b).split('/');
        const out: string[] = [];
        for (const part of parts) {
            if (part === '' || part === '.') continue;
            if (part === '..') out.pop();
            else out.push(part);
        }
        return out.join('/');
    };
    return {
        name: 'arc-virtual-fs',
        resolveId(source: string, importer: string | undefined) {
            if (
                importer &&
                files[importer] !== undefined &&
                (source.startsWith('./') || source.startsWith('../'))
            ) {
                const dir = importer.split('/').slice(0, -1).join('/');
                const base = joinPosix(dir, source);
                const resolved = tryResolve(base);
                if (resolved) return resolved;
            }
            const direct = tryResolve(source);
            if (direct) return direct;
            return null;
        },
        load(id: string) {
            if (files[id] !== undefined) return files[id]!;
            return null;
        }
    };
}

export async function bundleTree(entry: string, files: FileTree): Promise<string> {
    const plugins: Plugin[] = [
        virtualFsPlugin(files),
        babelTransformPlugin(entry),
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

export async function makeItArc(source: MakeItArcTreeSource): Promise<string> {
    const { entry, files } = normalizeTreeSource(source);
    return bundleTree(entry, files);
}

export default makeItArc;
