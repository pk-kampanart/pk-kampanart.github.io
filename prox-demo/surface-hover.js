/** Mirrors hover across the tree, plan, and Mesh pane. Tree rows light their
 * shapes, surface shapes light their rows, and node rows light assigned dots.
 * CSS handles each element's own pointer hover.
 * Hovering never switches floors: a dot on another floor is not drawn.
 * Hovering never selects an entity or changes the plan.
 * Channels: none.
 */
{
  /** @typedef {{root: Element, surface: Element, store: any, pane?: Element | null}} SurfaceHoverOptions */
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {Element} root @param {string} kind @param {string} id */
  const rowOf = (root, kind, id) =>
    [...root.querySelectorAll("[data-anchor]")].find(
      (row) =>
        row.getAttribute("data-anchor") === kind &&
        row.getAttribute("data-id") === id,
    ) || null;

  /** @param {PlanDocument} plan @returns {DeviceInstance[]} */
  const instancesIn = (plan) =>
    (plan?.floors || [])
      .flatMap((floor) => floor.applications || [])
      .flatMap((application) => application.deviceTypes || [])
      .flatMap((type) => type.instances || []);

  /** @param {PlanDocument} plan @param {string} id */
  const typeOfDevice = (plan, id) => {
    for (const floor of plan?.floors || [])
      for (const application of floor.applications || [])
        for (const type of application.deviceTypes || [])
          if ((type.instances || []).some((device) => device.id === id))
            return type;
    return null;
  };

  /** @param {SurfaceHoverOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      !options.surface ||
      typeof options.store?.read !== "function"
    )
      throw new TypeError(
        "surface hover requires root, surface, and store.read()",
      );

    const { root, surface, store } = options;
    const pane = options.pane || null;

    const clear = () => {
      for (const host of [root, surface, pane])
        for (const element of host?.querySelectorAll(
          '[data-state~="hovered"]',
        ) || [])
          planner.dom.state(element, "hovered", false);
      surface.removeAttribute("data-hover");
      surface.removeAttribute("data-hover-kind");
    };

    /** @param {string} id */
    const lightDevice = (id) => {
      for (const shape of surface.querySelectorAll(
        '[data-part="surface-device"]',
      ))
        if (shape.getAttribute("data-id") === id)
          planner.dom.state(shape, "hovered", true);
    };

    /** Lights the assigned node row without scrolling. @param {string} id */
    const lightNodeOf = (id) => {
      const node = instancesIn(store.read()).find((device) => device.id === id)
        ?.assignment?.node;
      for (const row of pane?.querySelectorAll('[data-part="mesh-node"]') || [])
        if (node && row.getAttribute("data-id") === node)
          planner.dom.state(row, "hovered", true);
    };

    /** @param {string} kind @param {string} id @param {"tree"|"surface"|"pane"} from */
    const hover = (kind, id, from) => {
      if (!id) return clear();
      clear();
      if (kind === "meshNode") {
        for (const device of instancesIn(store.read()))
          if (device.assignment?.node === id) lightDevice(device.id);
      } else if (kind === "deviceInstance") {
        lightDevice(id);
        const type = typeOfDevice(store.read(), id);
        const typeRow = type && rowOf(root, "deviceType", type.id);
        if (typeRow) planner.dom.state(typeRow, "hovered", true);
        lightNodeOf(id);
      } else if (from === "surface") {
        for (const shape of surface.querySelectorAll(
          '[data-part="surface-group"]',
        ))
          if (shape.getAttribute("data-id") === id)
            planner.dom.state(shape, "hovered", true);
        const row = rowOf(root, kind, id);
        if (row) planner.dom.state(row, "hovered", true);
      } else if (kind === "group") {
        for (const shape of surface.querySelectorAll(
          '[data-part="surface-group"]',
        ))
          if (shape.getAttribute("data-id") === id)
            planner.dom.state(shape, "hovered", true);
      } else if (kind === "deviceType") {
        const type = (store.read().floors || [])
          .flatMap((floor) => floor.applications || [])
          .flatMap((application) => application.deviceTypes || [])
          .find((candidate) => candidate.id === id);
        const ids = new Set((type?.instances || []).map((device) => device.id));
        for (const shape of surface.querySelectorAll(
          '[data-part="surface-device"]',
        ))
          if (ids.has(shape.getAttribute("data-id")))
            planner.dom.state(shape, "hovered", true);
      }
      surface.setAttribute("data-hover", id);
      surface.setAttribute("data-hover-kind", kind);
    };

    const anchorHover = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const anchor = target?.closest?.("[data-anchor]");
      if (!anchor || !root.contains(anchor)) return;
      const kind = anchor.getAttribute("data-anchor") || "";
      if (["group", "deviceType"].includes(kind))
        hover(kind, anchor.getAttribute("data-id") || "", "tree");
    };

    const nodeHover = (event) => {
      const row = /** @type {Element | null} */ (event.target)?.closest?.(
        '[data-part="mesh-node"]',
      );
      if (row) hover("meshNode", row.getAttribute("data-id") || "", "pane");
    };

    const surfaceHover = (event) => {
      const shape = planner.surfaceSelect?.entityAt?.(surface, event)?.shape;
      if (!shape) return clear();
      const device = shape.matches('[data-part="surface-device"]');
      const group = shape.matches('[data-part="surface-group"]');
      if (!device && !group) return clear();
      hover(
        device ? "deviceInstance" : "group",
        shape.getAttribute("data-id") || "",
        "surface",
      );
    };

    const leave = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const related = event.relatedTarget;
      if (!target || (related instanceof Node && target.contains(related)))
        return;
      clear();
    };

    root.addEventListener("pointerover", anchorHover);
    surface.addEventListener("pointermove", surfaceHover);
    root.addEventListener("pointerout", leave);
    surface.addEventListener("pointerout", leave);
    pane?.addEventListener("pointerover", nodeHover);
    pane?.addEventListener("pointerout", leave);

    return Object.freeze({ clear, disconnect: clear });
  };

  planner.surfaceHover = Object.freeze({ create });
}
