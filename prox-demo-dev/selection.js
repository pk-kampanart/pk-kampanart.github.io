/**
 * Mirrors one native radio group onto the root element's view state, and owns
 * which floor is active.
 * Selection remains DOM state; this file only reports its current value and
 * releases it when view input asks for idle.
 * Channels: listens planner:selection-changed / planner:selection-requested;
 * listens planner:surface-cancel;
 * dispatches planner:selection-changed.
 */
{
  /** @typedef {{root: Element, surface: Element, store: {read: () => PlanDocument}}} SelectionOptions */

  /**
   * The floor being planned. It follows the selection when the selection has
   * a floor, survives every selection that has none, and falls back to the
   * first floor when its own is gone. This is the only rule that decides it,
   * and the root element is the only place it is written.
   * @param {PlanDocument} plan @param {string} [preferred] @returns {string}
   */
  const activeFloor = (plan, preferred) => {
    const element = document.documentElement;
    const ids = (plan.floors || []).map((floor) => floor.id);
    const current = element.getAttribute("data-active-floor") || "";
    const next = ids.includes(preferred || "")
      ? preferred || ""
      : ids.includes(current)
        ? current
        : ids[0] || "";
    element.setAttribute("data-active-floor", next);
    return next;
  };
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @param {Element} anchor @returns {string} */
  const kindOf = (anchor) => {
    const kind = anchor.getAttribute("data-anchor");
    return kind === "deviceInstance"
      ? "device"
      : kind === "deviceType"
        ? "device-type"
        : kind || "";
  };

  /** @param {Element} root @param {string} kind @param {string} id */
  const anchorOf = (root, kind, id) => {
    const anchorKind =
      kind === "device"
        ? "deviceInstance"
        : kind === "device-type"
          ? "deviceType"
          : kind;
    return (
      [...root.querySelectorAll("[data-anchor]")].find(
        (anchor) =>
          anchor.getAttribute("data-anchor") === anchorKind &&
          anchor.getAttribute("data-id") === id,
      ) || null
    );
  };

  /** @param {Element} root @returns {{kind: string, id: string}} */
  const read = (root) => {
    const radio = /** @type {HTMLInputElement | null} */ (
      root.querySelector('input[name="planner-selection"]:checked')
    );
    if (!radio) return { kind: "", id: "" };
    const anchor = radio.closest("[data-anchor]");
    return {
      kind: radio.dataset.kind || (anchor ? kindOf(anchor) : ""),
      id: radio.value || anchor?.getAttribute("data-id") || "",
    };
  };

  /** @param {SelectionOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      !options.surface ||
      typeof options.store?.read !== "function"
    )
      throw new TypeError("selection requires root and surface");

    const { root, surface, store } = options;
    /** @type {{kind: string, id: string}} */
    let previous = { kind: "", id: "" };

    const templateOf = (/** @type {string} */ part) =>
      /** @type {HTMLTemplateElement | null} */ (
        document.querySelector(`[data-part="${part}"]`)
      );

    /** @param {Element} anchor */
    const ensureRadio = (anchor) => {
      const kind = kindOf(anchor);
      let radio = /** @type {HTMLInputElement | null} */ (
        anchor.querySelector('input[name="planner-selection"]')
      );
      if (!radio && kind === "device-type") {
        const template = templateOf("surface-device-type-selection-template");
        const label = /** @type {HTMLElement | null} */ (
          template?.content.firstElementChild?.cloneNode(true)
        );
        if (label) {
          const name = anchor.querySelector('[data-slot="name"]');
          radio = /** @type {HTMLInputElement | null} */ (
            label.querySelector('[data-part="selection-radio"]')
          );
          if (name) label.append(name);
          anchor.prepend(label);
        }
      }
      if (!radio && kind === "device") {
        const template = templateOf(
          "surface-device-instance-selection-template",
        );
        radio = /** @type {HTMLInputElement | null} */ (
          template?.content.firstElementChild?.cloneNode(true)
        );
        if (radio) anchor.append(radio);
      }
      if (!radio) return;
      // Part, kind, act and tabindex are the template's to declare. Only the
      // accessible name needs the entity, so only it is written here.
      radio.setAttribute(
        "aria-label",
        `Select ${kind} ${anchor.getAttribute("data-id") || ""}`,
      );
    };

    const ensureRows = () => {
      for (const anchor of root.querySelectorAll("[data-anchor]"))
        ensureRadio(anchor);
    };

    /** @param {string} kind @param {string} id */
    const radioOf = (kind, id) => {
      const anchor = anchorOf(root, kind, id);
      return /** @type {HTMLInputElement | null} */ (
        anchor?.querySelector('input[name="planner-selection"]')
      );
    };

    /**
     * The selection is the checked radio; these attributes are its projection,
     * and this is the only place that writes them.
     * @param {{kind: string, id: string}} value
     */
    const mirror = (value) => {
      const checked = root.querySelector(
        'input[name="planner-selection"]:checked',
      );
      activeFloor(
        store.read(),
        checked?.closest('[data-anchor="floor"]')?.getAttribute("data-id") ||
          undefined,
      );
      const element = document.documentElement;
      element.setAttribute("data-mode", value.kind || "idle");
      element.setAttribute("data-active-entity", value.id);
      surface.setAttribute("data-active-kind", value.kind);
      surface.setAttribute("data-active-entity", value.id);
    };

    /** @returns {{kind: string, id: string}} */
    const sync = () => {
      ensureRows();
      // A template-bound radio takes its value from data-slot. A radio cloned
      // onto a surface anchor carries no slot, so it is filled here.
      for (const radio of root.querySelectorAll(
        'input[name="planner-selection"]:not([data-slot])',
      )) {
        const anchor = radio.closest("[data-anchor]");
        if (!anchor) continue;
        const input = /** @type {HTMLInputElement} */ (radio);
        const id = anchor.getAttribute("data-id") || "";
        input.value = id;
        input.setAttribute("value", id);
      }
      const value = read(root);
      mirror(value);
      return value;
    };

    /** @param {boolean} [force=false] */
    const announce = (force = false) => {
      const value = sync();
      if (!force && value.kind === previous.kind && value.id === previous.id)
        return;
      previous = value;
      document.dispatchEvent(
        new CustomEvent("planner:selection-changed", { detail: value }),
      );
    };

    const release = () => {
      const checked = /** @type {HTMLInputElement | null} */ (
        root.querySelector('input[name="planner-selection"]:checked')
      );
      if (!checked) return;
      checked.checked = false;
      checked.removeAttribute("checked");
      announce(true);
    };

    root.addEventListener("change", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (!target?.matches('input[name="planner-selection"]')) return;
      announce(true);
    });

    root.addEventListener(
      "click",
      (event) => {
        const target = /** @type {Element | null} */ (event.target);
        const anchor = target?.closest?.("[data-anchor]");
        if (!anchor) return;
        const kind = kindOf(anchor);
        if (
          target?.closest?.('input[name="planner-selection"]') ||
          target?.closest?.(
            '[data-part="tree-row"], [data-part="selection-catcher"]',
          )
        ) {
          if (kind !== "floor" && kind !== "application")
            event.stopImmediatePropagation();
          return;
        }
        if (
          target?.closest?.("summary") &&
          !target?.closest?.(
            '[data-action], [data-act], [data-part="tree-background"]',
          )
        )
          event.stopImmediatePropagation();
      },
      true,
    );

    root.addEventListener(
      "pointerdown",
      (event) => {
        const target = /** @type {Element | null} */ (event.target);
        if (
          target?.closest?.(
            'input[name="planner-selection"], [data-part="tree-row"], [data-part="selection-catcher"], [data-action], [data-act], summary, button, input',
          )
        )
          return;
        release();
      },
      true,
    );

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !surface.hasAttribute("data-anchor-x"))
        release();
    });

    const observer = new MutationObserver(() => {
      const wanted = {
        kind: surface.getAttribute("data-active-kind") || "",
        id: surface.getAttribute("data-active-entity") || "",
      };
      ensureRows();
      const radio = wanted.id ? radioOf(wanted.kind, wanted.id) : null;
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.setAttribute("checked", "");
      }
      announce();
    });
    observer.observe(root, { childList: true, subtree: true });

    document.addEventListener("planner:selection-requested", (event) => {
      const detail =
        /** @type {CustomEvent<{kind?: string, id?: string}>} */ (event)
          .detail || {};
      const anchor = anchorOf(root, detail.kind || "", detail.id || "");
      const radio = anchor?.querySelector('input[name="planner-selection"]');
      if (radio) {
        for (
          let parent = anchor?.parentElement;
          parent;
          parent = parent.parentElement
        )
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        /** @type {HTMLInputElement} */ (radio).click();
      }
    });

    // Any owner may check or uncheck a radio, but the projection is derived
    // here and only here, so an announced change re-reads the radio group.
    document.addEventListener("planner:selection-changed", () =>
      mirror(read(root)),
    );

    document.addEventListener("planner:surface-cancel", () => {
      if (!surface.hasAttribute("data-anchor-x")) release();
    });

    ensureRows();
    previous = sync();
    return Object.freeze({
      read: () => read(root),
      render: sync,
      select: (/** @type {string} */ kind, /** @type {string} */ id) => {
        const anchor = anchorOf(root, kind, id);
        const radio = anchor?.querySelector('input[name="planner-selection"]');
        if (radio) /** @type {HTMLInputElement} */ (radio).click();
      },
      release: () => {
        release();
      },
      disconnect: () => observer.disconnect(),
    });
  };

  planner.selection = Object.freeze({ create, activeFloor });
}
