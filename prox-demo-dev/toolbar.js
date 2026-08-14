/**
 * Owns the planner header: its brand, undo and redo, zoom, Settings and the
 * shortcut list. Project actions live in the project menu, and the Mesh pane
 * opens from its own arrow, rail and M, not from here; zoom itself is the
 * viewport's.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {ToolbarOptions} options */
  const create = (options) => {
    if (
      !options?.store ||
      typeof options.store.undo !== "function" ||
      typeof options.store.redo !== "function" ||
      typeof options.openShortcuts !== "function"
    )
      throw new TypeError("toolbar requires store and the shortcut opener");

    const toolbar = document.querySelector('[data-part="toolbar"]');
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="tree-toolbar-template"]')
    );
    const controls = /** @type {Element | null} */ (
      template?.content.firstElementChild?.cloneNode(true) || null
    );
    if (!toolbar || !controls) throw new Error("toolbar template is missing");
    const logo = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="brand-logo-template"]')
    )?.content.firstElementChild?.cloneNode(true);
    if (logo)
      controls.querySelector('[data-part="toolbar-brand"]')?.append(logo);

    const undo = controls.querySelector('[data-part="toolbar-undo"]');
    const redo = controls.querySelector('[data-part="toolbar-redo"]');
    const refresh = () => {
      undo?.toggleAttribute("disabled", !options.store.canUndo?.());
      redo?.toggleAttribute("disabled", !options.store.canRedo?.());
    };
    const click = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const button = target?.closest?.("button");
      const part = button?.getAttribute("data-part");
      if (!button || !part) return;
      event.preventDefault();
      // Zoom runs the commands + - and 0 run, so its code lives in one place.
      if (part === "toolbar-zoom-in")
        options.dispatch?.({ command: "zoom-in" });
      else if (part === "toolbar-zoom-out")
        options.dispatch?.({ command: "zoom-out" });
      else if (part === "toolbar-zoom-reset")
        options.dispatch?.({ command: "reset-zoom" });
      else if (part === "toolbar-shortcuts") options.openShortcuts(button);
      else if (part === "toolbar-settings") options.openSettings?.(button);
      else if (part === "toolbar-undo") {
        if (options.history) options.history("undo");
        else options.store.undo();
      } else if (part === "toolbar-redo") {
        if (options.history) options.history("redo");
        else options.store.redo();
      }
    };

    toolbar.append(controls);
    controls.addEventListener("click", click);
    const unsubscribe = options.store.subscribe?.(refresh);
    refresh();
    return Object.freeze({
      disconnect: () => {
        controls.removeEventListener("click", click);
        unsubscribe?.();
      },
    });
  };

  planner.toolbar = Object.freeze({ create });
}
