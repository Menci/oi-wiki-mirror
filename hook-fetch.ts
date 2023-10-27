declare const __CDN_ROOT__: string;
declare const __404_PAGE__: string;

if (!Promise.any) {
  Promise.any = <T>(promises: Iterable<T | Promise<T>>): Promise<Awaited<T>> => {
    return Promise.all(
      [...promises].map(promise => {
        return new Promise((resolve, reject) =>
          Promise.resolve(promise)
            // When a promise fulfilled, we call reject to bail out Promise.all
            // When a promise rejected, we call resolve to continue Promise.all
            .then(reject, resolve)
        );
      })
    ).then(
      // The resolved are actually aggregated errors
      errors => Promise.reject(errors),
      // The reject is the first fulfilled promise (which causes the bail out)
      fastest => Promise.resolve<Awaited<T>>(fastest)
    );
  };
}

(function (cdnRoot: string, _404Page: string) {
  function isServiceWorkerRedirectActive() {
    const controller = navigator?.serviceWorker?.controller;
    if (controller?.state === "activated") {
      // Check path is "sw.js" and have specified search parameters
      const url = new URL(controller.scriptURL);
      if (url.pathname === "/sw.js" &&
          url.searchParams.get("t") === cdnRoot &&
          url.searchParams.get("404") === _404Page) {
        return true;
      }
    }
    return false;
  }

  const originalFetch = window.fetch;
  const origin = location.origin + "/";
  window.fetch = function () {
    if (isServiceWorkerRedirectActive() ||
        typeof arguments[0] !== "string" ||
        !arguments[0].startsWith(origin)) {
      return originalFetch.apply(this, arguments);
    }
    const url: string = arguments[0];
    const originalOptions: RequestInit = arguments[1];

    // Code copied from
    // https://github.com/Menci/service-worker-redirect-origin
    const abortEvent = new Event("abortFetch");
    const eventTarget = new EventTarget();
    const withAbort = <F extends (...args: any[]) => Promise<Response>>(
      fetchWithSignal: (signal: AbortSignal) => F
    ): ((...args: Parameters<F>) => Promise<Response>) => {
      // Abort other doFetch()-es when the first doFetch() resolved with true
      const abortController = typeof AbortController === "function" && new AbortController();
  
      // When the abort event triggered, don't abort the current fetch() if `fetchSucceed` is true
      let fetchSucceed = false;
      if (abortController) {
        eventTarget.addEventListener(abortEvent.type, () => {
          if (!fetchSucceed) abortController.abort();
        });
      }
  
      const doFetch = fetchWithSignal(abortController ? abortController.signal : undefined);
      return async (...args: Parameters<F>) => {
        const response = await doFetch(...args);
        if (response) {
          // Abort other fetch()-es
          fetchSucceed = true;
          eventTarget.dispatchEvent(abortEvent);
          return response;
        }
      };
    };
  
    const fetchOrigin = withAbort(signal => async () => {
      const resp = await originalFetch(url, { ...originalOptions, signal });
      return resp;
    });
    const fetchRedirected = withAbort(signal => async () => {
      const newUrl = cdnRoot + url.slice(origin.length)
  
      // Handle redirects like "https://cdn/path" to "https://cdn/path/"
      // NOTE: or return a transformed redirect response?
      const fetchOptions: RequestInit = {
        ...originalOptions,
        redirect: "follow",
        signal
      };
  
      let response = await originalFetch(newUrl, fetchOptions);
  
      // Handle 404 for static sites
      if (response.status === 404) {
        response = await originalFetch(cdnRoot + _404Page, fetchOptions);
      }
  
      if (!response.ok) {
        // Oops! the service worker CDN may not available now
        // Fallback to the original URL
  
        // This error won't be used, just to indicate the fetch failed
        throw null;
      }
  
      return response;
    });
  
    async function postProcessResponse(response: Response) {
      if (originalOptions.mode === "same-origin") {
        return new Response(response.body, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText
        });
      }
      return response;
    }
  
    return Promise.any([fetchOrigin(), fetchRedirected()]).then(postProcessResponse);
  };
})(__CDN_ROOT__, __404_PAGE__);
