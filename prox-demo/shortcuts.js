/**
 * Owns the shortcut help dialog and its list, built from the keymap table.
 * The keys themselves belong to src/hub.js.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const templateNode = (/** @type {string} */ name) => {
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector(`[data-part="${name}-template"]`)
    );
    return /** @type {Element | null} */ (
      template?.content.firstElementChild?.cloneNode(true) || null
    );
  };

  /** @param {ShortcutOptions} options */
  const create = (options) => {
    if (typeof options?.dispatch !== "function")
      throw new TypeError("shortcuts requires dispatch");

    const dialog = /** @type {HTMLDialogElement | null} */ (
      templateNode("shortcuts-dialog")
    );
    if (!dialog) throw new TypeError("shortcuts templates are incomplete");
    document.body.append(dialog);

    const list = dialog.querySelector('[data-part="shortcut-list"]');
    const rowTemplate = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="shortcut-row-template"]')
    );
    const entries = options.keymap?.entries || planner.keymap?.entries || [];
    if (!list || !rowTemplate)
      throw new TypeError("shortcut list template is incomplete");
    for (const entry of entries) {
      const row = /** @type {Element | null} */ (
        rowTemplate.content.firstElementChild?.cloneNode(true) || null
      );
      if (!row) continue;
      row.querySelector('[data-part="shortcut-keys"]')?.append(entry.display);
      row
        .querySelector('[data-part="shortcut-description"]')
        ?.append(entry.description);
      list.append(row);
    }

    const open = (/** @type {HTMLDialogElement} */ target) => {
      if (!target.open) target.showModal();
    };
    /** @type {HTMLElement | null} */
    let openerElement = null;
    /** @param {Element | null} [opener] */
    const openHelp = (opener = null) => {
      openerElement = /** @type {HTMLElement | null} */ (opener);
      open(dialog);
      /** @type {HTMLElement | null} */ (
        dialog.querySelector('[data-part="shortcuts-close"]')
      )?.focus();
    };
    const openProject = () => {
      if (typeof options.openProject === "function") {
        options.openProject();
        return;
      }
      options.dispatch({ command: "open-project" });
      const projectDialog = /** @type {HTMLDialogElement | null} */ (
        document.querySelector('[data-part="project-dialog"]')
      );
      if (projectDialog) open(projectDialog);
    };
    dialog.addEventListener("close", () => {
      openerElement?.focus();
      openerElement = null;
    });
    return Object.freeze({
      openHelp,
      openProject,
      disconnect: () => {},
    });
  };

  planner.shortcuts = Object.freeze({ create });
}
