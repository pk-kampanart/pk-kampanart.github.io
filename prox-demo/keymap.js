/**
 * Declares keyboard bindings as data for input and shortcut-help consumers.
 * It owns no document state and performs no DOM work until create is called.
 * Channels: none.
 */
{
  /** @typedef {{keys: string[], command: string, when: string, description: string}} KeymapSource */
  /** @type {KeymapSource[]} */
  const sources = [
    {
      keys: ["Ctrl+O"],
      command: "open-project",
      when: "global",
      description: "Open project",
    },
    {
      keys: ["Ctrl+S"],
      command: "save",
      when: "global",
      description: "Save now",
    },
    {
      keys: ["Ctrl+Z"],
      command: "undo",
      when: "global",
      description: "Undo",
    },
    {
      keys: ["Ctrl+Shift+Z", "Ctrl+Y"],
      command: "redo",
      when: "global",
      description: "Redo",
    },
    {
      keys: ["Delete", "Backspace"],
      command: "delete",
      when: "global",
      description: "Delete selection",
    },
    {
      keys: ["F2"],
      command: "rename",
      when: "tree",
      description: "Rename focused entry",
    },
    {
      keys: ["Tab"],
      command: "focus-next",
      when: "tree",
      description: "Move focus through the tree",
    },
    {
      keys: ["Enter", "Space"],
      command: "select",
      when: "tree",
      description: "Select focused entry",
    },
    {
      keys: ["ArrowLeft"],
      command: "collapse-branch",
      when: "tree",
      description: "Collapse the focused branch or move to its parent",
    },
    {
      keys: ["ArrowRight"],
      command: "expand-branch",
      when: "tree",
      description: "Expand the focused branch",
    },
    {
      keys: ["Alt+ArrowLeft", "Alt+ArrowRight", "Alt+ArrowUp", "Alt+ArrowDown"],
      command: "reorder",
      when: "tree",
      description: "Move past a sibling",
    },
    {
      keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"],
      command: "resize-panel",
      when: "splitter",
      description: "Resize workflow panel",
    },
    {
      keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
      command: "move-cursor",
      when: "surface",
      description: "Move placement cursor or selected entity",
    },
    {
      keys: [
        "Shift+ArrowLeft",
        "Shift+ArrowRight",
        "Shift+ArrowUp",
        "Shift+ArrowDown",
      ],
      command: "fine-move",
      when: "surface",
      description: "Use fine movement step",
    },
    {
      keys: ["Enter"],
      command: "commit",
      when: "surface",
      description: "Commit placement or drawing",
    },
    {
      keys: ["Enter"],
      command: "draw-group",
      when: "surface-group",
      description: "Set both group corners",
    },
    {
      keys: ["Escape"],
      command: "cancel",
      when: "surface",
      description: "Cancel the current gesture",
    },
    {
      keys: ["wheel"],
      command: "zoom",
      when: "surface-pointer",
      description: "Zoom the floor plan",
    },
    {
      keys: ["drag", "Space-drag"],
      command: "pan",
      when: "surface-pointer",
      description: "Pan the floor plan",
    },
    {
      keys: ["edge/corner handle"],
      command: "resize-group",
      when: "surface-pointer",
      description: "Resize a selected group",
    },
  ];

  /** @param {KeymapSource} entry @returns {string} */
  const displayOf = (entry) =>
    ({
      reorder: "Alt+arrow",
      "resize-panel": "arrows / Home / End",
      "move-cursor": "arrows",
      "fine-move": "Shift+arrow",
      "draw-group": "Enter twice",
      "resize-group": "edge/corner handle",
    })[entry.command] || entry.keys.join(" / ");

  const entries = sources.map((entry) =>
    Object.freeze({ ...entry, display: displayOf(entry) }),
  );

  const commands = Object.freeze([
    ...new Set(entries.map((entry) => entry.command)),
  ]);

  /**
   * @typedef {{root?: Element | null, surface: Element, store?: {read: () => Record<string, any>}, dispatch: (command: Record<string, unknown>) => unknown, announce?: (message: string) => void}} KeymapOptions
   */

  /** @param {KeymapOptions} options */
  const create = (options) => {
    if (!options?.surface || typeof options.dispatch !== "function")
      throw new TypeError("keymap requires surface and dispatch");

    const { surface } = options;
    let cursor = { x: 400, y: 300 };
    const announcer = document.querySelector('[data-part="surface-announcer"]');
    const announce = (/** @type {string} */ message) => {
      if (options.announce) options.announce(message);
      else if (announcer) announcer.textContent = message;
    };
    const renderCursor = () => {
      surface.setAttribute("data-cursor-x", String(cursor.x));
      surface.setAttribute("data-cursor-y", String(cursor.y));
      surface
        .querySelector('[data-part="surface-cursor"]')
        ?.setAttribute("data-x", String(cursor.x));
      surface
        .querySelector('[data-part="surface-cursor"]')
        ?.setAttribute("data-y", String(cursor.y));
    };
    const directionOf = (/** @type {string} */ key) =>
      ({
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      })[key];
    const active = () => ({
      kind: surface.getAttribute("data-active-kind") || "",
      id: surface.getAttribute("data-active-entity") || "",
      floorId: surface.getAttribute("data-active-floor") || "",
    });
    const selectedAnchor = () => {
      const radio = /** @type {HTMLInputElement | null} */ (
        options.root?.querySelector(
          'input[name="planner-selection"]:checked',
        ) || options.root?.querySelector('input[name="planner-scope"]:checked')
      );
      const anchor = radio?.closest("[data-anchor]");
      if (!anchor || !radio) return null;
      const entity =
        radio.name === "planner-scope"
          ? "floor"
          : anchor.getAttribute("data-anchor") || "";
      return {
        anchor,
        entity,
        id: radio.value || anchor.getAttribute("data-id") || "",
        floorId:
          entity === "floor"
            ? ""
            : anchor
                .closest('[data-anchor="floor"]')
                ?.getAttribute("data-id") || "",
        disabled: Boolean(
          anchor.querySelector(
            '[data-action="delete"]:disabled, [data-act="delete"]:disabled',
          ),
        ),
      };
    };
    const editable = (/** @type {EventTarget | null} */ target) => {
      const element = /** @type {Element | null} */ (target);
      return Boolean(
        element?.closest?.(
          'input:not([type="radio"]), textarea, select, [contenteditable="true"], dialog',
        ),
      );
    };
    const selectedRecord = (
      /** @type {{kind: string, id: string}} */ selection,
    ) => {
      for (const floor of options.store?.read().floors || [])
        for (const application of floor.applications || []) {
          const collections = [
            ["group", application.groups || []],
            ["device-type", application.deviceTypes || []],
          ];
          for (const [kind, values] of collections)
            if (selection.kind === kind) {
              const found = values.find(
                (/** @type {any} */ value) => value.id === selection.id,
              );
              if (found) return found;
            }
          for (const type of application.deviceTypes || []) {
            const found = (type.instances || []).find(
              (/** @type {any} */ value) =>
                selection.kind === "device" && value.id === selection.id,
            );
            if (found) return found;
          }
        }
      return null;
    };
    const syncEntityCursor = (
      /** @type {{kind: string, id: string}} */ selection,
    ) => {
      const record = selectedRecord(selection);
      if (selection.kind === "group" && record?.rect)
        cursor = {
          x: record.rect.x + record.rect.width / 2,
          y: record.rect.y + record.rect.height / 2,
        };
      else if (selection.kind === "device" && record)
        cursor = { x: record.x, y: record.y };
      renderCursor();
    };
    const keydown = (/** @type {KeyboardEvent} */ event) => {
      const focusedSurface = surface.contains(document.activeElement);
      const focusedRoot = Boolean(
        options.root?.contains(document.activeElement),
      );
      if (!focusedSurface && !focusedRoot) return;
      const direction = directionOf(event.key);
      if (event.key === "F2" && focusedRoot && !editable(event.target)) {
        const selected = selectedAnchor();
        const input = selected?.anchor?.querySelector(
          '[data-act="rename"], [data-slot="name"][data-slot-as="value"], input[type="text"]',
        );
        if (input) {
          /** @type {HTMLInputElement} */ (input).focus();
          /** @type {HTMLInputElement} */ (input).select();
          event.preventDefault();
        }
        return;
      }
      if (direction && event.altKey && focusedRoot && !editable(event.target)) {
        const selected = selectedAnchor();
        if (selected?.id && !selected.disabled) {
          options.dispatch({
            command: "reorder",
            entity: selected.entity,
            id: selected.id,
            floorId: selected.floorId,
            direction: event.key.slice("Arrow".length).toLowerCase(),
          });
          event.preventDefault();
        }
        return;
      }
      if (!focusedSurface) return;
      const selection = active();
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !editable(event.target)
      ) {
        const selected = selectedAnchor();
        if (selected?.id && !selected.disabled) {
          options.dispatch({
            command: "delete",
            entity: selected.entity,
            id: selected.id,
            floorId: selected.floorId,
          });
          event.preventDefault();
        }
        return;
      }
      if (event.key === "Escape" && surface.hasAttribute("data-anchor-x")) {
        surface.removeAttribute("data-anchor-x");
        surface.removeAttribute("data-anchor-y");
        announce("Drawing cancelled");
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" && selection.kind === "group" && selection.id) {
        if (!surface.hasAttribute("data-anchor-x")) {
          syncEntityCursor(selection);
          surface.setAttribute("data-anchor-x", String(cursor.x));
          surface.setAttribute("data-anchor-y", String(cursor.y));
          announce(`First corner of group set at ${cursor.x}, ${cursor.y}`);
        } else {
          const start = {
            x: Number(surface.getAttribute("data-anchor-x")),
            y: Number(surface.getAttribute("data-anchor-y")),
          };
          const rect = planner.geo?.normalize?.({
            x: start.x,
            y: start.y,
            width: cursor.x - start.x,
            height: cursor.y - start.y,
          }) || {
            x: Math.min(start.x, cursor.x),
            y: Math.min(start.y, cursor.y),
            width: Math.abs(cursor.x - start.x),
            height: Math.abs(cursor.y - start.y),
          };
          options.dispatch({
            command: "draw-group",
            groupId: selection.id,
            floorId: selection.floorId,
            rect,
          });
          surface.removeAttribute("data-anchor-x");
          surface.removeAttribute("data-anchor-y");
          announce(`Group drawn at ${rect.x}, ${rect.y}`);
        }
        event.preventDefault();
        return;
      }
      if (
        event.key === "Enter" &&
        selection.kind === "device-type" &&
        selection.id
      ) {
        options.dispatch({
          command: "place-instance",
          typeId: selection.id,
          floorId: selection.floorId,
          point: { ...cursor },
        });
        announce(`Device instance placed at ${cursor.x}, ${cursor.y}`);
        event.preventDefault();
        return;
      }
      if (!direction || event.ctrlKey || event.metaKey || event.altKey) return;
      const step = event.shiftKey ? 1 : 10;
      if (
        (selection.kind === "device" || selection.kind === "group") &&
        !surface.hasAttribute("data-anchor-x")
      ) {
        let delta = { x: direction.x * step, y: direction.y * step };
        const record = selectedRecord(selection);
        if (selection.kind === "device" && record)
          delta = {
            x: Math.min(800, Math.max(0, record.x + delta.x)) - record.x,
            y: Math.min(600, Math.max(0, record.y + delta.y)) - record.y,
          };
        options.dispatch({
          command: "nudge",
          entity: selection.kind === "device" ? "deviceInstance" : "group",
          id: selection.id,
          floorId: selection.floorId,
          delta,
          coalesce: `nudge:${selection.id}`,
        });
        if (focusedSurface) {
          const part =
            selection.kind === "device" ? "surface-device" : "surface-group";
          const current = [...surface.querySelectorAll(`[data-part="${part}"]`)].find(
            (element) => element.getAttribute("data-id") === selection.id,
          );
          if (current) /** @type {HTMLElement} */ (current).focus();
        }
        announce(`${selection.kind === "device" ? "Device" : "Group"} moved`);
        event.preventDefault();
        return;
      }
      cursor = {
        x: cursor.x + direction.x * step,
        y: cursor.y + direction.y * step,
      };
      renderCursor();
      announce(`Cursor at ${cursor.x}, ${cursor.y}`);
      event.preventDefault();
    };

    renderCursor();
    document.addEventListener("keydown", keydown);
    return Object.freeze({
      readCursor: () => ({ ...cursor }),
      disconnect: () => document.removeEventListener("keydown", keydown),
    });
  };

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.keymap = Object.freeze({
    entries: Object.freeze(entries),
    commands,
    create,
  });
}
