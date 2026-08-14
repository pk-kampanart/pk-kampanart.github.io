/**
 * Owns the "notify on network status change" preference and the notice it
 * shows: when the mesh connects or drops, a short message over the floor plan
 * says so, in the Mesh pane's own words. It is for sight only, so the
 * preference never silences anything: the pane and the status bar announce
 * every change regardless. The preference is this browser's, never the plan's.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const KEY = "mesh-planner:mesh-notify";
  /** The statuses a connection reaches or falls to; loading is on the way. */
  /** @type {MeshStatusName[]} */
  const NOTIFIED = ["offline", "unplugged", "unreached", "connected"];

  /** @param {MeshNoticeOptions} options */
  const create = (options) => {
    if (!options?.pane || !options.storage)
      throw new TypeError("mesh notice requires the Mesh pane and storage");
    const { pane, storage } = options;
    let notify = false;
    try {
      notify = storage.getItem(KEY) === "true";
    } catch {
      // Browser storage can be unavailable; preferences are best-effort.
    }
    let last = planner.meshPane.statusOf(pane).name;

    // The pane rewrites its state after each change, so watching it is enough.
    const observer = new MutationObserver(() => {
      const { name, says } = planner.meshPane.statusOf(pane);
      if (name === last) return;
      const previous = last;
      last = name;
      // The pane's first state is where it starts, not a change.
      if (!notify || !previous || !name || !NOTIFIED.includes(name)) return;
      planner.dom.notice(`Mesh: ${says}`);
    });
    observer.observe(pane, {
      attributes: true,
      attributeFilter: ["data-state"],
    });

    const read = () => ({ notify });
    return Object.freeze({
      read,
      /** @param {{notify?: boolean}} change */
      apply: (change) => {
        if (typeof change.notify === "boolean") {
          notify = change.notify;
          try {
            storage.setItem(KEY, String(notify));
          } catch {
            // Browser storage can be unavailable; preferences are best-effort.
          }
        }
        return read();
      },
      disconnect: () => observer.disconnect(),
    });
  };

  planner.meshNotice = Object.freeze({ create });
}
