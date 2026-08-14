/** Owns the surface SVG viewBox, wheel zoom, and whitespace panning.
 * Viewport changes are transient view state and never reach the document.
 * Channels: none.
 */
{
  /** @typedef {{x: number, y: number, width: number, height: number}} ViewBox */
  /** @typedef {{root: Element, surface: Element}} SurfaceViewportOptions */
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const EXTENT = planner.geo.WORLD_EXTENT;
  // Far enough out that the whole plan reads as an object on a table; closer in
  // than this and there is nothing but empty space to look at.
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 20;
  const STEP = 1.2;

  /** @param {Element} surface @returns {ViewBox} */
  const readViewBox = (surface) => {
    const values = (surface.getAttribute("viewBox") || "")
      .trim()
      .split(/\s+/)
      .map(Number);
    return values.length === 4 &&
      values.every(Number.isFinite) &&
      values[2] > 0 &&
      values[3] > 0
      ? { x: values[0], y: values[1], width: values[2], height: values[3] }
      : { ...EXTENT };
  };

  /** @param {Element} surface @param {{clientX: number, clientY: number}} event */
  const pointOf = (surface, event) => {
    const viewBox = readViewBox(surface);
    const box = surface.getBoundingClientRect();
    const scale =
      Math.min(box.width / viewBox.width, box.height / viewBox.height) || 1;
    return {
      x:
        viewBox.x +
        (event.clientX - box.left - (box.width - viewBox.width * scale) / 2) /
          scale,
      y:
        viewBox.y +
        (event.clientY - box.top - (box.height - viewBox.height * scale) / 2) /
          scale,
    };
  };

  /**
   * Below the fit, the viewport is larger than plan space, so panning would
   * only move emptiness: the plan stays centred instead.
   * @param {ViewBox} viewBox @returns {ViewBox}
   */
  const constrained = (viewBox) => {
    const wider = viewBox.width > EXTENT.width;
    const taller = viewBox.height > EXTENT.height;
    const xMin = EXTENT.x - viewBox.width + 1;
    const xMax = EXTENT.x + EXTENT.width - 1;
    const yMin = EXTENT.y - viewBox.height + 1;
    const yMax = EXTENT.y + EXTENT.height - 1;
    return {
      ...viewBox,
      x: wider
        ? EXTENT.x + (EXTENT.width - viewBox.width) / 2
        : Math.min(xMax, Math.max(xMin, viewBox.x)),
      y: taller
        ? EXTENT.y + (EXTENT.height - viewBox.height) / 2
        : Math.min(yMax, Math.max(yMin, viewBox.y)),
    };
  };

  /** @param {Element} surface @param {ViewBox} viewBox */
  const writeViewBox = (surface, viewBox) =>
    surface.setAttribute(
      "viewBox",
      `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
    );

  /** @param {SurfaceViewportOptions} options */
  const create = (options) => {
    if (!options?.root || !options.surface)
      throw new TypeError("surface viewport requires root and surface");

    const { surface } = options;
    const announce = (/** @type {string} */ message) => {
      const announcer = document.querySelector(
        '[data-part="surface-announcer"]',
      );
      if (announcer) announcer.textContent = message;
    };
    if (!surface.hasAttribute("viewBox")) writeViewBox(surface, EXTENT);
    let space = false;
    /** @type {{x: number, y: number, viewBox: ViewBox, scale: number, pointerId: number, moved: boolean} | null} */
    let drag = null;
    const editable = (/** @type {EventTarget | null} */ target) =>
      planner.dom.editable(target);

    const zoomValue = () => EXTENT.width / readViewBox(surface).width;

    const showZoom = () => {
      const label = document.querySelector('[data-part="view-zoom-value"]');
      if (label) label.textContent = `${Math.round(zoomValue() * 100)}%`;
    };

    /**
     * @param {number} factor
     * @param {{x: number, y: number} | null} [towards] plan-space anchor; the
     * centre of the view when absent.
     */
    const zoomBy = (factor, towards = null) => {
      const current = readViewBox(surface);
      const currentZoom = EXTENT.width / current.width;
      const nextZoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, currentZoom * factor),
      );
      if (nextZoom === currentZoom) return false;
      const point = towards || {
        x: current.x + current.width / 2,
        y: current.y + current.height / 2,
      };
      const ratio = nextZoom / currentZoom;
      writeViewBox(
        surface,
        constrained({
          width: EXTENT.width / nextZoom,
          height: EXTENT.height / nextZoom,
          x: point.x - (point.x - current.x) / ratio,
          y: point.y - (point.y - current.y) / ratio,
        }),
      );
      showZoom();
      return true;
    };

    const reset = () => {
      writeViewBox(surface, EXTENT);
      showZoom();
      return true;
    };

    // The wheel over the surface belongs to the plan at every zoom level. At a
    // limit the gesture is still the plan's, so it is swallowed rather than
    // left to become the browser's own page zoom.
    const zoom = (event) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? STEP : 1 / STEP, pointOf(surface, event));
    };

    const panStart = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const entity = target?.closest?.(
        '[data-part="surface-group"], [data-part="surface-device"]',
      );
      const activeKind = surface.getAttribute("data-active-kind") || "";
      const forced = event.button === 1 || space;
      if (event.button !== 0 && !forced) return;
      if (
        !forced &&
        (activeKind === "group" || (entity && activeKind !== "device-type"))
      )
        return;
      const viewBox = readViewBox(surface);
      const box = surface.getBoundingClientRect();
      drag = {
        x: event.clientX,
        y: event.clientY,
        viewBox,
        scale:
          Math.min(box.width / viewBox.width, box.height / viewBox.height) || 1,
        pointerId: event.pointerId,
        moved: false,
      };
      surface.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };

    const panMove = (event) => {
      if (!drag) return;
      drag.moved =
        drag.moved ||
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 1;
      const next = constrained({
        ...drag.viewBox,
        x: drag.viewBox.x - (event.clientX - drag.x) / drag.scale,
        y: drag.viewBox.y - (event.clientY - drag.y) / drag.scale,
      });
      writeViewBox(surface, next);
      event.preventDefault();
    };

    const panEnd = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = drag.moved;
      drag = null;
      if (moved) surface.setAttribute("data-suppress-click", "true");
      if (surface.hasPointerCapture?.(event.pointerId))
        surface.releasePointerCapture(event.pointerId);
    };

    const controlClick = (/** @type {Event} */ event) => {
      const button = /** @type {Element | null} */ (event.target)?.closest?.(
        "button",
      );
      const part = button?.getAttribute("data-part") || "";
      if (part === "view-zoom-in") zoomBy(STEP);
      else if (part === "view-zoom-out") zoomBy(1 / STEP);
      else if (part === "view-zoom-reset") {
        reset();
        announce("Zoom reset");
      }
    };
    const controls = document.querySelector('[data-part="view-controls"]');
    controls?.addEventListener("click", controlClick);
    showZoom();

    surface.addEventListener("wheel", zoom, {
      passive: false,
    });
    surface.addEventListener("pointerdown", panStart, true);
    surface.addEventListener("pointermove", panMove, true);
    surface.addEventListener("pointerup", panEnd, true);
    surface.addEventListener("pointercancel", panEnd, true);
    const keydown = (event) => {
      if (event.code !== "Space") return;
      if (editable(event.target)) {
        space = false;
        surface.removeAttribute("data-space");
        return;
      }
      space = true;
      surface.setAttribute("data-space", "true");
      event.preventDefault();
    };
    const keyup = (event) => {
      if (event.code === "Space") {
        space = false;
        surface.removeAttribute("data-space");
      }
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup);

    return Object.freeze({
      pointOf: (/** @type {{clientX: number, clientY: number}} */ event) =>
        pointOf(surface, event),
      read: () => readViewBox(surface),
      zoom: zoomValue,
      zoomIn: () => zoomBy(STEP),
      zoomOut: () => zoomBy(1 / STEP),
      reset: () => {
        reset();
        announce("Zoom reset");
        return true;
      },
      disconnect: () => {
        controls?.removeEventListener("click", controlClick);
        surface.removeAttribute("data-space");
        surface.removeEventListener("wheel", zoom);
        surface.removeEventListener("pointerdown", panStart, true);
        surface.removeEventListener("pointermove", panMove, true);
        surface.removeEventListener("pointerup", panEnd, true);
        surface.removeEventListener("pointercancel", panEnd, true);
        document.removeEventListener("keydown", keydown);
        document.removeEventListener("keyup", keyup);
      },
    });
  };

  planner.surfaceViewport = Object.freeze({ create, pointOf });
}
