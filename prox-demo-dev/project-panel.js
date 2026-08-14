/**
 * Owns the native project dialog.
 * Channels: none; project lifecycle calls the storage rails directly.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {ProjectPanelOptions} options */
  const create = (options) => {
    if (
      typeof options.store?.read !== "function" ||
      typeof options.store?.restore !== "function" ||
      typeof options.rails?.open !== "function" ||
      typeof options.rails?.createProject !== "function" ||
      typeof options.rails?.importProject !== "function"
    )
      throw new TypeError("project panel requires store and rails");

    const dialogTemplate = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="project-dialog-template"]')
    );
    const itemTemplate = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="project-item-template"]')
    );
    const exchangeTemplate = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="project-exchange-dialog-template"]')
    );
    const dialog = /** @type {HTMLDialogElement | null} */ (
      dialogTemplate?.content.firstElementChild?.cloneNode(true)
    );
    const exchange = /** @type {HTMLDialogElement | null} */ (
      exchangeTemplate?.content.firstElementChild?.cloneNode(true)
    );
    if (!dialog || !itemTemplate || !exchange)
      throw new Error("project templates are missing");

    document.body.append(dialog);
    document.body.append(exchange);

    const closeDialog = () => {
      if (dialog.open) dialog.close();
    };
    const list = dialog.querySelector('[data-part="project-list"]');
    const empty = dialog.querySelector('[data-part="project-empty"]');
    const form = dialog.querySelector('[data-part="project-form"]');
    const nameInput = /** @type {HTMLInputElement | null} */ (
      dialog.querySelector('[data-part="project-name"]')
    );
    if (!list || !form || !nameInput)
      throw new Error("project dialog controls are missing");

    /** @type {HTMLElement | null} */
    let openerElement = null;

    const renderProjectList = async () => {
      const projects = await planner.db.getAllProjects();
      list.replaceChildren();
      if (empty) empty.toggleAttribute("hidden", projects.length > 0);
      for (const project of projects) {
        const templateRoot = itemTemplate.content.firstElementChild;
        if (!templateRoot) throw new Error("project item template is empty");
        const item = /** @type {Element} */ (templateRoot.cloneNode(true));
        item.setAttribute("data-id", String(project.id));
        const itemName = item.querySelector('[data-part="project-name"]');
        const itemUpdated = item.querySelector('[data-part="project-updated"]');
        if (!itemName || !itemUpdated)
          throw new Error("project item is incomplete");
        itemName.textContent = project.name;
        itemUpdated.textContent = project.updatedAt;
        list.append(item);
      }
    };

    /** @param {Element | null} [opener] */
    const openDialog = async (opener = null) => {
      openerElement = /** @type {HTMLElement | null} */ (opener);
      await renderProjectList();
      if (!dialog.open) dialog.showModal();
      nameInput.focus();
    };

    /** @param {string} id @param {(() => Promise<void>) | undefined} [beforeSwitch] */
    const activate = async (id, beforeSwitch) => {
      const result = await options.rails.open(id);
      if (!result.ok) return result;
      // Edits made while the open was pending still belong to the old
      // project: a queued one would be overwritten by the restore.
      await options.store.flush?.();
      options.onActivated?.(result.record);
      options.store.restore(result.plan);
      await options.store.flush?.();
      await beforeSwitch?.();
      await options.onSwitched?.();
      return result;
    };

    const exchangeText = /** @type {HTMLTextAreaElement | null} */ (
      exchange.querySelector('[data-part="project-exchange-text"]')
    );
    const exchangeForm = exchange.querySelector(
      '[data-part="project-exchange-form"]',
    );
    const exchangeError = exchange.querySelector(
      '[data-part="project-exchange-error"]',
    );
    const exchangeImport = exchange.querySelector(
      '[data-part="project-exchange-import"]',
    );
    const exchangeExportMode = exchange.querySelector(
      '[data-part="project-exchange-export-mode"]',
    );
    const exchangeImportMode = exchange.querySelector(
      '[data-part="project-exchange-import-mode"]',
    );
    if (
      !exchangeText ||
      !exchangeForm ||
      !exchangeError ||
      !exchangeImport ||
      !exchangeExportMode ||
      !exchangeImportMode
    )
      throw new Error("project exchange controls are missing");

    /** @param {string} reason */
    const showExchangeError = (reason) => {
      exchangeError.textContent = reason;
      exchangeError.removeAttribute("hidden");
    };
    const clearExchangeError = () => {
      exchangeError.textContent = "";
      exchangeError.setAttribute("hidden", "");
    };
    /** @param {"export" | "import"} mode */
    const setExchangeMode = (mode) => {
      const exporting = mode === "export";
      exchange.setAttribute("data-mode", mode);
      exchangeExportMode.setAttribute("aria-pressed", String(exporting));
      exchangeImportMode.setAttribute("aria-pressed", String(!exporting));
      exchangeText.readOnly = exporting;
      exchangeImport.toggleAttribute("hidden", exporting);
      clearExchangeError();
      if (exporting) {
        exchangeText.value = JSON.stringify(options.store.read(), null, 2);
        exchangeText.select();
      } else {
        exchangeText.value = "";
        exchangeText.focus();
      }
    };

    /** @type {HTMLElement | null} */
    let exchangeOpener = null;
    /** @param {"export" | "import"} mode @param {Element | null} opener */
    const openExchange = (mode, opener = null) => {
      exchangeOpener = /** @type {HTMLElement | null} */ (opener);
      if (!exchange.open) exchange.showModal();
      setExchangeMode(mode);
      if (mode === "export") exchangeText.select();
    };
    const closeExchange = () => {
      if (exchange.open) exchange.close();
    };

    exchange.addEventListener("click", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (target?.closest?.('[data-part="project-exchange-close"]')) {
        event.preventDefault();
        closeExchange();
      } else if (
        target?.closest?.('[data-part="project-exchange-export-mode"]')
      ) {
        event.preventDefault();
        setExchangeMode("export");
        exchangeText.select();
      } else if (
        target?.closest?.('[data-part="project-exchange-import-mode"]')
      ) {
        event.preventDefault();
        setExchangeMode("import");
      }
    });
    exchangeText.addEventListener("input", clearExchangeError);
    exchangeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      exchangeImport.setAttribute("disabled", "");
      void options.rails
        .importProject(exchangeText.value)
        .then(async (/** @type {ProjectResult} */ result) => {
          if (!result.ok) {
            showExchangeError(result.reason);
            return;
          }
          const activated = await activate(result.record.id);
          if (!activated.ok) {
            showExchangeError(activated.reason);
            return;
          }
          closeExchange();
          await renderProjectList();
        })
        .catch((/** @type {unknown} */ error) =>
          showExchangeError(String(error)),
        )
        .finally(() => exchangeImport.removeAttribute("disabled"));
    });
    exchange.addEventListener("cancel", clearExchangeError);
    exchange.addEventListener("close", () => {
      exchangeOpener?.focus();
      exchangeOpener = null;
    });

    /** @param {Element} button */
    const disarm = (button) => {
      button.removeAttribute("data-confirming");
      button.removeAttribute("aria-describedby");
      button.textContent = "Delete";
      button.setAttribute("title", "Delete this project");
      const warning = button
        .closest('[data-part="project-item"]')
        ?.querySelector('[data-part="project-delete-warning"]');
      if (warning) {
        warning.textContent = "";
        warning.removeAttribute("id");
        warning.setAttribute("hidden", "");
      }
    };
    let confirming = /** @type {Element | null} */ (null);
    /** @param {string} id @param {Element} button */
    const handleDelete = async (id, button) => {
      if (confirming !== button) {
        if (confirming) disarm(confirming);
        const count = (await options.network?.nodes(id)) || 0;
        const warning = button
          .closest('[data-part="project-item"]')
          ?.querySelector('[data-part="project-delete-warning"]');
        const message =
          count > 0
            ? "Delete this project and its network of " +
              count +
              (count === 1 ? " node" : " nodes") +
              "; export a backup first, or those devices need a factory reset."
            : "";
        if (warning && message) {
          warning.id = "project-delete-warning-" + encodeURIComponent(id);
          warning.textContent = message;
          warning.removeAttribute("hidden");
          button.setAttribute("aria-describedby", warning.id);
        }
        confirming = button;
        button.setAttribute("data-confirming", "true");
        button.textContent = "Confirm?";
        button.setAttribute("title", message || "Confirm deletion");
        return;
      }
      const project = await planner.db.getProject(id);
      if (!project) return;
      if (options.store.read().project.id === id) {
        const name = await planner.db.defaultProjectName();
        const created = await options.rails.createProject(name);
        if (!created.ok) {
          confirming = null;
          await renderProjectList();
          return;
        }
        await options.network?.forget(id);
        const activated = await activate(created.record.id, () =>
          planner.db.deleteProject(id),
        );
        if (!activated.ok) {
          await planner.db.deleteProject(created.record.id);
          confirming = null;
          await renderProjectList();
          return;
        }
        closeDialog();
      } else {
        await options.network?.forget(id);
        await planner.db.deleteProject(id);
      }
      confirming = null;
      await renderProjectList();
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      const result = await options.rails.createProject(name);
      if (!result.ok) return;
      await activate(result.record.id);
      nameInput.value = "";
      closeDialog();
      await renderProjectList();
    });
    dialog.addEventListener("click", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (target?.closest?.('[data-part="project-close"]')) {
        event.preventDefault();
        closeDialog();
        return;
      }
      const item = target?.closest?.('[data-part="project-item"]');
      const id = item?.getAttribute("data-id");
      if (!id) return;
      const deleteButton = target?.closest?.('[data-part="project-delete"]');
      if (deleteButton) {
        event.preventDefault();
        handleDelete(id, deleteButton);
        return;
      }
      if (!target?.closest?.('[data-part="project-open-item"]')) return;
      event.preventDefault();
      activate(id).then(() => {
        closeDialog();
        return renderProjectList();
      });
    });
    dialog.addEventListener("cancel", () => {
      if (confirming) disarm(confirming);
      confirming = null;
    });
    dialog.addEventListener("close", () => {
      if (confirming) disarm(confirming);
      confirming = null;
      openerElement?.focus();
      openerElement = null;
    });

    return Object.freeze({
      open: openDialog,
      openExport: (/** @type {Element | undefined} */ opener) =>
        openExchange("export", opener),
      openImport: (/** @type {Element | undefined} */ opener) =>
        openExchange("import", opener),
      close: closeDialog,
    });
  };

  planner.projectPanel = Object.freeze({ create });
}
