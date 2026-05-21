// ---------------------------------------------------------------------------
// require('stream') → { Readable }
//
// Only referenced from react-dom/server's `renderToPipeableStream` path,
// which `renderToString` does not invoke. The module-level capture
// (`var stream = require$$5;`) still needs to resolve at import time, so a
// no-op constructor is enough. If we ever exercise the streaming render
// API on Arc, this will need a real implementation (or, more likely, Arc
// will grow native streams and we'll delete this file).
// ---------------------------------------------------------------------------

(function () {
  function ArcReadable() {}
  globalThis.__arcModules.stream = { Readable: ArcReadable };
})();
