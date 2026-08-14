/**
 * The keyboard hub: the one place a key becomes a command.
 *
 * Every entry in `Planner.keymap` that names a command is routed here, and
 * nowhere else installs a document-level shortcut. A key that does not fire is
 * therefore answerable from one table: either no entry matched the chord, or
 * the entry matched and its region or mode did not.
 *
 * The hub owns the keys that act on the document or on the selection. A key
 * that acts on whatever has focus — Enter to select a row, F2 to rename it,
 * Alt+arrow to move it past a sibling, arrows to walk the tree — belongs to
 * the control the focus is in, and stays there.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {KeyboardEvent} event @returns {string} */
  const chordOf = (event) => {
    const key =
      event.key === " "
        ? "Space"
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.key;
    return `${event.ctrlKey || event.metaKey ? "Ctrl+" : ""}${
      event.altKey ? "Alt+" : ""
    }${event.shiftKey ? "Shift+" : ""}${key}`;
  };

  /** @param {HubOptions} options */
  const create = (options) => {
    if (typeof options?.dispatch !== "function")
      throw new TypeError("the keyboard hub requires dispatch");
    const { root, surface, dispatch } = options;
    const gestures = options.gestures;
    const entries = (options.keymap || planner.keymap).entries;

    /** @param {EventTarget | null} target @returns {string} */
    const regionOf = (target) => {
      const element = /** @type {Element | null} */ (target);
      if (element?.closest?.("dialog")) return "dialog";
      if (element?.closest?.('[data-part="splitter"]')) return "splitter";
      if (surface?.contains(element)) return "surface";
      if (root?.contains(element)) return "tree";
      return "";
    };

    /** @returns {{entity: string, id: string, floorId: string, disabled: boolean} | null} */
    const target = () => {
      const radio = /** @type {HTMLInputElement | null} */ (
        root?.querySelector('input[name="planner-selection"]:checked')
      );
      const anchor = radio?.closest("[data-anchor]");
      if (!anchor || !radio) return null;
      const entity = anchor.getAttribute("data-anchor") || "";
      return {
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

    /**
     * How each command builds its payload. A command missing from here is a
     * command the hub does not own.
     * @type {Record<string, (event: KeyboardEvent) => boolean>}
     */
    const commands = {
      undo: () => Boolean(dispatch({ command: "undo" })) || true,
      redo: () => Boolean(dispatch({ command: "redo" })) || true,
      save: () => {
        void Promise.resolve(dispatch({ command: "save" })).catch(() => {});
        return true;
      },
      "open-project": () => {
        dispatch({ command: "open-project" });
        return true;
      },
      help: () => {
        dispatch({ command: "help" });
        return true;
      },
      delete: () => {
        const selected = target();
        if (!selected?.id || selected.disabled) return false;
        dispatch({
          command: "delete",
          entity: selected.entity,
          id: selected.id,
          floorId: selected.floorId,
        });
        return true;
      },
      cancel: () => Boolean(gestures?.cancel()),
      commit: () => Boolean(gestures?.commit()),
      "draw-group": () => Boolean(gestures?.commit()),
      "move-cursor": (event) => Boolean(gestures?.move(event.key, 10)),
      "fine-move": (event) => Boolean(gestures?.move(event.key, 1)),
    };

    const keydown = (/** @type {KeyboardEvent} */ event) => {
      const chord = chordOf(event);
      const region = regionOf(event.target);
      const mode = document.documentElement.getAttribute("data-mode") || "idle";
      const editable = planner.dom.editable(event.target);
      // An entry naming this mode beats one that names any mode, so the table
      // reads in whatever order is clearest rather than in priority order.
      const matches = entries.filter(
        (entry) =>
          commands[entry.command] &&
          entry.keys.includes(chord) &&
          (!entry.region || entry.region.split(" ").includes(region)) &&
          (!entry.mode || entry.mode === mode) &&
          (!editable || entry.editable),
      );
      for (const entry of [
        ...matches.filter((entry) => entry.mode),
        ...matches.filter((entry) => !entry.mode),
      ]) {
        if (!commands[entry.command](event)) continue;
        event.preventDefault();
        return;
      }
    };

    document.addEventListener("keydown", keydown);
    return Object.freeze({
      disconnect: () => document.removeEventListener("keydown", keydown),
    });
  };

  planner.hub = Object.freeze({ create, chordOf });
}
