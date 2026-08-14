/**
 * Owns the menu an Area's Add Application opens: the presets the Area does
 * not hold yet, in their order, then Other… for an application the user
 * names. The browser opens it from the button (popovertarget); this fills it
 * for that Area, adds the menu pattern — focus on its first item, ↓ ↑ Home
 * End to move, Tab to leave — and adds the chosen application by command.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {ApplicationMenuOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.read !== "function" ||
      typeof options.dispatch !== "function" ||
      typeof options.select !== "function" ||
      typeof options.announce !== "function"
    )
      throw new TypeError("application menu requires root and its actions");
    const { root } = options;

    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="application-menu-template"]')
    );
    const content = /** @type {DocumentFragment | undefined} */ (
      template?.content.cloneNode(true)
    );
    const menu = /** @type {HTMLElement | null} */ (
      content?.querySelector('[data-part="application-menu"]') || null
    );
    const itemTemplate = menu?.querySelector(
      '[data-part="application-menu-item"]',
    );
    const dividerTemplate = menu?.querySelector(
      '[data-part="application-menu-divider"]',
    );
    if (!content || !menu || !itemTemplate || !dividerTemplate)
      throw new TypeError("application menu template is missing");
    itemTemplate.remove();
    dividerTemplate.remove();
    document.body.append(content);

    /** The Area whose Add Application opened the menu. */
    let areaId = "";

    const items = () =>
      /** @type {HTMLButtonElement[]} */ ([
        ...menu.querySelectorAll('[role="menuitem"]'),
      ]);

    // The opener is recorded before the browser opens the menu from it: a
    // click, or Enter or Space, which the browser turns into a click.
    const onRootClick = (/** @type {MouseEvent} */ event) => {
      const button = /** @type {HTMLElement | null} */ (
        /** @type {Element | null} */ (event.target)?.closest(
          '[data-part="tree-add-application"]',
        )
      );
      if (!button) return;
      areaId =
        button.closest('[data-anchor="area"]')?.getAttribute("data-id") || "";
    };

    const onBeforeToggle = (/** @type {Event} */ event) => {
      if (/** @type {ToggleEvent} */ (event).newState !== "open") return;
      const missing = planner.applications.missing(options.read(), areaId);
      /** @param {string} value @param {string} label @param {string} [title] */
      const item = (value, label, title) => {
        const button = /** @type {HTMLButtonElement} */ (
          itemTemplate.cloneNode(true)
        );
        button.value = value;
        button.textContent = label;
        if (title) button.title = title;
        return button;
      };
      // A divider between each item and the next; Other… always comes last.
      menu.replaceChildren(
        ...[
          ...missing.map((preset) =>
            item(preset, planner.codec.PRESETS[preset]),
          ),
          item(
            "other",
            "Other…",
            "An application you name, with device types you add",
          ),
        ].flatMap((button, index) =>
          index ? [dividerTemplate.cloneNode(true), button] : [button],
        ),
      );
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
        /** @type {HTMLButtonElement} */ (document.activeElement),
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
    // The pointer takes the keyboard's place, so one preset is highlighted
    // at a time and Enter picks the one that shows it.
    const onPointerOver = (/** @type {PointerEvent} */ event) => {
      const item = /** @type {HTMLElement | null} */ (
        /** @type {Element | null} */ (event.target)?.closest(
          '[role="menuitem"]',
        )
      );
      if (item && item !== document.activeElement) item.focus();
    };
    const onClick = (/** @type {MouseEvent} */ event) => {
      const item = /** @type {HTMLButtonElement | null} */ (
        /** @type {Element | null} */ (event.target)?.closest(
          '[role="menuitem"]',
        )
      );
      if (!item) return;
      const preset = item.value;
      menu.hidePopover();
      const result = options.dispatch({
        entity: "area",
        action: "add-application",
        id: areaId,
        value: preset,
      });
      const applications =
        result?.areas.find((area) => area.id === areaId)?.applications || [];
      const added =
        preset === "other"
          ? applications.at(-1)
          : applications.find((application) => application.preset === preset);
      if (!added) return;
      options.select("application", added.id);
      options.announce(`Added ${added.name}`);
      // Other… is chosen to name an application: its name box opens.
      if (preset === "other") options.rename?.(added.id);
    };

    root.addEventListener("click", onRootClick, true);
    menu.addEventListener("beforetoggle", onBeforeToggle);
    menu.addEventListener("toggle", onToggle);
    menu.addEventListener("keydown", onKeyDown);
    menu.addEventListener("pointerover", onPointerOver);
    menu.addEventListener("click", onClick);

    return Object.freeze({
      disconnect: () => {
        root.removeEventListener("click", onRootClick, true);
        menu.removeEventListener("beforetoggle", onBeforeToggle);
        menu.removeEventListener("toggle", onToggle);
        menu.removeEventListener("keydown", onKeyDown);
        menu.removeEventListener("pointerover", onPointerOver);
        menu.removeEventListener("click", onClick);
        menu.remove();
      },
    });
  };

  planner.applicationMenu = Object.freeze({ create });
}
