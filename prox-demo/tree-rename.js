/**
 * Owns tree row rename input and its focus contract.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {TreeRenameOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.registry?.dispatch !== "function" ||
      typeof options.render !== "function" ||
      typeof options.focusRow !== "function"
    )
      throw new TypeError(
        "tree rename requires root, registry, render, and focusRow",
      );
    const { root, registry, render, focusRow } = options;
    /** @type {HTMLInputElement | null} */
    let cancelInput = null;

    // The anchor's own name line: inside its summary for a branch, its row for
    // a leaf, and the line itself for the project.
    /** @param {Element | null} anchor @returns {Element | null} */
    const rowOf = (anchor) =>
      anchor?.querySelector(
        ':scope > [data-part="tree-line"] [data-part="tree-row"]',
      ) ||
      anchor?.querySelector(':scope > [data-part="tree-row"]') ||
      anchor?.querySelector(':scope > [data-part="tree-line"]') ||
      null;

    /** @param {Element | null} anchor @returns {boolean} */
    const startRename = (anchor) => {
      const row = rowOf(anchor);
      const name = anchor?.querySelector(
        '[data-part="tree-name"], [data-part="tree-project-name"]',
      );
      const input = /** @type {HTMLInputElement | null} */ (
        anchor?.querySelector('[data-part="tree-name-input"]')
      );
      if (!row || !name || !input) return false;
      cancelInput = null;
      input.value = name.textContent || "";
      row.setAttribute("hidden", "");
      input.removeAttribute("hidden");
      input.focus();
      input.select();
      return true;
    };

    /** @param {HTMLInputElement} input @param {boolean} commit */
    const finishRename = (input, commit) => {
      if (input.hasAttribute("hidden")) return;
      const anchor = input.closest("[data-anchor]");
      const id = anchor?.getAttribute("data-id");
      const entity = anchor?.getAttribute("data-anchor");
      rowOf(anchor)?.removeAttribute("hidden");
      input.setAttribute("hidden", "");
      if (commit && id && entity) {
        registry.dispatch({
          entity,
          action: "rename",
          id,
          value: input.value,
          coalesce: `rename:${id}`,
        });
      }
      render();
      if (entity && id) queueMicrotask(() => focusRow(entity, id));
    };

    const onDoubleClick = (/** @type {MouseEvent} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      const name = target?.closest?.(
        '[data-part="tree-name"], [data-part="tree-project-name"]',
      );
      const anchor = name?.closest?.("[data-anchor]");
      if (!name || !anchor) return;
      startRename(anchor);
    };
    const onKeyDown = (/** @type {KeyboardEvent} */ event) => {
      const input = /** @type {HTMLInputElement | null} */ (event.target);
      if (!input?.matches('[data-part="tree-name-input"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancelInput = input;
        finishRename(input, false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        finishRename(input, true);
      }
    };
    const onFocusOut = (/** @type {FocusEvent} */ event) => {
      const input = /** @type {HTMLInputElement | null} */ (event.target);
      if (!input?.matches('[data-part="tree-name-input"]')) return;
      if (cancelInput === input) {
        cancelInput = null;
        return;
      }
      finishRename(input, true);
    };
    root.addEventListener("dblclick", onDoubleClick);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("focusout", onFocusOut);

    return Object.freeze({
      startRename,
      disconnect: () => {
        root.removeEventListener("dblclick", onDoubleClick);
        root.removeEventListener("keydown", onKeyDown);
        root.removeEventListener("focusout", onFocusOut);
      },
    });
  };

  planner.treeRename = Object.freeze({ create });
}
