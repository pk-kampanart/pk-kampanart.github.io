/**
 * Owns host-independent tree behavior and keyed child reconciliation.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /**
   * @param {Element} parent
   * @param {any[]} records
   * @param {{nodeKey: (node: Element) => string, recordKey: (record: any) => string, createNode: (record: any) => Element | null, updateNode: (node: Element, record: any) => void}} options
   */
  const reconcile = (parent, records, options) => {
    const existing = new Map(
      [...parent.children].map((node) => [options.nodeKey(node), node]),
    );
    const next = [];
    for (const record of records) {
      const node =
        existing.get(options.recordKey(record)) || options.createNode(record);
      if (!node) continue;
      options.updateNode(node, record);
      next.push(node);
    }
    for (let index = 0; index < next.length; index++) {
      const node = next[index];
      if (parent.children[index] !== node)
        parent.insertBefore(node, parent.children[index] || null);
    }
    const nextSet = new Set(next);
    for (const node of existing.values()) if (!nextSet.has(node)) node.remove();
  };

  /** @param {Element | null} anchor */
  const focusRow = (anchor) =>
    /** @type {HTMLElement | null} */ (
      anchor?.querySelector('[data-part="tree-row"]')
    )?.focus();

  /** @param {Element | null} anchor */
  const openAncestors = (anchor) => {
    for (
      let parent = anchor?.parentElement;
      parent;
      parent = parent.parentElement
    )
      if (parent instanceof HTMLDetailsElement) parent.open = true;
  };

  /** @param {TreeViewOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.onSelect !== "function" ||
      typeof options.onClear !== "function"
    )
      throw new TypeError("tree view requires root, onSelect, and onClear");
    const { root, onSelect, onClear } = options;

    const onRootKeyDown = (/** @type {KeyboardEvent} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      const editable = target?.matches(
        'textarea, select, [contenteditable="true"], input:not([type="radio"])',
      );
      const branch = target?.closest?.("summary")?.closest("details");
      if (
        branch &&
        !editable &&
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
      if (event.key === "Escape" && !editable) {
        if (onClear() !== false) event.preventDefault();
        return;
      }
      const row = target?.closest?.('[data-part="tree-row"]');
      if (!row || (event.key !== "Enter" && event.key !== " ")) return;
      const anchor = row.closest("[data-anchor]");
      if (!anchor) return;
      event.preventDefault();
      onSelect(anchor);
    };

    root.addEventListener("keydown", onRootKeyDown);

    return Object.freeze({
      reconcile,
      focusRow,
      openAncestors,
      disconnect: () => root.removeEventListener("keydown", onRootKeyDown),
    });
  };

  planner.treeView = Object.freeze({ create });
}
