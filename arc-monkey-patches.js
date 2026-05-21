// ---------------------------------------------------------------------------
// Temporary monkey patches for the Arc runtime.
//
// Everything in this file is a workaround for something Arc gets wrong (or
// hasn't implemented yet). Each block should call out the bug it papers over
// so we can delete the block once Arc fixes it upstream.
//
// File layout:
//   - Above FOOTER_BELOW: banner-time patches. Prepended to the bundle and
//     run BEFORE core-js installs its polyfills. Use these to nudge core-js
//     onto a working code path (e.g. force-undefining broken globals).
//   - Below FOOTER_BELOW: footer-time patches. Injected just before
//     requireUserCode(), AFTER core-js polyfills have been installed. Use
//     these to override a polyfill that core-js installed incorrectly for
//     Arc, or to install a fix that core-js would otherwise clobber.
// ---------------------------------------------------------------------------

// Stub ArrayBuffer for Arc runtime (Arc has no native ArrayBuffer).
// core-js's polyfill init code does `ArrayBuffer.prototype` unconditionally
// inside requireArrayBufferTransfer(), so we need at least an object with
// a .prototype to keep that path from throwing.
if (typeof globalThis.ArrayBuffer === "undefined") {
  globalThis.ArrayBuffer = function ArrayBuffer() {};
  globalThis.ArrayBuffer.prototype = {};
}
if (typeof globalThis.DataView === "undefined") {
  globalThis.DataView = function DataView() {};
  globalThis.DataView.prototype = {
    getInt8: function () {},
    setInt8: function () {},
  };
}

// Arc has no event loop and no microtask queue, but core-js's microtask
// polyfill (loaded transitively by Promise-related polyfills) inspects
// `queueMicrotask` and, if missing, falls through to an init path that
// touches `Promise.resolve().then(...)`. The strip-async post-bundle pass
// turns `Promise.resolve(undefined)` into `undefined`, which then explodes
// on the next member access. Provide a synchronous-running stub so the
// `if (!microtask)` branch is never entered.
if (typeof globalThis.queueMicrotask === "undefined") {
  globalThis.queueMicrotask = function (fn) {
    try {
      fn();
    } catch (e) {}
  };
}

// Force core-js to skip its WeakMap-backed internal-state path. Arc's
// WeakMap either doesn't persist values or doesn't match the host's
// native-code signature reliably, which leads to:
//   TypeError: Incompatible receiver, Set required
// when polyfilled Set lookups miss the state store. Removing WeakMap
// pushes core-js onto its hidden-property fallback for internal state.
globalThis.WeakMap = undefined;

// Arc's native Set/Map are partially compatible — enough that
// core-js detects them via isCallable and only "wraps" rather than
// replacing them, but the wrapped path doesn't install the internal
// state the polyfilled iterator (Set.prototype.values()) expects.
// Force-undefine them so core-js takes the full-replacement path
// using its own state-tracked implementations.
globalThis.Set = undefined;
globalThis.Map = undefined;
globalThis.WeakSet = undefined;

