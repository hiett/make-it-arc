// ---------------------------------------------------------------------------
// require('async_hooks') → { AsyncLocalStorage }
//
// react-dom/server constructs an AsyncLocalStorage instance at module init
// to scope per-request state. Arc has no event loop, so there's no real
// async context to track — a single hidden slot saved/restored around
// `run(value, fn)` is enough to keep the synchronous render path happy.
//
// `enterWith` and `exit` / `disable` are stubbed for completeness; nothing
// in the renderToString path currently exercises them.
// ---------------------------------------------------------------------------

(function () {
  function ArcAsyncLocalStorage() {
    this._store = undefined;
  }
  ArcAsyncLocalStorage.prototype.getStore = function () {
    return this._store;
  };
  ArcAsyncLocalStorage.prototype.run = function (value, fn) {
    var prev = this._store;
    this._store = value;
    try {
      return fn();
    } finally {
      this._store = prev;
    }
  };
  ArcAsyncLocalStorage.prototype.enterWith = function (value) {
    this._store = value;
  };
  ArcAsyncLocalStorage.prototype.exit = function (fn) {
    var prev = this._store;
    this._store = undefined;
    try {
      return fn();
    } finally {
      this._store = prev;
    }
  };
  ArcAsyncLocalStorage.prototype.disable = function () {
    this._store = undefined;
  };

  globalThis.__arcModules.async_hooks = { AsyncLocalStorage: ArcAsyncLocalStorage };
})();
