{
  const notice = /** @type {HTMLElement | null} */ (
    document.querySelector('[data-part="status-update-notice"]')
  );
  const status = /** @type {HTMLElement | null} */ (
    document.querySelector('[data-part="status-update"]')
  );
  // A page saved while the notice showed keeps it unhidden in its markup.
  if (notice) notice.hidden = true;
  if (
    ["http:", "https:"].includes(location.protocol) &&
    "serviceWorker" in navigator
  ) {
    const worker = navigator.serviceWorker;
    const reload = /** @type {HTMLButtonElement | null} */ (
      status?.querySelector('[data-part="status-update-reload"]')
    );
    const mesh = document.querySelector('[data-part="mesh"]');

    if (notice && status && reload && mesh) {
      let reloadOnChange = false;
      const reflectBusy = () => {
        const busy = mesh.matches('[data-state~="busy"]');
        reload.disabled = busy;
        if (busy)
          reload.setAttribute("aria-describedby", "status-update-description");
        else reload.removeAttribute("aria-describedby");
      };
      const observe = new MutationObserver(reflectBusy);
      observe.observe(mesh, {
        attributes: true,
        attributeFilter: ["data-state"],
      });
      reflectBusy();

      worker.addEventListener("controllerchange", () => {
        if (reloadOnChange) location.reload();
      });

      worker
        .register("sw.js")
        .then((registration) => {
          const showUpdate = () => {
            if (worker.controller && registration.waiting)
              notice.hidden = false;
          };
          const watchInstall = () => {
            const installing = registration.installing;
            installing?.addEventListener("statechange", () => {
              if (installing.state === "installed") showUpdate();
            });
          };

          if (registration.waiting) showUpdate();
          registration.addEventListener("updatefound", watchInstall);
          reload.addEventListener("click", () => {
            if (reload.disabled) return;
            if (!registration.waiting) return location.reload();
            reloadOnChange = true;
            registration.waiting.postMessage({ type: "skip-waiting" });
          });

          const loaded =
            document.readyState === "complete"
              ? Promise.resolve()
              : new Promise((resolve) =>
                  window.addEventListener("load", (event) => resolve(event), {
                    once: true,
                  }),
                );
          void Promise.all([worker.ready, loaded]).then(async ([ready]) => {
            // A stamped worker ignores this: its install cached every file.
            // Resource timing records fetches only after they settle.
            const urls = new Set([location.href]);
            for (const entry of performance.getEntriesByType("resource")) {
              const url = new URL(entry.name, location.href);
              if (url.origin === location.origin) urls.add(url.href);
            }
            const channel = new MessageChannel();
            channel.port1.onmessage = () => channel.port1.close();
            ready.active?.postMessage({ type: "cache", urls: [...urls] }, [
              channel.port2,
            ]);
          });
        })
        .catch(() => {});
    }
  }
}
