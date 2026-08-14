/**
 * Owns the Settings window: its section menu; switches for the grid
 * preferences the G and S keys change and for the mesh notice; the keymap's
 * shortcuts, listed read-only; and About, with the shared logo. It keeps no
 * setting of its own; each switch reads and writes its owner's, so nothing
 * here reaches the plan.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const SECTIONS = ["area", "mesh", "shortcuts", "about"];

  /** @param {SettingsOptions} options */
  const create = (options) => {
    if (
      typeof options?.grid?.read !== "function" ||
      typeof options.meshNotice?.read !== "function"
    )
      throw new TypeError("settings requires the preferences it shows");
    const { grid, meshNotice } = options;

    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="settings-dialog-template"]')
    );
    const dialog = /** @type {HTMLDialogElement | null} */ (
      template?.content.firstElementChild?.cloneNode(true) || null
    );
    if (!dialog) throw new TypeError("settings template is missing");
    document.body.append(dialog);

    /** @param {string} name */
    const part = (name) =>
      /** @type {HTMLElement | null} */ (
        dialog.querySelector(`[data-part="${name}"]`)
      );
    const tabs = SECTIONS.map((name) => part(`settings-tab-${name}`));
    const panels = SECTIONS.map((name) => part(`settings-panel-${name}`));
    const showGrid = /** @type {HTMLInputElement | null} */ (
      part("settings-show-grid")
    );
    const snap = /** @type {HTMLInputElement | null} */ (part("settings-snap"));
    const notify = /** @type {HTMLInputElement | null} */ (
      part("settings-mesh-notify")
    );
    let current = 0;

    // The keymap is the one list of keys, so this cannot drift from them.
    const shortcuts = part("settings-shortcuts");
    const row = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="settings-shortcut-template"]')
    );
    for (const entry of planner.keymap.entries) {
      const item = /** @type {Element | null} */ (
        row?.content.firstElementChild?.cloneNode(true) || null
      );
      if (!item) continue;
      item
        .querySelector('[data-part="settings-shortcut-description"]')
        ?.append(entry.description);
      item.querySelector('[data-part="settings-key"]')?.append(entry.display);
      shortcuts?.append(item);
    }

    // The header's logo, drawn once in its own template.
    const logo = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="brand-logo-template"]')
    )?.content.firstElementChild?.cloneNode(true);
    if (logo) part("settings-about-logo")?.append(logo);
    /** @type {HTMLElement | null} */
    let opener = null;

    /** @param {number} index @param {boolean} [focus] */
    const select = (index, focus = false) => {
      current = (index + SECTIONS.length) % SECTIONS.length;
      tabs.forEach((tab, at) => {
        tab?.setAttribute("aria-selected", String(at === current));
        tab?.setAttribute("tabindex", at === current ? "0" : "-1");
      });
      panels.forEach((panel, at) => {
        if (panel) panel.hidden = at !== current;
      });
      if (focus) tabs[current]?.focus();
    };

    // Their owners keep these preferences; the switches only show them. The
    // keys that change the grid's do nothing while a window is open, so
    // reading them as the window opens is enough.
    const sync = () => {
      const { show, snap: snapping } = grid.read();
      if (showGrid) showGrid.checked = show;
      if (snap) snap.checked = snapping;
      if (notify) notify.checked = meshNotice.read().notify;
    };

    /** @param {Element | null} [from] */
    const open = (from = null) => {
      opener = /** @type {HTMLElement | null} */ (from);
      sync();
      opener?.setAttribute("aria-expanded", "true");
      if (!dialog.open) dialog.showModal();
      tabs[current]?.focus();
    };

    const onTabsKeyDown = (/** @type {KeyboardEvent} */ event) => {
      if (event.key === "ArrowDown") select(current + 1, true);
      else if (event.key === "ArrowUp") select(current - 1, true);
      else if (event.key === "Home") select(0, true);
      else if (event.key === "End") select(SECTIONS.length - 1, true);
      else return;
      event.preventDefault();
    };
    const onTabsClick = (/** @type {MouseEvent} */ event) => {
      const tab = /** @type {Element | null} */ (event.target)?.closest(
        '[role="tab"]',
      );
      const index = tabs.indexOf(/** @type {HTMLElement | null} */ (tab));
      if (index >= 0) select(index);
    };
    const onChange = (/** @type {Event} */ event) => {
      if (event.target === showGrid) grid.apply({ show: showGrid?.checked });
      else if (event.target === snap) grid.apply({ snap: snap?.checked });
      else if (event.target === notify)
        meshNotice.apply({ notify: notify?.checked });
    };
    const onClose = () => {
      opener?.setAttribute("aria-expanded", "false");
      opener?.focus();
      opener = null;
    };

    const tablist = part("settings-tabs");
    tablist?.addEventListener("keydown", onTabsKeyDown);
    tablist?.addEventListener("click", onTabsClick);
    dialog.addEventListener("change", onChange);
    dialog.addEventListener("close", onClose);
    select(0);

    return Object.freeze({
      open,
      disconnect: () => {
        tablist?.removeEventListener("keydown", onTabsKeyDown);
        tablist?.removeEventListener("click", onTabsClick);
        dialog.removeEventListener("change", onChange);
        dialog.removeEventListener("close", onClose);
        dialog.remove();
      },
    });
  };

  planner.settings = Object.freeze({ create });
}
