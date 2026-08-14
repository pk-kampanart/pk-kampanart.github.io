/**
 * Mounts group branches and owns group document commands.
 * Channels: none.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  const DRAW_THRESHOLD = 4;

  /** @param {GroupPanelOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.store?.read !== "function" ||
      typeof options.store?.replace !== "function"
    )
      throw new TypeError("group panel requires root, store, and registry");

    const { root, surface, store, registry } = options;
    const projectDocument = options.projectDocument !== false;
    if (typeof registry?.dispatch !== "function")
      throw new TypeError("group panel requires a command registry");
    const refresh = options.refresh || (() => planner.dom.project(root, store));
    const state = (
      /** @type {Element} */ element,
      /** @type {string} */ token,
      /** @type {boolean} */ on,
    ) => {
      const tokens = new Set(
        (element.getAttribute("data-state") || "").split(/\s+/),
      );
      tokens.delete("");
      if (on) tokens.add(token);
      else tokens.delete(token);
      if (tokens.size)
        element.setAttribute("data-state", [...tokens].join(" "));
      else element.removeAttribute("data-state");
    };
    const focusPointer = (/** @type {Element} */ element) => {
      const target = /** @type {{blur: () => void, focus: (options?: {focusVisible?: boolean}) => void}} */ (
        /** @type {unknown} */ (element)
      );
      if (document.activeElement === element) target.blur();
      target.focus({ focusVisible: false });
    };
    const templateOf = (/** @type {string} */ part) =>
      /** @type {HTMLTemplateElement | null} */ (
        document.querySelector(`[data-part="${part}"]`)
      );

    /** @param {Record<string, any>} plan @param {string} id */
    const groupOf = (plan, id) => {
      for (const floor of plan.floors)
        for (const application of floor.applications) {
          const group = application.groups.find(
            (/** @type {any} */ item) => item.id === id,
          );
          if (group) return group;
        }
      return null;
    };

    /** @param {Record<string, any>} plan @param {string} id */
    const applicationOf = (plan, id) => {
      for (const floor of plan.floors)
        for (const application of floor.applications)
          if (
            application.id === id ||
            application.groups.some(
              (/** @type {any} */ group) => group.id === id,
            )
          )
            return application;
      return null;
    };

    const pointOf = (
      /** @type {{clientX: number, clientY: number}} */ event,
    ) => {
      if (!surface) throw new Error("group panel requires a surface");
      if (typeof planner.surfaceViewport?.pointOf !== "function")
        throw new Error("surface viewport is unavailable");
      return planner.surfaceViewport.pointOf(surface, event);
    };

    const surfacePart = (/** @type {string} */ part) => {
      const template = templateOf(`${part}-template`);
      return /** @type {Element | null} */ (
        template?.content.firstElementChild?.firstElementChild?.cloneNode(
          true,
        ) || null
      );
    };

    const handlePoint = (
      /** @type {Record<string, number>} */ rect,
      /** @type {string} */ handle,
    ) => {
      const right = rect.x + rect.width;
      const bottom = rect.y + rect.height;
      const middleX = rect.x + rect.width / 2;
      const middleY = rect.y + rect.height / 2;
      return {
        nw: { x: rect.x, y: rect.y },
        n: { x: middleX, y: rect.y },
        ne: { x: right, y: rect.y },
        e: { x: right, y: middleY },
        se: { x: right, y: bottom },
        s: { x: middleX, y: bottom },
        sw: { x: rect.x, y: bottom },
        w: { x: rect.x, y: middleY },
      }[handle];
    };

    /** @param {Element} rect @param {Rect} geometry */
    const showGeometry = (rect, geometry) => {
      for (const [name, value] of Object.entries({
        x: planner.geo.snap(geometry.x),
        y: planner.geo.snap(geometry.y),
        width: planner.geo.snap(geometry.width),
        height: planner.geo.snap(geometry.height),
      }))
        rect.setAttribute(name, String(value));
    };

    /** @param {Record<string, any>} plan */
    const renderSurface = (plan) => {
      if (!surface) return;
      for (const handle of surface.querySelectorAll(
        '[data-part="group-handle"]',
      ))
        handle.remove();
      for (const rect of surface.querySelectorAll(
        '[data-part="surface-group"]',
      )) {
        const group = groupOf(plan, rect.getAttribute("data-id") || "");
        if (!group?.rect) continue;
        showGeometry(rect, group.rect);
        rect.setAttribute("fill", group.color);
        rect.setAttribute("data-group-color", group.color);
        rect.setAttribute(
          "aria-label",
          `${group.name}, ${planner.geo.snap(group.rect.width)} by ${planner.geo.snap(group.rect.height)} at ${planner.geo.snap(group.rect.x)}, ${planner.geo.snap(group.rect.y)}`,
        );
        const selected =
          surface.getAttribute("data-active-kind") === "group" &&
          surface.getAttribute("data-active-entity") === group.id;
        state(rect, "selected", selected);
      }
      const selected =
        surface.getAttribute("data-active-kind") === "group"
          ? groupOf(plan, surface.getAttribute("data-active-entity") || "")
          : null;
      if (!selected?.rect) return;
      const layer = surface.querySelector('[data-part="group-layer"]');
      const template = templateOf("surface-group-handle-template");
      if (!layer || !template) return;
      for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
        const element = surfacePart("surface-group-handle");
        const point = handlePoint(selected.rect, handle);
        if (!element || !point) continue;
        element.setAttribute("data-id", selected.id);
        element.setAttribute("data-handle", handle);
        element.setAttribute(
          "aria-label",
          `${handle} resize handle for ${selected.name}`,
        );
        showGeometry(element, {
          x: point.x - 5,
          y: point.y - 5,
          width: 10,
          height: 10,
        });
        layer.append(element);
      }
    };

    /** @type {string | null} */
    let selectedGroupId = null;

    const setHistoryButtons = () => {
      for (const floor of root.querySelectorAll('[data-anchor="floor"]')) {
        const undo = floor.querySelector('[data-action="undo"]');
        const redo = floor.querySelector('[data-action="redo"]');
        if (undo)
          /** @type {HTMLButtonElement} */ (undo).disabled = !store.canUndo?.();
        if (redo)
          /** @type {HTMLButtonElement} */ (redo).disabled = !store.canRedo?.();
      }
    };

    const decorate = (/** @type {Record<string, any>} */ plan) => {
      const selected = selectedGroupId ? groupOf(plan, selectedGroupId) : null;
      if (surface && selected) {
        surface.setAttribute("data-active-kind", "group");
        surface.setAttribute("data-active-entity", selected.id);
      }
      for (const application of root.querySelectorAll(
        '[data-anchor="application"]',
      )) {
        const region = application.querySelector('[data-region="groups"]');
        const listTemplate = templateOf("group-list-template");
        const addTemplate = templateOf("group-add-template");
        if (!region || !listTemplate || !addTemplate) continue;
        let list = region.querySelector(':scope > [data-part="group-list"]');
        let add = region.querySelector(':scope > [data-part="group-add"]');
        const groups = list
          ? [...list.querySelectorAll(':scope > [data-anchor="group"]')]
          : [...region.querySelectorAll(':scope > [data-anchor="group"]')];
        if (!list || !add) {
          list = /** @type {Element | null} */ (
            listTemplate.content.firstElementChild?.cloneNode(true) || null
          );
          add = /** @type {Element | null} */ (
            addTemplate.content.firstElementChild?.cloneNode(true) || null
          );
          if (!list || !add) continue;
          if (groups.length > 0)
            list.querySelector('[data-part="group-placeholder"]')?.remove();
          list.append(...groups);
          region.replaceChildren(list, add);
        } else if (groups.length > 0) {
          list.querySelector('[data-part="group-placeholder"]')?.remove();
        }
        const applicationId = application.getAttribute("data-id") || "";
        const floor = application.closest('[data-anchor="floor"]');
        const floorId = floor?.getAttribute("data-id") || "";
        for (const group of groups) {
          const id = group.getAttribute("data-id") || "";
          const record = plan.floors
            .flatMap((/** @type {any} */ item) => item.applications)
            .flatMap((/** @type {any} */ item) => item.groups)
            .find((/** @type {any} */ item) => item.id === id);
          group.setAttribute("data-application-id", applicationId);
          group.setAttribute("data-floor-id", floorId);
          state(group, "incomplete", !record?.rect);
        }
      }
    };

    const linkView =
      surface && planner.linkView?.create
        ? planner.linkView.create({ root, surface, store })
        : null;

    const render = () => {
      if (projectDocument) refresh();
      const plan = store.read();
      decorate(plan);
      renderSurface(plan);
      linkView?.render?.();
      setHistoryButtons();
      return plan;
    };

    const select = (/** @type {string} */ id) => {
      selectedGroupId = id;
      let anchor = root.querySelector(`[data-anchor="group"][data-id="${id}"]`);
      const floor = anchor?.closest('[data-anchor="floor"]');
      const floorRadio = floor?.querySelector('[data-part="floor-radio"]');
      const floorId = floor?.getAttribute("data-id");
      if (
        floorRadio &&
        surface?.getAttribute("data-active-floor") !== floorId
      ) {
        /** @type {HTMLInputElement} */ (floorRadio).click();
        anchor = root.querySelector(`[data-anchor="group"][data-id="${id}"]`);
      }
      const radio = anchor?.querySelector('input[name="planner-selection"]');
      if (radio) /** @type {HTMLInputElement} */ (radio).click();
      if (surface) {
        surface.setAttribute("data-active-kind", "group");
        surface.setAttribute("data-active-entity", id);
        renderSurface(store.read());
      }
    };

    const commitGeometry = (
      /** @type {string} */ id,
      /** @type {Rect} */ rect,
    ) => {
      registry.dispatch({
        entity: "group",
        action: "set-rect",
        id,
        rect,
      });
      render();
    };

    /** @param {string} id @param {Rect} geometry */
    const updateHandles = (id, geometry) => {
      if (!surface) return;
      for (const handle of surface.querySelectorAll(
        '[data-part="group-handle"]',
      )) {
        if (handle.getAttribute("data-id") !== id) continue;
        const point = handlePoint(
          geometry,
          handle.getAttribute("data-handle") || "",
        );
        if (!point) continue;
        showGeometry(handle, {
          x: point.x - 5,
          y: point.y - 5,
          width: 10,
          height: 10,
        });
      }
    };

    /** @typedef {{kind: "draw", id: string, pointerId: number, start: Point} | {kind: "move" | "resize", id: string, pointerId: number, start: Point, geometry: Rect, handle?: string}} GroupGesture */
    /** @type {GroupGesture | null} */
    let gesture = null;
    let preview = /** @type {Element | null} */ (null);

    const clearPreview = () => {
      preview?.remove();
      preview = null;
      surface?.removeAttribute("data-drawing");
    };

    const showPreview = (/** @type {Rect} */ geometry) => {
      if (!surface) return;
      const layer = surface.querySelector('[data-part="group-layer"]');
      if (!layer) return;
      if (!preview) {
        preview = surfacePart("surface-group-preview");
        if (preview) layer.append(preview);
      }
      if (preview) showGeometry(preview, geometry);
      surface.setAttribute("data-drawing", "true");
    };

    const surfaceTarget = (/** @type {Event} */ event) =>
      /** @type {Element | null} */ (event.target);

    if (surface) {
      document.addEventListener(
        "pointerdown",
        (event) => {
          const pointer = /** @type {PointerEvent} */ (event);
          if (pointer.button !== 0) return;
          surface.removeAttribute("data-suppress-click");
          const target = surfaceTarget(event);
          if (!target || !surface.contains(target)) return;
          if (
            surface.hasAttribute("data-space") ||
            surface.getAttribute("data-active-kind") === "device-type"
          )
            return;
          const handle = target.closest('[data-part="group-handle"]');
          const rect = target.closest('[data-part="surface-group"]');
          if (handle) {
            const id = handle.getAttribute("data-id") || "";
            const group = groupOf(store.read(), id);
            if (!group?.rect) return;
            select(id);
            gesture = {
              kind: "resize",
              id,
              pointerId: pointer.pointerId,
              start: pointOf(pointer),
              geometry: { ...group.rect },
              handle: handle.getAttribute("data-handle") || "",
            };
          } else if (surface.getAttribute("data-active-kind") === "group") {
            const id = surface.getAttribute("data-active-entity") || "";
            if (!groupOf(store.read(), id)) return;
            gesture = {
              kind: "draw",
              id,
              pointerId: pointer.pointerId,
              start: pointOf(pointer),
            };
          } else if (rect) {
            const id = rect.getAttribute("data-id") || "";
            const group = groupOf(store.read(), id);
            if (!group?.rect) return;
            focusPointer(rect);
            select(id);
            const current = surface.querySelector(
              `[data-part="surface-group"][data-id="${id}"]`,
            );
            if (current) focusPointer(current);
            gesture = {
              kind: "move",
              id,
              pointerId: pointer.pointerId,
              start: pointOf(pointer),
              geometry: { ...group.rect },
            };
          } else return;
          surface.setPointerCapture?.(pointer.pointerId);
          pointer.preventDefault();
          pointer.stopImmediatePropagation();
        },
        true,
      );
      document.addEventListener(
        "pointermove",
        (event) => {
          const pointer = /** @type {PointerEvent} */ (event);
          if (!gesture || gesture.pointerId !== pointer.pointerId) return;
          const at = pointOf(pointer);
          let geometry;
          if (gesture.kind === "draw")
            geometry = planner.geo.normalize({
              x: gesture.start.x,
              y: gesture.start.y,
              width: at.x - gesture.start.x,
              height: at.y - gesture.start.y,
            });
          else if (gesture.kind === "move")
            geometry = planner.geo.translate(gesture.geometry, {
              x: at.x - gesture.start.x,
              y: at.y - gesture.start.y,
            });
          else
            geometry = planner.geo.resize(gesture.geometry, gesture.handle, {
              x: at.x - gesture.start.x,
              y: at.y - gesture.start.y,
            });
          if (gesture.kind === "draw") showPreview(geometry);
          else {
            const rect = surface.querySelector(
              `[data-part="surface-group"][data-id="${gesture.id}"]`,
            );
            if (rect) showGeometry(rect, geometry);
            updateHandles(gesture.id, geometry);
          }
          pointer.preventDefault();
          pointer.stopImmediatePropagation();
        },
        true,
      );
      document.addEventListener(
        "pointerup",
        (event) => {
          const pointer = /** @type {PointerEvent} */ (event);
          if (!gesture || gesture.pointerId !== pointer.pointerId) return;
          const current = gesture;
          const at = pointOf(pointer);
          const geometry =
            current.kind === "draw"
              ? planner.geo.normalize({
                  x: current.start.x,
                  y: current.start.y,
                  width: at.x - current.start.x,
                  height: at.y - current.start.y,
                })
              : current.kind === "move"
                ? planner.geo.translate(current.geometry, {
                    x: at.x - current.start.x,
                    y: at.y - current.start.y,
                  })
                : planner.geo.resize(current.geometry, current.handle, {
                    x: at.x - current.start.x,
                    y: at.y - current.start.y,
                  });
          const distance = Math.hypot(
            at.x - current.start.x,
            at.y - current.start.y,
          );
          if (current.kind === "draw" && distance > DRAW_THRESHOLD)
            surface.setAttribute("data-suppress-click", "true");
          gesture = null;
          clearPreview();
          if (surface.hasPointerCapture?.(pointer.pointerId))
            surface.releasePointerCapture(pointer.pointerId);
          if (
            geometry.width >= 1 &&
            geometry.height >= 1 &&
            (current.kind !== "move" || distance >= 10) &&
            (current.kind !== "draw" || distance > DRAW_THRESHOLD)
          )
            commitGeometry(current.id, geometry);
          else renderSurface(store.read());
          pointer.preventDefault();
          pointer.stopImmediatePropagation();
        },
        true,
      );
      document.addEventListener(
        "pointercancel",
        (event) => {
          const pointer = /** @type {PointerEvent} */ (event);
          if (!gesture || gesture.pointerId !== pointer.pointerId) return;
          gesture = null;
          clearPreview();
          renderSurface(store.read());
          pointer.stopImmediatePropagation();
        },
        true,
      );
    }

    /** @type {string | null} */
    let draggedGroupId = null;
    const clearDropState = () => {
      for (const element of root.querySelectorAll("[data-drop]"))
        element.removeAttribute("data-drop");
    };

    const dropOf = (/** @type {DragEvent} */ event) => {
      if (!draggedGroupId) return null;
      const plan = store.read();
      const source = applicationOf(plan, draggedGroupId);
      const target = /** @type {Element | null} */ (event.target);
      const targetGroup = target?.closest?.('[data-anchor="group"]');
      const targetApplication = targetGroup
        ? applicationOf(plan, targetGroup.getAttribute("data-id") || "")
        : target?.closest?.('[data-anchor="application"]');
      const targetId = targetGroup
        ? targetApplication?.id
        : targetApplication?.getAttribute("data-id");
      const targetRecord = targetId ? applicationOf(plan, targetId) : null;
      if (
        !source ||
        !targetRecord ||
        planner.floors.floorOf(plan, source.id) !==
          planner.floors.floorOf(plan, targetRecord.id)
      )
        return null;
      if (!targetGroup && source.id === targetRecord.id) return null;
      if (targetGroup && targetGroup.getAttribute("data-id") === draggedGroupId)
        return null;
      let index = targetRecord.groups.length;
      if (targetGroup) {
        const targetIndex = targetRecord.groups.findIndex(
          (/** @type {any} */ group) =>
            group.id === targetGroup.getAttribute("data-id"),
        );
        if (targetIndex < 0) return null;
        const box = targetGroup.getBoundingClientRect();
        const before = event.clientY < box.top + box.height / 2;
        index = targetIndex + (before ? 0 : 1);
        const sourceIndex = source.groups.findIndex(
          (/** @type {any} */ group) => group.id === draggedGroupId,
        );
        if (source.id === targetRecord.id && sourceIndex < index) index -= 1;
      }
      return {
        applicationId: targetRecord.id,
        index,
        target: targetGroup || targetApplication,
      };
    };

    document.addEventListener(
      "dragstart",
      (event) => {
        const target = /** @type {Element | null} */ (event.target);
        const row = target?.closest?.('[data-anchor="group"]');
        if (!row || !root.contains(row)) return;
        draggedGroupId = row.getAttribute("data-id");
        event.dataTransfer?.setData(
          "application/x-planner-group",
          draggedGroupId || "",
        );
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      },
      true,
    );
    document.addEventListener(
      "dragover",
      (event) => {
        const drop = dropOf(event);
        clearDropState();
        if (!drop) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        drop.target?.setAttribute("data-drop", "true");
      },
      true,
    );
    document.addEventListener(
      "drop",
      (event) => {
        const drop = dropOf(event);
        clearDropState();
        if (!drop) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const id = draggedGroupId;
        if (!id) return;
        registry.dispatch({
          entity: "group",
          action: "reorder",
          id,
          targetApplicationId: drop.applicationId,
          index: drop.index,
        });
        render();
      },
      true,
    );
    document.addEventListener(
      "dragend",
      () => {
        draggedGroupId = null;
        clearDropState();
      },
      true,
    );

    /** @type {string | null} */
    let keyboardGroupId = null;
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          !event.altKey ||
          (event.key !== "ArrowUp" && event.key !== "ArrowDown")
        )
          return;
        const target = /** @type {Element | null} */ (event.target);
        const focusedRow = target?.closest?.('[data-anchor="group"]');
        const row = focusedRow?.querySelector('[data-part="selection-catcher"]')
          ? focusedRow
          : keyboardGroupId
            ? root.querySelector(
                `[data-anchor="group"][data-id="${keyboardGroupId}"]`,
              )
            : null;
        if (!row) return;
        const id = row.getAttribute("data-id") || "";
        const plan = store.read();
        const application = applicationOf(plan, id);
        const index =
          application?.groups.findIndex(
            (/** @type {any} */ group) => group.id === id,
          ) ?? -1;
        const nextIndex = index + (event.key === "ArrowDown" ? 1 : -1);
        if (
          !application ||
          index < 0 ||
          nextIndex < 0 ||
          nextIndex >= application.groups.length
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        keyboardGroupId = id;
        registry.dispatch({
          entity: "group",
          action: "reorder",
          id,
          targetApplicationId: application.id,
          index: nextIndex,
        });
        render();
        const catcher = /** @type {HTMLElement | null} */ (
          root.querySelector(
            `[data-anchor="group"][data-id="${id}"] [data-part="selection-catcher"]`,
          )
        );
        catcher?.focus();
      },
      true,
    );

    document.addEventListener(
      "input",
      (event) => {
        const target = /** @type {HTMLInputElement | null} */ (event.target);
        const group = target?.closest?.('[data-anchor="group"]');
        const action = target?.getAttribute("data-act");
        const id = group?.getAttribute("data-id");
        if (!group || !id || (action !== "rename" && action !== "recolor"))
          return;
        event.stopImmediatePropagation();
        const tag = `${action}:${id}`;
        const result = registry.dispatch({
          entity: "group",
          action,
          id,
          value: target?.value || "",
          coalesce: tag,
        });
        const record = groupOf(result, id);
        if (record) planner.dom.render(group, "group", record);
        renderSurface(result);
        setHistoryButtons();
      },
      true,
    );

    document.addEventListener(
      "click",
      (event) => {
        const target = /** @type {Element | null} */ (event.target);
        const deleteButton = target?.closest?.('[data-part="group-delete"]');
        const group = deleteButton?.closest?.('[data-anchor="group"]');
        const groupId = group?.getAttribute("data-id");
        if (deleteButton && group && groupId) {
          event.preventDefault();
          event.stopImmediatePropagation();
          registry.dispatch({
            entity: "group",
            action: "delete",
            id: groupId,
          });
          if (selectedGroupId === groupId) {
            const radio = /** @type {HTMLInputElement | null} */ (
              group.querySelector('input[name="planner-selection"]')
            );
            if (radio) {
              radio.checked = false;
              radio.removeAttribute("checked");
            }
            selectedGroupId = null;
            surface?.removeAttribute("data-active-kind");
            surface?.removeAttribute("data-active-entity");
          }
          render();
          return;
        }
        if (target?.closest?.('[data-action="undo"], [data-action="redo"]'))
          return;
      },
      true,
    );

    root.addEventListener("click", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const button = target?.closest?.('[data-part="group-add"]');
      const application = button?.closest?.('[data-anchor="application"]');
      const id = application?.getAttribute("data-id");
      if (!button || !id) return;
      event.preventDefault();
      const before = store.read();
      const result = registry.dispatch({
        entity: "application",
        action: "add-group",
        id,
      });
      if (JSON.stringify(before) === JSON.stringify(result)) return;
      render();
      const added = result.floors
        .flatMap((/** @type {any} */ floor) => floor.applications)
        .find((/** @type {any} */ item) => item.id === id)
        ?.groups.at(-1);
      if (added) select(added.id);
    });

    root.addEventListener("change", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (!target?.matches('input[name="planner-selection"]')) return;
      const anchor = target.closest('[data-anchor="group"]');
      selectedGroupId = anchor?.getAttribute("data-id") || null;
      renderSurface(store.read());
    });

    const observer = new MutationObserver(() => {
      const plan = store.read();
      decorate(plan);
      renderSurface(plan);
      linkView?.render?.();
      setHistoryButtons();
    });
    observer.observe(root, { childList: true, subtree: true });

    const unsubscribe = store.subscribe?.(() => render());
    render();
    return Object.freeze({
      render,
      read: store.read,
      disconnect: () => unsubscribe?.(),
    });
  };

  planner.groupPanel = Object.freeze({ create });
}
