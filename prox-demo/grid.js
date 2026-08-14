/**
 * Owns grid preferences and the active floor's persisted alignment.
 * Visibility and snapping are browser-local; origin and spacing are plan data
 * changed through floor commands. The lattice moves, never the plan content.
 * Channels: listens planner:selection-changed and store changes.
 */

{
  /** @typedef {{show: boolean, snap: boolean}} GridSettings */
  /** @typedef {{root?: Element | null, surface: Element, store?: Store, dispatch?: (command: Record<string, unknown>) => unknown, storage?: Storage | null, announce?: (message: string) => void}} GridOptions */

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const KEY = "mesh-planner:grid";
  const DEFAULTS = Object.freeze({ show: true, snap: true });
  /** @type {GridSettings} */
  let settings = { ...DEFAULTS };
  /** @type {any} */
  let current = null;

  /** @param {unknown} value @returns {GridSettings} */
  const checked = (value) => {
    const record = /** @type {Record<string, unknown>} */ (
      value && typeof value === "object" ? value : {}
    );
    return {
      show:
        typeof record.show === "boolean" ? record.show : DEFAULTS.show,
      snap:
        typeof record.snap === "boolean" ? record.snap : DEFAULTS.snap,
    };
  };

  /** @param {Element | null | undefined} root */
  const floorIdOf = (root) =>
    document.documentElement.getAttribute("data-active-floor") ||
    /** @type {HTMLInputElement | null} */ (
      root?.querySelector('input[name="planner-selection"]:checked')
    )?.value ||
    "";

  /** @param {GridOptions} options @param {string} [id] */
  const alignmentOf = (options, id = floorIdOf(options.root)) => {
    const plan = options.store?.read?.() || planner.app?.read?.();
    const floor = (plan?.floors || []).find((item) => item.id === id);
    return planner.floors.gridOf(floor);
  };

  /** @param {GridOptions} options @returns {((message: string) => void)} */
  const announcerOf = (options) =>
    options.announce ||
    ((message) => {
      const announcer = document.querySelector(
        '[data-part="surface-announcer"]',
      );
      if (announcer) announcer.textContent = message;
    });

  /** @param {number} value @returns {string} */
  const numberOf = (value) =>
    Number.isInteger(value)
      ? String(value)
      : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

  /** @param {GridOptions} options */
  const create = (options) => {
    if (!options?.surface) throw new TypeError("grid requires a surface");
    const { root, surface } = options;
    const storage =
      options.storage === undefined ? window.localStorage : options.storage;
    const announce = announcerOf(options);
    const pattern = surface.querySelector('[data-part="grid-pattern"]');
    const layer = surface.querySelector('[data-part="grid-layer"]');
    const gridButton = document.querySelector('[data-part="view-grid"]');
    const snapButton = document.querySelector('[data-part="view-snap"]');
    const alignButton = document.querySelector('[data-part="view-align"]');
    const spacingInput = /** @type {HTMLInputElement | null} */ (
      document.querySelector('[data-part="view-spacing"]')
    );
    let armed = false;
    /** @type {{floorId: string, originX: number, originY: number, point: Point, pointerId: number, moved: boolean} | null} */
    let drag = null;
    let wheelTimer = 0;

    try {
      const raw = storage?.getItem(KEY);
      settings = checked(raw ? JSON.parse(raw) : null);
    } catch {
      settings = { ...DEFAULTS };
    }

    const store = () => {
      try {
        storage?.setItem(
          KEY,
          JSON.stringify({ show: settings.show, snap: settings.snap }),
        );
      } catch {
        // Browser storage can be unavailable; preferences are best-effort.
      }
    };

    const read = () => {
      const alignment = alignmentOf(options);
      return { ...settings, ...alignment, align: armed };
    };

    const selected = () => {
      const radio = /** @type {HTMLInputElement | null} */ (
        root?.querySelector('input[name="planner-selection"]:checked')
      );
      const anchor = radio?.closest("[data-anchor]");
      const anchorKind = anchor?.getAttribute("data-anchor") || "";
      return {
        kind:
          anchorKind === "deviceType"
            ? "device-type"
            : anchorKind === "deviceInstance"
              ? "device"
              : anchorKind,
        id: anchor?.getAttribute("data-id") || radio?.value || "",
      };
    };

    const restoreSelection = () => {
      const value = selected();
      document.documentElement.setAttribute("data-mode", value.kind || "idle");
      surface.setAttribute("data-active-kind", value.kind);
      surface.setAttribute("data-active-entity", value.id);
    };

    const preserveAlignMode = () => {
      if (!armed) return;
      document.documentElement.setAttribute("data-mode", "align");
      surface.setAttribute("data-active-kind", "align");
      surface.removeAttribute("data-active-entity");
    };

    const reflect = () => {
      const alignment = alignmentOf(options);
      preserveAlignMode();
      // Selection/render subscribers can restore their mode synchronously;
      // reassert alignment after that DOM work settles.
      if (armed) window.setTimeout(preserveAlignMode, 0);
      pattern?.setAttribute("x", String(alignment.originX));
      pattern?.setAttribute("y", String(alignment.originY));
      pattern?.setAttribute("width", String(alignment.spacing));
      pattern?.setAttribute("height", String(alignment.spacing));
      pattern
        ?.querySelector('[data-part="grid-line"]')
        ?.setAttribute(
          "d",
          `M ${alignment.spacing} 0 L 0 0 L 0 ${alignment.spacing}`,
        );
      if (settings.show) layer?.removeAttribute("data-state");
      else layer?.setAttribute("data-state", "hidden");
      gridButton?.setAttribute("aria-pressed", String(settings.show));
      snapButton?.setAttribute("aria-pressed", String(settings.snap));
      alignButton?.setAttribute("aria-pressed", String(armed));
      if (spacingInput) spacingInput.value = String(alignment.spacing);
    };

    /** @param {Record<string, unknown>} command */
    const dispatch = (command) => {
      if (typeof options.dispatch === "function") return options.dispatch(command);
      if (typeof planner.app?.dispatch === "function")
        return planner.app.dispatch(command);
      return null;
    };

    /** @param {string} floorId @param {Grid} grid @param {string} coalesce */
    const setAlignment = (floorId, grid, coalesce) => {
      const result = dispatch({
        command: "set-grid",
        floorId,
        value: grid,
        coalesce,
      });
      reflect();
      return result;
    };

    const toggleGrid = () => {
      settings = checked({ ...settings, show: !settings.show });
      store();
      reflect();
      announce(settings.show ? "Grid shown" : "Grid hidden");
      return read();
    };

    const toggleSnap = () => {
      settings = checked({ ...settings, snap: !settings.snap });
      store();
      reflect();
      announce(settings.snap ? "Snap on" : "Snap off");
      return read();
    };

    const arm = () => {
      armed = true;
      document.documentElement.setAttribute("data-mode", "align");
      surface.setAttribute("data-active-kind", "align");
      surface.removeAttribute("data-active-entity");
      reflect();
      return true;
    };

    const disarm = () => {
      if (!armed) return false;
      armed = false;
      drag = null;
      restoreSelection();
      reflect();
      return true;
    };

    const toggleAlign = () => (armed ? disarm() : arm());

    /** @param {Point} delta */
    const nudgeOrigin = (delta) => {
      if (!armed) return false;
      const floorId = floorIdOf(root);
      const alignment = alignmentOf(options, floorId);
      setAlignment(
        floorId,
        {
          ...alignment,
          originX: alignment.originX + delta.x,
          originY: alignment.originY + delta.y,
        },
        `grid-nudge:${floorId}`,
      );
      return true;
    };

    const pointOf = (event) =>
      planner.surfaceViewport.pointOf(surface, {
        clientX: event.clientX,
        clientY: event.clientY,
      });

    const pointerDown = (/** @type {PointerEvent} */ event) => {
      if (!armed || event.button !== 0) return;
      const floorId = floorIdOf(root);
      const alignment = alignmentOf(options, floorId);
      drag = {
        floorId,
        originX: alignment.originX,
        originY: alignment.originY,
        point: pointOf(event),
        pointerId: event.pointerId,
        moved: false,
      };
      surface.setAttribute("data-suppress-click", "true");
      surface.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const pointerMove = (/** @type {PointerEvent} */ event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const point = pointOf(event);
      const delta = {
        x: point.x - drag.point.x,
        y: point.y - drag.point.y,
      };
      drag.moved = drag.moved || Math.hypot(delta.x, delta.y) > 0.01;
      if (drag.moved) {
        setAlignment(
          drag.floorId,
          {
            originX: drag.originX + delta.x,
            originY: drag.originY + delta.y,
            spacing: alignmentOf(options, drag.floorId).spacing,
          },
          `grid-drag:${drag.floorId}`,
        );
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const pointerUp = (/** @type {PointerEvent} */ event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const finished = drag;
      drag = null;
      if (surface.hasPointerCapture?.(event.pointerId))
        surface.releasePointerCapture(event.pointerId);
      if (finished.moved) {
        const alignment = alignmentOf(options, finished.floorId);
        announce(
          `Grid origin ${numberOf(alignment.originX)}, ${numberOf(alignment.originY)}`,
        );
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const wheel = (/** @type {WheelEvent} */ event) => {
      if (!armed || event.ctrlKey) return;
      const floorId = floorIdOf(root);
      const alignment = alignmentOf(options, floorId);
      const amount = event.deltaY < 0 ? 1 : -1;
      const spacing = Math.min(
        planner.floors.GRID_MAX_SPACING,
        Math.max(planner.floors.GRID_MIN_SPACING, alignment.spacing + amount),
      );
      setAlignment(
        floorId,
        { ...alignment, spacing },
        `grid-wheel:${floorId}`,
      );
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        announce(`Grid spacing ${numberOf(spacing)}`);
      }, 150);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const controlsClick = (/** @type {MouseEvent} */ event) => {
      const button = /** @type {Element | null} */ (event.target)?.closest?.(
        "button",
      );
      if (button === gridButton) {
        event.preventDefault();
        toggleGrid();
      } else if (button === snapButton) {
        event.preventDefault();
        toggleSnap();
      } else if (button === alignButton) {
        event.preventDefault();
        toggleAlign();
      }
    };

    const spacingChange = (/** @type {Event} */ event) => {
      if (event.target !== spacingInput) return;
      const spacing = Number(spacingInput?.value);
      if (
        !Number.isFinite(spacing) ||
        spacing < planner.floors.GRID_MIN_SPACING ||
        spacing > planner.floors.GRID_MAX_SPACING
      ) {
        reflect();
        return;
      }
      const floorId = floorIdOf(root);
      setAlignment(
        floorId,
        { ...alignmentOf(options, floorId), spacing },
        `grid-spacing:${floorId}`,
      );
      announce(`Grid spacing ${numberOf(spacing)}`);
    };

    const selectionChanged = () => {
      preserveAlignMode();
      reflect();
    };

    const unsubscribe = options.store?.subscribe?.(reflect);
    document.addEventListener("planner:selection-changed", selectionChanged);
    const controls = document.querySelector('[data-part="view-controls"]');
    const controlsListener = /** @type {EventListener} */ (controlsClick);
    const pointerDownListener = /** @type {EventListener} */ (pointerDown);
    const pointerMoveListener = /** @type {EventListener} */ (pointerMove);
    const pointerUpListener = /** @type {EventListener} */ (pointerUp);
    controls?.addEventListener("click", controlsListener);
    spacingInput?.addEventListener("change", spacingChange);
    surface.addEventListener("pointerdown", pointerDownListener, true);
    surface.addEventListener("pointermove", pointerMoveListener, true);
    surface.addEventListener("pointerup", pointerUpListener, true);
    surface.addEventListener("pointercancel", pointerUpListener, true);
    surface.addEventListener(
      "wheel",
      /** @type {EventListener} */ (wheel),
      { capture: true, passive: false },
    );
    current = {
      read,
      apply: (change) => {
        if (Object.hasOwn(change, "show") || Object.hasOwn(change, "snap")) {
          settings = checked({ ...settings, ...change });
          store();
        }
        if (Object.hasOwn(change, "spacing")) {
          const floorId = floorIdOf(root);
          setAlignment(
            floorId,
            { ...alignmentOf(options, floorId), spacing: Number(change.spacing) },
            `grid-spacing:${floorId}`,
          );
        }
        reflect();
        return read();
      },
      toggleGrid,
      toggleSnap,
      toggleAlign,
      cancelAlign: disarm,
      nudgeOrigin,
      step: () => (settings.snap ? alignmentOf(options).spacing : 1),
      nudgeStep: () => alignmentOf(options).spacing,
      stepFor: (event) =>
        event?.altKey || !settings.snap ? 1 : alignmentOf(options).spacing,
      origin: () => {
        const alignment = alignmentOf(options);
        return { x: alignment.originX, y: alignment.originY };
      },
      disconnect: () => {
        window.clearTimeout(wheelTimer);
        unsubscribe?.();
        document.removeEventListener(
          "planner:selection-changed",
          selectionChanged,
        );
        controls?.removeEventListener("click", controlsListener);
        spacingInput?.removeEventListener("change", spacingChange);
        surface.removeEventListener("pointerdown", pointerDownListener, true);
        surface.removeEventListener("pointermove", pointerMoveListener, true);
        surface.removeEventListener("pointerup", pointerUpListener, true);
        surface.removeEventListener("pointercancel", pointerUpListener, true);
        surface.removeEventListener(
          "wheel",
          /** @type {EventListener} */ (wheel),
          true,
        );
        if (armed) disarm();
        current = null;
      },
    };
    reflect();
    return Object.freeze(current);
  };

  planner.grid = Object.freeze({
    DEFAULTS,
    create,
    read: () =>
      current?.read?.() || { ...DEFAULTS, ...planner.floors.GRID_DEFAULTS },
    step: () => current?.step?.() || planner.floors.GRID_DEFAULTS.spacing,
    nudgeStep: () =>
      current?.nudgeStep?.() || planner.floors.GRID_DEFAULTS.spacing,
    stepFor: (event) =>
      current?.stepFor?.(event) || planner.floors.GRID_DEFAULTS.spacing,
    origin: () =>
      current?.origin?.() || {
        x: planner.floors.GRID_DEFAULTS.originX,
        y: planner.floors.GRID_DEFAULTS.originY,
      },
    nudgeOrigin: (delta) => Boolean(current?.nudgeOrigin?.(delta)),
    cancelAlign: () => Boolean(current?.cancelAlign?.()),
  });
}
