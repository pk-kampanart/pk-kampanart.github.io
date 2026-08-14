/**
 * Owns the status bar: every field in it is written here and nowhere else.
 * Channels: listens planner:selection-changed.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {{applications?: Application[]} | undefined} floor @returns {any[]} */
  const devicesOf = (floor) =>
    (floor?.applications || []).flatMap((application) =>
      (application.deviceTypes || []).flatMap((deviceType) =>
        (deviceType.instances || []).map((instance) => ({
          ...instance,
          deviceType,
        })),
      ),
    );

  /** @param {PlanDocument} plan @param {string} id @returns {any | null} */
  const entityOf = (plan, id) => {
    for (const floor of plan.floors || []) {
      if (floor.id === id) return floor;
      for (const application of floor.applications || []) {
        if (application.id === id) return application;
        for (const group of application.groups || [])
          if (group.id === id) return group;
        for (const deviceType of application.deviceTypes || []) {
          if (deviceType.id === id) return deviceType;
          for (const instance of deviceType.instances || [])
            if (instance.id === id) return instance;
        }
      }
    }
    return null;
  };

  /** @param {string} kind @param {any | null} entity */
  const modeName = (kind, entity) => {
    if (document.documentElement.getAttribute("data-mode") === "align") {
      const origin = planner.grid?.origin?.() || { x: 0, y: 0 };
      return `Align grid origin ${origin.x}, ${origin.y} · Esc to stop`;
    }
    // The Mesh pane presses the Assign it armed; its name says what is taken.
    const assign = document.querySelector(
      '[data-part="mesh"][data-state~="assigning"] [aria-pressed="true"]',
    );
    if (assign)
      return `Assigning ${(assign.getAttribute("aria-label") || "").replace(
        /^Assign /,
        "",
      )} — click a device on the plan · Esc to stop`;
    if (kind === "device-type")
      return `Placing ${entity?.name || "device type"} — Esc to stop`;
    if (kind === "group")
      return `Drawing ${entity?.name || "group"} — Esc to stop`;
    if (!kind) return "Idle";
    return kind[0].toUpperCase() + kind.slice(1);
  };

  /** @type {Record<MeshPaneState, string>} */
  const MESH = {
    disk: "opened from disk",
    unreachable: "no device access",
    missing: "engine not installed",
    offline: "not connected",
    unplugged: "dongle disconnected",
    connected: "connected",
  };

  /** The Mesh pane shows its state as a token; this names it, with its node
   * count once the pane can list nodes. The pane rewrites data-state after
   * each list change, so observing it is enough. */
  const meshName = () => {
    const tokens = (
      document
        .querySelector('[data-part="mesh"]')
        ?.getAttribute("data-state") || ""
    ).split(" ");
    const state = /** @type {MeshPaneState | undefined} */ (
      tokens.find((token) => token in MESH)
    );
    if (!state) return "—";
    // Over GATT the transport lost is the proxy, not a dongle.
    const text =
      state === "unplugged" && tokens.includes("gatt")
        ? "no node in reach"
        : MESH[state];
    if (!["offline", "unplugged", "connected"].includes(state)) return text;
    const count = document.querySelectorAll('[data-part="mesh-node"]').length;
    return `${text}, ${count} node${count === 1 ? "" : "s"}`;
  };

  /** @param {{root: Element, store: {read: () => PlanDocument, subscribe?: (listener: () => void) => () => void}}} options */
  const create = (options) => {
    if (!options?.root || typeof options.store?.read !== "function")
      throw new TypeError("status requires root and store.read()");
    const { root, store } = options;
    /** @param {Element} anchor @returns {string} */
    const kindOf = (anchor) => {
      const kind = anchor.getAttribute("data-anchor");
      return kind === "deviceInstance"
        ? "device"
        : kind === "deviceType"
          ? "device-type"
          : kind || "";
    };

    // The checked radio is the selection itself (ADR-0008), so the status bar
    // reads it rather than a projection that a listener may not have written
    // yet.
    /** @returns {{kind: string, id: string}} */
    const selection = () => {
      const radio = /** @type {HTMLInputElement | null} */ (
        root.querySelector('input[name="planner-selection"]:checked')
      );
      const anchor = radio?.closest("[data-anchor]");
      return {
        kind: radio?.dataset.kind || (anchor ? kindOf(anchor) : ""),
        id: radio?.value || anchor?.getAttribute("data-id") || "",
      };
    };

    const refresh = () => {
      document
        .querySelector('[data-part="status"]')
        ?.removeAttribute("aria-live");
      const plan = store.read();
      const current = selection();
      const selectedAnchor = current.id
        ? [...root.querySelectorAll("[data-anchor]")].find(
            (anchor) => anchor.getAttribute("data-id") === current.id,
          )
        : null;
      const activeFloorId = planner.selection.activeFloor(plan);
      const floor = (plan.floors || []).find(
        (item) => item.id === activeFloorId,
      );
      const entity = current.id ? entityOf(plan, current.id) : null;
      const floorDevices = devicesOf(floor);
      let count = (plan.floors || []).reduce(
        (/** @type {number} */ total, item) => total + devicesOf(item).length,
        0,
      );
      if (current.kind === "floor") count = floorDevices.length;
      else if (current.kind === "application")
        count = devicesOf(
          entity ? { applications: [entity] } : undefined,
        ).length;
      else if (current.kind === "device-type")
        count = entity?.instances?.length || 0;
      else if (current.kind === "device") count = entity ? 1 : 0;
      else if (current.kind === "group") {
        const devices = floorDevices;
        count =
          entity?.rect && planner.geo?.contains
            ? devices.filter((device) =>
                planner.geo?.contains?.(entity.rect, device),
              ).length
            : 0;
      }

      const mode = document.querySelector('[data-part="status-mode-value"]');
      const devices = document.querySelector(
        '[data-part="status-device-count"]',
      );
      const floorName = document.querySelector(
        '[data-part="status-floor-name"]',
      );
      const applicationName = document.querySelector(
        '[data-part="status-application-name"]',
      );
      const application = selectedAnchor?.closest(
        '[data-anchor="application"]',
      );
      const mesh = document.querySelector('[data-part="status-mesh-value"]');
      if (mode) mode.textContent = modeName(current.kind, entity);
      if (devices) devices.textContent = String(count);
      if (floorName) floorName.textContent = floor?.name || "—";
      if (applicationName)
        applicationName.textContent =
          (application &&
            entityOf(plan, application.getAttribute("data-id") || "")?.name) ||
          "—";
      // Unchanged text is not rewritten, so a live region speaks only news.
      const meshText = meshName();
      if (mesh && mesh.textContent !== meshText) mesh.textContent = meshText;
      return { ...current, floorId: activeFloorId, count };
    };

    const selectionChanged = () => refresh();
    document.addEventListener("planner:selection-changed", selectionChanged);
    const unsubscribe = store.subscribe?.(refresh);
    const modeObserver = new MutationObserver(refresh);
    modeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode"],
    });
    const meshPane = document.querySelector('[data-part="mesh"]');
    if (meshPane)
      modeObserver.observe(meshPane, {
        attributes: true,
        attributeFilter: ["data-state"],
      });
    document
      .querySelector('[data-part="status"]')
      ?.removeAttribute("aria-live");
    return Object.freeze({
      refresh,
      disconnect: () => {
        unsubscribe?.();
        modeObserver.disconnect();
        document.removeEventListener(
          "planner:selection-changed",
          selectionChanged,
        );
      },
    });
  };

  planner.status = Object.freeze({ create });
}
