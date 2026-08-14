/**
 * Owns the planner shell toolbar and its shell actions.
 * Channels: none.
 */
{
  /** @typedef {{store: any, openProject: (opener?: Element) => unknown, openShortcuts: (opener?: Element) => unknown, openExport?: (opener?: Element) => unknown, openImport?: (opener?: Element) => unknown, history?: (direction: "undo" | "redo") => unknown}} ToolbarOptions */
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {ToolbarOptions} options */
  const create = (options) => {
    if (
      !options?.store ||
      typeof options.store.read !== "function" ||
      typeof options.store.save !== "function" ||
      typeof options.store.undo !== "function" ||
      typeof options.store.redo !== "function" ||
      typeof options.openProject !== "function" ||
      typeof options.openShortcuts !== "function"
    )
      throw new TypeError("toolbar requires store and dialog openers");

    const toolbar = document.querySelector('[data-part="toolbar"]');
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="tree-toolbar-template"]')
    );
    const controls = /** @type {Element | null} */ (
      template?.content.firstElementChild?.cloneNode(true) || null
    );
    if (!toolbar || !controls) throw new Error("toolbar template is missing");

    const undo = controls.querySelector('[data-part="toolbar-undo"]');
    const redo = controls.querySelector('[data-part="toolbar-redo"]');
    const refresh = () => {
      undo?.toggleAttribute("disabled", !options.store.canUndo?.());
      redo?.toggleAttribute("disabled", !options.store.canRedo?.());
    };
    const click = (/** @type {Event} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      const button = target?.closest?.("button");
      const part = button?.getAttribute("data-part");
      if (!button || !part) return;
      event.preventDefault();
      if (part === "toolbar-open") options.openProject(button);
      else if (part === "toolbar-save")
        void Promise.resolve(options.store.save()).catch(() => {});
      else if (part === "toolbar-export") options.openExport?.(button);
      else if (part === "toolbar-import") options.openImport?.(button);
      else if (part === "toolbar-shortcuts") options.openShortcuts(button);
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
