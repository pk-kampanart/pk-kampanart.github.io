/**
 * Development-only prototype review host. It deliberately keeps its registry,
 * CSS, review form, and drag behavior in one file for fast iteration. The
 * production selector and subtree-building rules do not apply here because
 * this file is loaded only by the development server and development build.
 */
{
  const hostScript = document.currentScript;
  const isolatedKey = hostScript?.dataset.prototypeIsolation || "";
  const registry = new Map();
  const NOTE_LIMIT = 500;
  const SHARE_URL_LIMIT = 8000;
  const SAVE_DELAY = 250;
  const PANEL_EDGE = 12;
  const POSITION_KEY = "mesh-planner.prototype-panel-position";
  const steps = new Set(["prototype", "variants", "notes", "summary"]);

  /** @param {string} value */
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );

  /** @param {unknown} value */
  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};

  /** @param {unknown} value */
  const string = (value) => (typeof value === "string" ? value : "");

  /** @param {unknown} value */
  const encode = (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  };

  /** @param {string} value */
  const decode = (value) => {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      ),
    );
  };

  /** @param {any} definition */
  const register = (definition) => {
    const source = document.currentScript?.src || "";
    // The filename is the key everywhere else -- `--prototype`, the isolation
    // attribute, `?prototype=` -- so it wins here too.
    const fileKey = source
      ? (new URL(source).pathname.split("/").pop() || "").replace(
          /\.dev\.js$/,
          "",
        )
      : "";
    const key = string(definition?.key) || fileKey;
    if (!key || registry.has(key))
      throw new Error(`prototype key must be unique: ${key || "missing"}`);
    if (fileKey && key !== fileKey)
      throw new Error(`prototype key ${key} must match its file name ${fileKey}`);
    if (!Array.isArray(definition.variants) || definition.variants.length === 0)
      throw new Error(`prototype ${key} needs at least one variant`);
    if (typeof definition.mount !== "function")
      throw new Error(`prototype ${key} needs a mount function`);

    registry.set(key, {
      ...definition,
      key,
      title: string(definition.title) || key,
      question: string(definition.question),
      revision: source
        ? new URL(source).searchParams.get("v") || "unversioned"
        : "unversioned",
      variants: definition.variants.map((variant) => ({
        key: string(variant.key),
        name: string(variant.name) || string(variant.key),
        description: string(variant.description),
      })),
    });
  };

  window.PlannerDev = Object.freeze({ register });

  const style = document.createElement("style");
  style.textContent = `
    [data-part="prototype-fab"] {
      position: fixed;
      inset-inline-end: ${PANEL_EDGE}px;
      inset-block-end: ${PANEL_EDGE}px;
      z-index: 1000;
      min-height: 42px;
      padding-inline: 16px;
      border-radius: 999px;
      box-shadow: var(--shadow-dialog);
      font-weight: 700;
    }

    [data-part="prototype-panel"] {
      position: fixed;
      inset-inline-end: ${PANEL_EDGE}px;
      inset-block-end: ${PANEL_EDGE}px;
      z-index: 1000;
      display: grid;
      width: min(30rem, calc(100vw - ${PANEL_EDGE * 2}px));
      max-height: min(80vh, 44rem);
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
      border: var(--border-width) solid var(--border-strong);
      border-radius: var(--radius-lg);
      color: var(--text);
      background: var(--surface-raised);
      box-shadow: var(--shadow-dialog);
    }

    [data-part="prototype-panel"][hidden],
    [data-part="prototype-fab"][hidden] {
      display: none;
    }

    [data-part="prototype-panel-header"] {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-4);
      border-bottom: var(--border-width) solid var(--border);
      cursor: move;
      touch-action: none;
      user-select: none;
    }

    [data-part="prototype-panel-title"] {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    [data-part="prototype-panel-header"] button,
    [data-part="prototype-panel-body"] button,
    [data-part="prototype-panel-body"] select {
      width: auto;
      min-height: 30px;
      padding-inline: var(--space-4);
    }

    [data-part="prototype-panel-body"] {
      min-height: 0;
      overflow: auto;
      padding: var(--space-5);
    }

    [data-part="prototype-picker"] {
      display: grid;
      gap: var(--space-2);
      margin-block-end: var(--space-5);
      color: var(--text-muted);
      font-weight: 600;
    }

    [data-part="prototype-picker"] select {
      width: 100%;
    }

    [data-part="prototype-progress"] {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: end;
      gap: var(--space-3);
      margin-block-end: var(--space-5);
    }

    [data-part="prototype-progress"] > div {
      display: grid;
      min-width: 0;
      gap: var(--space-2);
      justify-items: center;
      text-align: center;
    }

    [data-part="prototype-progress-label"] {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    [data-part="prototype-progress-dots"],
    [data-part="prototype-variant-dots"] {
      display: flex;
      justify-content: center;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    [data-part="prototype-progress-dots"] li,
    [data-part="prototype-variant-dots"] li {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--border-strong);
    }

    [data-part="prototype-progress-dots"] li[data-state="complete"],
    [data-part="prototype-variant-dots"] li[data-state="complete"] {
      background: var(--accent);
    }

    [data-part="prototype-progress-dots"] li[data-state="current"],
    [data-part="prototype-variant-dots"] li[data-state="current"] {
      width: 12px;
      height: 12px;
      margin-block-start: -1px;
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      background: var(--accent-strong);
    }

    [data-part="prototype-progress-dots"] li[data-state="upcoming"],
    [data-part="prototype-variant-dots"] li[data-state="upcoming"] {
      background: var(--border);
    }

    [data-part="prototype-review-tabs"] {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-2);
      margin-block-end: var(--space-5);
    }

    [data-part="prototype-review-tabs"] [aria-current="step"] {
      border-color: var(--accent);
      color: var(--accent-strong);
      background: var(--accent-surface);
    }

    [data-part="prototype-summary-tab"] {
      margin-block-end: var(--space-5);
      padding-block-end: var(--space-4);
      border-block-end: var(--border-width) solid var(--border-strong);
    }

    [data-part="prototype-summary-tab"] button {
      width: 100%;
    }

    [data-part="prototype-summary-tab"] [aria-current="step"] {
      border-color: var(--accent);
      color: var(--accent-strong);
      background: var(--accent-surface);
    }

    [data-part="prototype-step"] h2,
    [data-part="prototype-step"] h3,
    [data-part="prototype-step"] p {
      margin-block-start: 0;
    }

    [data-part="prototype-state"] {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--space-2) var(--space-4);
      margin-block: var(--space-5);
      padding: var(--space-4);
      border-radius: var(--radius);
      background: var(--surface-inset);
    }

    [data-part="prototype-state"] > div {
      display: contents;
    }

    [data-part="prototype-state"] dt {
      color: var(--text-muted);
      font-weight: 600;
    }

    [data-part="prototype-state"] dd {
      margin: 0;
    }

    [data-part="prototype-field"],
    [data-part="prototype-choice"] {
      display: grid;
      gap: var(--space-2);
      margin-block: var(--space-5);
    }

    [data-part="prototype-field"] textarea {
      width: 100%;
      min-height: 3.5rem;
      field-sizing: content;
      resize: vertical;
    }

    [data-part="prototype-field"] textarea::placeholder {
      color: var(--text-faint);
      opacity: 1;
    }

    [data-part="prototype-note-count"] {
      color: var(--text-faint);
      font-size: var(--size-1);
      text-align: end;
    }

    [data-part="prototype-choice"] label {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    [data-part="prototype-choice"] input {
      margin: 0;
    }

    [data-part="prototype-summary-choice"] {
      display: grid;
      gap: var(--space-2);
      margin-block: var(--space-4);
    }

    [data-part="prototype-summary-choice-option"] {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    [data-part="prototype-summary-choice-option"] input {
      margin: 0;
    }

    [data-part="prototype-step-actions"] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-block-start: var(--space-5);
    }

    [data-part="prototype-step"][data-step="notes"],
    [data-part="prototype-step"][data-step="summary"] {
      padding-block-end: var(--space-5);
    }

    [data-part="prototype-step"][data-step="notes"] [data-part="prototype-step-actions"],
    [data-part="prototype-step"][data-step="summary"] [data-part="prototype-step-actions"] {
      position: sticky;
      bottom: 0;
      z-index: 1;
      padding-block: var(--space-3);
      background: var(--surface-raised);
      border-block-start: var(--border-width) solid var(--border);
    }

    [data-part="prototype-variant-navigation"] {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--space-3);
      margin-block-end: var(--space-5);
      text-align: center;
    }

    [data-part="prototype-variant-navigation"] > div {
      display: grid;
      min-width: 0;
      gap: var(--space-2);
      justify-items: center;
    }

    [data-part="prototype-variant-status"] {
      min-width: 0;
      text-align: center;
    }

    [data-part="prototype-alert"] {
      margin-block-end: var(--space-4);
      padding: var(--space-4);
      border: var(--border-width) solid var(--notice);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--notice) 12%, white);
    }

    [data-part="prototype-summary-notes"] {
      display: grid;
      gap: var(--space-4);
      margin-block-end: var(--space-5);
    }

    [data-part="prototype-summary-note"] {
      padding: var(--space-4);
      border: var(--border-width) solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-inset);
    }

    [data-part="prototype-summary-note"] h4 {
      margin-block: 0 var(--space-3);
    }

    [data-part="prototype-summary-note-variants"] {
      margin-block-start: var(--space-5);
      padding-block-start: var(--space-4);
      border-block-start: var(--border-width) solid var(--border);
    }

    [data-part="prototype-summary-variant"] {
      display: grid;
      gap: var(--space-2);
    }

    [data-part="prototype-summary-variant-header"] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }

    [data-part="prototype-summary-variant-header"] button {
      flex: 0 0 auto;
    }

    [data-part="prototype-share-status"] {
      min-height: 1.5em;
      color: var(--text-muted);
      font-size: var(--size-1);
    }
  `;

  /** @param {Record<string, any>} catalog */
  const freshReview = (catalog) => ({ version: 1, catalog, responses: {} });

  /** @param {any} raw @param {Record<string, any>} catalog */
  const normalizeReview = (raw, catalog) => {
    const value = object(raw);
    return {
      version: 1,
      catalog: object(value.catalog),
      responses: object(value.responses),
      ...(Object.keys(object(value.catalog)).length === 0 ? { catalog } : {}),
    };
  };

  const start = async () => {
    const ready = window.Planner?.app?.ready?.();
    if (ready && typeof ready.then === "function") await ready;

    const catalog = Object.fromEntries(
      [...registry.values()].map((prototype) => [
        prototype.key,
        {
          title: prototype.title,
          revision: prototype.revision,
          variants: prototype.variants.map((variant) => variant.key),
        },
      ]),
    );
    const params = new URLSearchParams(window.location.search);
    let reviewError = "";
    let review;
    try {
      review = params.has("review")
        ? normalizeReview(decode(params.get("review")), catalog)
        : freshReview(catalog);
    } catch {
      reviewError =
        "This response link could not be read. A fresh review is shown.";
      review = freshReview(catalog);
    }

    const requestedSet = params.get("prototypes");
    const selectedKeys = requestedSet
      ? [
          ...new Set(
            requestedSet
              .split(",")
              .map((key) => key.trim())
              .filter(Boolean),
          ),
        ]
      : [...registry.keys()];
    const listedPrototypes = selectedKeys
      .map((key) => registry.get(key))
      .filter(Boolean);
    const defaultSelected = listedPrototypes.find(
      (prototype) => prototype.default,
    );
    const selectedPrototypes = defaultSelected
      ? [
          defaultSelected,
          ...listedPrototypes.filter(
            (prototype) => prototype.key !== defaultSelected.key,
          ),
        ]
      : listedPrototypes;
    const missingSelected = selectedKeys.filter((key) => !registry.has(key));
    const setError = missingSelected.length
      ? `Selected prototypes were not loaded: ${missingSelected.join(", ")}.`
      : "";
    const defaultPrototype =
      isolatedKey ||
      selectedPrototypes.find((prototype) => prototype.default)?.key ||
      selectedPrototypes[0]?.key ||
      "none";
    const requestedKey = params.get("prototype") || defaultPrototype;
    let active = requestedKey === "none" ? null : registry.get(requestedKey);
    let activeError = setError;
    if (
      isolatedKey &&
      requestedKey !== "none" &&
      requestedKey !== isolatedKey
    ) {
      active = null;
      activeError = `This server is isolated to ${isolatedKey}. ${requestedKey} was not loaded.`;
    } else if (
      requestedSet &&
      requestedKey !== "none" &&
      !selectedKeys.includes(requestedKey)
    ) {
      active = null;
      activeError = `${activeError ? `${activeError} ` : ""}${requestedKey} is not in the selected prototype set.`;
    } else if (requestedKey !== "none" && !active) {
      activeError = `${activeError ? `${activeError} ` : ""}Prototype not found: ${requestedKey}.`;
    }

    const requestedVariant = params.get("variant");
    const activeVariant = active
      ? active.variants.find((variant) => variant.key === requestedVariant) ||
        active.variants[0]
      : null;
    if (
      active &&
      requestedVariant &&
      !active.variants.some((variant) => variant.key === requestedVariant)
    )
      activeError = `${activeError ? `${activeError} ` : ""}Variant not found: ${requestedVariant}. Showing ${activeVariant.key}.`;

    let currentStep = steps.has(params.get("reviewStep"))
      ? params.get("reviewStep")
      : "prototype";
    let responseSaved = true;
    let saveProblem = "";
    let pendingSave = 0;

    document.head.append(style);
    const fab = document.createElement("button");
    fab.type = "button";
    fab.dataset.part = "prototype-fab";
    fab.setAttribute("aria-controls", "prototype-panel");
    fab.setAttribute("aria-expanded", "false");
    fab.textContent = "Prototype review";
    fab.hidden = true;

    const panel = document.createElement("section");
    panel.dataset.part = "prototype-panel";
    panel.id = "prototype-panel";
    panel.setAttribute("aria-label", "Prototype review");
    panel.innerHTML = `
      <header data-part="prototype-panel-header">
        <strong data-part="prototype-panel-title">Prototype review</strong>
        <button type="button" data-action="original">Original</button>
        <button type="button" data-action="collapse" aria-label="Collapse prototype review">−</button>
      </header>
      <div data-part="prototype-panel-body">
        <div data-part="prototype-summary-tab">
          <button type="button" data-step="summary">Summary</button>
        </div>
        <label data-part="prototype-picker">
          Prototype
          <select data-action="prototype"></select>
        </label>
        <div data-part="prototype-progress">
          <button type="button" data-action="previous-prototype" aria-label="Previous prototype">Previous</button>
          <div>
            <strong data-part="prototype-progress-label"></strong>
            <ol data-part="prototype-progress-dots" aria-label="Prototype progress"></ol>
          </div>
          <button type="button" data-action="next-prototype" aria-label="Next prototype">Next</button>
        </div>
        <nav data-part="prototype-review-tabs" aria-label="Review steps">
          <button type="button" data-step="prototype">Prototype</button>
          <button type="button" data-step="variants">Variants</button>
          <button type="button" data-step="notes">Notes</button>
        </nav>
        <div data-part="prototype-error" role="alert" hidden></div>
        <div data-part="prototype-step"></div>
        <p data-part="prototype-share-status" aria-live="polite"></p>
      </div>`;
    document.body.append(fab, panel);

    const picker = panel.querySelector('[data-action="prototype"]');
    const error = panel.querySelector('[data-part="prototype-error"]');
    const stepRoot = panel.querySelector('[data-part="prototype-step"]');
    const shareStatus = panel.querySelector(
      '[data-part="prototype-share-status"]',
    );
    const progressLabel = panel.querySelector(
      '[data-part="prototype-progress-label"]',
    );
    const progressDots = panel.querySelector(
      '[data-part="prototype-progress-dots"]',
    );
    const previousPrototype = panel.querySelector(
      '[data-action="previous-prototype"]',
    );
    const nextPrototype = panel.querySelector('[data-action="next-prototype"]');

    /** @param {string} key */
    const responseFor = (key) => {
      const responses = object(review.responses);
      review.responses = responses;
      if (!object(responses[key]).variantNotes)
        responses[key] = { ...object(responses[key]), variantNotes: {} };
      return responses[key];
    };

    /** @param {string} key */
    const currentDefinition = (key) => registry.get(key);

    /** @param {string} key */
    const savedDefinition = (key) => object(review.catalog)[key];

    /** @param {string} key */
    const reviewStatus = (key) => {
      const saved = savedDefinition(key);
      const current = currentDefinition(key);
      if (!saved) return { label: "Not reviewed", stale: false };
      if (!current)
        return { label: "Outdated: prototype was removed", stale: true };
      const currentVariants = current.variants.map((variant) => variant.key);
      const savedVariants = Array.isArray(saved.variants) ? saved.variants : [];
      if (
        saved.revision !== current.revision ||
        currentVariants.join("\n") !== savedVariants.join("\n")
      )
        return { label: "Outdated: prototype changed", stale: true };
      return object(review.responses)[key]
        ? { label: "Reviewed", stale: false }
        : { label: "Not reviewed", stale: false };
    };

    const reviewURL = (
      summary = false,
      step = null,
      source = new URL(window.location.href),
    ) => {
      const url = new URL(source.href);
      const reviewStep =
        step || (summary ? "summary" : url.searchParams.get("reviewStep"));
      const ordinaryParams = [...url.searchParams].filter(
        ([key]) => key !== "review" && key !== "reviewStep",
      );
      url.search = new URLSearchParams(ordinaryParams).toString();
      if (reviewStep) url.searchParams.set("reviewStep", reviewStep);
      url.searchParams.set("review", encode(review));
      return url;
    };

    const updateSaveStatus = () => {
      const length = reviewURL(true).href.length;
      shareStatus.textContent =
        saveProblem ||
        `${length.toLocaleString()} / ${SHARE_URL_LIMIT.toLocaleString()} share-link characters`;
    };

    /** @param {string} [step] */
    const saveReview = (step) => {
      window.clearTimeout(pendingSave);
      pendingSave = 0;
      const url = reviewURL(step === "summary", step);
      if (url.href.length > SHARE_URL_LIMIT) {
        responseSaved = false;
        saveProblem = `Response is too long to save in the URL. Shorten a note below ${NOTE_LIMIT} characters.`;
        updateSaveStatus();
        return false;
      }
      try {
        window.history.replaceState(
          null,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      } catch {
        // Firefox and Safari rate-limit replaceState; an unhandled throw here
        // would stop every later keystroke from reaching the URL.
        responseSaved = false;
        saveProblem =
          "The browser refused to update the address. Copy the response link to keep this response.";
        updateSaveStatus();
        return false;
      }
      responseSaved = true;
      saveProblem = "";
      updateSaveStatus();
      return true;
    };

    // Typing writes one history entry per pause, not one per character.
    const saveReviewSoon = () => {
      window.clearTimeout(pendingSave);
      pendingSave = window.setTimeout(saveReview, SAVE_DELAY);
    };

    /** @param {string} prototypeKey @param {string | null} variantKey @param {string} [step] */
    const navigate = (prototypeKey, variantKey, step = currentStep) => {
      const url = new URL(window.location.href);
      url.searchParams.set("prototype", prototypeKey);
      if (variantKey) url.searchParams.set("variant", variantKey);
      else url.searchParams.delete("variant");
      const nextURL = reviewURL(step === "summary", step, url);
      if (nextURL.href.length > SHARE_URL_LIMIT) {
        responseSaved = false;
        saveProblem = `Response is too long to save in the URL. Shorten a note below ${NOTE_LIMIT} characters.`;
        updateSaveStatus();
        return false;
      }
      window.location.assign(nextURL.href);
      return true;
    };

    /** @param {string} step */
    const showStep = (step) => {
      if (!saveReview(step)) return;
      currentStep = step;
      render();
    };

    const renderPrototypeProgress = () => {
      const index = selectedPrototypes.findIndex(
        (prototype) => prototype.key === active?.key,
      );
      const previous = index > 0 ? selectedPrototypes[index - 1] : null;
      const next =
        index < 0
          ? selectedPrototypes[0]
          : index < selectedPrototypes.length - 1
            ? selectedPrototypes[index + 1]
            : null;
      progressLabel.textContent =
        index >= 0
          ? `Prototype ${index + 1} of ${selectedPrototypes.length}: ${active.title}`
          : requestedKey === "none"
            ? "Original"
            : "Prototype unavailable";
      progressDots.replaceChildren();
      selectedPrototypes.forEach((prototype, prototypeIndex) => {
        const dot = document.createElement("li");
        dot.dataset.state =
          prototypeIndex === index
            ? "current"
            : prototypeIndex < index
              ? "complete"
              : "upcoming";
        dot.setAttribute(
          "aria-label",
          `Prototype ${prototypeIndex + 1} of ${selectedPrototypes.length}: ${prototype.title}`,
        );
        if (prototypeIndex === index) dot.setAttribute("aria-current", "step");
        progressDots.append(dot);
      });
      previousPrototype.disabled = !previous;
      nextPrototype.disabled = !next && currentStep === "summary";
      nextPrototype.textContent =
        index < 0
          ? "Next prototype"
          : currentStep === "prototype"
            ? "Next: variants"
            : currentStep === "variants"
              ? "Next: notes"
              : next
                ? "Next prototype"
                : currentStep === "summary"
                  ? "Review complete"
                  : "Review summary";
    };

    const renderPicker = () => {
      picker.replaceChildren();
      const original = document.createElement("option");
      original.value = "none";
      original.textContent = "Original";
      picker.append(original);
      for (const prototype of listedPrototypes) {
        const option = document.createElement("option");
        option.value = prototype.key;
        option.textContent = prototype.title;
        picker.append(option);
      }
      if (
        ![...picker.options].some((option) => option.value === requestedKey)
      ) {
        const unavailable = document.createElement("option");
        unavailable.value = requestedKey;
        unavailable.textContent = `Unavailable: ${requestedKey}`;
        picker.append(unavailable);
      }
      picker.value = requestedKey;
    };

    /** A decoded response can exceed the limit that `maxlength` only enforces
     * while typing, so the remaining count is clamped at zero.
     * @param {string} value */
    const remaining = (value) =>
      `${Math.max(0, NOTE_LIMIT - value.length)} characters remaining`;

    /** @param {string} value */
    const count = (value) =>
      `<span data-part="prototype-note-count">${remaining(value)}</span>`;

    const renderPrototypeStep = () => {
      if (!active) {
        stepRoot.innerHTML = `
          <h2>Original</h2>
          <p>The production page is untouched. Choose a prototype above to compare it.</p>`;
        return;
      }
      const state =
        typeof active.state === "function"
          ? active.state(activeVariant.key)
          : active.state || [];
      stepRoot.innerHTML = `
        <h2>Stats</h2>
        <p>${escape(active.question)}</p>
        <dl data-part="prototype-state">
          ${state
            .map(
              (item) =>
                `<div><dt>${escape(item.label)}</dt><dd>${escape(item.value)}</dd></div>`,
            )
            .join("")}
        </dl>`;
    };

    const renderVariantStep = () => {
      if (!active || !activeVariant) {
        stepRoot.innerHTML = `
          <h2>No prototype selected</h2>
          <p>Choose a prototype before reviewing its variants.</p>`;
        return;
      }
      const response = responseFor(active.key);
      response.variantNotes = object(response.variantNotes);
      const selectedChoice = active.variants.some(
        (variant) => variant.key === response.choice,
      )
        ? response.choice
        : null;
      const note = string(response.variantNotes[activeVariant.key]);
      const index = active.variants.indexOf(activeVariant);
      const previous =
        active.variants[
          (index - 1 + active.variants.length) % active.variants.length
        ];
      const next = active.variants[(index + 1) % active.variants.length];
      const variantDots = active.variants
        .map(
          (variant, variantIndex) =>
            `<li data-state="${variantIndex === index ? "current" : "upcoming"}" aria-label="Variant ${variantIndex + 1} of ${active.variants.length}: ${escape(variant.name)}"${variantIndex === index ? ' aria-current="step"' : ""}></li>`,
        )
        .join("");
      stepRoot.innerHTML = `
        <nav data-part="prototype-variant-navigation" aria-label="Prototype variants">
          <button type="button" data-variant="${escape(previous.key)}" ${active.variants.length > 1 ? "" : "disabled"}>Previous variant</button>
          <div>
            <strong data-part="prototype-variant-status">Variant ${index + 1} of ${active.variants.length}</strong>
            <ol data-part="prototype-variant-dots" aria-label="Variant progress">${variantDots}</ol>
          </div>
          <button type="button" data-variant="${escape(next.key)}" ${active.variants.length > 1 ? "" : "disabled"}>Next variant</button>
        </nav>
        <h2>${escape(activeVariant.name)}</h2>
        <p>${escape(activeVariant.description)}</p>
        <button type="button" data-action="choose-current-variant">Choose this variant</button>
        <fieldset data-part="prototype-choice">
          <legend>Variant decision</legend>
          <label><input type="radio" data-review-choice="variant" data-prototype-key="${escape(active.key)}" name="prototype-choice" value="none" ${selectedChoice === null ? "checked" : ""}/>Not choosing</label>
          ${active.variants
            .map(
              (variant, variantIndex) =>
                `<label><input type="radio" data-review-choice="variant" data-prototype-key="${escape(active.key)}" name="prototype-choice" value="${escape(variant.key)}" ${selectedChoice === variant.key ? "checked" : ""}/>${variantIndex + 1}) ${escape(variant.name)}</label>`,
            )
            .join("")}
        </fieldset>
        <label data-part="prototype-field">
          Note about ${escape(activeVariant.name)}
          <textarea data-review-field="variant-note" data-prototype-key="${escape(active.key)}" data-variant-key="${escape(activeVariant.key)}" maxlength="${NOTE_LIMIT}" placeholder="What works, fails, or should change?">${escape(note)}</textarea>
          ${count(note)}
        </label>
        <div data-part="prototype-step-actions">
          <button type="button" data-step="prototype">Prototype review</button>
          <button type="button" data-action="end">End review</button>
        </div>
        `;
    };

    const renderReviewNote = (key) => {
      const current = currentDefinition(key);
      const saved = savedDefinition(key);
      const response = object(review.responses)[key];
      const selectedChoice = current?.variants.some(
        (variant) => variant.key === response?.choice,
      )
        ? response.choice
        : null;
      const variantKeys = [
        ...(current?.variants.map((variant) => variant.key) || []),
        ...Object.keys(object(response?.variantNotes)).filter(
          (variant) =>
            variant !== "none" &&
            !current?.variants.some((item) => item.key === variant),
        ),
      ];
      const noteField = (variant, name) => {
        const note = string(response?.variantNotes?.[variant]);
        return `
              <label data-part="prototype-field">
                Note about ${escape(name)}
                <textarea data-review-field="variant-note" data-prototype-key="${escape(key)}" data-variant-key="${escape(variant)}" maxlength="${NOTE_LIMIT}" placeholder="What works, fails, or should change?">${escape(note)}</textarea>
                ${count(note)}
              </label>`;
      };
      const prototypeNote = `
          <section data-part="prototype-summary-note-prototype">
            <h4>Prototype note</h4>
            ${
              current
                ? `<label data-part="prototype-summary-choice-option"><input type="radio" data-review-choice="variant" data-prototype-key="${escape(key)}" name="prototype-choice-${escape(key)}" value="none" ${selectedChoice === null ? "checked" : ""}/>Not choosing</label>`
                : ""
            }
            <label data-part="prototype-field">
              Note about this prototype
              <textarea data-review-field="prototype-note" data-prototype-key="${escape(key)}" maxlength="${NOTE_LIMIT}" placeholder="What should we remember about this prototype?">${escape(string(response?.note))}</textarea>
              ${count(string(response?.note))}
            </label>
          </section>`;
      const removedVariantNotes = variantKeys
        .filter(
          (variant) => !current?.variants.some((item) => item.key === variant),
        )
        .map((variant) => noteField(variant, variant))
        .join("");
      const variantNoteSection = current
        ? `
            <section data-part="prototype-summary-note-variants">
              <h4>Variant notes</h4>
              ${current.variants
                .map(
                  (variant, variantIndex) =>
                    `<div data-part="prototype-summary-variant"><div data-part="prototype-summary-variant-header"><label data-part="prototype-summary-choice-option"><input type="radio" data-review-choice="variant" data-prototype-key="${escape(key)}" name="prototype-choice-${escape(key)}" value="${escape(variant.key)}" ${selectedChoice === variant.key ? "checked" : ""}/>${variantIndex + 1}) ${escape(variant.name)}</label><button type="button" data-action="go-to-variant" data-prototype-key="${escape(key)}" data-variant-key="${escape(variant.key)}">Go to variant</button></div>${noteField(variant.key, variant.name)}</div>`,
                )
                .join("")}
              ${removedVariantNotes}
            </section>`
        : removedVariantNotes
          ? `<section data-part="prototype-summary-note-variants"><h4>Variant notes</h4>${removedVariantNotes}</section>`
          : "";
      const variantNotes = current
        ? `<fieldset data-part="prototype-summary-choice" data-prototype-key="${escape(key)}"><legend>Variant decision and notes</legend>${prototypeNote}${variantNoteSection}</fieldset>`
        : `${prototypeNote}${variantNoteSection}`;
      return `
          <article data-part="prototype-summary-note" data-prototype-key="${escape(key)}">
            <h3>${escape(current?.title || saved?.title || key)}</h3>
            ${variantNotes}
          </article>`;
    };

    const renderNotesStep = () => {
      if (!active) {
        stepRoot.innerHTML = `
          <h2>No prototype selected</h2>
          <p>Choose a prototype before writing notes.</p>`;
        return;
      }
      stepRoot.innerHTML = `
        <h2>Notes</h2>
        <p>Record what should be remembered about this prototype and its variants.</p>
        <section data-part="prototype-notes">
          <h3>Review notes</h3>
          ${renderReviewNote(active.key)}
        </section>
        <div data-part="prototype-step-actions">
          <button type="button" data-step="summary">Go to Summary</button>
          <button type="button" data-action="copy-json">Copy review as JSON</button>
          <button type="button" data-action="copy">Copy response link</button>
        </div>`;
    };

    const renderSummaryStep = () => {
      // Responses outlive their prototype file; dropping them here would lose
      // a reviewer's notes silently.
      const keys = new Set([
        ...selectedKeys,
        ...Object.keys(object(review.responses)),
      ]);
      const noteRows = [...keys].map((key) => renderReviewNote(key));
      const stale = [...keys].some((key) => reviewStatus(key).stale);
      stepRoot.innerHTML = `
        <h2>Review summary</h2>
        ${stale ? '<p data-part="prototype-alert" role="alert"><strong>Outdated review.</strong> One or more prototypes changed after this response was recorded.</p>' : ""}
        <section data-part="prototype-summary-notes">
          <h3>Review notes</h3>
          ${noteRows.join("")}
        </section>
        <div data-part="prototype-step-actions">
          <button type="button" data-step="prototype">Continue review</button>
          <button type="button" data-action="copy-json">Copy review as JSON</button>
          <button type="button" data-action="copy">Copy response link</button>
        </div>`;
    };

    const clampPanel = () => {
      if (panel.hidden) return;
      const rect = panel.getBoundingClientRect();
      const left = Math.min(
        Math.max(PANEL_EDGE, rect.left),
        Math.max(PANEL_EDGE, window.innerWidth - rect.width - PANEL_EDGE),
      );
      const top = Math.min(
        Math.max(PANEL_EDGE, rect.top),
        Math.max(PANEL_EDGE, window.innerHeight - rect.height - PANEL_EDGE),
      );
      panel.style.inset = "auto";
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };

    const render = () => {
      stepRoot.dataset.step = currentStep;
      for (const button of panel.querySelectorAll("[data-step]"))
        button.setAttribute(
          "aria-current",
          button.dataset.step === currentStep ? "step" : "false",
        );
      error.hidden = !activeError && !reviewError;
      error.dataset.part =
        activeError || reviewError ? "prototype-alert" : "prototype-error";
      error.textContent = activeError || reviewError;
      renderPrototypeProgress();
      if (currentStep === "variants") renderVariantStep();
      else if (currentStep === "notes") renderNotesStep();
      else if (currentStep === "summary") renderSummaryStep();
      else renderPrototypeStep();
      updateSaveStatus();
      requestAnimationFrame(clampPanel);
    };

    renderPicker();
    render();

    try {
      const savedPosition = JSON.parse(
        window.sessionStorage.getItem(POSITION_KEY) || "null",
      );
      if (
        Number.isFinite(savedPosition?.left) &&
        Number.isFinite(savedPosition?.top)
      ) {
        panel.style.inset = "auto";
        panel.style.left = `${savedPosition.left}px`;
        panel.style.top = `${savedPosition.top}px`;
      }
    } catch {
      // Dev-only convenience; storage denial leaves the default position.
    }
    requestAnimationFrame(clampPanel);

    fab.addEventListener("click", () => {
      panel.hidden = false;
      fab.hidden = true;
      fab.setAttribute("aria-expanded", "true");
      requestAnimationFrame(clampPanel);
    });

    // A reload inside the debounce window would otherwise drop the last note.
    window.addEventListener("pagehide", () => {
      if (pendingSave) saveReview();
    });

    picker.addEventListener("change", () => {
      const requested = picker.value;
      const next = registry.get(requested);
      // A refused navigation leaves the old prototype mounted; the picker has
      // already moved, so put it back.
      if (!navigate(requested, next?.variants[0]?.key || null))
        picker.value = requestedKey;
    });

    panel.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.action === "collapse") {
        panel.hidden = true;
        fab.hidden = false;
        fab.setAttribute("aria-expanded", "false");
        fab.focus();
        return;
      }
      if (button.dataset.action === "original") {
        navigate("none", null);
        return;
      }
      if (button.dataset.action === "choose-current-variant") {
        if (!active || !activeVariant) return;
        const choice = [
          ...panel.querySelectorAll('input[name="prototype-choice"]'),
        ].find((input) => input.value === activeVariant.key);
        if (choice instanceof HTMLInputElement) {
          choice.checked = true;
          responseFor(active.key).choice = activeVariant.key;
          saveReview();
        }
        return;
      }
      if (button.dataset.action === "go-to-variant") {
        const prototypeKey = button.dataset.prototypeKey;
        const variantKey = button.dataset.variantKey;
        if (prototypeKey && variantKey)
          navigate(prototypeKey, variantKey, "variants");
        return;
      }
      if (button.dataset.action === "end") {
        showStep("summary");
        return;
      }
      if (button.dataset.action === "copy") {
        const url = reviewURL(true);
        if (url.href.length > SHARE_URL_LIMIT) {
          responseSaved = false;
          updateSaveStatus();
          return;
        }
        try {
          await navigator.clipboard.writeText(url.href);
          shareStatus.textContent = "Response link copied.";
        } catch {
          shareStatus.textContent =
            "Copy was blocked. Copy the current address from the browser.";
        }
        return;
      }
      if (button.dataset.action === "copy-json") {
        try {
          await navigator.clipboard.writeText(JSON.stringify(review, null, 2));
          shareStatus.textContent = "Review JSON copied.";
        } catch {
          shareStatus.textContent =
            "Copy was blocked. Select the review JSON from another source.";
        }
        return;
      }
      if (button.dataset.step) {
        showStep(button.dataset.step);
        return;
      }
      if (
        button.dataset.action === "previous-prototype" ||
        button.dataset.action === "next-prototype"
      ) {
        const index = selectedPrototypes.findIndex(
          (prototype) => prototype.key === active?.key,
        );
        const isNext = button.dataset.action === "next-prototype";
        const offset = button.dataset.action === "previous-prototype" ? -1 : 1;
        const target =
          index < 0 && offset > 0
            ? selectedPrototypes[0]
            : selectedPrototypes[index + offset];
        if (active && isNext && currentStep === "prototype") {
          showStep("variants");
          return;
        }
        if (active && isNext && currentStep === "variants") {
          showStep("notes");
          return;
        }
        if (active && isNext && currentStep === "notes" && !target) {
          showStep("summary");
          return;
        }
        if (!target) return;
        const targetStep =
          isNext && currentStep === "notes" ? "prototype" : currentStep;
        navigate(target.key, target.variants[0]?.key || null, targetStep);
        return;
      }
      if (button.dataset.variant) navigate(active.key, button.dataset.variant);
    });

    panel.addEventListener("input", (event) => {
      const field = event.target;
      if (!(field instanceof HTMLTextAreaElement)) return;
      const prototypeKey = field.dataset.prototypeKey || active?.key;
      if (!prototypeKey) return;
      const response = responseFor(prototypeKey);
      if (field.dataset.reviewField === "prototype-note")
        response.note = field.value;
      else if (field.dataset.reviewField === "variant-note") {
        response.variantNotes = object(response.variantNotes);
        response.variantNotes[field.dataset.variantKey] = field.value;
      }
      const noteCount = field.parentElement?.querySelector(
        '[data-part="prototype-note-count"]',
      );
      if (noteCount) noteCount.textContent = remaining(field.value);
      saveReviewSoon();
    });

    panel.addEventListener("change", (event) => {
      const choice = event.target;
      if (
        !(choice instanceof HTMLInputElement) ||
        choice.dataset.reviewChoice !== "variant"
      )
        return;
      const prototypeKey = choice.dataset.prototypeKey || active?.key;
      if (!prototypeKey) return;
      responseFor(prototypeKey).choice =
        choice.value === "none" ? null : choice.value;
      saveReview();
    });

    const header = panel.querySelector('[data-part="prototype-panel-header"]');
    let drag = null;
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      header.setPointerCapture(event.pointerId);
    });
    header.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      panel.style.inset = "auto";
      panel.style.left = `${event.clientX - drag.offsetX}px`;
      panel.style.top = `${event.clientY - drag.offsetY}px`;
      clampPanel();
    });
    header.addEventListener("pointerup", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      const rect = panel.getBoundingClientRect();
      try {
        window.sessionStorage.setItem(
          POSITION_KEY,
          JSON.stringify({ left: rect.left, top: rect.top }),
        );
      } catch {
        // Dev-only convenience; storage denial leaves the panel movable.
      }
    });
    window.addEventListener("resize", clampPanel);

    if (active) {
      try {
        await active.mount({ variant: activeVariant.key });
      } catch (cause) {
        activeError = `Prototype failed to mount: ${cause instanceof Error ? cause.message : String(cause)}`;
        render();
      }
    }
  };

  if (document.readyState === "complete") start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
