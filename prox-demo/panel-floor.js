/**
 * Mounts the floor branch,
 * and provides the floor panel's document projection.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {FloorPanelOptions} options */
  const create = (options) => {
    if (!options?.root || typeof options.store?.read !== "function")
      throw new TypeError("floor panel requires root, store, and registry");

    const { root, store, surface, registry, surfaceRenderer } = options;
    const projectDocument = options.projectDocument !== false;
    if (typeof registry?.dispatch !== "function")
      throw new TypeError("floor panel requires a command registry");
    if (surface && typeof surfaceRenderer?.render !== "function")
      throw new TypeError("floor panel requires a surface renderer");
    const opacityOpen = new Set();

    const dispatch = (
      /** @type {string} */ action,
      /** @type {string} */ id,
      /** @type {unknown} */ value,
      /** @type {unknown} */ tag = null,
    ) => {
      const result = registry.dispatch({
        entity: "floor",
        action,
        id,
        value,
        coalesce: tag,
      });
      render();
      return result;
    };

    const selectionOf = () => {
      const selected = planner.selection?.read?.();
      if (selected?.id) return selected;
      const kind = surface?.getAttribute("data-active-kind") || "";
      const id = surface?.getAttribute("data-active-entity") || "";
      if (kind || id) return { kind, id };
      return { kind: "", id: "" };
    };

    const clearSelection = () => {
      surface?.removeAttribute("data-active-kind");
      surface?.removeAttribute("data-active-entity");
      planner.selection?.release?.();
    };

    const render = () => {
      const selected = selectionOf();
      if (projectDocument) planner.dom.project(root, store);
      const plan = store.read();
      const activeFloorId = planner.selection.activeFloor(plan) || null;
      for (const floor of root.querySelectorAll('[data-anchor="floor"]')) {
        const id = floor.getAttribute("data-id");
        const record = plan.floors.find((item) => item.id === id);
        const radio = /** @type {HTMLInputElement | null} */ (
          floor.querySelector('input[name="planner-selection"]')
        );
        if (radio) {
          radio.value = id || "";
          radio.toggleAttribute(
            "checked",
            selected?.kind === "floor" && selected.id === id,
          );
          radio.checked = selected?.kind === "floor" && selected.id === id;
        }
        const remove = /** @type {HTMLButtonElement | null} */ (
          floor.querySelector('[data-action="delete"]')
        );
        if (remove) remove.disabled = plan.floors.length < 2;
        const undo = /** @type {HTMLButtonElement | null} */ (
          floor.querySelector('[data-action="undo"]')
        );
        const redo = /** @type {HTMLButtonElement | null} */ (
          floor.querySelector('[data-action="redo"]')
        );
        if (undo) undo.disabled = !store.canUndo?.();
        if (redo) redo.disabled = !store.canRedo?.();
        const thumbnail = /** @type {HTMLImageElement | null} */ (
          floor.querySelector('[data-part="background-thumbnail"]')
        );
        if (thumbnail) {
          if (record?.background?.src)
            thumbnail.setAttribute("src", record.background.src);
          else thumbnail.removeAttribute("src");
        }
        const opacity = record?.background?.opacity ?? 100;
        floor.setAttribute("data-image-opacity", String(opacity));
        const badge = floor.querySelector('[data-part="opacity-badge"]');
        if (badge) badge.textContent = `${opacity}%`;
        const slider = /** @type {HTMLInputElement | null} */ (
          floor.querySelector('[data-part="opacity-slider"]')
        );
        if (slider) {
          slider.value = String(opacity);
          slider.setAttribute(
            "data-state",
            opacityOpen.has(id) ? "open" : "closed",
          );
        }
        const checkbox = /** @type {HTMLInputElement | null} */ (
          floor.querySelector('[data-part="opacity-checkbox"]')
        );
        if (checkbox) checkbox.checked = opacityOpen.has(id);
      }
      if (surface) surfaceRenderer.render(plan, activeFloorId, selected);
      return plan;
    };

    render();
    root.addEventListener("click", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const action = target
        ?.closest?.("[data-action]")
        ?.getAttribute("data-action");
      if (action === "undo" || action === "redo") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const before = store.read();
        const operation = store[action];
        const snapshot = typeof operation === "function" ? operation() : null;
        if (snapshot) {
          const changedFloorId = planner.floors.changedId(before, snapshot);
          planner.selection.activeFloor(snapshot, changedFloorId || "");
          render();
        }
        return;
      }
      if (action === "delete") {
        event.preventDefault();
        const anchor = target?.closest?.('[data-anchor="floor"]');
        const id = anchor?.getAttribute("data-id");
        if (id) dispatch("delete", id, undefined);
        return;
      }
      if (action === "add-floor") {
        event.preventDefault();
        const next = registry.dispatch({
          entity: "floor",
          action: "add",
        });
        const added = next.floors[next.floors.length - 1];
        planner.selection.activeFloor(next, added.id);
        clearSelection();
        render();
        return;
      }
      if (action === "background-pick") {
        event.preventDefault();
        const input = /** @type {HTMLInputElement | null} */ (
          target
            ?.closest?.("[data-anchor]")
            ?.querySelector('[data-action="background-image"]')
        );
        input?.click();
        return;
      }
      if (action === "opacity-toggle") {
        event.preventDefault();
        const floor = target?.closest?.('[data-anchor="floor"]');
        const id = floor?.getAttribute("data-id");
        const checkbox = /** @type {HTMLInputElement | null} */ (
          floor?.querySelector('[data-part="opacity-checkbox"]')
        );
        if (id && checkbox) {
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) opacityOpen.add(id);
          else opacityOpen.delete(id);
          render();
        }
        return;
      }
    });
    root.addEventListener("change", (event) => {
      const target = /** @type {HTMLInputElement | null} */ (event.target);
      const action = target?.getAttribute("data-action");
      const floor = target?.closest?.('[data-anchor="floor"]');
      const id = floor?.getAttribute("data-id");
      if (!target || !id) return;
      if (action === "background-image") {
        const file = target.files?.[0];
        if (!file || file.size > 8 * 1024 * 1024) return;
        const reader = new FileReader();
        reader.onload = () =>
          dispatch(
            "set-background",
            id,
            {
              src: String(reader.result),
              opacity:
                store.read().floors.find((item) => item.id === id)?.background
                  ?.opacity ?? 100,
            },
            `background:${id}`,
          );
        reader.readAsDataURL(file);
      } else if (action === "background-opacity") {
        dispatch("set-opacity", id, target.value, `opacity:${id}`);
      } else if (target.matches('[data-act="rename"]')) {
        dispatch("rename", id, target.value, `rename:${id}`);
      } else if (action === "opacity-toggle") {
        if (target.checked) opacityOpen.add(id);
        else opacityOpen.delete(id);
        render();
      } else if (target.matches('input[name="planner-selection"]')) {
        render();
      }
    });
    if (surface)
      surface.addEventListener("click", (event) => {
        const target = /** @type {Element | null} */ (event.target);
        const shape = target?.closest?.(
          '[data-part="surface-group"], [data-part="surface-device"]',
        );
        const id = shape?.getAttribute("data-id");
        if (!id) return;
        const entity =
          shape?.getAttribute("data-part") === "surface-group"
            ? "group"
            : "deviceInstance";
        const anchor = [...root.querySelectorAll("[data-anchor]")].find(
          (item) =>
            item.getAttribute("data-anchor") === entity &&
            item.getAttribute("data-id") === id,
        );
        /** @type {HTMLInputElement | null} */ (
          anchor?.querySelector('input[name="planner-selection"]')
        )?.click();
        render();
      });
    const unsubscribe = store.subscribe?.(() => render());
    return Object.freeze({
      render,
      read: store.read,
      disconnect: () => unsubscribe?.(),
    });
  };

  planner.floorPanel = Object.freeze({ create });
}
