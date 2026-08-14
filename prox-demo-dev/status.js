/**
 * Owns the planner status fields, and the header's Mesh pill, which reads the
 * same Mesh pane state as the status bar; offline.js owns its update notice.
 * Channels: listens planner:selection-changed.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {{applications?: Application[]} | undefined} area @returns {any[]} */
  const devicesOf = (area) =>
    (area?.applications || []).flatMap((application) =>
      (application.deviceTypes || []).flatMap((deviceType) =>
        (deviceType.instances || []).map((instance) => ({
          ...instance,
          deviceType,
        })),
      ),
    );

  /** @param {PlanDocument} plan @param {string} id @returns {any | null} */
  const entityOf = (plan, id) => {
    for (const area of plan.areas || []) {
      if (area.id === id) return area;
      for (const application of area.applications || []) {
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

  /**
   * @param {string} kind @param {any | null} entity
   * @param {boolean} [hidden] a selected group is hidden, so not drawn
   */
  const modeName = (kind, entity, hidden = false) => {
    if (document.documentElement.getAttribute("data-mode") === "align") {
      const origin = planner.grid?.origin?.() || { x: 0, y: 0 };
      return `Align grid origin ${origin.x}, ${origin.y} · Esc to stop`;
    }
    // The Mesh pane presses the Assign it armed; its name says what is taken.
    const assign = document.querySelector(
      '[data-part="mesh"][data-state~="assigning"] [data-part="mesh-assign"][aria-pressed="true"]',
    );
    if (assign)
      return `Assigning ${(assign.getAttribute("aria-label") || "").replace(
        /^Assign /,
        "",
      )} — click a device on the plan · Esc to stop`;
    if (kind === "device-type")
      return `Placing ${entity?.name || "device type"} — Esc to stop`;
    // A hidden group is not drawn, so the mode says so rather than promise
    // a draw the plan will refuse.
    if (kind === "group" && hidden)
      return `${entity?.name || "This group"} is hidden — show it to draw`;
    if (kind === "group")
      return `Drawing ${entity?.name || "group"} — Esc to stop`;
    if (!kind) return "Idle";
    return kind[0].toUpperCase() + kind.slice(1);
  };

  /** @type {Record<MeshPaneState, string>} */
  const MESH = {
    storage: "no device storage",
    unreachable: "no device access",
    missing: "engine not installed",
    offline: "not connected",
    unplugged: "dongle disconnected",
    connected: "connected",
  };

  /**
   * The header's Mesh pill, by the pane's status name, which is also its state
   * token for the stylesheet to colour: its words, and a quieter detail.
   * @type {Record<MeshStatusName, [string, string]>}
   */
  const PILL = {
    storage: ["Mesh unavailable", "no device storage"],
    unreachable: ["No device access", ""],
    missing: ["Mesh engine missing", ""],
    offline: ["Not connected", ""],
    loading: ["Starting mesh…", ""],
    unreached: ["No node in reach", ""],
    unplugged: ["Dongle disconnected", ""],
    connected: ["Connected", ""],
  };

  /** The Mesh pane's status, which the pane works out from its own state; the
   * pane rewrites data-state after each list change, so observing it is
   * enough. @returns {MeshStatus} */
  const meshStatus = () =>
    planner.meshPane?.statusOf(
      document.querySelector('[data-part="mesh"]'),
    ) || {
      name: "",
      says: "",
    };

  /** The status bar's Mesh value, with the node count once the pane can list
   * nodes. @param {MeshStatus} mesh */
  const meshName = ({ state, name }) => {
    if (!state) return "—";
    const text = name === "unreached" ? "no node in reach" : MESH[state];
    if (!["offline", "unplugged", "connected"].includes(state)) return text;
    const count = document.querySelectorAll('[data-part="mesh-node"]').length;
    return `${text}, ${count} node${count === 1 ? "" : "s"}`;
  };

  /**
   * Writes the header pill. It is not a live region: the status bar's Mesh
   * value already announces each change, and a second region would say it
   * twice. Its tooltip is the pane's own sentence for the state.
   * @param {MeshStatus} mesh
   */
  const showPill = ({ name, says }) => {
    const pill = document.querySelector('[data-part="mesh-pill"]');
    if (!pill) return;
    // How the planner is connected is the pane's to show, beside Connect.
    const [text, detail] = name ? PILL[name] : ["", ""];
    /** @param {string} part @param {string} value */
    const write = (part, value) => {
      const element = pill.querySelector(`[data-part="${part}"]`);
      if (element && element.textContent !== value) element.textContent = value;
    };
    write("mesh-pill-text", text);
    write("mesh-pill-detail-text", detail);
    if (name) pill.setAttribute("data-state", name);
    else pill.removeAttribute("data-state");
    if (says) pill.setAttribute("title", says);
    else pill.removeAttribute("title");
  };

  /** @param {{root: Element, store: {read: () => PlanDocument, subscribe?: (listener: () => void) => () => void}, visibility?: GroupVisibility}} options */
  const create = (options) => {
    if (!options?.root || typeof options.store?.read !== "function")
      throw new TypeError("status requires root and store.read()");
    const { root, store, visibility } = options;
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
      const activeAreaId = planner.selection.activeArea(plan);
      const area = (plan.areas || []).find((item) => item.id === activeAreaId);
      const entity = current.id ? entityOf(plan, current.id) : null;
      const areaDevices = devicesOf(area);
      let count = (plan.areas || []).reduce(
        (/** @type {number} */ total, item) => total + devicesOf(item).length,
        0,
      );
      if (current.kind === "area") count = areaDevices.length;
      else if (current.kind === "application")
        count = devicesOf(
          entity ? { applications: [entity] } : undefined,
        ).length;
      else if (current.kind === "device-type")
        count = entity?.instances?.length || 0;
      else if (current.kind === "device") count = entity ? 1 : 0;
      else if (current.kind === "group") {
        const devices = areaDevices;
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
      const areaName = document.querySelector('[data-part="status-area-name"]');
      const applicationName = document.querySelector(
        '[data-part="status-application-name"]',
      );
      const application = selectedAnchor?.closest(
        '[data-anchor="application"]',
      );
      const mesh = document.querySelector('[data-part="status-mesh-value"]');
      const hidden =
        current.kind === "group" && Boolean(visibility?.isHidden(current.id));
      if (mode) mode.textContent = modeName(current.kind, entity, hidden);
      // The prompt line's words are the stylesheet's; this says which.
      const hint = document.querySelector('[data-part="status-hint"]');
      if (hint) planner.dom.state(hint, "hidden-group", hidden);
      if (devices) devices.textContent = String(count);
      if (areaName && areaName.textContent !== (area?.name || "—"))
        areaName.textContent = area?.name || "—";
      if (applicationName)
        applicationName.textContent =
          (application &&
            entityOf(plan, application.getAttribute("data-id") || "")?.name) ||
          "—";
      // Unchanged text is not rewritten, so a live region speaks only news.
      const meshNow = meshStatus();
      const meshText = meshName(meshNow);
      if (mesh && mesh.textContent !== meshText) mesh.textContent = meshText;
      showPill(meshNow);
      return { ...current, areaId: activeAreaId, count };
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
