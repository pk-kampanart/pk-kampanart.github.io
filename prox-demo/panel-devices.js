/**
 * Mounts device-type rows, placement, instance movement, and device commands.
 * Channels: none.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {DevicePanelOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      !options.surface ||
      typeof options.store?.read !== "function" ||
      typeof options.store?.replace !== "function"
    )
      throw new TypeError("device panel requires root, surface, store, and registry");

    const { root, surface, store, registry } = options;
    const projectDocument = options.projectDocument !== false;
    if (typeof registry?.dispatch !== "function")
      throw new TypeError("device panel requires a command registry");
    const refresh = options.refresh || (() => planner.dom.project(root, store));

    /** @type {string | null} */
    let draggedTypeId = null;
    /** @type {{id: string, pointerId: number, offset: {x: number, y: number}, point: {x: number, y: number}, moved: boolean} | null} */
    let draggedDevice = null;

    /** @param {string} kind @param {string} id */
    const anchorOf = (kind, id) =>
      [...root.querySelectorAll("[data-anchor]")].find(
        (anchor) =>
          anchor.getAttribute("data-anchor") === kind &&
          anchor.getAttribute("data-id") === id,
      ) || null;

    const active = () => ({
      kind: surface.getAttribute("data-active-kind") || "",
      id: surface.getAttribute("data-active-entity") || "",
    });

    /** @param {string} kind @param {string} id */
    const select = (kind, id) => {
      surface.setAttribute("data-active-kind", kind);
      surface.setAttribute("data-active-entity", id);
      if (typeof planner.selection?.select === "function")
        planner.selection.select(kind, id);
    };

    const release = () => {
      surface.removeAttribute("data-active-kind");
      surface.removeAttribute("data-active-entity");
      planner.selection?.release?.();
    };

    /** @param {{x: number, y: number}} point */
    const announce = (point) => {
      const announcer = document.querySelector(
        '[data-part="surface-announcer"]',
      );
      if (announcer)
        announcer.textContent = `Device at ${Math.round(point.x)}, ${Math.round(point.y)}`;
    };

    const refreshSelection = (
      /** @type {{kind: string, id: string}} */ wanted,
    ) => {
      const kind =
        wanted.kind === "device"
          ? "deviceInstance"
          : wanted.kind === "device-type"
            ? "deviceType"
            : wanted.kind;
      if (wanted.id && anchorOf(kind, wanted.id))
        select(wanted.kind, wanted.id);
      else if (wanted.id) release();
    };

    const templates = {
      addType: /** @type {HTMLTemplateElement | null} */ (
        document.querySelector('[data-part="device-type-add-template"]')
      ),
    };

    /** @param {Record<string, any>} plan */
    const records = (plan) => {
      const types = new Map();
      const instances = new Map();
      for (const floor of plan.floors)
        for (const application of floor.applications)
          for (const type of application.deviceTypes) {
            types.set(type.id, {
              ...type,
              applicationId: application.id,
              floorId: floor.id,
            });
            for (const instance of type.instances)
              instances.set(instance.id, {
                ...instance,
                typeId: type.id,
                floorId: floor.id,
              });
          }
      return { types, instances };
    };

    /** @param {Record<string, any>} plan */
    const decorate = (plan) => {
      const found = records(plan);
      for (const application of root.querySelectorAll(
        '[data-anchor="application"]',
      )) {
        const id = application.getAttribute("data-id");
        const region = application.querySelector('[data-region="deviceTypes"]');
        if (
          region &&
          templates.addType &&
          !region.querySelector('[data-part="device-type-add"]')
        ) {
          const add =
            templates.addType.content.firstElementChild?.cloneNode(true);
          if (add) region.append(add);
        }
        for (const typeRow of application.querySelectorAll(
          '[data-anchor="deviceType"]',
        )) {
          const type = found.types.get(typeRow.getAttribute("data-id") || "");
          if (!type) continue;
          typeRow.setAttribute(
            "data-device-count",
            String(type.instances.length),
          );
          typeRow.setAttribute("data-application-id", id || "");
          const radio = /** @type {HTMLInputElement | null} */ (
            typeRow.querySelector('input[name="planner-selection"]')
          );
          if (radio) {
            radio.value = type.id;
            radio.setAttribute("value", type.id);
            radio.setAttribute(
              "aria-label",
              `Select ${type.name}, ${type.instances.length} instances`,
            );
          }
          const count = typeRow.querySelector(
            '[data-part="device-type-count"]',
          );
          if (count) count.textContent = String(type.instances.length);
          const rename = /** @type {HTMLInputElement | null} */ (
            typeRow.querySelector('[data-part="device-type-rename"]')
          );
          if (rename) rename.setAttribute("aria-label", `Rename ${type.name}`);
          const remove = /** @type {HTMLButtonElement | null} */ (
            typeRow.querySelector('[data-part="device-type-delete"]')
          );
          if (remove) remove.title = `Delete device type: ${type.name}`;
          for (const instanceRow of typeRow.querySelectorAll(
            '[data-anchor="deviceInstance"]',
          )) {
            const instance = found.instances.get(
              instanceRow.getAttribute("data-id") || "",
            );
            if (!instance) continue;
            const name = planner.devices.instanceName(plan, instance.id);
            instanceRow.setAttribute("aria-label", name || "Device instance");
            const label = instanceRow.querySelector(
              '[data-part="device-instance-name"]',
            );
            if (label) label.textContent = name || "Device instance";
            const instanceRadio = /** @type {HTMLInputElement | null} */ (
              instanceRow.querySelector('input[name="planner-selection"]')
            );
            if (instanceRadio) {
              instanceRadio.value = instance.id;
              instanceRadio.setAttribute("value", instance.id);
              instanceRadio.setAttribute(
                "aria-label",
                `Select ${name || "device instance"}`,
              );
            }
          }
        }
      }
      const activeFloor = surface.getAttribute("data-active-floor");
      for (const node of surface.querySelectorAll(
        '[data-part="surface-device"]',
      )) {
        const instance = found.instances.get(
          node.getAttribute("data-id") || "",
        );
        if (!instance || (activeFloor && instance.floorId !== activeFloor))
          continue;
        const name =
          planner.devices.instanceName(plan, instance.id) || "Device instance";
        node.setAttribute("data-type-id", instance.typeId);
        node.setAttribute("aria-label", name);
        node.setAttribute("data-name", name);
      }
    };

    const render = () => {
      const wanted = active();
      if (projectDocument) refresh();
      const plan = store.read();
      decorate(plan);
      linkView?.render?.();
      refreshSelection(wanted);
      for (const floor of root.querySelectorAll('[data-anchor="floor"]')) {
        const undo = floor.querySelector('[data-action="undo"]');
        const redo = floor.querySelector('[data-action="redo"]');
        if (undo) undo.toggleAttribute("disabled", !store.canUndo?.());
        if (redo) redo.toggleAttribute("disabled", !store.canRedo?.());
      }
      return plan;
    };

    /** @param {Record<string, any>} intent @param {unknown} [tag] */
    const dispatch = (intent, tag = null) => {
      const result = registry.dispatch({ ...intent, coalesce: tag });
      render();
      return result;
    };

    const reorder = (
      /** @type {string} */ typeId,
      /** @type {string} */ targetId,
      /** @type {"before" | "after"} */ where,
    ) => {
      registry.dispatch({
        entity: "deviceType",
        action: "reorder",
        id: typeId,
        targetId,
        where,
      });
      render();
    };

    const pointOf = (
      /** @type {{clientX: number, clientY: number}} */ event,
    ) => {
      if (typeof planner.surfaceViewport?.pointOf !== "function")
        throw new Error("surface viewport is unavailable");
      return planner.surfaceViewport.pointOf(surface, event);
    };

    const addInstance = (
      /** @type {{typeId: string, point: {x: number, y: number}}} */ detail,
    ) =>
      dispatch(
        {
          entity: "deviceType",
          action: "add-instance",
          id: detail.typeId,
          x: detail.point.x,
          y: detail.point.y,
        },
      );

    const deviceSelect = () => {
      const wanted = active();
      return wanted.kind === "device" && wanted.id ? wanted.id : null;
    };

    surface.addEventListener(
      "dragover",
      /** @type {EventListener} */ (
        (/** @type {DragEvent} */ event) => {
          if (
            !event.dataTransfer?.types.includes(
              "application/x-planner-device-type",
            )
          )
            return;
          event.preventDefault();
        }
      ),
    );
    surface.addEventListener(
      "drop",
      /** @type {EventListener} */ (
        (/** @type {DragEvent} */ event) => {
          const typeId = event.dataTransfer?.getData(
            "application/x-planner-device-type",
          );
          if (!typeId) return;
          event.preventDefault();
          addInstance({ typeId, point: pointOf(event) });
        }
      ),
    );
    surface.addEventListener(
      "pointerdown",
      /** @type {EventListener} */ (
        (/** @type {PointerEvent} */ event) => {
          if (
            event.button !== 0 ||
            surface.getAttribute("data-active-kind") === "device-type"
          )
            return;
          const node = /** @type {Element | null} */ (event.target)?.closest?.(
            '[data-part="surface-device"]',
          );
          const id = node?.getAttribute("data-id");
          if (!node || !id) return;
          const point = pointOf(event);
          const plan = store.read();
          const instance = records(plan).instances.get(id);
          if (!instance) return;
          draggedDevice = {
            id,
            pointerId: event.pointerId,
            offset: { x: instance.x - point.x, y: instance.y - point.y },
            point,
            moved: false,
          };
          surface.setPointerCapture?.(event.pointerId);
        }
      ),
    );
    surface.addEventListener(
      "pointermove",
      /** @type {EventListener} */ (
        (/** @type {PointerEvent} */ event) => {
          if (!draggedDevice || draggedDevice.pointerId !== event.pointerId)
            return;
          const point = pointOf(event);
          draggedDevice.moved =
            draggedDevice.moved ||
            Math.hypot(
              point.x - draggedDevice.point.x,
              point.y - draggedDevice.point.y,
            ) > 1;
          draggedDevice.point = point;
          const node = [
            ...surface.querySelectorAll('[data-part="surface-device"]'),
          ].find((item) => item.getAttribute("data-id") === draggedDevice?.id);
          if (node && draggedDevice.moved) {
            node.setAttribute("cx", String(point.x + draggedDevice.offset.x));
            node.setAttribute("cy", String(point.y + draggedDevice.offset.y));
            event.preventDefault();
          }
        }
      ),
    );
    const endDrag = (/** @type {PointerEvent} */ event) => {
      if (!draggedDevice || draggedDevice.pointerId !== event.pointerId) return;
      const drag = draggedDevice;
      draggedDevice = null;
      if (surface.hasPointerCapture?.(event.pointerId))
        surface.releasePointerCapture(event.pointerId);
      if (!drag.moved) return;
      const point = {
        x: drag.point.x + drag.offset.x,
        y: drag.point.y + drag.offset.y,
      };
      dispatch(
        {
          entity: "deviceInstance",
          action: "move",
          id: drag.id,
          x: point.x,
          y: point.y,
        },
        `move:${drag.id}`,
      );
      announce(point);
    };
    surface.addEventListener(
      "pointerup",
      /** @type {EventListener} */ (endDrag),
    );
    surface.addEventListener(
      "pointercancel",
      /** @type {EventListener} */ (endDrag),
    );

    root.addEventListener(
      "dragstart",
      /** @type {EventListener} */ (
        (/** @type {DragEvent} */ event) => {
          const type = /** @type {Element | null} */ (event.target)?.closest?.(
            '[data-anchor="deviceType"]',
          );
          const id = type?.getAttribute("data-id");
          if (!id || !event.dataTransfer) return;
          draggedTypeId = id;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-planner-device-type", id);
        }
      ),
    );
    root.addEventListener(
      "dragover",
      /** @type {EventListener} */ (
        (/** @type {DragEvent} */ event) => {
          const target = /** @type {Element | null} */ (
            event.target
          )?.closest?.('[data-anchor="deviceType"]');
          if (
            !draggedTypeId ||
            !target ||
            target.getAttribute("data-id") === draggedTypeId
          )
            return;
          event.preventDefault();
        }
      ),
    );
    root.addEventListener(
      "drop",
      /** @type {EventListener} */ (
        (/** @type {DragEvent} */ event) => {
          const target = /** @type {Element | null} */ (
            event.target
          )?.closest?.('[data-anchor="deviceType"]');
          const targetId = target?.getAttribute("data-id");
          if (
            !draggedTypeId ||
            !target ||
            !targetId ||
            targetId === draggedTypeId
          )
            return;
          event.preventDefault();
          const box = target.getBoundingClientRect();
          reorder(
            draggedTypeId,
            targetId,
            event.clientY < box.top + box.height / 2 ? "before" : "after",
          );
          draggedTypeId = null;
        }
      ),
    );

    root.addEventListener("click", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const action = target
        ?.closest?.("[data-action]")
        ?.getAttribute("data-action");
      if (action === "add-device-type") {
        event.preventDefault();
        const application = target?.closest?.('[data-anchor="application"]');
        const id = application?.getAttribute("data-id");
        if (!id) return;
        const result = dispatch(
          { entity: "application", action, id },
          `add-type:${id}`,
        );
        const added = result.floors
          .flatMap((/** @type {any} */ floor) => floor.applications)
          .find((/** @type {any} */ item) => item.id === id)
          ?.deviceTypes.at(-1);
        if (added) select("device-type", added.id);
        return;
      }
      const anchor = target?.closest?.('[data-anchor="deviceType"]');
      const command = target?.closest?.("[data-act]")?.getAttribute("data-act");
      const id = anchor?.getAttribute("data-id");
      if (command === "delete" && id) {
        event.preventDefault();
        dispatch(
          { entity: "deviceType", action: "delete", id },
          `delete-type:${id}`,
        );
        return;
      }
      if (action === "undo" || action === "redo") {
        return;
      }
      if (action === "delete" && deviceSelect()) {
        event.preventDefault();
        const id = deviceSelect();
        if (id)
          dispatch(
            { entity: "deviceInstance", action: "delete", id },
            `delete-device:${id}`,
          );
      }
    });

    root.addEventListener("input", (event) => {
      const target = /** @type {HTMLInputElement | null} */ (event.target);
      const type = target?.closest?.('[data-anchor="deviceType"]');
      if (!target?.matches('[data-act="rename"]') || !type) return;
      const id = type.getAttribute("data-id");
      if (!id) return;
      const tag = `rename-type:${id}`;
      registry.dispatch({
        entity: "deviceType",
        action: "rename",
        id,
        value: target.value,
        coalesce: tag,
      });
      decorate(store.read());
      linkView?.render?.();
    });

    surface.addEventListener(
      "keydown",
      /** @type {EventListener} */ (
        (/** @type {KeyboardEvent} */ event) => {
          if (!projectDocument) return;
          if (
            (event.key === "Enter" || event.key === " ") &&
            surface.getAttribute("data-active-kind") === "device-type"
          ) {
            event.preventDefault();
            const typeId = surface.getAttribute("data-active-entity");
            if (typeId) addInstance({ typeId, point: { x: 500, y: 350 } });
          } else if (
            (event.key === "Delete" || event.key === "Backspace") &&
            deviceSelect()
          ) {
            event.preventDefault();
            const id = deviceSelect();
            if (id)
              dispatch(
                { entity: "deviceInstance", action: "delete", id },
                `delete-device:${id}`,
              );
          }
        }
      ),
    );

    planner.surfaceSelect?.create({
      root,
      surface,
      onCreate: addInstance,
      onPlace: addInstance,
    });
    const linkView = planner.linkView.create({ root, surface, store });
    const unsubscribe = store.subscribe?.(() => render());
    render();
    for (const floor of root.querySelectorAll('[data-anchor="floor"]')) {
      const undo = floor.querySelector('[data-action="undo"]');
      const redo = floor.querySelector('[data-action="redo"]');
      if (undo) undo.toggleAttribute("disabled", !store.canUndo?.());
      if (redo) redo.toggleAttribute("disabled", !store.canRedo?.());
    }
    return Object.freeze({
      render,
      read: store.read,
      linkView,
      disconnect: () => unsubscribe?.(),
    });
  };

  planner.devicePanel = Object.freeze({ create });
}
