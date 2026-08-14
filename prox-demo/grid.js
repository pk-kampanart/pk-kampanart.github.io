/**
 * Owns the grid: its spacing, whether it is drawn, and whether placement snaps
 * to it. View state, kept in browser-local storage and never in the plan
 * document (ADR-0002); snapping rounds a gesture before it becomes a command
 * (ADR-0035).
 * Channels: none.
 */
{
  /** @typedef {{spacing: number, show: boolean, snap: boolean}} GridSettings */
  /** @typedef {{root?: Element | null, surface: Element, storage?: Storage | null, announce?: (message: string) => void}} GridOptions */
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  const KEY = "mesh-planner:grid";
  const SPACINGS = Object.freeze([5, 10, 25, 50]);
  /** @type {GridSettings} */
  const DEFAULTS = Object.freeze({ spacing: 10, show: true, snap: true });

  /** @type {GridSettings} */
  let settings = { ...DEFAULTS };

  /** @param {unknown} value @returns {GridSettings} */
  const checked = (value) => {
    const record = /** @type {Record<string, unknown>} */ (
      value && typeof value === "object" ? value : {}
    );
    const spacing = Number(record.spacing);
    return {
      spacing: SPACINGS.includes(spacing) ? spacing : DEFAULTS.spacing,
      show: typeof record.show === "boolean" ? record.show : DEFAULTS.show,
      snap: typeof record.snap === "boolean" ? record.snap : DEFAULTS.snap,
    };
  };

  /** @returns {GridSettings} */
  const read = () => ({ ...settings });

  /**
   * The step a command rounds to. With snapping off the floor is one whole
   * surface unit, which is what the planner rounded to before there was a grid.
   */
  const step = () => (settings.snap ? settings.spacing : 1);

  /** Arrows move by the spacing whether or not snapping is on. */
  const nudgeStep = () => settings.spacing;

  /** Alt suspends snapping for the length of a gesture. */
  /** @param {{altKey?: boolean} | null} [event] */
  const stepFor = (event) => (event?.altKey ? 1 : step());

  /** @param {GridOptions} options */
  const create = (options) => {
    if (!options?.surface) throw new TypeError("grid requires surface");
    const { surface } = options;
    const storage =
      options.storage === undefined ? localStorage : options.storage;
    const announce = (/** @type {string} */ message) => {
      if (options.announce) options.announce(message);
      else {
        const announcer = document.querySelector(
          '[data-part="surface-announcer"]',
        );
        if (announcer) announcer.textContent = message;
      }
    };

    const load = () => {
      try {
        const raw = storage?.getItem(KEY);
        settings = checked(raw ? JSON.parse(raw) : null);
      } catch {
        settings = { ...DEFAULTS };
      }
    };

    const store = () => {
      try {
        storage?.setItem(KEY, JSON.stringify(settings));
      } catch {
        // Browser storage can be unavailable; the preference is best-effort.
      }
    };

    const pattern = surface.querySelector('[data-part="grid-pattern"]');
    const layer = surface.querySelector('[data-part="grid-layer"]');
    const gridButton = document.querySelector('[data-part="view-grid"]');
    const snapButton = document.querySelector('[data-part="view-snap"]');
    const spacing = /** @type {HTMLSelectElement | null} */ (
      document.querySelector('[data-part="view-spacing"]')
    );

    const reflect = () => {
      pattern?.setAttribute("width", String(settings.spacing));
      pattern?.setAttribute("height", String(settings.spacing));
      pattern
        ?.querySelector('[data-part="grid-line"]')
        ?.setAttribute(
          "d",
          `M ${settings.spacing} 0 L 0 0 L 0 ${settings.spacing}`,
        );
      if (settings.show) layer?.removeAttribute("data-state");
      else layer?.setAttribute("data-state", "hidden");
      gridButton?.setAttribute("aria-pressed", String(settings.show));
      snapButton?.setAttribute("aria-pressed", String(settings.snap));
      if (spacing) spacing.value = String(settings.spacing);
    };

    /** @param {Partial<GridSettings>} change */
    const apply = (change) => {
      settings = checked({ ...settings, ...change });
      store();
      reflect();
      return read();
    };

    const click = (/** @type {Event} */ event) => {
      const button = /** @type {Element | null} */ (event.target)?.closest?.(
        "button",
      );
      if (!button) return;
      if (button === gridButton) {
        apply({ show: !settings.show });
        announce(settings.show ? "Grid shown" : "Grid hidden");
      } else if (button === snapButton) {
        apply({ snap: !settings.snap });
        announce(settings.snap ? "Snap on" : "Snap off");
      }
    };

    const change = () => {
      if (!spacing) return;
      apply({ spacing: Number(spacing.value) });
      announce(`Grid spacing ${settings.spacing}`);
    };

    load();
    reflect();
    gridButton?.addEventListener("click", click);
    snapButton?.addEventListener("click", click);
    spacing?.addEventListener("change", change);

    return Object.freeze({
      read,
      apply,
      toggleGrid: () => {
        apply({ show: !settings.show });
        announce(settings.show ? "Grid shown" : "Grid hidden");
        return read();
      },
      toggleSnap: () => {
        apply({ snap: !settings.snap });
        announce(settings.snap ? "Snap on" : "Snap off");
        return read();
      },
      disconnect: () => {
        gridButton?.removeEventListener("click", click);
        snapButton?.removeEventListener("click", click);
        spacing?.removeEventListener("change", change);
      },
    });
  };

  planner.grid = Object.freeze({
    SPACINGS,
    DEFAULTS,
    create,
    read,
    step,
    nudgeStep,
    stepFor,
  });
}
