/**
 * Development-only Developer panel. It owns no Plan state; this file may use
 * DOM and session storage because it is never included in production output.
 */
{
  const registry = new Map();
  const pageStorageKey = "mesh-planner.developer-panel-page";
  let notifyRegistration = () => {};

  /** @param {unknown} value @returns {string} */
  const text = (value) => (typeof value === "string" ? value.trim() : "");

  /** @returns {string} */
  const keyFromCurrentScript = () => {
    const source = document.currentScript?.src || "";
    if (!source) throw new Error("Developer panel page needs a script URL");
    const name = new URL(source, document.baseURI).pathname.split("/").pop();
    const key = decodeURIComponent(name || "").replace(/\.dev\.js$/, "");
    if (!key) throw new Error("Developer panel page needs a file name");
    return key;
  };

  /** @param {any} definition */
  const register = (definition) => {
    const key = keyFromCurrentScript();
    if (registry.has(key))
      throw new Error(`developer page key must be unique: ${key}`);
    if (!text(definition?.title))
      throw new Error(`developer page ${key} needs a title`);
    if (typeof definition?.mount !== "function")
      throw new Error(`developer page ${key} needs a mount function`);
    registry.set(
      key,
      Object.freeze({
        key,
        title: text(definition.title),
        mount: definition.mount,
      }),
    );
    notifyRegistration();
  };

  window.PlannerDevPanel = Object.freeze({ register });

  const markDevelopment = () => {
    document.documentElement.dataset.build = "dev";
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", markDevelopment, {
      once: true,
    });
  else markDevelopment();

  const start = () => {
    if (document.querySelector('[data-part="developer-panel"]')) return;

    const panel = document.createElement("aside");
    panel.dataset.part = "developer-panel";
    panel.hidden = true;
    panel.tabIndex = -1;
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("aria-label", "Developer panel");
    panel.innerHTML = `
      <header data-part="developer-panel-header">
        <h2 data-part="developer-panel-title">Developer panel</h2>
        <button type="button" data-part="developer-panel-close">Close</button>
      </header>
      <div data-part="developer-panel-picker">
        <label data-part="developer-panel-picker-label">
          Page
          <select data-part="developer-panel-page-select" aria-label="Developer panel page"></select>
        </label>
      </div>
      <div data-part="developer-panel-page"></div>`;
    document.body.append(panel);

    const style = document.createElement("style");
    style.textContent = `
      [data-part="developer-panel"] {
        position: fixed;
        inset-block: 0;
        inset-inline-end: 0;
        z-index: 1100;
        display: grid;
        width: min(34rem, 100vw);
        grid-template-rows: auto auto minmax(0, 1fr);
        overflow: hidden;
        border-inline-start: 1px solid var(--border-strong, #8b95a5);
        color: var(--text, #17202b);
        background: var(--surface-raised, #fff);
        box-shadow: -8px 0 24px rgb(0 0 0 / 18%);
        font: 14px/1.4 system-ui, sans-serif;
      }
      [data-part="developer-panel"][hidden] { display: none; }
      [data-part="developer-panel-header"],
      [data-part="developer-panel-picker"] {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-block-end: 1px solid var(--border, #d5dae2);
      }
      [data-part="developer-panel-title"] {
        min-width: 0;
        flex: 1;
        margin: 0;
        font-size: 1rem;
      }
      [data-part="developer-panel-picker-label"] {
        display: grid;
        width: 100%;
        gap: 4px;
        color: var(--text-muted, #586474);
        font-weight: 600;
      }
      [data-part="developer-panel-picker"] select { width: 100%; }
      [data-part="developer-panel-page"] {
        min-height: 0;
        overflow: auto;
        padding: 16px;
      }
      [data-part="developer-panel"] button,
      [data-part="developer-panel"] select {
        min-height: 32px;
        border: 1px solid var(--border-strong, #8b95a5);
        border-radius: 4px;
        color: inherit;
        background: var(--surface-raised, #fff);
        font: inherit;
      }
      [data-part="developer-panel"] button { padding: 4px 10px; }
      [data-part="developer-panel"] button:focus-visible,
      [data-part="developer-panel"] select:focus-visible,
      [data-part="developer-panel"]:focus-visible {
        outline: 2px solid var(--accent, #1772e8);
        outline-offset: 2px;
      }
      [data-part="developer-panel-error"] {
        padding: 12px;
        color: #a61b1b;
        background: #fff0f0;
        white-space: pre-wrap;
      }
    `;
    document.head.append(style);

    const picker = /** @type {HTMLSelectElement} */ (
      panel.querySelector('[data-part="developer-panel-page-select"]')
    );
    const pageTitle = /** @type {HTMLElement} */ (
      panel.querySelector('[data-part="developer-panel-title"]')
    );
    const pageRoot = /** @type {HTMLElement} */ (
      panel.querySelector('[data-part="developer-panel-page"]')
    );
    let currentKey = "";
    let mountedKey = "";
    let cleanup = null;
    let previousFocus = null;
    let open = false;

    const pages = () =>
      [...registry.values()].sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      );

    const storedKey = () => {
      try {
        return sessionStorage.getItem(pageStorageKey) || "";
      } catch {
        return "";
      }
    };

    /** @param {string} key */
    const rememberKey = (key) => {
      try {
        sessionStorage.setItem(pageStorageKey, key);
      } catch {
        // Private browsing can disable session storage; the panel still works.
      }
    };

    const renderPicker = () => {
      picker.replaceChildren();
      for (const page of pages()) {
        const option = document.createElement("option");
        option.value = page.key;
        option.textContent = page.title;
        picker.append(option);
      }
      picker.disabled = pages().length === 0;
      if (currentKey) picker.value = currentKey;
    };

    /** @param {unknown} error */
    const renderError = (error) => {
      pageRoot.replaceChildren();
      const message = document.createElement("p");
      message.dataset.part = "developer-panel-error";
      message.setAttribute("role", "alert");
      message.textContent = `Could not mount ${currentKey}: ${String(error)}`;
      pageRoot.append(message);
    };

    /** @param {string} key */
    const switchPage = (key) => {
      const page = registry.get(key);
      if (!page) return;
      if (key === mountedKey) return;
      try {
        cleanup?.();
      } catch {
        // A broken experiment must not strand the page picker.
      }
      cleanup = null;
      mountedKey = key;
      currentKey = key;
      rememberKey(key);
      picker.value = key;
      pageTitle.textContent = `Developer panel · ${page.title}`;
      pageRoot.replaceChildren();
      try {
        const result = page.mount(pageRoot);
        if (result !== undefined && typeof result !== "function")
          throw new TypeError(
            "mount must return a cleanup function or nothing",
          );
        cleanup = result || null;
      } catch (error) {
        renderError(error);
      }
    };

    // Docked, not floating: the app shrinks by the panel's width so the panel
    // covers no planner content.
    /** @param {boolean} on */
    const dock = (on) => {
      const app = /** @type {HTMLElement|null} */ (
        document.querySelector('[data-part="app"]')
      );
      if (!app) return;
      app.style.paddingInlineEnd = on
        ? `${panel.getBoundingClientRect().width}px`
        : "";
    };

    const close = () => {
      if (!open) return;
      open = false;
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
      dock(false);
      if (previousFocus?.isConnected) previousFocus.focus();
      previousFocus = null;
    };

    const show = () => {
      if (open) return;
      open = true;
      previousFocus = document.activeElement;
      panel.hidden = false;
      panel.setAttribute("aria-hidden", "false");
      dock(true);
      panel.focus();
      if (currentKey) switchPage(currentKey);
    };

    const toggle = () => (open ? close() : show());

    currentKey = storedKey();
    if (!registry.has(currentKey)) currentKey = pages()[0]?.key || "";
    renderPicker();
    if (currentKey) picker.value = currentKey;

    picker.addEventListener("change", () => switchPage(picker.value));
    panel
      .querySelector('[data-part="developer-panel-close"]')
      ?.addEventListener("click", close);
    document.addEventListener(
      "keydown",
      (event) => {
        const exactChord =
          event.key.toLowerCase() === "g" &&
          event.shiftKey &&
          !event.altKey &&
          event.ctrlKey !== event.metaKey;
        if (exactChord && !event.repeat) {
          event.preventDefault();
          event.stopPropagation();
          toggle();
        } else if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      },
      true,
    );

    notifyRegistration = () => {
      renderPicker();
      if (!currentKey) {
        currentKey = pages()[0]?.key || "";
        if (open && currentKey) switchPage(currentKey);
      }
    };
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
