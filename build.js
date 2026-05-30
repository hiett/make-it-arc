import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { makeItArc } from './make-it-arc.ts';

const root = path.dirname(url.fileURLToPath(import.meta.url));
const code = await makeItArc(path.join(root, 'src'));
const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.js'), code);
