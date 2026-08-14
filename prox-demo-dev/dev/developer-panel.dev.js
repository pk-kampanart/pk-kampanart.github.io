/**
 * Development-only Developer panel. It owns no Plan state; this file may use
 * DOM and session storage because it is never included in production output.
 */
{
  const registry = new Map();
  const DEV_PARAM = "dev";
  let notifyRegistration = () => {};
  let togglePanel = () => start(true);
  let openPanel = () => start(true);

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

  const installToolbarButton = () => {
    const toolbar = document.querySelector('[data-part="tree-toolbar"]');
    if (!toolbar) return false;
    if (toolbar.querySelector('[data-part="toolbar-developer-panel"]'))
      return true;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.part = "toolbar-developer-panel";
    button.title = "Open developer panel (Ctrl+Shift+G)";
    button.setAttribute("aria-label", "Open developer panel");
    button.innerHTML = `
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
      >
        <path d="m5 4-3 4 3 4" />
        <path d="m11 4 3 4-3 4" />
        <path d="m9 2-2 12" />
      </svg>`;
    button.addEventListener("click", () => openPanel());
    // Its own group, mounted whole or not at all: production never renders an
    // empty landmark, and styles.css never names a development part.
    const group = document.createElement("div");
    group.dataset.part = "toolbar-group-development";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Development");
    group.style.display = "inline-flex";
    group.style.alignItems = "center";
    group.style.gap = "var(--space-1)";
    group.append(button);
    toolbar.append(group);
    return true;
  };

  const watchToolbar = () => {
    if (installToolbarButton()) return;
    const body = document.body;
    if (!body) return;
    const observer = new MutationObserver(() => {
      if (installToolbarButton()) observer.disconnect();
    });
    observer.observe(body, { childList: true, subtree: true });
  };

  watchToolbar();

  const start = (force = false) => {
    if (document.querySelector('[data-part="developer-panel"]')) return;

    const requestedKey = new URL(window.location.href).searchParams.get(
      DEV_PARAM,
    );
    if (!force && (!requestedKey || !registry.has(requestedKey))) return;

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
      <nav
        data-part="developer-panel-picker"
        role="tablist"
        aria-label="Developer panel pages"
      ></nav>
      <div
        id="developer-panel-page"
        data-part="developer-panel-page"
        role="tabpanel"
        tabindex="0"
      ></div>`;
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
        font: 14px/1.4 system-ui, sans-serif;
      }
      [data-part="developer-panel"][hidden] { display: none; }
      [data-part="developer-panel-header"],
      [data-part="developer-panel-picker"] {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-block-end: 1px solid var(--border, #d5dae2);
      }
      [data-part="developer-panel-title"] {
        min-width: 0;
        flex: 1;
        margin: 0;
        font-size: 0.95rem;
      }
      [data-part="developer-panel-picker"] {
        overflow-x: auto;
        scrollbar-width: thin;
      }
      [data-part="developer-panel-tab"] {
        flex: 0 0 auto;
        min-height: 28px;
        padding: 3px 8px;
        border: 0;
        border-block-end: 2px solid transparent;
        border-radius: 0;
        color: var(--text-muted, #586474);
        background: transparent;
        font-weight: 600;
      }
      [data-part="developer-panel-tab"][aria-selected="true"] {
        border-block-end-color: var(--accent, #1772e8);
        color: var(--accent-strong, #0f58b5);
        background: var(--accent-surface, #e8f1ff);
      }
      [data-part="developer-panel-page"] {
        min-height: 0;
        overflow: auto;
        padding: 12px;
      }
      [data-part="developer-panel"] button,
      [data-part="developer-panel"] select {
        min-height: 28px;
        border: 1px solid var(--border-strong, #8b95a5);
        border-radius: 4px;
        color: inherit;
        background: var(--surface-raised, #fff);
        font: inherit;
      }
      [data-part="developer-panel"] button { padding: 3px 8px; }
      [data-part="developer-panel"] button:focus-visible,
      [data-part="developer-panel"] select:focus-visible,
      [data-part="developer-panel"]:focus-visible {
        outline: 2px solid var(--accent, #1772e8);
        outline-offset: 2px;
      }
      [data-part="developer-panel-error"] {
        padding: 8px;
        color: #a61b1b;
        background: #fff0f0;
        white-space: pre-wrap;
      }
    `;
    document.head.append(style);

    const picker = /** @type {HTMLElement} */ (
      panel.querySelector('[data-part="developer-panel-picker"]')
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

    const tabs = () =>
      /** @type {HTMLElement[]} */ ([
        ...picker.querySelectorAll('[data-part="developer-panel-tab"]'),
      ]);

    const renderPicker = () => {
      picker.replaceChildren();
      for (const page of pages()) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.dataset.part = "developer-panel-tab";
        tab.dataset.key = page.key;
        tab.id = `developer-panel-tab-${page.key}`;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", "developer-panel-page");
        tab.setAttribute(
          "aria-selected",
          page.key === currentKey ? "true" : "false",
        );
        tab.tabIndex = page.key === currentKey ? 0 : -1;
        tab.textContent = page.title;
        picker.append(tab);
      }
    };

    const updateURL = (key) => {
      const url = new URL(window.location.href);
      url.searchParams.set(DEV_PARAM, key);
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    };

    const renderTabs = () => {
      for (const tab of tabs()) {
        const selected = tab.dataset.key === currentKey;
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.tabIndex = selected ? 0 : -1;
      }
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
    const switchPage = (key, syncURL = true) => {
      const page = registry.get(key);
      if (!page) return;
      if (key === mountedKey) {
        renderTabs();
        if (syncURL) updateURL(key);
        return;
      }
      try {
        cleanup?.();
      } catch (error) {
        // A broken experiment must not strand the page picker. Saying nothing
        // about it, though, means a cleanup that throws halfway leaves its
        // listeners attached and its styles in the document with no sign.
        // eslint-disable-next-line no-console
        console.warn("[dev-panel] page cleanup threw", error);
      }
      cleanup = null;
      mountedKey = key;
      currentKey = key;
      renderTabs();
      if (syncURL) updateURL(key);
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
      // Hiding the panel is not enough: a page that holds a radio, a network
      // connection or an advertisement watch goes on holding it behind a
      // hidden panel, and only a page change used to run the teardown. So
      // Close and Escape now do what switching pages does.
      try {
        cleanup?.();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[dev-panel] page cleanup threw", error);
      }
      cleanup = null;
      mountedKey = "";
      pageRoot.replaceChildren();
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

    currentKey = registry.has(requestedKey)
      ? requestedKey
      : pages()[0]?.key || "";
    renderPicker();
    renderTabs();

    picker.addEventListener("click", (event) => {
      const tab = event.target.closest('[data-part="developer-panel-tab"]');
      if (tab) switchPage(tab.dataset.key);
    });
    picker.addEventListener("keydown", (event) => {
      const current = event.target.closest('[data-part="developer-panel-tab"]');
      if (!current) return;
      const available = tabs();
      const index = available.indexOf(current);
      const offset =
        event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? -1
            : 0;
      const target =
        event.key === "Home"
          ? available[0]
          : event.key === "End"
            ? available.at(-1)
            : offset
              ? available[
                  (index + offset + available.length) % available.length
                ]
              : null;
      if (!target) return;
      event.preventDefault();
      target.focus();
      switchPage(target.dataset.key);
    });
    panel
      .querySelector('[data-part="developer-panel-close"]')
      ?.addEventListener("click", close);
    document.addEventListener(
      "keydown",
      (event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      },
      true,
    );

    notifyRegistration = () => {
      renderPicker();
      renderTabs();
    };

    togglePanel = toggle;
    openPanel = show;
    show();
  };

  document.addEventListener(
    "keydown",
    (event) => {
      const exactChord =
        event.key.toLowerCase() === "g" &&
        event.shiftKey &&
        !event.altKey &&
        event.ctrlKey !== event.metaKey;
      if (!exactChord) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) togglePanel();
    },
    true,
  );

  if (document.readyState === "complete") start();
  else
    document.addEventListener("DOMContentLoaded", () => start(), {
      once: true,
    });
}
