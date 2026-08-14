/**
 * Mounts application rows and owns application commands at the floor scope.
 * Channels: listens planner:selection-changed.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {ApplicationPanelOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.store?.read !== "function" ||
      typeof options.store?.replace !== "function"
    )
      throw new TypeError("application panel requires root, store, and registry");

    const { root, store, registry } = options;
    const projectDocument = options.projectDocument !== false;
    if (typeof registry?.dispatch !== "function")
      throw new TypeError("application panel requires a command registry");
    const refresh = options.refresh || (() => planner.dom.project(root, store));

    /** @type {string | null} */
    let selectedApplicationId = null;

    const addTemplate = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="application-add-template"]')
    );

    const reflectApplicationStatus = (
      /** @type {Record<string, any>} */ plan,
      /** @type {string | null} */ id,
    ) => {
      const application = id
        ? planner.applications.applicationOf(plan, id)
        : null;
      const name = document.querySelector(
        '[data-part="status-application-name"]',
      );
      if (name) name.textContent = application?.name || "—";
      if (application) {
        const count = document.querySelector(
          '[data-part="status-device-count"]',
        );
        if (count)
          count.textContent = String(
            planner.applications.deviceCount(plan, application.id),
          );
        const mode = document.querySelector('[data-part="status-mode-value"]');
        if (mode && id === application.id) mode.textContent = "Application";
      }
    };

    const render = () => {
      if (projectDocument) refresh();
      const plan = store.read();
      for (const floor of root.querySelectorAll('[data-anchor="floor"]')) {
        const region = floor.querySelector('[data-region="applications"]');
        const applications = floor.querySelectorAll(
          '[data-anchor="application"]',
        );
        for (const application of applications) {
          const id = application.getAttribute("data-id");
          if (!id) continue;
          const radio = /** @type {HTMLInputElement | null} */ (
            application.querySelector('[data-part="application-radio"]')
          );
          if (radio) {
            radio.setAttribute("value", id || "");
            radio.value = id || "";
            radio.toggleAttribute("checked", id === selectedApplicationId);
            radio.checked = id === selectedApplicationId;
            const name =
              application.querySelector(
                '[data-slot="name"][data-slot-as="text"]',
              )?.textContent || "Untitled application";
            radio.title = `Select ${name}`;
            radio.setAttribute(
              "aria-label",
              `Select ${name}, ${planner.applications.groupCount(plan, id)} groups, ${planner.applications.deviceCount(plan, id)} devices`,
            );
          }
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
      const selected = selectedApplicationId
        ? root.querySelector(
            `[data-anchor="application"][data-id="${selectedApplicationId}"]`,
          )
        : null;
      if (!selected) selectedApplicationId = null;
      reflectApplicationStatus(plan, selectedApplicationId);
    };

    root.addEventListener(
      "click",
      (event) => {
        const target = /** @type {Element | null} */ (event.target);
        const application = target?.closest?.('[data-anchor="application"]');
        const select = /** @type {HTMLInputElement | null} */ (
          application?.querySelector('[data-part="application-radio"]')
        );
        if (
          application &&
          target?.closest?.('[data-part="application-select"]') &&
          select
        ) {
          selectedApplicationId = application.getAttribute("data-id");
          select.checked = true;
          event.preventDefault();
        }
      },
      true,
    );

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
          if (selectedApplicationId === id) selectedApplicationId = null;
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
      if (target?.closest?.('[data-part="floor-select"]')) {
        selectedApplicationId = null;
        render();
        return;
      }
      if (
        target?.closest?.(
          '[data-anchor="application"] [data-part="application-select"]',
        )
      ) {
        render();
        return;
      }
      const anchor = target?.closest?.("[data-anchor]");
      const anchorId = anchor?.getAttribute("data-id");
      const anchorKind = anchor?.getAttribute("data-anchor");
      if (
        anchorId &&
        anchorKind &&
        anchorKind !== "floor" &&
        anchorKind !== "application"
      ) {
        selectedApplicationId = null;
        reflectApplicationStatus(store.read(), anchorId);
        return;
      }
      if (action !== "add-application") return;
      event.preventDefault();
      const id = floor?.getAttribute("data-id");
      if (id) {
        const result = registry.dispatch({ entity: "floor", action, id });
        const addedFloor = result.floors.find(
          (/** @type {any} */ item) => item.id === id,
        );
        selectedApplicationId = addedFloor?.applications.at(-1)?.id || null;
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
      const status = document.querySelector(
        '[data-part="status-application-name"]',
      );
      if (status && selectedApplicationId === id)
        status.textContent = label?.textContent || "—";
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

    const selectionChanged = (/** @type {Event} */ event) => {
      const detail =
        /** @type {CustomEvent<{kind?: string, id?: string}>} */ (event)
          .detail || {};
      selectedApplicationId =
        detail.kind === "application" ? detail.id || null : null;
      reflectApplicationStatus(store.read(), detail.id || null);
    };
    document.addEventListener("planner:selection-changed", selectionChanged);

    root.addEventListener("change", (event) => {
      const target = /** @type {HTMLInputElement | null} */ (event.target);
      const application = target?.closest?.('[data-anchor="application"]');
      if (
        !target?.matches('[data-part="application-radio"]') ||
        !target.checked ||
        !application
      )
        return;
      selectedApplicationId = application.getAttribute("data-id");
      render();
    });

    const unsubscribe = store.subscribe?.(() => render());
    render();
    return Object.freeze({
      render,
      read: store.read,
      disconnect: () => {
        unsubscribe?.();
        document.removeEventListener(
          "planner:selection-changed",
          selectionChanged,
        );
      },
    });
  };

  planner.applicationPanel = Object.freeze({ create });
}
