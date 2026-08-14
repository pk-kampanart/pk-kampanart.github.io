/**
 * Development-only JSON editor shared by Developer panel pages. It builds its
 * own modal dialog and styles because it is excluded from production, and it
 * claims Escape before the Developer panel's own handler while it is open.
 *
 * Planner.devJsonEditor.open({title, text, readOnly, validate, apply,
 * applyLabel, actions}) shows one editor at a time and returns {close}.
 * Apply parses the text, lists the parse error with its line and column or
 * validate(text)'s messages, then awaits apply(value) with the parsed value
 * and closes; a thrown error is listed instead. Each action's run(text) runs
 * as is, and its thrown error is listed. Close and Escape return focus to the
 * element that had it when the editor opened.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  const STYLE = `
    [data-part="dev-json-editor"] { width: min(60rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); height: min(48rem, 86vh); max-height: 86vh; box-sizing: border-box; padding: var(--space-6); border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-dialog); background: var(--surface-raised); color: var(--text); font: var(--size-2) / 1.35 var(--font-ui); }
    [data-part="dev-json-editor"][open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: var(--space-4); }
    [data-part="dev-json-editor"]::backdrop { background: var(--scrim); }
    [data-part="dev-json-editor-heading"] { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
    [data-part="dev-json-editor-heading"] h2 { margin: 0; font-size: var(--size-3); color: var(--ink); }
    [data-part="dev-json-editor-text"] { width: 100%; height: 100%; min-height: 8rem; box-sizing: border-box; resize: none; margin: 0; padding: var(--space-4); border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-inset); color: var(--text); font: var(--size-1) / 1.45 var(--font-mono); tab-size: 2; white-space: pre; overflow: auto; }
    [data-part="dev-json-editor-errors"]:empty { display: none; }
    [data-part="dev-json-editor-errors"] ul { margin: 0; padding-inline-start: var(--space-6); color: var(--danger-strong); font: var(--size-1) / 1.45 var(--font-mono); max-height: 8rem; overflow: auto; }
    [data-part="dev-json-editor-actions"] { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-3); }
    [data-part="dev-json-editor"] button { font: inherit; padding: var(--space-1) var(--space-4); border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-sm); background: var(--control-surface); color: var(--text); cursor: pointer; }
    [data-part="dev-json-editor"] button:hover { background: var(--control-surface-hover); }
    [data-part="dev-json-editor"] button:disabled { cursor: default; opacity: .6; }
    [data-part="dev-json-editor"] button[data-part="dev-json-editor-apply"] { background: var(--accent); border-color: var(--accent-strong); color: var(--surface-raised); }
  `;

  const LITERAL =
    /true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const SPACE = /[ \t\n\r]*/y;
  /** Where JSON.parse stopped: not every browser message carries a position.
   * @param {string} text @returns {number} */
  const errorOffset = (text) => {
    let at = 0;
    const space = () => {
      SPACE.lastIndex = at;
      SPACE.exec(text);
      at = SPACE.lastIndex;
    };
    const fail = () => {
      throw at;
    };
    const string = () => {
      at += 1;
      for (;;) {
        const char = text[at];
        if (char === undefined || char < " ") fail();
        if (char === '"') return void (at += 1);
        if (char !== "\\") at += 1;
        else if (/^["\\/bfnrt]/.test(text[at + 1] || "")) at += 2;
        else if (/^u[0-9a-fA-F]{4}/.test(text.slice(at + 1, at + 6))) at += 6;
        else fail();
      }
    };
    /** @param {string} close @param {() => void} item */
    const list = (close, item) => {
      at += 1;
      space();
      if (text[at] === close) return void (at += 1);
      for (;;) {
        item();
        space();
        if (text[at] === close) return void (at += 1);
        if (text[at] !== ",") fail();
        at += 1;
      }
    };
    const value = () => {
      space();
      const char = text[at];
      if (char === "{")
        list("}", () => {
          space();
          if (text[at] !== '"') fail();
          string();
          space();
          if (text[at] !== ":") fail();
          at += 1;
          value();
        });
      else if (char === "[") list("]", value);
      else if (char === '"') string();
      else {
        LITERAL.lastIndex = at;
        if (!LITERAL.exec(text)) fail();
        at = LITERAL.lastIndex;
      }
    };
    try {
      value();
      space();
      if (at < text.length) fail();
    } catch (offset) {
      return /** @type {number} */ (offset);
    }
    return text.length;
  };

  /** @param {string} text @returns {{value: unknown} | {error: string, offset: number}} */
  const parse = (text) => {
    try {
      return { value: JSON.parse(text) };
    } catch (error) {
      const offset = errorOffset(text);
      const before = text.slice(0, offset).split("\n");
      const reason = String(/** @type {Error} */ (error).message)
        .replace(/ in JSON at position \d+.*$/, "")
        .replace(/, ".*" is not valid JSON$/s, "");
      return {
        error: `Line ${before.length}, column ${before.at(-1).length + 1}: ${reason}`,
        offset,
      };
    }
  };

  /** @type {(() => void) | null} */
  let closeOpen = null;
  /** @type {Element | null} */
  let keptOpener = null;
  let serial = 0;
  /** @param {DevJsonEditorOptions} options */
  const open = (options) => {
    // A second editor replaces the first and keeps the first one's opener.
    const opener = closeOpen ? keptOpener : document.activeElement;
    closeOpen?.();
    keptOpener = opener;
    const id = `dev-json-editor-${(serial += 1)}`;
    const style = document.createElement("style");
    style.textContent = STYLE;
    const dialog = document.createElement("dialog");
    dialog.dataset.part = "dev-json-editor";
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    dialog.innerHTML = `
      <div data-part="dev-json-editor-heading">
        <h2 id="${id}-title"></h2>
        <button type="button" data-part="dev-json-editor-close">Close</button>
      </div>
      <textarea data-part="dev-json-editor-text" spellcheck="false" autocomplete="off" wrap="off" aria-labelledby="${id}-title" aria-describedby="${id}-errors"></textarea>
      <div data-part="dev-json-editor-errors" id="${id}-errors" role="alert"></div>
      <div data-part="dev-json-editor-actions"></div>`;
    /** @param {string} name @returns {any} */
    const part = (name) =>
      dialog.querySelector(`[data-part="dev-json-editor-${name}"]`);
    dialog.querySelector("h2").textContent = options.title;
    const textarea = /** @type {HTMLTextAreaElement} */ (part("text"));
    textarea.value = options.text;
    textarea.readOnly = Boolean(options.readOnly);
    const errors = part("errors");
    /** @param {string[]} messages */
    const show = (messages) => {
      if (!messages.length) return errors.replaceChildren();
      const items = document.createElement("ul");
      for (const text of messages) {
        const item = document.createElement("li");
        item.textContent = text;
        items.append(item);
      }
      errors.replaceChildren(items);
    };
    /** @param {unknown} error */
    const reason = (error) =>
      error instanceof Error ? error.message : String(error);
    const buttons = part("actions");
    /** @type {HTMLButtonElement[]} */
    const busyButtons = [];
    /** @param {() => Promise<void>} work */
    const busy = async (work) => {
      for (const button of busyButtons) button.disabled = true;
      try {
        await work();
      } finally {
        for (const button of busyButtons) button.disabled = false;
      }
    };
    for (const action of options.actions || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () =>
        busy(async () => {
          show([]);
          try {
            await action.run(textarea.value);
          } catch (error) {
            if (dialog.isConnected) show([reason(error)]);
          }
        }),
      );
      busyButtons.push(button);
      buttons.append(button);
    }
    if (!options.readOnly && options.apply) {
      const apply = options.apply;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.part = "dev-json-editor-apply";
      button.textContent = options.applyLabel || "Apply";
      button.addEventListener("click", () =>
        busy(async () => {
          const text = textarea.value;
          const parsed = parse(text);
          if ("error" in parsed) {
            show([parsed.error]);
            textarea.focus();
            textarea.setSelectionRange(parsed.offset, parsed.offset);
            return;
          }
          const invalid = options.validate?.(text) || [];
          if (invalid.length) return show(invalid);
          show([]);
          try {
            await apply(parsed.value);
          } catch (error) {
            if (dialog.isConnected) show([reason(error)]);
            return;
          }
          close();
        }),
      );
      busyButtons.push(button);
      buttons.append(button);
    }
    // Escape belongs to the editor while it is open; the Developer panel
    // listens in document capture, so claim it first at window capture.
    /** @param {KeyboardEvent} event */
    const escape = (event) => {
      if (event.key !== "Escape" || !dialog.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    const close = () => {
      if (!dialog.isConnected) return;
      window.removeEventListener("keydown", escape, true);
      if (dialog.open) dialog.close();
      dialog.remove();
      style.remove();
      if (closeOpen === close) {
        closeOpen = null;
        keptOpener = null;
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      }
    };
    part("close").addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    window.addEventListener("keydown", escape, true);
    document.head.append(style);
    document.body.append(dialog);
    closeOpen = close;
    dialog.showModal();
    textarea.focus();
    textarea.setSelectionRange(0, 0);
    textarea.scrollTop = 0;
    return Object.freeze({ close });
  };

  planner.devJsonEditor = Object.freeze({ open });
}
