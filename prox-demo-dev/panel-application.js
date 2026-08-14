/**
 * Mounts application rows and owns their commands.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {ApplicationPanelOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.store?.read !== "function" ||
      typeof options.store?.replace !== "function"
    )
      throw new TypeError(
        "application panel requires root, store, and registry",
      );

    const { root, store, registry } = options;
    const projectDocument = options.projectDocument !== false;
    if (typeof registry?.dispatch !== "function")
      throw new TypeError("application panel requires a command registry");
    const refresh = options.refresh || (() => planner.dom.project(root, store));

    const addTemplate = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="application-add-template"]')
    );

    const render = () => {
      if (projectDocument) refresh();
      for (const area of root.querySelectorAll('[data-anchor="area"]')) {
        const region = area.querySelector('[data-region="applications"]');
        const applications = area.querySelectorAll(
          '[data-anchor="application"]',
        );
        for (const application of applications) {
          const id = application.getAttribute("data-id");
          if (!id) continue;
          const remove = /** @type {HTMLButtonElement | null} */ (
            application.querySelector('[data-part="application-delete"]')
          );
          if (remove)
            remove.title = `Delete ${application.querySelector('[data-slot="name"][data-slot-as="text"]')?.textContent || "application"}`;
        }
        if (addTemplate && region) {
          const add = addTemplate.content.firstElementChild?.cloneNode(true);
          if (add) region.append(add);
        }
      }
      for (const area of root.querySelectorAll('[data-anchor="area"]')) {
        const undo = area.querySelector('[data-action="undo"]');
        const redo = area.querySelector('[data-action="redo"]');
        if (undo) undo.toggleAttribute("disabled", !store.canUndo?.());
        if (redo) redo.toggleAttribute("disabled", !store.canRedo?.());
      }
    };

    root.addEventListener("click", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const application = target?.closest?.('[data-anchor="application"]');
      const area = target?.closest?.('[data-anchor="area"]');
      const command = target?.closest?.("[data-act]")?.getAttribute("data-act");
      if (command === "delete" && application && area) {
        event.preventDefault();
        const id = application.getAttribute("data-id");
        const areaId = area.getAttribute("data-id");
        if (id && areaId) {
          registry.dispatch({
            entity: "application",
            action: "delete",
            id,
            areaId,
          });
          render();
        }
        return;
      }
      const action = target
        ?.closest?.("[data-action]")
        ?.getAttribute("data-action");
      if (action === "undo" || action === "redo") {
        return;
      }
      if (action === "add-area" || (action === "delete" && !application)) {
        render();
        return;
      }
      if (action !== "add-application") return;
      event.preventDefault();
      const id = area?.getAttribute("data-id");
      if (id) {
        registry.dispatch({ entity: "area", action, id });
        render();
      }
    });

    const unsubscribe = store.subscribe?.(() => render());
    render();
    return Object.freeze({
      render,
      read: store.read,
      disconnect: () => {
        unsubscribe?.();
      },
    });
  };

  planner.applicationPanel = Object.freeze({ create });
}
