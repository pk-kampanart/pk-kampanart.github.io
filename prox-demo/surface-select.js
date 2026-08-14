/**
 * Resolves presses on painted surface entities into selection requests.
 * Placement and document edits remain with the domain owners that consume a
 * surface gesture.
 * Channels: dispatches planner:selection-requested.
 */
{
  /** @typedef {{root: Element, surface: Element, onCreate?: (detail: any) => void, onPlace?: (detail: any) => void, onDraw?: (detail: any) => void}} SurfaceSelectOptions */
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {SurfaceSelectOptions} options */
  const create = (options) => {
    if (!options?.root || !options.surface)
      throw new TypeError("surface selection requires root and surface");

    const { surface } = options;
    let space = false;
    let suppressClick = false;
    /** @type {{start: {x: number, y: number}} | null} */
    let drawing = null;
    const editable = (/** @type {EventTarget | null} */ target) =>
      planner.dom.editable(target);
    const pointOf = (event) => {
      const viewport = planner.surfaceViewport;
      if (typeof viewport?.pointOf !== "function")
        throw new Error("surface viewport is unavailable");
      return viewport.pointOf(surface, event);
    };

    /** @param {MouseEvent} event */
    const entityAt = (event) => {
      const point = pointOf(event);
      const candidates = [];
      for (const shape of surface.querySelectorAll(
        '[data-part="surface-group"], [data-part="surface-device"]',
      )) {
        try {
          candidates.push({
            entity: shape,
            rect: /** @type {SVGGraphicsElement} */ (shape).getBBox(),
          });
        } catch {
          continue;
        }
      }
      const winner = planner.geo?.hit?.(point, candidates);
      const target = winner || /** @type {Element | null} */ (event.target);
      const shape = target?.closest?.(
        '[data-part="surface-group"], [data-part="surface-device"]',
      );
      return shape && surface.contains(shape)
        ? { shape, point }
        : { shape: null, point };
    };

    const drawStart = (event) => {
      if (event.button === 1 || space) {
        suppressClick = event.button === 0;
        return;
      }
      if (
        event.button !== 0 ||
        surface.getAttribute("data-active-kind") !== "group"
      )
        return;
      const { shape, point } = entityAt(event);
      if (shape) return;
      drawing = { start: point };
      surface.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const drawMove = (event) => {
      if (!drawing) return;
      const point = pointOf(event);
      surface.setAttribute("data-drawing", "true");
      surface.setAttribute(
        "data-drawing-start",
        `${drawing.start.x} ${drawing.start.y}`,
      );
      surface.setAttribute("data-drawing-end", `${point.x} ${point.y}`);
      event.preventDefault();
    };

    const drawEnd = (event) => {
      if (!drawing) return;
      const start = drawing.start;
      const end = pointOf(event);
      drawing = null;
      surface.removeAttribute("data-drawing");
      surface.removeAttribute("data-drawing-start");
      surface.removeAttribute("data-drawing-end");
      if (surface.hasPointerCapture?.(event.pointerId))
        surface.releasePointerCapture(event.pointerId);
      const rect = planner.geo?.normalize?.({
        x: start.x,
        y: start.y,
        width: end.x - start.x,
        height: end.y - start.y,
      }) || {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
      options.onDraw?.({
        floorId:
          document.documentElement.getAttribute("data-active-floor") || "",
        rect,
      });
      event.preventDefault();
    };

    surface.addEventListener(
      "click",
      (event) => {
        if (surface.hasAttribute("data-suppress-click")) {
          surface.removeAttribute("data-suppress-click");
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (suppressClick) {
          suppressClick = false;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const { shape, point } = entityAt(/** @type {MouseEvent} */ (event));
        const kind =
          shape?.getAttribute("data-part") === "surface-device"
            ? "device"
            : shape
              ? "group"
              : "";
        const id = shape?.getAttribute("data-id") || "";
        const activeKind = surface.getAttribute("data-active-kind") || "";
        const activeId = surface.getAttribute("data-active-entity") || "";
        if (!shape && activeKind !== "device-type") return;
        event.preventDefault();
        event.stopPropagation();
        if (
          activeKind === "device-type" &&
          activeId &&
          (shape ? options.onPlace : options.onCreate)
        ) {
          const detail = {
            typeId: activeId,
            floorId:
              document.documentElement.getAttribute("data-active-floor") || "",
            point,
          };
          if (shape) {
            options.onPlace?.({
              ...detail,
              target: { kind, id },
            });
          } else {
            options.onCreate?.(detail);
          }
          return;
        }
        if (shape) planner.dom.focusPointer(shape);
        document.dispatchEvent(
          new CustomEvent("planner:selection-requested", {
            detail: {
              kind,
              id,
            },
          }),
        );
        const current = shape
          ? [
              ...surface.querySelectorAll(
                `[data-part="${shape.getAttribute("data-part")}"]`,
              ),
            ].find((item) => item.getAttribute("data-id") === id)
          : null;
        if (current) planner.dom.focusPointer(current);
      },
      true,
    );
    surface.addEventListener("pointerdown", drawStart, true);
    surface.addEventListener("pointermove", drawMove, true);
    surface.addEventListener("pointerup", drawEnd, true);
    surface.addEventListener("pointercancel", drawEnd, true);
    const clearMiddleClick = (event) => {
      if (event.button === 1) suppressClick = false;
    };
    surface.addEventListener("pointerup", clearMiddleClick, true);
    document.addEventListener("keydown", (event) => {
      if (event.code === "Space") {
        if (editable(event.target)) {
          space = false;
          return;
        }
        space = true;
        event.preventDefault();
      }
    });
    document.addEventListener("keyup", (event) => {
      if (event.code === "Space") space = false;
    });

    return Object.freeze({});
  };

  planner.surfaceSelect = Object.freeze({ create });
}
