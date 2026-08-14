/**
 * Owns the project menu the project's name opens: Save, Rename, Open / New,
 * Export and Import. The browser opens and closes it from the name
 * (popovertarget); this adds the menu pattern — focus on its first item,
 * ↓ ↑ Home End to move, Tab to leave.
 * Save says when the project last saved, and a save asked for is confirmed
 * by an announced "Project saved".
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  // Long enough to read, short enough not to sit over the plan.
  const CONFIRM_MS = 3000;
  const MINUTE_MS = 60_000;

  /**
   * When the project last saved, in words: recent saves by how long ago,
   * today's by the clock, older ones by the day.
   * @param {number} at @param {number} now
   */
  const savedText = (at, now) => {
    const minutes = Math.floor((now - at) / MINUTE_MS);
    if (minutes < 1) return "Saved just now";
    if (minutes < 60) return `Saved ${minutes} min ago`;
    const when = new Date(at);
    if (when.toDateString() === new Date(now).toDateString())
      return `Saved at ${when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    return `Saved on ${when.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  };

  /** @param {ProjectMenuOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.save !== "function" ||
      typeof options.rename !== "function" ||
      typeof options.openProject !== "function" ||
      typeof options.openExport !== "function" ||
      typeof options.openImport !== "function"
    )
      throw new TypeError("project menu requires root and its actions");
    const { root } = options;

    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="project-menu-template"]')
    );
    const content = /** @type {DocumentFragment | undefined} */ (
      template?.content.cloneNode(true)
    );
    const menu = /** @type {HTMLElement | null} */ (
      content?.querySelector('[data-part="project-menu"]') || null
    );
    const confirmation = /** @type {HTMLElement | null} */ (
      content?.querySelector('[data-part="project-saved"]') || null
    );
    const savedNote = menu?.querySelector('[data-part="project-menu-saved"]');
    if (!content || !menu || !confirmation || !savedNote)
      throw new TypeError("project menu template is missing");
    document.body.append(content);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let confirmTimer;

    const showSaved = () => {
      const at = options.lastSaved?.() ?? null;
      savedNote.textContent = at === null ? "" : savedText(at, Date.now());
    };

    const confirmSaved = () => {
      // A new text node each time, so a second save is announced again.
      confirmation.replaceChildren(document.createTextNode("Project saved"));
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(
        () => confirmation.replaceChildren(),
        CONFIRM_MS,
      );
      if (menu.matches(":popover-open")) showSaved();
    };

    const name = () =>
      /** @type {HTMLElement | null} */ (
        root.querySelector('[data-part="tree-project-name"]')
      );
    const items = () =>
      /** @type {HTMLElement[]} */ ([
        ...menu.querySelectorAll('[role="menuitem"]'),
      ]);

    /** @type {Record<string, (opener: HTMLElement | null) => unknown>} */
    const actions = {
      "project-menu-save": () =>
        void Promise.resolve(options.save()).catch(() => {}),
      "project-menu-rename": () => options.rename(),
      "project-menu-open": (opener) => options.openProject(opener || undefined),
      "project-menu-export": (opener) =>
        options.openExport(opener || undefined),
      "project-menu-import": (opener) =>
        options.openImport(opener || undefined),
    };

    // Before the menu shows, so "Saved …" is current the moment it is read.
    const onBeforeToggle = (/** @type {Event} */ event) => {
      if (/** @type {ToggleEvent} */ (event).newState === "open") showSaved();
    };
    // The toggle event arrives a task late, so a key pressed in between may
    // already have moved focus or closed the menu.
    const onToggle = (/** @type {Event} */ event) => {
      if (
        /** @type {ToggleEvent} */ (event).newState === "open" &&
        menu.matches(":popover-open") &&
        !menu.contains(document.activeElement)
      )
        items()[0]?.focus();
    };
    const onKeyDown = (/** @type {KeyboardEvent} */ event) => {
      const list = items();
      const at = list.indexOf(
        /** @type {HTMLElement} */ (document.activeElement),
      );
      /** @param {number} index */
      const go = (index) => {
        event.preventDefault();
        list[(index + list.length) % list.length]?.focus();
      };
      if (event.key === "ArrowDown") go(at + 1);
      else if (event.key === "ArrowUp") go(at - 1);
      else if (event.key === "Home") go(0);
      else if (event.key === "End") go(list.length - 1);
      else if (event.key === "Tab") menu.hidePopover();
    };
    // The pointer takes the keyboard's place, so one item is highlighted at
    // a time and Enter runs the one that shows it.
    const onPointerOver = (/** @type {PointerEvent} */ event) => {
      const item = /** @type {HTMLElement | null} */ (
        /** @type {Element | null} */ (event.target)?.closest(
          '[role="menuitem"]',
        )
      );
      if (item && item !== document.activeElement) item.focus();
    };
    const onClick = (/** @type {MouseEvent} */ event) => {
      const item = /** @type {Element | null} */ (event.target)?.closest(
        '[role="menuitem"]',
      );
      const action = actions[item?.getAttribute("data-part") || ""];
      if (!action) return;
      const opener = name();
      menu.hidePopover();
      opener?.focus();
      action(opener);
    };
    // ↓ on the name opens the menu, as Enter and Space already do; Tab and
    // Escape leave an open menu before focus has reached it. Escape is
    // closed here because the tree's own Escape cancels the browser's.
    const onNameKeyDown = (/** @type {KeyboardEvent} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (!target?.matches('[data-part="tree-project-name"]')) return;
      const open = menu.matches(":popover-open");
      if (event.key === "Tab" && open) menu.hidePopover();
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        menu.hidePopover();
        return;
      }
      if (event.key !== "ArrowDown" || open) return;
      event.preventDefault();
      event.stopPropagation();
      menu.showPopover();
      items()[0]?.focus();
    };

    menu.addEventListener("beforetoggle", onBeforeToggle);
    menu.addEventListener("toggle", onToggle);
    menu.addEventListener("keydown", onKeyDown);
    menu.addEventListener("pointerover", onPointerOver);
    menu.addEventListener("click", onClick);
    root.addEventListener("keydown", onNameKeyDown, true);

    return Object.freeze({
      confirmSaved,
      disconnect: () => {
        clearTimeout(confirmTimer);
        menu.removeEventListener("beforetoggle", onBeforeToggle);
        menu.removeEventListener("toggle", onToggle);
        menu.removeEventListener("keydown", onKeyDown);
        menu.removeEventListener("pointerover", onPointerOver);
        menu.removeEventListener("click", onClick);
        root.removeEventListener("keydown", onNameKeyDown, true);
        menu.remove();
        confirmation.remove();
      },
    });
  };

  planner.projectMenu = Object.freeze({ create });
}
