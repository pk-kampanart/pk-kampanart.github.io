/**
 * Owns tree row reordering and its same-floor drop announcements.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {TreeReorderOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.store?.read !== "function" ||
      typeof options.dispatch !== "function" ||
      typeof options.anchorOf !== "function" ||
      typeof options.announce !== "function"
    )
      throw new TypeError(
        "tree reorder requires root, store, dispatch, anchorOf, and announce",
      );
    const { root, store, dispatch, anchorOf, announce } = options;

    const reorderTo = (
      /** @type {Element} */ source,
      /** @type {Element} */ target,
      /** @type {"before" | "after"} */ where,
    ) => {
      const kind = source.getAttribute("data-anchor");
      const id = source.getAttribute("data-id");
      const targetId = target.getAttribute("data-id");
      const section = target.matches('[data-part="tree-section"]');
      const targetKind = section
        ? target.getAttribute("data-section-kind")
        : target.getAttribute("data-anchor");
      const sourceApplication = source.closest('[data-anchor="application"]');
      const targetApplication = target.closest('[data-anchor="application"]');
      const sourceApplicationId = sourceApplication?.getAttribute("data-id");
      const targetApplicationId = targetApplication?.getAttribute("data-id");
      if (
        !kind ||
        !id ||
        !targetKind ||
        kind !== targetKind ||
        !sourceApplicationId ||
        !targetApplicationId ||
        (!section && !targetId)
      )
        return false;
      if (!section && targetId === id) return false;
      const plan = store.read();
      if (
        planner.floors.floorOf(plan, sourceApplicationId) !==
        planner.floors.floorOf(plan, targetApplicationId)
      ) {
        announce(
          `Drop refused: ${kind === "deviceType" ? "Device types" : "Groups"} must stay on the same floor.`,
        );
        return true;
      }
      const collection =
        kind === "group"
          ? targetApplication?.querySelectorAll('[data-anchor="group"]')
          : targetApplication?.querySelectorAll('[data-anchor="deviceType"]');
      if (!collection) return false;
      const targetIndex = targetId
        ? [...collection].findIndex(
            (item) => item.getAttribute("data-id") === targetId,
          )
        : -1;
      if (!section && targetIndex < 0) return false;
      const index = section
        ? collection.length
        : targetIndex + (where === "after" ? 1 : 0);
      if (kind === "group") {
        dispatch({
          entity: "group",
          action: "reorder",
          id,
          targetApplicationId,
          index,
        });
      } else if (kind === "deviceType") {
        if (!section && sourceApplicationId === targetApplicationId)
          dispatch({
            entity: "deviceType",
            action: "reorder",
            id,
            targetId,
            where,
          });
        else
          dispatch({
            entity: "deviceType",
            action: "move",
            id,
            targetApplicationId,
            index,
          });
      } else return false;
      return true;
    };

    /** @type {{kind: string, id: string} | null} */
    let dragged = null;
    const onDragStart = (/** @type {DragEvent} */ event) => {
      const anchor = /** @type {Element | null} */ (event.target)?.closest?.(
        '[data-anchor="group"], [data-anchor="deviceType"]',
      );
      const kind = anchor?.getAttribute("data-anchor");
      const id = anchor?.getAttribute("data-id");
      if (!kind || !id) return;
      dragged = { kind, id };
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
      }
    };
    const onDragOver = (/** @type {DragEvent} */ event) => {
      const target = /** @type {Element | null} */ (event.target)?.closest?.(
        '[data-anchor="group"], [data-anchor="deviceType"], [data-part="tree-section"]',
      );
      const targetKind = target?.matches('[data-part="tree-section"]')
        ? target.getAttribute("data-section-kind")
        : target?.getAttribute("data-anchor");
      if (
        !dragged ||
        !target ||
        targetKind !== dragged.kind ||
        target.getAttribute("data-id") === dragged.id
      )
        return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      for (const element of root.querySelectorAll("[data-drop]"))
        element.removeAttribute("data-drop");
      target.setAttribute("data-drop", "true");
    };
    const onDrop = (/** @type {DragEvent} */ event) => {
      const target = /** @type {Element | null} */ (event.target)?.closest?.(
        '[data-anchor="group"], [data-anchor="deviceType"], [data-part="tree-section"]',
      );
      const targetKind = target?.matches('[data-part="tree-section"]')
        ? target.getAttribute("data-section-kind")
        : target?.getAttribute("data-anchor");
      if (
        !dragged ||
        !target ||
        targetKind !== dragged.kind ||
        target.getAttribute("data-id") === dragged.id
      )
        return;
      const source = anchorOf(dragged.kind, dragged.id);
      if (!source) return;
      event.preventDefault();
      const box = target.getBoundingClientRect();
      reorderTo(
        source,
        target,
        event.clientY < box.top + box.height / 2 ? "before" : "after",
      );
      for (const element of root.querySelectorAll("[data-drop]"))
        element.removeAttribute("data-drop");
      dragged = null;
    };
    const onDragEnd = () => {
      dragged = null;
      for (const element of root.querySelectorAll("[data-drop]"))
        element.removeAttribute("data-drop");
    };
    root.addEventListener("dragstart", onDragStart);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("drop", onDrop);
    root.addEventListener("dragend", onDragEnd);

    return Object.freeze({
      reorderTo,
      disconnect: () => {
        root.removeEventListener("dragstart", onDragStart);
        root.removeEventListener("dragover", onDragOver);
        root.removeEventListener("drop", onDrop);
        root.removeEventListener("dragend", onDragEnd);
      },
    });
  };

  planner.treeReorder = Object.freeze({ create });
}
