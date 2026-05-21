// ---------------------------------------------------------------------------
// Global `require()` shim + module registry.
//
// Rollup's commonjs plugin leaves bare `require('util')` / `require('crypto')`
// / `require('async_hooks')` / `require('stream')` calls in the bundle for
// modules it considers external (Node built-ins). Arc has no module loader
// at all — `require` is undefined and throws at load time.
//
// This file installs an empty registry and a `require(name)` that looks up
// modules in it. Each `node-*.js` file in this folder then registers itself
// with the registry. Throws for unknown module names so missing stubs are
// loud, not silent.
//
// Ordering: this MUST run before any `node-*.js` file. The `00-` prefix
// keeps it first in the lexicographic load order.
// ---------------------------------------------------------------------------

(function () {
  if (typeof globalThis.__arcModules === "undefined") {
    globalThis.__arcModules = {};
  }
  if (typeof globalThis.require === "undefined") {
    globalThis.require = function (name) {
      if (Object.prototype.hasOwnProperty.call(globalThis.__arcModules, name)) {
        return globalThis.__arcModules[name];
      }
      throw new Error("Arc: cannot require module '" + name + "'");
    };
  }
})();
