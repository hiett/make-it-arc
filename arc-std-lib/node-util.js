// ---------------------------------------------------------------------------
// require('util') → { TextEncoder }
//
// react-dom/server reads this at module init to "precompute" static HTML
// chunks (`stringToPrecomputedChunk = content => textEncoder.encode(content)`).
// The legacy `renderToString` destination's push handler then does
// `result += chunk` — so chunks just need to be string-coercible.
//
// We return the input string unchanged from `encode()`, which keeps every
// chunk string-shaped end-to-end and sidesteps the Uint8Array path entirely
// (Arc doesn't ship a usable Uint8Array yet). `encodeInto` is provided too
// for code paths that prefer it.
// ---------------------------------------------------------------------------

(function () {
  function ArcTextEncoder() {}
  ArcTextEncoder.prototype.encode = function (s) {
    return s == null ? "" : String(s);
  };
  ArcTextEncoder.prototype.encodeInto = function (s, target) {
    var str = s == null ? "" : String(s);
    return { read: str.length, written: str.length };
  };

  globalThis.__arcModules.util = { TextEncoder: ArcTextEncoder };
})();
