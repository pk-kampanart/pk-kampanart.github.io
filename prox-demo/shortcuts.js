/**
 * Owns shortcut help and global chords. It translates input into commands and
 * leaves document mutation to the caller.
 * Channels: none.
 */
{
  /** @typedef {{root?: Element | null, keymap?: {entries: Array<{keys: string[], command: string, display: string, description: string}>}, dispatch: (command: Record<string, unknown>) => unknown, openProject?: (opener?: Element) => unknown}} ShortcutOptions */
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  const templateNode = (/** @type {string} */ name) => {
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector(`[data-part="${name}-template"]`)
    );
    return /** @type {Element | null} */ (
      template?.content.firstElementChild?.cloneNode(true) || null
    );
  };

  const editable = (/** @type {EventTarget | null} */ target) => {
    const element = /** @type {Element | null} */ (target);
    return Boolean(
      element?.closest?.(
        'input, textarea, select, [contenteditable="true"], [role="textbox"], dialog',
      ),
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
    const commandOf = (/** @type {KeyboardEvent} */ event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return "";
      const key = `${event.ctrlKey || event.metaKey ? "Ctrl+" : ""}${event.shiftKey ? "Shift+" : ""}${event.key.toUpperCase()}`;
      return (
        entries.find((/** @type {{keys: string[], command: string}} */ entry) =>
          entry.keys.includes(key),
        )?.command || ""
      );
    };

    const keydown = (/** @type {KeyboardEvent} */ event) => {
      if (
        (event.key === "?" || event.key === "F1") &&
        !editable(event.target)
      ) {
        event.preventDefault();
        openHelp();
        return;
      }
      const command = commandOf(event);
      if (
        !command ||
        (editable(event.target) && (command === "undo" || command === "redo"))
      )
        return;
      if (command === "undo" || command === "redo") {
        event.preventDefault();
        options.dispatch({ command });
      } else if (command === "open-project") {
        event.preventDefault();
        openProject();
      } else if (command === "save") {
        event.preventDefault();
        void Promise.resolve(options.dispatch({ command: "save" })).catch(
          () => {},
        );
      }
    };

    document.addEventListener("keydown", keydown);
    dialog.addEventListener("close", () => {
      openerElement?.focus();
      openerElement = null;
    });
    return Object.freeze({
      openHelp,
      disconnect: () => {
        document.removeEventListener("keydown", keydown);
      },
    });
  };

  planner.shortcuts = Object.freeze({ create });
}
