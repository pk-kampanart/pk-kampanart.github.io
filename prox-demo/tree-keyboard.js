/**
 * Owns keyboard interaction for the workflow tree and work surface.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {TreeKeyboardOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.registry?.dispatch !== "function" ||
      typeof options.readSelection !== "function" ||
      typeof options.clearSelection !== "function" ||
      typeof options.reflectSelection !== "function" ||
      typeof options.announceSelection !== "function" ||
      typeof options.select !== "function" ||
      typeof options.reorder?.reorderTo !== "function" ||
      typeof options.rename?.startRename !== "function" ||
      typeof options.render !== "function"
    )
      throw new TypeError("tree keyboard requires its tree wiring");
    const {
      root,
      surface,
      registry,
      readSelection,
      clearSelection,
      reflectSelection,
      announceSelection,
      select,
      reorder,
      rename,
      render,
    } = options;

    const onRootKeyDown = (/** @type {KeyboardEvent} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      const branch = target?.closest?.("summary")?.closest("details");
      if (
        branch &&
        !target?.matches('[data-part="tree-name-input"]') &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        if (event.key === "ArrowRight") branch.open = true;
        else if (branch.open) branch.open = false;
        else {
          const parent = branch.parentElement?.closest("details");
          /** @type {HTMLElement | null} */ (
            parent?.querySelector(':scope > [data-part="tree-line"]')
          )?.focus();
        }
        event.preventDefault();
        return;
      }
      if (
        event.key === "Escape" &&
        root.querySelector('[data-part="tree-opacity-popover"]:popover-open')
      )
        return;
      if (
        event.key === "Escape" &&
        !target?.matches('[data-part="tree-name-input"]')
      ) {
        if (readSelection()) {
          clearSelection();
          reflectSelection();
          announceSelection();
        }
        event.preventDefault();
        return;
      }
      const row = target?.closest?.(
        '[data-part="tree-row"], [data-part="tree-project-name"]',
      );
      if (
        row &&
        event.altKey &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        const anchor = row.closest("[data-anchor]");
        if (!anchor) return;
        const kind = anchor?.getAttribute("data-anchor");
        const id = anchor?.getAttribute("data-id");
        const application = anchor?.closest('[data-anchor="application"]');
        const siblings =
          kind && application
            ? [...application.querySelectorAll(`[data-anchor="${kind}"]`)]
            : [];
        const index = id
          ? siblings.findIndex((item) => item.getAttribute("data-id") === id)
          : -1;
        const delta =
          event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
        const targetIndex = index + delta;
        if (
          id &&
          application &&
          (kind === "group" || kind === "deviceType") &&
          siblings[targetIndex]
        ) {
          if (
            reorder.reorderTo(
              anchor,
              siblings[targetIndex],
              delta > 0 ? "after" : "before",
            )
          )
            event.preventDefault();
        }
        return;
      }
      if (row && event.key === "F2") {
        const anchor = row.closest("[data-anchor]");
        if (rename.startRename(anchor)) event.preventDefault();
        return;
      }
      if (!row || (event.key !== "Enter" && event.key !== " ")) return;
      const anchor = row.closest("[data-anchor]");
      const anchorKind = anchor?.getAttribute("data-anchor") || "";
      const kind =
        anchorKind === "deviceType"
          ? "device-type"
          : anchorKind === "deviceInstance"
            ? "device"
            : anchorKind;
      const id = anchor?.getAttribute("data-id");
      if (!kind || !id) return;
      if (kind === "project") return;
      event.preventDefault();
      select(kind, id);
    };

    const onSurfaceKeyDown = (/** @type {KeyboardEvent} */ event) => {
      if (!surface) return;
      const target = /** @type {Element | null} */ (event.target);
      const shape = target?.closest?.(
        '[data-part="surface-group"], [data-part="surface-device"]',
      );
      const kind = shape?.getAttribute("data-kind");
      const id = shape?.getAttribute("data-id");
      if (!shape || !kind || !id) {
        if (event.key === "Escape" && !surface.hasAttribute("data-anchor-x")) {
          event.preventDefault();
          if (readSelection()) {
            clearSelection();
            reflectSelection();
            announceSelection();
          }
        }
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(kind, id);
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        kind === "device"
      ) {
        event.preventDefault();
        registry.dispatch({
          entity: "deviceInstance",
          action: "delete",
          id,
        });
        clearSelection();
        render();
      } else if (
        event.key === "Escape" &&
        !surface.hasAttribute("data-anchor-x")
      ) {
        event.preventDefault();
        if (readSelection()) {
          clearSelection();
          reflectSelection();
          announceSelection();
        }
      }
    };
    root.addEventListener("keydown", onRootKeyDown);
    surface?.addEventListener("keydown", onSurfaceKeyDown);

    return Object.freeze({
      disconnect: () => {
        root.removeEventListener("keydown", onRootKeyDown);
        surface?.removeEventListener("keydown", onSurfaceKeyDown);
      },
    });
  };

  planner.treeKeyboard = Object.freeze({ create });
}
