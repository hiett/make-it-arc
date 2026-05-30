import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import url from 'node:url';

import { makeItArc } from '../make-it-arc.ts';
import { FIXTURE } from './fixture.ts';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function buildBrowserBundle(outDir: string): Promise<void> {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    // Re-export the browser entry on globalThis so the harness can call it.
    const entryPath = path.join(outDir, '__entry.mjs');
    fs.writeFileSync(
        entryPath,
        `import { makeItArc } from ${JSON.stringify(
            path.join(projectRoot, 'make-it-arc.browser.ts')
        )};\nglobalThis.__makeItArc = makeItArc;\n`
    );

    await build({
        entryPoints: [entryPath],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile: path.join(outDir, 'bundle.js'),
        logLevel: 'error'
    });

    // @rollup/browser expects bindings_wasm_bg.wasm sitting next to the
    // module via `new URL('./bindings_wasm_bg.wasm', import.meta.url)`.
    // esbuild doesn't auto-copy it, so we drop it in by hand.
    const wasmSrc = path.join(
        projectRoot,
        'node_modules/@rollup/browser/dist/es/bindings_wasm_bg.wasm'
    );
    fs.copyFileSync(wasmSrc, path.join(outDir, 'bindings_wasm_bg.wasm'));

    fs.writeFileSync(
        path.join(outDir, 'index.html'),
        `<!doctype html><meta charset="utf-8"><title>parity</title>` +
            `<script type="module" src="./bundle.js"></script>`
    );
}

function startStaticServer(rootDir: string): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const reqPath = (req.url || '/').split('?')[0];
            const filePath = path.join(
                rootDir,
                reqPath === '/' ? 'index.html' : reqPath
            );
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.statusCode = 404;
                    res.end('not found');
                    return;
                }
                const ext = path.extname(filePath);
                const types: Record<string, string> = {
                    '.html': 'text/html',
                    '.js': 'text/javascript',
                    '.mjs': 'text/javascript',
                    '.wasm': 'application/wasm'
                };
                res.setHeader('content-type', types[ext] || 'application/octet-stream');
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as AddressInfo;
            const u = `http://127.0.0.1:${addr.port}`;
            resolve({
                url: u,
                close: () => new Promise((r) => server.close(() => r()))
            });
        });
    });
}

test('node and browser produce byte-identical output for the same tree', async ({ page }) => {
    const nodeOutput = await makeItArc(FIXTURE);
    const nodeHash = sha(nodeOutput);

    const outDir = path.join(projectRoot, '.test-browser');
    await buildBrowserBundle(outDir);
    const server = await startStaticServer(outDir);

    try {
        const consoleErrors: string[] = [];
        page.on('pageerror', (e) => consoleErrors.push(String(e)));
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto(server.url, { waitUntil: 'load' });
        await page.waitForFunction(() => typeof (window as any).__makeItArc === 'function');

        const browserOutput = await page.evaluate(async (fixture) => {
            const out = await (window as any).__makeItArc(fixture);
            return out as string;
        }, FIXTURE);

        if (consoleErrors.length) {
            console.error('browser console errors:', consoleErrors);
        }

        const browserHash = sha(browserOutput);

        console.log('node sha256   =', nodeHash, '(' + nodeOutput.length + ' bytes)');
        console.log('browser sha256=', browserHash, '(' + browserOutput.length + ' bytes)');

        expect(browserOutput.length).toBe(nodeOutput.length);
        expect(browserHash).toBe(nodeHash);
    } finally {
        await server.close();
    }
});
