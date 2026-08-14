/** Shows the transient surface cursor for idle, entity, and armed modes.
 * The cursor is view decoration and never writes the plan.
 * Channels: listens planner:selection-changed.
 * Channels: dispatches planner:surface-cancel.
 */
{
  /** @typedef {{root: Element, surface: Element}} SurfaceCursorOptions */
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {SurfaceCursorOptions} options */
  const create = (options) => {
    if (!options?.root || !options.surface)
      throw new TypeError("surface cursor requires root and surface");

    const { surface } = options;
    const layer = surface.querySelector('[data-part="cursor-layer"]');
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="surface-cursor-template"]')
    );
    let cursor = /** @type {SVGElement | null} */ (
      surface.querySelector('[data-part="surface-cursor"]')
    );
    if (!cursor) {
      cursor = /** @type {SVGElement | null} */ (
        template?.content.firstElementChild?.firstElementChild?.cloneNode(true)
      );
      if (cursor && layer) layer.append(cursor);
    }
    if (!cursor) throw new TypeError("surface cursor template is missing");
    cursor.setAttribute("d", "M -12 0 H 12 M 0 -12 V 12");

    const render = (/** @type {string} */ mode) => {
      surface.setAttribute("data-cursor", mode);
      cursor?.setAttribute("data-state", mode);
      if (mode === "armed") {
        cursor?.removeAttribute("data-x");
        cursor?.removeAttribute("data-y");
      }
    };

    const pointer = (/** @type {PointerEvent} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      const entity = target?.closest?.(
        '[data-part="surface-group"], [data-part="surface-device"]',
      );
      render(entity && surface.contains(entity) ? "entity" : "empty");
    };

    const selection = (/** @type {Event} */ event) => {
      const detail =
        /** @type {CustomEvent<{kind?: string}>} */ (event).detail || {};
      render(detail.kind === "device-type" ? "armed" : "idle");
    };

    const cancel = (/** @type {KeyboardEvent} */ event) => {
      if (event.key !== "Escape") return;
      document.dispatchEvent(new CustomEvent("planner:surface-cancel"));
    };

    surface.addEventListener(
      "pointermove",
      /** @type {EventListener} */ (pointer),
    );
    document.addEventListener("planner:selection-changed", selection);
    document.addEventListener("keydown", cancel);
    render("idle");

    return Object.freeze({ render, disconnect: () => {} });
  };

  planner.surfaceCursor = Object.freeze({ create });
}
