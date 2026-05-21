// ---------------------------------------------------------------------------
// require('crypto') → { createHash }
//
// react-dom/server uses `crypto.createHash("md5")` to derive component key
// paths. Those derived keys only need to be deterministic, not actually
// cryptographic, so we hand back a no-op hasher: `update(s)` concatenates
// input, `digest()` returns the concatenation.
//
// If anything ever depends on the *value* matching real MD5 (e.g. matching
// a hash produced server-side against a client-side hash), this stub will
// need to be replaced with a real implementation.
// ---------------------------------------------------------------------------

(function () {
  globalThis.__arcModules.crypto = {
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
})();
