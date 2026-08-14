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
      for (const floor of root.querySelectorAll('[data-anchor="floor"]')) {
        const region = floor.querySelector('[data-region="applications"]');
        const applications = floor.querySelectorAll(
          '[data-anchor="application"]',
        );
        for (const application of applications) {
          const id = application.getAttribute("data-id");
          if (!id) continue;
          const remove = /** @type {HTMLButtonElement | null} */ (
            application.querySelector('[data-part="application-delete"]')
          );
          if (remove) {
            remove.disabled = applications.length < 2;
            remove.title =
              applications.length < 2
                ? "A floor keeps at least one application"
                : `Delete ${application.querySelector('[data-slot="name"][data-slot-as="text"]')?.textContent || "application"}`;
          }
          const rename = /** @type {HTMLInputElement | null} */ (
            application.querySelector('[data-part="application-name"]')
          );
          if (rename)
            rename.setAttribute(
              "aria-label",
              `Rename ${application.querySelector('[data-slot="name"][data-slot-as="text"]')?.textContent || "application"}`,
            );
        }
        if (addTemplate && region) {
          const add = addTemplate.content.firstElementChild?.cloneNode(true);
          if (add) region.append(add);
        }
      }
      for (const floor of root.querySelectorAll('[data-anchor="floor"]')) {
        const undo = floor.querySelector('[data-action="undo"]');
        const redo = floor.querySelector('[data-action="redo"]');
        if (undo) undo.toggleAttribute("disabled", !store.canUndo?.());
        if (redo) redo.toggleAttribute("disabled", !store.canRedo?.());
      }
    };

    root.addEventListener("click", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const application = target?.closest?.('[data-anchor="application"]');
      const floor = target?.closest?.('[data-anchor="floor"]');
      const command = target?.closest?.("[data-act]")?.getAttribute("data-act");
      if (command === "delete" && application && floor) {
        event.preventDefault();
        const id = application.getAttribute("data-id");
        const floorId = floor.getAttribute("data-id");
        if (id && floorId) {
          registry.dispatch({
            entity: "application",
            action: "delete",
            id,
            floorId,
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
      if (action === "add-floor" || (action === "delete" && !application)) {
        render();
        return;
      }
      if (action !== "add-application") return;
      event.preventDefault();
      const id = floor?.getAttribute("data-id");
      if (id) {
        registry.dispatch({ entity: "floor", action, id });
        render();
      }
    });

    root.addEventListener("input", (event) => {
      const target = /** @type {HTMLInputElement | null} */ (event.target);
      const application = target?.closest?.('[data-anchor="application"]');
      const floor = target?.closest?.('[data-anchor="floor"]');
      if (!target?.matches('[data-act="rename"]') || !application || !floor)
        return;
      const id = application.getAttribute("data-id");
      const floorId = floor.getAttribute("data-id");
      if (!id || !floorId) return;
      registry.dispatch({
        entity: "application",
        action: "rename",
        id,
        floorId,
        value: target.value,
        coalesce: `rename:${id}`,
      });
      const label = application.querySelector(
        '[data-slot="name"][data-slot-as="text"]',
      );
      if (label)
        label.textContent = target.value.trim() || "Untitled application";
    });

    root.addEventListener(
      "change",
      (event) => {
        const target = /** @type {HTMLInputElement | null} */ (event.target);
        if (
          target?.matches('[data-act="rename"]') &&
          target.closest('[data-anchor="application"]')
        )
          event.stopPropagation();
      },
      true,
    );

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
