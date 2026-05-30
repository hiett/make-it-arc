// Browser entry: the shared core IS the browser surface.
export {
    makeItArc,
    bundleTree,
    normalizeTreeSource,
    virtualFsPlugin,
    type FileTree,
    type MakeItArcTreeSource as MakeItArcSource
} from './make-it-arc-core.js';

export { makeItArc as default } from './make-it-arc-core.js';
