/** Mirrors hover across the two panes: a hovered tree row lights its shapes,
 * a hovered shape lights its row. An element's own hover is :hover's job, so
 * the pane the pointer is in is left to the stylesheet.
 * Hovering never selects an entity or changes the plan.
 * Channels: none.
 */
{
  /** @typedef {{root: Element, surface: Element, store: any}} SurfaceHoverOptions */
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {Element} element @param {string} token @param {boolean} on */
  const state = (element, token, on) => {
    const tokens = new Set(
      (element.getAttribute("data-state") || "").split(/\s+/),
    );
    tokens.delete("");
    if (on) tokens.add(token);
    else tokens.delete(token);
    if (tokens.size) element.setAttribute("data-state", [...tokens].join(" "));
    else element.removeAttribute("data-state");
  };

  /** @param {Element} root @param {string} kind @param {string} id */
  const rowOf = (root, kind, id) =>
    [...root.querySelectorAll("[data-anchor]")].find(
      (row) =>
        row.getAttribute("data-anchor") === kind &&
        row.getAttribute("data-id") === id,
    ) || null;

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

    const clear = () => {
      for (const element of root.querySelectorAll('[data-state~="hovered"]'))
        state(element, "hovered", false);
      for (const element of surface.querySelectorAll('[data-state~="hovered"]'))
        state(element, "hovered", false);
      surface.removeAttribute("data-hover");
      surface.removeAttribute("data-hover-kind");
    };

    /** @param {string} kind @param {string} id @param {"tree"|"surface"} from */
    const hover = (kind, id, from) => {
      if (!id) return clear();
      clear();
      if (from === "surface") {
        const row = rowOf(root, kind, id);
        if (row) state(row, "hovered", true);
        if (kind === "deviceInstance") {
          const type = typeOfDevice(store.read(), id);
          const typeRow = type && rowOf(root, "deviceType", type.id);
          if (typeRow) state(typeRow, "hovered", true);
        }
      } else if (kind === "group") {
        for (const shape of surface.querySelectorAll(
          '[data-part="surface-group"]',
        ))
          if (shape.getAttribute("data-id") === id)
            state(shape, "hovered", true);
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
            state(shape, "hovered", true);
      }
      surface.setAttribute("data-hover", id);
      surface.setAttribute("data-hover-kind", kind);
    };

    const anchorHover = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const anchor = target?.closest?.("[data-anchor]");
      if (!anchor || !root.contains(anchor)) return;
      const kind = anchor.getAttribute("data-anchor");
      if (kind === "group")
        hover("group", anchor.getAttribute("data-id") || "", "tree");
      else if (kind === "deviceType")
        hover("deviceType", anchor.getAttribute("data-id") || "", "tree");
    };

    const surfaceHover = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const device = target?.closest?.('[data-part="surface-device"]');
      const group = target?.closest?.('[data-part="surface-group"]');
      const shape = device || group;
      if (!shape || !surface.contains(shape)) return;
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
    surface.addEventListener("pointerover", surfaceHover);
    root.addEventListener("pointerout", leave);
    surface.addEventListener("pointerout", leave);

    return Object.freeze({ clear, disconnect: clear });
  };

  planner.surfaceHover = Object.freeze({ create });
}