// Arc's Symbol.prototype.valueOf returns the Symbol object rather than
// the Symbol primitive, so core-js's polyfilled
// Symbol.prototype[Symbol.toPrimitive] (which forwards to valueOf)
// returns an object and the spec coercion throws
//   TypeError: Cannot convert object to primitive value
// when anything stringifies a value that internally touches a Symbol
// (e.g. `urlSearchParams + ''` during URL polyfill setup).
// Override @@toPrimitive on Symbol.prototype to return a definite
// primitive (the description string, or empty string) so coercion
// completes. Reported upstream to the Arc runtime; remove once fixed.
// Arc's `String(x)` does not follow the spec when `x` is a wrapper object:
// `String(Object('hi'))` returns `''` instead of `'hi'`. Spec says coerce
// via ToPrimitive(x, 'string') which falls through to `x.toString()` /
// `x.valueOf()`. This breaks core-js's `Array.from('https://google.com')`
// because the polyfill calls `toObject(string)` (which boxes it) and then
// `String(boxed)` inside the String-iterator state — getting an empty
// string makes the iterator immediately report `done`, so the entire URL
// parser sees an empty input and bails with "Invalid scheme".
//
// Wrap String/Number/Boolean to unbox correctly when called as functions.
// Construction (`new String(x)`) is left to the native built-in; we only
// fix the function-call coercion path. Prototype identity is preserved so
// `x instanceof String` and `Object.prototype.toString.call(x)` still work.
(function () {
  function wrapPrimitiveCoercer(name, fallback) {
    var Native = globalThis[name];
    if (typeof Native !== "function") return;
    function Wrapper(value) {
      if (this instanceof Wrapper) {
        // Construction path — delegate to native and return its box.
        return arguments.length === 0 ? new Native() : new Native(value);
      }
      if (arguments.length === 0) return fallback;
      if (value !== null && typeof value === "object") {
        if (typeof value.valueOf === "function") {
          var v;
          try {
            v = value.valueOf();
          } catch (e) {
            v = undefined;
          }
          if (v !== value && (typeof v !== "object" || v === null)) {
            return Native(v);
          }
        }
        if (typeof value.toString === "function") {
          var s;
          try {
            s = value.toString();
          } catch (e) {
            s = undefined;
          }
          if (typeof s !== "object" || s === null) {
            return Native(s);
          }
        }
      }
      return Native(value);
    }
    Wrapper.prototype = Native.prototype;
    try {
      Wrapper.prototype.constructor = Wrapper;
    } catch (e) {}
    for (var k in Native) {
      if (Object.prototype.hasOwnProperty.call(Native, k)) {
        try {
          Wrapper[k] = Native[k];
        } catch (e) {}
      }
    }
    var extras = [
      "fromCharCode",
      "fromCodePoint",
      "raw",
      "isFinite",
      "isInteger",
      "isNaN",
      "isSafeInteger",
      "parseFloat",
      "parseInt",
      "MAX_VALUE",
      "MIN_VALUE",
      "MAX_SAFE_INTEGER",
      "MIN_SAFE_INTEGER",
      "EPSILON",
      "POSITIVE_INFINITY",
      "NEGATIVE_INFINITY",
      "NaN",
    ];
    for (var i = 0; i < extras.length; i++) {
      var key = extras[i];
      if (key in Native) {
        try {
          Wrapper[key] = Native[key];
        } catch (e) {}
      }
    }
    globalThis[name] = Wrapper;
  }
  wrapPrimitiveCoercer("String", "");
  wrapPrimitiveCoercer("Number", 0);
  wrapPrimitiveCoercer("Boolean", false);
})();

if (typeof globalThis.Symbol !== "undefined" && globalThis.Symbol.prototype) {
  var __arcToPrim = globalThis.Symbol.toPrimitive;
  if (__arcToPrim) {
    // Must return a primitive without touching `this.description` —
    // core-js installs a `description` getter that uses the symbol as
    // a key in a hasOwn lookup, which re-coerces and re-enters this
    // function, producing infinite recursion. Return a constant empty
    // string instead. Anything that ends up here is a stringification
    // path that would otherwise have thrown anyway; '' is harmless.
    globalThis.Symbol.prototype[__arcToPrim] = function () {
      return "";
    };
  }
}

// === FOOTER (injected after core-js polyfills by rollup.config.js) ===
// Everything below the FOOTER_BELOW marker runs AFTER the bundle, so it can
// override anything core-js polyfilled. Banner-time patches get clobbered.
// FOOTER_BELOW
(function () {
  // TEMP: Arc's String.prototype.startsWith is exposed (typeof === "function")
  // but throws "undefined is not a function" when invoked. core-js's polyfill
  // is also broken in Arc. Patch it here at the very end so nothing overwrites
  // us. Remove once Arc ships a working startsWith.
  String.prototype.startsWith = function (search, pos) {
    var p = pos === undefined ? 0 : pos;
    return this.substring(p, p + search.length) === search;
  };
})();
