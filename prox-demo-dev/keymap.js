/**
 * Declares keyboard bindings as data, and owns the surface's pointing gestures.
 *
 * The table is the routing table: `src/hub.js` reads it to turn a chord into a
 * command, and the shortcut dialog reads it to list them. An entry's `region`
 * is where focus must be — one of `tree`, `surface`, `splitter`, `dialog`, or
 * several separated by a space, and "" for anywhere. Its `mode` names the
 * selection that must be armed ("" any), and `editable` whether it still fires
 * inside a text control.
 * Channels: none.
 */
{
  /** @typedef {{keys: string[], command: string, region?: string, mode?: string, editable?: boolean, description: string}} KeymapSource */
  /** @type {KeymapSource[]} */
  const sources = [
    {
      keys: ["F1", "?"],
      command: "help",
      editable: false,
      description: "Keyboard help",
    },
    {
      keys: ["Ctrl+O"],
      command: "open-project",
      description: "Open project",
    },
    {
      keys: ["Ctrl+S"],
      command: "save",
      description: "Save now",
    },
    {
      keys: ["Ctrl+Z"],
      command: "undo",
      description: "Undo",
    },
    {
      keys: ["Ctrl+Shift+Z", "Ctrl+Y"],
      command: "redo",
      description: "Redo",
    },
    {
      keys: ["Delete", "Backspace"],
      command: "delete",
      region: "tree surface",
      description: "Delete selection",
    },
    {
      keys: ["F2"],
      command: "rename",
      region: "tree",
      description: "Rename focused entry",
    },
    {
      keys: ["Tab"],
      command: "focus-next",
      region: "tree",
      description: "Move focus through the tree",
    },
    {
      keys: ["Enter", "Space"],
      command: "select",
      region: "tree",
      description: "Select focused entry",
    },
    {
      keys: ["ArrowLeft"],
      command: "collapse-branch",
      region: "tree",
      description: "Collapse the focused branch or move to its parent",
    },
    {
      keys: ["ArrowRight"],
      command: "expand-branch",
      region: "tree",
      description: "Expand the focused branch",
    },
    {
      keys: ["Alt+ArrowLeft", "Alt+ArrowRight", "Alt+ArrowUp", "Alt+ArrowDown"],
      command: "reorder",
      region: "tree",
      description: "Move past a sibling",
    },
    {
      keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"],
      command: "resize-panel",
      region: "splitter",
      description: "Resize workflow panel",
    },
    {
      keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
      command: "move-cursor",
      region: "tree surface",
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
      region: "tree surface",
      description: "Use fine movement step",
    },
    {
      keys: ["Enter"],
      command: "commit",
      region: "tree surface",
      description: "Commit placement or drawing",
    },
    {
      keys: ["Enter"],
      command: "draw-group",
      region: "tree surface",
      mode: "group",
      description: "Set both group corners",
    },
    {
      keys: ["Escape"],
      command: "cancel",
      region: "tree surface",
      description: "Cancel the current gesture",
    },
    {
      keys: ["wheel"],
      command: "zoom",
      region: "pointer",
      description: "Zoom the floor plan",
    },
    {
      keys: ["drag", "Space-drag"],
      command: "pan",
      region: "pointer",
      description: "Pan the floor plan",
    },
    {
      keys: ["edge/corner handle"],
      command: "resize-group",
      region: "pointer",
      description: "Resize a selected group",
    },
  ];

  /** @param {KeymapSource} entry @returns {string} */
  const displayOf = (entry) =>
    ({
      help: "F1 / ?",
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
   * @typedef {{root?: Element | null, surface: Element, store?: {read: () => PlanDocument}, dispatch: (command: Record<string, unknown>) => unknown, announce?: (message: string) => void}} KeymapOptions
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
      floorId: document.documentElement.getAttribute("data-active-floor") || "",
    });
    const selectedRecord = (
      /** @type {{kind: string, id: string}} */ selection,
    ) => {
      for (const floor of options.store?.read().floors || [])
        for (const application of floor.applications || []) {
          /** @type {Array<[string, Array<Group | DeviceType>]>} */
          const collections = [
            ["group", application.groups || []],
            ["device-type", application.deviceTypes || []],
          ];
          for (const [kind, values] of collections)
            if (selection.kind === kind) {
              const found = values.find((value) => value.id === selection.id);
              if (found) return found;
            }
          for (const type of application.deviceTypes || []) {
            const found = (type.instances || []).find(
              (value) =>
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
      if (
        selection.kind === "group" &&
        record &&
        "rect" in record &&
        record.rect
      )
        cursor = {
          x: record.rect.x + record.rect.width / 2,
          y: record.rect.y + record.rect.height / 2,
        };
      else if (selection.kind === "device" && record && "x" in record)
        cursor = { x: record.x, y: record.y };
      renderCursor();
    };
    // The hub routes the chord; these decide whether the gesture applies and
    // report back, so a key it does not use stays available to its control.
    const applies = () => {
      if (surface.contains(document.activeElement)) return true;
      const selection = active();
      const row = document.activeElement?.closest?.(
        '[data-anchor="group"] [data-part="tree-row"]',
      );
      return Boolean(
        options.root?.contains(document.activeElement) &&
        selection.kind === "group" &&
        row?.closest('[data-anchor="group"]')?.getAttribute("data-id") ===
          selection.id,
      );
    };

    const cancel = () => {
      if (!applies() || !surface.hasAttribute("data-anchor-x")) return false;
      surface.removeAttribute("data-anchor-x");
      surface.removeAttribute("data-anchor-y");
      announce("Drawing cancelled");
      return true;
    };

    const commit = () => {
      if (!applies()) return false;
      const selection = active();
      if (selection.kind === "group" && selection.id) {
        if (!surface.hasAttribute("data-anchor-x")) {
          syncEntityCursor(selection);
          surface.setAttribute("data-anchor-x", String(cursor.x));
          surface.setAttribute("data-anchor-y", String(cursor.y));
          announce(`First corner of group set at ${cursor.x}, ${cursor.y}`);
          return true;
        }
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
        return true;
      }
      if (selection.kind === "device-type" && selection.id) {
        options.dispatch({
          command: "place-instance",
          typeId: selection.id,
          floorId: selection.floorId,
          point: { ...cursor },
        });
        announce(`Device instance placed at ${cursor.x}, ${cursor.y}`);
        return true;
      }
      return false;
    };

    /** @param {string} key @param {number} step */
    const move = (key, step) => {
      const direction = directionOf(key);
      if (!direction || !applies()) return false;
      const selection = active();
      const focusedSurface = surface.contains(document.activeElement);
      if (
        (selection.kind === "device" || selection.kind === "group") &&
        !surface.hasAttribute("data-anchor-x")
      ) {
        const delta = { x: direction.x * step, y: direction.y * step };
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
          const current = [
            ...surface.querySelectorAll(`[data-part="${part}"]`),
          ].find((element) => element.getAttribute("data-id") === selection.id);
          if (current) /** @type {HTMLElement} */ (current).focus();
        }
        announce(`${selection.kind === "device" ? "Device" : "Group"} moved`);
        return true;
      }
      if (!focusedSurface) return false;
      cursor = {
        x: cursor.x + direction.x * step,
        y: cursor.y + direction.y * step,
      };
      renderCursor();
      announce(`Cursor at ${cursor.x}, ${cursor.y}`);
      return true;
    };

    renderCursor();
    return Object.freeze({
      readCursor: () => ({ ...cursor }),
      cancel,
      commit,
      move,
      disconnect: () => {},
    });
  };

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.keymap = Object.freeze({
    entries: Object.freeze(entries),
    commands,
    create,
  });
}
