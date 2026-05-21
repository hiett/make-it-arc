// ---------------------------------------------------------------------------
// Global `process` stub.
//
// Used heavily by react and other Node-targeting libraries to branch on
// `process.env.NODE_ENV` and call `process.nextTick(fn)`. We pin NODE_ENV
// to "production" so react picks the production codepath (avoids dev-only
// asserts and console warnings that would touch missing APIs).
//
// nextTick is implemented synchronously — Arc has no event loop. The
// strip-async post-bundle pass already collapses microtask scheduling
// elsewhere; matching that semantics here keeps everything consistent.
// ---------------------------------------------------------------------------

(function () {
  if (typeof globalThis.process !== "undefined") return;
  globalThis.process = {
    env: { NODE_ENV: "production" },
    nextTick: function (fn) {
      try { fn(); } catch (e) {}
    },
    versions: {}
  };
})();
