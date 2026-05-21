// ---------------------------------------------------------------------------
// Fetch-style Headers / Request / Response for Arc.
//
// Arc has no native fetch primitives. These implementations cover the common
// surface used by @kaito-http/core and similar libraries: header bag access,
// request body parsing (json/text/arrayBuffer/blob/formData), and Response
// construction including the static Response.json helper.
//
// They are deliberately synchronous under the hood — Arc has no event loop
// and the post-bundle babel plugin strips async/await — so the body-reading
// methods return Promise.resolve(value) which the strip-async pass collapses
// into bare values at the call site.
// ---------------------------------------------------------------------------

(function () {
  function normalizeHeaderName(name) {
    return String(name).toLowerCase();
  }

  function ArcHeaders(init) {
    this._map = {};
    if (init == null) return;
    if (init instanceof ArcHeaders) {
      var src = init._map;
      for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) this._map[k] = src[k];
      }
      return;
    }
    if (Array.isArray(init)) {
      for (var i = 0; i < init.length; i++) {
        var pair = init[i];
        if (pair && pair.length >= 2) this.append(pair[0], pair[1]);
      }
      return;
    }
    if (typeof init === "object") {
      for (var key in init) {
        if (Object.prototype.hasOwnProperty.call(init, key)) {
          this.append(key, init[key]);
        }
      }
    }
  }
  ArcHeaders.prototype.get = function (name) {
    var v = this._map[normalizeHeaderName(name)];
    return v === undefined ? null : v;
  };
  ArcHeaders.prototype.has = function (name) {
    return Object.prototype.hasOwnProperty.call(
      this._map,
      normalizeHeaderName(name),
    );
  };
  ArcHeaders.prototype.set = function (name, value) {
    this._map[normalizeHeaderName(name)] = String(value);
  };
  ArcHeaders.prototype.append = function (name, value) {
    var k = normalizeHeaderName(name);
    if (Object.prototype.hasOwnProperty.call(this._map, k)) {
      this._map[k] = this._map[k] + ", " + String(value);
    } else {
      this._map[k] = String(value);
    }
  };
  ArcHeaders.prototype["delete"] = function (name) {
    delete this._map[normalizeHeaderName(name)];
  };
  ArcHeaders.prototype.forEach = function (cb, thisArg) {
    for (var k in this._map) {
      if (Object.prototype.hasOwnProperty.call(this._map, k)) {
        cb.call(thisArg, this._map[k], k, this);
      }
    }
  };
  ArcHeaders.prototype.keys = function () {
    var out = [];
    for (var k in this._map) {
      if (Object.prototype.hasOwnProperty.call(this._map, k)) out.push(k);
    }
    return out;
  };
  ArcHeaders.prototype.values = function () {
    var out = [];
    for (var k in this._map) {
      if (Object.prototype.hasOwnProperty.call(this._map, k))
        out.push(this._map[k]);
    }
    return out;
  };
  ArcHeaders.prototype.entries = function () {
    var out = [];
    for (var k in this._map) {
      if (Object.prototype.hasOwnProperty.call(this._map, k))
        out.push([k, this._map[k]]);
    }
    return out;
  };

  // Body shared by Request and Response. The raw body is stored as either
  // a string or null; reading methods produce derived views on demand.
  function readBodyAsString(body) {
    if (body == null) return "";
    if (typeof body === "string") return body;
    if (typeof body === "object") {
      // Allow callers to pass plain objects to Response — treat as JSON.
      try {
        return JSON.stringify(body);
      } catch (e) {
        return String(body);
      }
    }
    return String(body);
  }

  function ArcRequest(input, init) {
    init = init || {};
    var url;
    var method;
    var headersInit;
    var body;
    if (input && typeof input === "object" && input instanceof ArcRequest) {
      url = input.url;
      method = input.method;
      headersInit = input.headers;
      body = input._bodyText;
    } else if (input && typeof input === "object") {
      // Convenience form: `new Request({ url, method, headers, body })`.
      // Standard fetch only accepts a URL string or Request here, but
      // accepting a plain options bag is friendlier for Arc, where
      // there is no fetch() that would normally hand you one.
      url = input.url == null ? "" : String(input.url);
      if (input.method) method = String(input.method).toUpperCase();
      if (input.headers !== undefined) headersInit = input.headers;
      if (input.body !== undefined) body = input.body;
    } else {
      url = String(input == null ? "" : input);
      method = "GET";
    }
    if (init.method) method = String(init.method).toUpperCase();
    if (init.headers !== undefined) headersInit = init.headers;
    if (init.body !== undefined) body = init.body;

    this.url = url;
    this.method = method || "GET";
    this.headers =
      headersInit instanceof ArcHeaders
        ? headersInit
        : new ArcHeaders(headersInit);
    this._bodyText = body == null ? null : readBodyAsString(body);
    this._bodyUsed = false;
  }
  ArcRequest.prototype._consume = function () {
    if (this._bodyUsed) throw new TypeError("Body already read");
    this._bodyUsed = true;
    return this._bodyText == null ? "" : this._bodyText;
  };
  ArcRequest.prototype.text = function () {
    return Promise.resolve(this._consume());
  };
  ArcRequest.prototype.json = function () {
    var t = this._consume();
    return Promise.resolve(t === "" ? null : JSON.parse(t));
  };
  ArcRequest.prototype.arrayBuffer = function () {
    // Arc has no real ArrayBuffer — hand back the raw string. Callers that
    // truly need bytes will need a real runtime ArrayBuffer.
    return Promise.resolve(this._consume());
  };
  ArcRequest.prototype.blob = function () {
    return Promise.resolve(this._consume());
  };
  ArcRequest.prototype.bytes = function () {
    return Promise.resolve(this._consume());
  };
  ArcRequest.prototype.formData = function () {
    var t = this._consume();
    var out = {};
    if (!t) return Promise.resolve(out);
    var parts = t.split("&");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      var eq = p.indexOf("=");
      var k = eq < 0 ? p : p.slice(0, eq);
      var v = eq < 0 ? "" : p.slice(eq + 1);
      try {
        k = decodeURIComponent(k.replace(/\+/g, " "));
      } catch (e) {}
      try {
        v = decodeURIComponent(v.replace(/\+/g, " "));
      } catch (e) {}
      out[k] = v;
    }
    return Promise.resolve(out);
  };
  ArcRequest.prototype.clone = function () {
    var r = new ArcRequest(this.url, {
      method: this.method,
      headers: this.headers,
      body: this._bodyText,
    });
    return r;
  };

  function ArcResponse(body, init) {
    init = init || {};
    this._bodyText = body == null ? null : readBodyAsString(body);
    this.status = init.status === undefined ? 200 : init.status | 0;
    this.statusText =
      init.statusText === undefined ? "" : String(init.statusText);
    this.headers =
      init.headers instanceof ArcHeaders
        ? init.headers
        : new ArcHeaders(init.headers);
    this.ok = this.status >= 200 && this.status < 300;
    this.redirected = false;
    this.type = "default";
    this.url = "";
    this._bodyUsed = false;
  }
  ArcResponse.prototype._consume = function () {
    if (this._bodyUsed) throw new TypeError("Body already read");
    this._bodyUsed = true;
    return this._bodyText == null ? "" : this._bodyText;
  };
  ArcResponse.prototype.text = function () {
    return Promise.resolve(this._consume());
  };
  ArcResponse.prototype.json = function () {
    var t = this._consume();
    return Promise.resolve(t === "" ? null : JSON.parse(t));
  };
  ArcResponse.prototype.arrayBuffer = function () {
    return Promise.resolve(this._consume());
  };
  ArcResponse.prototype.blob = function () {
    return Promise.resolve(this._consume());
  };
  ArcResponse.prototype.bytes = function () {
    return Promise.resolve(this._consume());
  };
  ArcResponse.prototype.clone = function () {
    return new ArcResponse(this._bodyText, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
  };

  ArcResponse.json = function (body, init) {
    init = init || {};
    var headers =
      init.headers instanceof ArcHeaders
        ? init.headers
        : new ArcHeaders(init.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new ArcResponse(JSON.stringify(body), {
      status: init.status === undefined ? 200 : init.status,
      statusText: init.statusText,
      headers: headers,
    });
  };
  ArcResponse.error = function () {
    var r = new ArcResponse(null, { status: 0 });
    r.type = "error";
    return r;
  };
  ArcResponse.redirect = function (url, status) {
    var s = status === undefined ? 302 : status;
    var h = new ArcHeaders();
    h.set("location", String(url));
    return new ArcResponse(null, { status: s, headers: h });
  };

  globalThis.Headers = ArcHeaders;
  globalThis.Request = ArcRequest;
  globalThis.Response = ArcResponse;

})();

