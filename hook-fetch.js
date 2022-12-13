(function (cdnRoot) {
  var originalFetch = window.fetch;
  var origin = location.origin + "/";
  window.fetch = function () {
    if (arguments[0].startsWith(origin)) {
      arguments[0] = cdnRoot + arguments[0].slice(origin.length);
    }
    return originalFetch.apply(this, arguments);
  };
})(__CDN_ROOT__);
