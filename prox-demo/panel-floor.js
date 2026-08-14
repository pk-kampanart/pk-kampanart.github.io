/**
 * Mounts the floor branch, keeps active floor scope separate from selection,
 * and provides the floor panel's document projection.
 * Channels: none.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {FloorPanelOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.store?.read !== "function"
    )
      throw new TypeError("floor panel requires root, store, and registry");

    const { root, store, surface, registry } = options;
    const projectDocument = options.projectDocument !== false;
    if (typeof registry?.dispatch !== "function")
      throw new TypeError("floor panel requires a command registry");
    let activeFloorId =
      options.activeFloorId || store.read().floors[0]?.id || null;
    /** @type {{entity: string, id: string} | null} */
    let selection = null;
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
      if (action === "delete")
        activeFloorId =
          planner.floors.floorOf(result, id) || result.floors[0]?.id || null;
      render();
      return result;
    };

    const surfacePart = (/** @type {string} */ name) => {
      const template = /** @type {HTMLTemplateElement | null} */ (
        document.querySelector(`[data-part="${name}-template"]`)
      );
      const wrapper = template?.content.firstElementChild;
      return /** @type {Element | null} */ (
        wrapper?.firstElementChild?.cloneNode(true) || null
      );
    };

    const selectionOf = () => {
      const selected = planner.selection?.read?.();
      if (selected?.id) return selected;
      const kind = surface?.getAttribute("data-active-kind") || "";
      const id = surface?.getAttribute("data-active-entity") || "";
      if (kind || id) return { kind, id };
      return selection
        ? {
            kind:
              selection.entity === "deviceInstance"
                ? "device"
                : selection.entity,
            id: selection.id,
          }
        : { kind: "", id: "" };
    };

    const clearSelection = () => {
      selection = null;
      surface?.removeAttribute("data-active-kind");
      surface?.removeAttribute("data-active-entity");
      planner.selection?.release?.();
    };

    const draw = (
      /** @type {any} */ plan,
      /** @type {{kind: string, id: string}} */ selected = selectionOf(),
    ) => {
      if (!surface) return;
      const floor = plan.floors.find(
        (/** @type {any} */ item) => item.id === activeFloorId,
      );
      const contents = planner.floors.contents(plan, activeFloorId);
      surface.setAttribute("data-active-floor", activeFloorId || "");
      surface.setAttribute("data-active-kind", selected.kind || "");
      surface.setAttribute("data-active-entity", selected.id || "");
      for (const layerName of [
        "background-layer",
        "group-layer",
        "link-layer",
        "device-layer",
      ])
        surface.querySelector(`[data-part="${layerName}"]`)?.replaceChildren();

      const backgroundLayer = surface.querySelector(
        '[data-part="background-layer"]',
      );
      if (backgroundLayer && floor?.background?.src) {
        const image = surfacePart("surface-background");
        if (image) {
          image.setAttribute("href", floor.background.src);
          image.setAttribute(
            "opacity",
            String((floor.background.opacity ?? 100) / 100),
          );
          backgroundLayer.append(image);
        }
      }

      const groupLayer = surface.querySelector('[data-part="group-layer"]');
      for (const group of contents.groups) {
        if (!group.rect || !groupLayer) continue;
        const rect = surfacePart("surface-group");
        if (!rect) continue;
        for (const [name, value] of Object.entries({
          x: group.rect.x,
          y: group.rect.y,
          width: group.rect.width,
          height: group.rect.height,
          fill: group.color,
          "data-id": group.id,
        }))
          rect.setAttribute(name, String(value));
        groupLayer.append(rect);
      }

      const deviceLayer = surface.querySelector('[data-part="device-layer"]');
      for (const device of contents.devices) {
        if (!deviceLayer) continue;
        const circle = surfacePart("surface-device");
        if (!circle) continue;
        for (const [name, value] of Object.entries({
          cx: device.x,
          cy: device.y,
          "data-id": device.id,
        }))
          circle.setAttribute(name, String(value));
        deviceLayer.append(circle);
      }

      const linkLayer = surface.querySelector('[data-part="link-layer"]');
      for (const group of contents.groups) {
        if (!group.rect || !linkLayer) continue;
        for (const device of contents.devices) {
          if (!planner.geo.contains(group.rect, device)) continue;
          const line = surfacePart("surface-link");
          if (!line) continue;
          for (const [name, value] of Object.entries({
            x1: group.rect.x + group.rect.width / 2,
            y1: group.rect.y + group.rect.height / 2,
            x2: device.x,
            y2: device.y,
            "data-id": `${group.id}-${device.id}`,
          }))
            line.setAttribute(name, String(value));
          linkLayer.append(line);
        }
      }
    };

    const render = () => {
      const selected = selectionOf();
      if (projectDocument) planner.dom.project(root, store);
      const plan = store.read();
      activeFloorId =
        planner.floors.floorOf(plan, activeFloorId) ||
        plan.floors[0]?.id ||
        null;
      for (const floor of root.querySelectorAll('[data-anchor="floor"]')) {
        const id = floor.getAttribute("data-id");
        const record = plan.floors.find(
          (/** @type {any} */ item) => item.id === id,
        );
        const radio = /** @type {HTMLInputElement | null} */ (
          floor.querySelector('[data-part="floor-radio"]')
        );
        if (radio) {
          radio.value = id || "";
          radio.toggleAttribute("checked", id === activeFloorId);
          radio.checked = id === activeFloorId;
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
      const status = document.querySelector('[data-part="status-floor-name"]');
      if (status)
        status.textContent =
          plan.floors.find(
            (/** @type {any} */ floor) => floor.id === activeFloorId,
          )?.name || "—";
      const mode = document.querySelector('[data-part="status-mode-value"]');
      if (mode)
        mode.textContent = selected?.kind || selection?.entity || "Idle";
      const count = document.querySelector('[data-part="status-device-count"]');
      if (count) count.textContent = String(planner.floors.deviceCount(plan));
      draw(plan, selected);
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
          activeFloorId =
            planner.floors.changedId(before, snapshot) ||
            planner.floors.floorOf(snapshot, activeFloorId) ||
            snapshot.floors[0]?.id ||
            null;
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
        activeFloorId = added.id;
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
      const anchor = target?.closest?.("[data-anchor]");
      if (!anchor || !root.contains(anchor)) return;
      const entity = anchor.getAttribute("data-anchor");
      if (!entity) return;
      if (entity === "floor") {
        if (!target?.closest?.('[data-part="floor-select"]')) return;
        activeFloorId = anchor.getAttribute("data-id");
        clearSelection();
        render();
        return;
      }
      const id = anchor.getAttribute("data-id");
      if (!id) return;
      selection = { entity, id };
      activeFloorId = planner.floors.floorOf(store.read(), id) || activeFloorId;
      render();
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
                store
                  .read()
                  .floors.find((/** @type {any} */ item) => item.id === id)
                  ?.background?.opacity ?? 100,
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
      } else if (target.matches('[data-part="floor-radio"]')) {
        activeFloorId = id;
        clearSelection();
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
        selection = { entity, id };
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
