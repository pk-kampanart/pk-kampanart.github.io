{
  const VERSION = "";
  const FILES = [];
  const CACHE = VERSION ? `mesh-planner-${VERSION}` : "mesh-planner-dev";
  const serviceWorker = /** @type {any} */ (self);

  /** @param {string} url */
  const inScope = (url) => {
    try {
      return (
        typeof url === "string" &&
        new URL(url, self.location.href).origin === self.location.origin
      );
    } catch {
      return false;
    }
  };

  /** @param {Request} request */
  const serve = async (request) => {
    const cache = await caches.open(CACHE);
    if (VERSION) {
      if (request.mode === "navigate") {
        const page = await cache.match("./", { ignoreSearch: true });
        if (page) return page;
      }
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch (error) {
        if (request.mode === "navigate") {
          const page = await cache.match("./", { ignoreSearch: true });
          if (page) return page;
        }
        throw error;
      }
    }

    try {
      const response = await fetch(request);
      if (response.ok)
        await cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === "navigate") {
        const page = await cache.match("./", { ignoreSearch: true });
        if (page) return page;
      }
      throw error;
    }
  };

  self.addEventListener(
    "install",
    /** @param {any} event */ (event) => {
      event.waitUntil(
        caches
          .open(CACHE)
          .then((cache) =>
            cache.addAll(
              VERSION
                ? FILES.map((file) => new Request(file, { cache: "reload" }))
                : ["./"],
            ),
          ),
      );
    },
  );

  self.addEventListener(
    "activate",
    /** @param {any} event */ (event) => {
      event.waitUntil(
        (async () => {
          if (VERSION) {
            for (const name of await caches.keys())
              if (name.startsWith("mesh-planner-") && name !== CACHE)
                await caches.delete(name);
          }
          await serviceWorker.clients.claim();
        })(),
      );
    },
  );

  self.addEventListener(
    "message",
    /** @param {any} event */ (event) => {
      if (event.data?.type === "skip-waiting") {
        serviceWorker.skipWaiting();
        return;
      }
      if (
        VERSION ||
        event.data?.type !== "cache" ||
        !Array.isArray(event.data.urls)
      )
        return;
      event.waitUntil(
        (async () => {
          const cache = await caches.open(CACHE);
          const urls = event.data.urls.filter(inScope);
          await Promise.allSettled(urls.map((url) => cache.add(url)));
          event.ports[0]?.postMessage({ type: "cached" });
        })(),
      );
    },
  );

  self.addEventListener(
    "fetch",
    /** @param {any} event */ (event) => {
      const request = event.request;
      if (!inScope(request.url)) return;
      if (request.method === "GET") {
        event.respondWith(serve(request));
        return;
      }
      if (request.method === "HEAD")
        event.respondWith(
          (async () => {
            const cache = await caches.open(CACHE);
            const cached = await cache.match(request.url, {
              ignoreSearch: true,
            });
            if (!cached) return fetch(request);
            return new Response(null, {
              status: cached.status,
              statusText: cached.statusText,
              headers: cached.headers,
            });
          })(),
        );
    },
  );
}