// ---------------------------------------------------------------------------
// Node built-in module stubs (util, crypto, async_hooks, stream).
//
// Rollup's commonjs plugin leaves bare `require('util')` / `require('crypto')`
// / `require('async_hooks')` / `require('stream')` calls in the bundle for
// modules it considers external (Node built-ins). Arc has no module loader
// at all — `require` is undefined and throws at load time.
//
// Here we install a global `require` that returns minimal stubs for the four
// Node built-ins react-dom/server pulls in. Only the pieces actually exercised
// by `renderToString` need to be real:
//
//   util.TextEncoder       — used to "precompute" static HTML chunks at module
//                            init. renderToString's destination.push handler
//                            just concatenates chunks as strings, so we make
//                            encode() return the input string unchanged.
//                            This keeps everything string-shaped end-to-end
//                            (no Uint8Array needed) and `result += chunk`
//                            works as react-dom's legacy path expects.
//   crypto.createHash      — used for componentKeyPath in dev paths; we hand
//                            back a no-op hasher that returns a stable string.
//   async_hooks.AsyncLocalStorage — only the constructor and getStore/run/
//                            enterWith surface are touched; back it with a
//                            single hidden slot.
//   stream.Readable        — only referenced from renderToPipeableStream,
//                            which renderToString does not invoke; a no-op
//                            constructor is enough to satisfy module load.
//
// Remove individual stubs once Arc grows a real require() / native bindings.
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

  var utilStub = { TextEncoder: ArcTextEncoder };

  var cryptoStub = {
    createHash: function () {
      var data = "";
      var hash = {
        update: function (s) {
          data += s == null ? "" : String(s);
          return hash;
        },
        digest: function () {
          return data;
        }
      };
      return hash;
    }
  };

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

  var asyncHooksStub = { AsyncLocalStorage: ArcAsyncLocalStorage };

  function ArcReadable() {}
  var streamStub = { Readable: ArcReadable };

  var modules = {
    util: utilStub,
    crypto: cryptoStub,
    async_hooks: asyncHooksStub,
    stream: streamStub
  };

  if (typeof globalThis.process === "undefined") {
    globalThis.process = {
      env: { NODE_ENV: "production" },
      nextTick: function (fn) {
        try { fn(); } catch (e) {}
      },
      versions: {}
    };
  }

  if (typeof globalThis.require === "undefined") {
    globalThis.require = function (name) {
      if (Object.prototype.hasOwnProperty.call(modules, name)) {
        return modules[name];
      }
      throw new Error("Arc: cannot require module '" + name + "'");
    };
  }
})();
