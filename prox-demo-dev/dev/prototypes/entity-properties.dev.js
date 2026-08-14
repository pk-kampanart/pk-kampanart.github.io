/**
 * Development-only entity-properties prototype. It answers where property
 * editing should live, using a fake board and fake groups so nothing here
 * touches a Plan, a command, or history. Markup, CSS, sample data and logic
 * share one file because the review host reloads the planner between variants.
 *
 * Rows come from the real plan schema: a group property that declares a
 * command (ADR-0028) becomes a control. The table below adds only what the
 * schema cannot say — section, label, order, and which property a nullable
 * override inherits from. `rect` is deliberately absent: this asks about
 * styling, not geometry.
 */
{
  const presentation = {
    name: { section: "Identity", label: "Name" },
    color: { section: "Appearance", label: "Color" },
    strokeType: { section: "Appearance", label: "Stroke" },
    strokeWidth: { section: "Appearance", label: "Width" },
    strokeOpacity: { section: "Appearance", label: "Opacity" },
    strokeColor: {
      section: "Appearance",
      label: "Stroke color",
      inheritsFrom: "color",
    },
  };
  const hotKeys = ["color", "strokeType", "strokeWidth"];

  const state = {
    selectedId: "lobby",
    panelOpen: true,
    groups: [
      {
        id: "lobby",
        name: "Lobby and Corridors",
        color: "#3b82f6",
        strokeType: "dashed",
        strokeWidth: 2,
        strokeOpacity: 80,
        strokeColor: null,
        members: 4,
        rect: { x: 60, y: 50, width: 250, height: 150 },
      },
      {
        id: "egress",
        name: "Emergency Egress",
        color: "#ef4444",
        strokeType: "solid",
        strokeWidth: 3,
        strokeOpacity: 100,
        strokeColor: "#7f1d1d",
        members: 2,
        rect: { x: 350, y: 90, width: 190, height: 130 },
      },
      {
        id: "north",
        name: "North Wing",
        color: "#10b981",
        strokeType: "none",
        strokeWidth: 1,
        strokeOpacity: 60,
        strokeColor: null,
        members: 6,
        rect: { x: 120, y: 250, width: 320, height: 110 },
      },
    ],
  };

  const selected = () =>
    state.groups.find((group) => group.id === state.selectedId);

  /** @returns {any} the live plan schema the planner page carries */
  const groupSchema = () => {
    const block = document.querySelector('[data-part="schema"]');
    if (!block?.textContent) throw new Error("the plan schema is unavailable");
    const fields = JSON.parse(block.textContent).$defs?.group?.properties;
    if (!fields) throw new Error("the schema declares no group");
    return fields;
  };

  /** Editable fields, in presentation order, schema-filtered by `command`. */
  const fieldsOf = (schema) =>
    Object.keys(presentation)
      .filter((key) => schema[key]?.command)
      .map((key) => ({ key, field: schema[key], ...presentation[key] }));

  const typeOf = (field) =>
    Array.isArray(field.type)
      ? field.type.find((name) => name !== "null")
      : field.type;
  const nullable = (field) =>
    Array.isArray(field.type) && field.type.includes("null");
  const isColor = (field) => /0-9a-fA-F\]\{6\}/.test(field.pattern || "");

  const dashFor = (group) =>
    group.strokeType === "dashed"
      ? `${group.strokeWidth * 4} ${group.strokeWidth * 3}`
      : group.strokeType === "dotted"
        ? `${group.strokeWidth * 0.1} ${group.strokeWidth * 2.5}`
        : "";

  // ---- rendering the fake board -----------------------------------------

  const paintBoard = () => {
    for (const group of state.groups) {
      const node = document.querySelector(
        `[data-part="proto-rect"][data-group="${group.id}"]`,
      );
      if (!node) continue;
      const stroke = group.strokeColor || group.color;
      node.setAttribute("fill", group.color);
      node.setAttribute("fill-opacity", "0.12");
      node.setAttribute(
        "stroke",
        group.strokeType === "none" ? "none" : stroke,
      );
      node.setAttribute("stroke-width", String(group.strokeWidth));
      node.setAttribute("stroke-opacity", String(group.strokeOpacity / 100));
      node.setAttribute("stroke-dasharray", dashFor(group));
      node.setAttribute(
        "stroke-linecap",
        group.strokeType === "dotted" ? "round" : "butt",
      );
      node.dataset.state = group.id === state.selectedId ? "selected" : "idle";
      const label = document.querySelector(
        `[data-part="proto-rect-label"][data-group="${group.id}"]`,
      );
      if (label) label.textContent = group.name;
      const row = document.querySelector(
        `[data-part="proto-tree-name"][data-group="${group.id}"]`,
      );
      if (row) row.textContent = group.name;
      const swatch = document.querySelector(
        `[data-part="proto-tree-swatch"][data-group="${group.id}"]`,
      );
      if (swatch) swatch.style.background = group.color;
    }
    placeFloating();
  };

  /** Every control showing `key`, refreshed from state without a rebuild. */
  const syncControls = (source) => {
    const group = selected();
    for (const control of document.querySelectorAll("[data-key]")) {
      if (control === source) continue;
      const key = control.dataset.key;
      const value =
        key === "strokeColor" ? group.strokeColor || group.color : group[key];
      if (control.value !== String(value)) control.value = String(value);
    }
    for (const output of document.querySelectorAll("[data-readout]"))
      output.textContent = String(group[output.dataset.readout]);
    for (const badge of document.querySelectorAll("[data-inherit-badge]"))
      badge.textContent = group.strokeColor ? "override" : "inherits color";
    for (const reset of document.querySelectorAll("[data-reset]"))
      reset.disabled = group[reset.dataset.reset] === null;
  };

  const set = (key, value, source) => {
    selected()[key] = value;
    paintBoard();
    syncControls(source);
  };

  // ---- controls ----------------------------------------------------------

  /** One control per field. Native elements only; the label carries the name. */
  const controlFor = (entry, compact) => {
    const group = selected();
    const field = entry.field;
    const type = typeOf(field);
    const wrap = document.createElement("div");
    wrap.dataset.part = "proto-control";

    if (field.enum) {
      const select = document.createElement("select");
      select.dataset.key = entry.key;
      for (const option of field.enum) {
        const node = document.createElement("option");
        node.value = option;
        node.textContent = option[0].toUpperCase() + option.slice(1);
        select.append(node);
      }
      select.value = group[entry.key];
      select.addEventListener("change", () =>
        set(entry.key, select.value, select),
      );
      wrap.append(select);
      return wrap;
    }

    if (type === "string" && isColor(field)) {
      const input = document.createElement("input");
      input.type = "color";
      input.dataset.key = entry.key;
      input.value = group[entry.key] || group[entry.inheritsFrom];
      input.addEventListener("input", () => set(entry.key, input.value, input));
      wrap.append(input);
      if (nullable(field)) {
        // A nullable override cannot be said with a colour input alone: the
        // swatch always has a value, so Reset is what says "follow the group".
        const reset = document.createElement("button");
        reset.type = "button";
        reset.dataset.reset = entry.key;
        reset.textContent = "Reset";
        reset.disabled = group[entry.key] === null;
        reset.addEventListener("click", () => set(entry.key, null, null));
        wrap.append(reset);
        if (!compact) {
          const badge = document.createElement("span");
          badge.dataset.part = "proto-badge";
          badge.setAttribute("data-inherit-badge", entry.key);
          badge.textContent = group[entry.key] ? "override" : "inherits color";
          wrap.append(badge);
        }
      }
      return wrap;
    }

    if (
      (type === "number" || type === "integer") &&
      field.minimum !== undefined &&
      field.maximum !== undefined
    ) {
      const input = document.createElement("input");
      input.type = "range";
      input.dataset.key = entry.key;
      input.min = String(field.minimum);
      input.max = String(field.maximum);
      input.step = type === "integer" ? "1" : "0.5";
      input.value = String(group[entry.key]);
      const readout = document.createElement("output");
      readout.dataset.readout = entry.key;
      readout.textContent = String(group[entry.key]);
      input.addEventListener("input", () =>
        set(entry.key, Number(input.value), input),
      );
      wrap.append(input, readout);
      return wrap;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.dataset.key = entry.key;
    input.value = String(group[entry.key]);
    input.addEventListener("input", () => set(entry.key, input.value, input));
    wrap.append(input);
    return wrap;
  };

  /** A labelled row: what the panel and the tree disclosure both use. */
  const rowFor = (entry) => {
    const row = document.createElement("label");
    row.dataset.part = "proto-row";
    const name = document.createElement("span");
    name.dataset.part = "proto-row-label";
    name.textContent = entry.label;
    row.append(name, controlFor(entry, false));
    return row;
  };

  /** The compact bar: hot properties only, names carried by aria-label. */
  const barFor = (entries, extra) => {
    const bar = document.createElement("div");
    bar.dataset.part = "proto-bar";
    for (const entry of entries.filter((item) => hotKeys.includes(item.key))) {
      const control = controlFor(entry, true);
      for (const input of control.querySelectorAll("input, select, button"))
        if (!input.dataset.reset) input.setAttribute("aria-label", entry.label);
      control.title = entry.label;
      bar.append(control);
    }
    if (extra) bar.append(extra);
    return bar;
  };

  const panelFor = (entries) => {
    const group = selected();
    const panel = document.createElement("aside");
    panel.dataset.part = "proto-panel";
    panel.setAttribute("aria-label", "Selected entity properties");
    const heading = document.createElement("h2");
    heading.dataset.part = "proto-panel-heading";
    heading.textContent = `Group "${group.name}"`;
    panel.append(heading);
    let currentSection = "";
    let host = panel;
    for (const entry of entries) {
      if (entry.section !== currentSection) {
        currentSection = entry.section;
        const section = document.createElement("section");
        section.dataset.part = "proto-section";
        const title = document.createElement("h3");
        title.textContent = currentSection;
        section.append(title);
        panel.append(section);
        host = section;
      }
      host.append(rowFor(entry));
    }
    const derived = document.createElement("section");
    derived.dataset.part = "proto-section";
    derived.innerHTML = `<h3>Derived</h3><p data-part="proto-derived">Members ${group.members}</p>`;
    panel.append(derived);
    return panel;
  };

  // ---- floating placement ------------------------------------------------

  const placeFloating = () => {
    const bar = document.querySelector('[data-part="proto-floating"]');
    if (!bar) return;
    const rect = document.querySelector(
      `[data-part="proto-rect"][data-group="${state.selectedId}"]`,
    );
    const stage = document.querySelector('[data-part="proto-stage"]');
    if (!rect || !stage) return;
    const box = rect.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    const left = box.left - frame.left + box.width / 2 - bar.offsetWidth / 2;
    const top = box.top - frame.top - bar.offsetHeight - 10;
    bar.style.left = `${Math.max(4, Math.min(left, frame.width - bar.offsetWidth - 4))}px`;
    bar.style.top = `${top < 4 ? box.bottom - frame.top + 10 : top}px`;
  };

  // ---- page ---------------------------------------------------------------

  const style = `
    [data-part="workspace"][data-proto] {
      grid-template-columns: 17rem minmax(0, 1fr) auto;
      gap: 0;
    }
    [data-part="proto-tree"] {
      overflow: auto;
      padding: 12px;
      border-inline-end: 1px solid var(--border, #d5dae2);
      font: 13px/1.5 system-ui, sans-serif;
    }
    [data-part="proto-tree"] ul { margin: 0; padding: 0 0 0 14px; list-style: none; }
    [data-part="proto-tree-row"] {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 5px 6px;
      border: 0;
      border-radius: 4px;
      color: inherit;
      background: none;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    [data-part="proto-tree-row"][data-state="selected"] {
      background: var(--accent-soft, #e4efff);
      font-weight: 600;
    }
    [data-part="proto-tree-swatch"] {
      width: 11px;
      height: 11px;
      flex: none;
      border-radius: 2px;
    }
    [data-part="proto-tree-details"] {
      display: grid;
      gap: 6px;
      margin: 2px 0 8px 20px;
      padding: 10px;
      border: 1px solid var(--border, #d5dae2);
      border-radius: 6px;
      background: var(--surface, #f7f9fb);
    }
    [data-part="proto-stage"] { position: relative; overflow: hidden; }
    [data-part="proto-board"] { display: block; width: 100%; height: 100%; }
    [data-part="proto-rect"] { cursor: pointer; }
    [data-part="proto-rect"][data-state="selected"] { outline: none; }
    [data-part="proto-rect-halo"] { display: none; }
    [data-part="proto-rect"][data-state="selected"] + [data-part="proto-rect-halo"] { display: block; }
    [data-part="proto-rect-label"] { font: 12px system-ui, sans-serif; fill: #445; pointer-events: none; }
    [data-part="proto-floating"] {
      position: absolute;
      z-index: 5;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border: 1px solid var(--border-strong, #8b95a5);
      border-radius: 8px;
      background: var(--surface-raised, #fff);
      box-shadow: 0 6px 18px rgb(0 0 0 / 18%);
    }
    [data-part="proto-panel"] {
      width: 21rem;
      overflow: auto;
      padding: 14px;
      border-inline-start: 1px solid var(--border, #d5dae2);
      background: var(--surface-raised, #fff);
      font: 13px/1.5 system-ui, sans-serif;
    }
    [data-part="proto-panel-heading"] { margin: 0 0 12px; font-size: 1rem; }
    [data-part="proto-section"] { display: grid; gap: 8px; margin: 0 0 16px; }
    [data-part="proto-section"] h3 {
      margin: 0;
      color: var(--text-muted, #586474);
      font-size: 0.75rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    [data-part="proto-row"] {
      display: grid;
      grid-template-columns: 6.5rem minmax(0, 1fr);
      align-items: center;
      gap: 8px;
    }
    [data-part="proto-row-label"] { color: var(--text-muted, #586474); }
    [data-part="proto-control"] { display: flex; align-items: center; gap: 6px; min-width: 0; }
    [data-part="proto-control"] input[type="range"] { min-width: 0; flex: 1; }
    [data-part="proto-control"] input[type="color"] { width: 14px; height: 14px; padding: 0; }
    [data-part="proto-control"] output { min-width: 2.2rem; text-align: end; font-variant-numeric: tabular-nums; }
    [data-part="proto-badge"] { color: var(--text-muted, #586474); font-size: 0.75rem; }
    [data-part="proto-bar"] [data-part="proto-control"] input[type="range"] { width: 5rem; }
    [data-part="proto-derived"] { margin: 0; color: var(--text-muted, #586474); }
    [data-part="proto-more"] { min-height: 28px; padding: 2px 9px; }
    [data-part="proto-toolbar"] {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-inline-start: 8px;
      padding-inline-start: 10px;
      border-inline-start: 1px solid var(--border, #d5dae2);
      font: 13px/1.5 system-ui, sans-serif;
    }
    [data-part="proto-toolbar-label"] { color: var(--text-muted, #586474); white-space: nowrap; }
    [data-part="proto-toolbar"] [data-part="proto-bar"] { display: flex; align-items: center; gap: 6px; }
    [data-part="proto-tree-menu"] {
      min-height: 22px;
      margin-inline-start: auto;
      padding: 0 5px;
      border: 0;
      border-radius: 4px;
      color: var(--text-muted, #586474);
      background: none;
      font: inherit;
      cursor: pointer;
    }
    [data-part="proto-tree-menu"]:hover { background: var(--border, #d5dae2); }
    /* Native popover: light dismiss, Escape and the top layer come free, so it
       escapes the scrolling tree column without a clipping workaround. */
    [data-part="proto-popover"] {
      position: fixed;
      display: none;
      width: 18rem;
      margin: 0;
      padding: 10px;
      border: 1px solid var(--border-strong, #8b95a5);
      border-radius: 8px;
      background: var(--surface-raised, #fff);
      box-shadow: 0 8px 22px rgb(0 0 0 / 20%);
      font: 13px/1.5 system-ui, sans-serif;
      inset: auto;
    }
    [data-part="proto-popover"]:popover-open { display: grid; gap: 6px; }
  `;

  const boardMarkup = () => {
    const shapes = state.groups
      .map(
        (group) => `
        <rect data-part="proto-rect" data-group="${group.id}" tabindex="0" role="button"
          aria-label="Group ${group.name}"
          x="${group.rect.x}" y="${group.rect.y}"
          width="${group.rect.width}" height="${group.rect.height}" rx="6" />
        <rect data-part="proto-rect-halo" pointer-events="none" fill="none"
          stroke="#1772e8" stroke-width="1" stroke-dasharray="3 3"
          x="${group.rect.x - 5}" y="${group.rect.y - 5}"
          width="${group.rect.width + 10}" height="${group.rect.height + 10}" rx="8" />
        <text data-part="proto-rect-label" data-group="${group.id}"
          x="${group.rect.x + 10}" y="${group.rect.y + 20}">${group.name}</text>`,
      )
      .join("");
    return `<svg data-part="proto-board" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet"
      role="application" aria-label="Fake floor plan">${shapes}</svg>`;
  };

  const mount = async ({ variant }) => {
    const ready = window.Planner?.app?.ready?.();
    if (ready && typeof ready.then === "function") await ready;

    const schema = groupSchema();
    const entries = fieldsOf(schema);

    const workspace = document.querySelector('[data-part="workspace"]');
    if (!workspace) throw new Error("prototype needs its page target");
    workspace.dataset.proto = variant;

    const sheet = document.createElement("style");
    sheet.textContent = style;
    document.head.append(sheet);

    workspace.innerHTML = `
      <nav data-part="proto-tree" aria-label="Planning workflow"><ul data-part="proto-tree-list"></ul></nav>
      <div data-part="proto-stage">${boardMarkup()}</div>`;

    const tree = workspace.querySelector('[data-part="proto-tree-list"]');
    const stage = workspace.querySelector('[data-part="proto-stage"]');

    const renderTree = () => {
      tree.replaceChildren();
      for (const group of state.groups) {
        const item = document.createElement("li");
        const row = document.createElement("button");
        row.type = "button";
        row.dataset.part = "proto-tree-row";
        row.dataset.group = group.id;
        row.dataset.state = group.id === state.selectedId ? "selected" : "idle";
        if (variant === "tree")
          row.setAttribute(
            "aria-expanded",
            String(group.id === state.selectedId),
          );
        row.innerHTML = `<span data-part="proto-tree-swatch" data-group="${group.id}" style="background:${group.color}"></span>
          <span data-part="proto-tree-name" data-group="${group.id}">${group.name}</span>`;
        row.addEventListener("click", () => select(group.id));
        item.append(row);
        if (variant === "tree-menu") {
          const menu = document.createElement("button");
          menu.type = "button";
          menu.dataset.part = "proto-tree-menu";
          menu.dataset.group = group.id;
          menu.textContent = "\u22ef";
          menu.setAttribute("aria-label", `Properties of ${group.name}`);
          menu.setAttribute("aria-haspopup", "dialog");
          // The UA light-dismisses an open `popover=auto` as the default action
          // of this press, so by click time it is already closed and reopening
          // is the wrong answer. The listener runs before that default action,
          // which makes pointerdown the only moment the press can see what it
          // is about to close. Keyboard activation fires no pointer event, so
          // the click handler still closes an already-open popover itself.
          menu.addEventListener("pointerdown", () => {
            dismissing =
              popover.matches(":popover-open") &&
              popover.dataset.group === group.id;
          });
          menu.addEventListener("click", (event) => {
            event.stopPropagation();
            const closing =
              dismissing ||
              (popover.matches(":popover-open") &&
                popover.dataset.group === group.id);
            dismissing = false;
            select(group.id);
            if (closing) {
              if (popover.matches(":popover-open")) popover.hidePopover();
              return;
            }
            openPopover(group.id);
          });
          row.append(menu);
        }
        if (variant === "tree" && group.id === state.selectedId) {
          const details = document.createElement("div");
          details.dataset.part = "proto-tree-details";
          for (const entry of entries) details.append(rowFor(entry));
          item.append(details);
        }
        tree.append(item);
      }
    };

    const renderPanel = () => {
      workspace.querySelector('[data-part="proto-panel"]')?.remove();
      const wanted =
        variant === "panel" || (variant === "merged" && state.panelOpen);
      if (wanted) workspace.append(panelFor(entries));
    };

    const renderFloating = () => {
      stage.querySelector('[data-part="proto-floating"]')?.remove();
      if (variant !== "floating" && variant !== "merged") return;
      let more = null;
      if (variant === "merged") {
        more = document.createElement("button");
        more.type = "button";
        more.dataset.part = "proto-more";
        more.textContent = "⋯";
        more.setAttribute("aria-label", "More properties");
        more.setAttribute("aria-expanded", String(state.panelOpen));
        more.addEventListener("click", () => {
          state.panelOpen = !state.panelOpen;
          renderPanel();
          renderFloating();
        });
      }
      const bar = barFor(entries, more);
      bar.dataset.part = "proto-floating";
      stage.append(bar);
      placeFloating();
    };

    const popover = document.createElement("div");
    popover.dataset.part = "proto-popover";
    popover.setAttribute("popover", "auto");
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Group properties");
    document.body.append(popover);

    /** True between a press that light-dismisses the popover and its click. */
    let dismissing = false;

    /** @param {string} id */
    const openPopover = (id) => {
      popover.dataset.group = id;
      popover.replaceChildren();
      for (const entry of entries) popover.append(rowFor(entry));
      // Showing an already-shown popover throws; render() calls this to
      // reposition one that is open.
      if (!popover.matches(":popover-open")) popover.showPopover();
      const anchor = document.querySelector(
        `[data-part="proto-tree-menu"][data-group="${id}"]`,
      );
      if (!anchor) return;
      // Rebuilding the tree rows discards the button that was focused, which
      // drops focus to the body and leaves a keyboard user with nothing to
      // press. Only the rebuild loses focus this way, so nothing is stolen
      // from a control the user is actually using.
      if (!document.activeElement || document.activeElement === document.body)
        /** @type {HTMLElement} */ (anchor).focus();
      const box = anchor.getBoundingClientRect();
      popover.style.left = `${Math.min(box.right + 8, window.innerWidth - popover.offsetWidth - 8)}px`;
      popover.style.top = `${Math.min(box.top, window.innerHeight - popover.offsetHeight - 8)}px`;
    };

    // R keeps the controls in page chrome: a contextual section appended to the
    // real planner toolbar, beside the file actions it has to share a row with.
    const renderToolbar = () => {
      document.querySelector('[data-part="proto-toolbar"]')?.remove();
      if (variant !== "ribbon") return;
      const toolbar = document.querySelector('[data-part="toolbar"]');
      if (!toolbar) return;
      const section = document.createElement("div");
      section.dataset.part = "proto-toolbar";
      section.setAttribute("aria-label", "Selected group");
      const label = document.createElement("span");
      label.dataset.part = "proto-toolbar-label";
      label.textContent = `Group: ${selected().name}`;
      section.append(label, barFor(entries, null));
      toolbar.append(section);
    };

    const render = () => {
      renderToolbar();
      renderTree();
      renderPanel();
      renderFloating();
      paintBoard();
      // A selection change elsewhere must not leave the popover editing the
      // group that is no longer selected.
      if (popover.matches(":popover-open") && !dismissing)
        popover.dataset.group === state.selectedId
          ? openPopover(state.selectedId)
          : popover.hidePopover();
    };

    const select = (id) => {
      state.selectedId = id;
      render();
    };

    for (const rect of stage.querySelectorAll('[data-part="proto-rect"]')) {
      rect.addEventListener("click", () => select(rect.dataset.group));
      rect.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(rect.dataset.group);
        }
      });
    }
    window.addEventListener("resize", placeFloating);

    render();
  };

  window.PlannerDev.register({
    title: "Entity property editing",
    question:
      "Where should the controls that set a group's style live, given the same surface must later serve device types, instances and applications?",
    variants: [
      {
        key: "panel",
        name: "A — Docked properties panel",
        description:
          "Every property in one persistent right column, sectioned. Covers nothing, and works for entities that have no rectangle to float beside.",
      },
      {
        key: "floating",
        name: "B — Floating toolbar on the selection",
        description:
          "Hot properties float above the selected rectangle. Hands stay on the object; no room for name, derived facts, or a long list.",
      },
      {
        key: "ribbon",
        name: "R \u2014 Contextual section in the toolbar",
        description:
          "Hot properties live in the planner toolbar beside the file actions. One fixed spot that covers nothing and needs no positioning, but it is far from the object and shares a single row.",
      },
      {
        key: "tree",
        name: "D1 — Workflow row, expand below",
        description:
          "The selected row discloses its properties in place. Adds no new surface, but pushes siblings down and is narrow for sliders.",
      },
      {
        key: "tree-menu",
        name: "D2 \u2014 Workflow row, 3-dot popover",
        description:
          "A \u22ef on the row opens the properties in a popover. Tree stays compact and the popover sizes freely, but it is transient and the \u22ef competes with selection on the same row.",
      },
      {
        key: "merged",
        name: "C — Merged: hot properties float, the rest docks",
        description:
          "Floating bar carries three properties and an overflow that opens the panel. Two surfaces to keep in sync, one more piece of view state.",
      },
    ],
    state: () => [
      { label: "Data", value: "Three fake groups, edited for real, no Plan" },
      { label: "Rows", value: "Schema-driven from $defs.group (command only)" },
      { label: "Override", value: "strokeColor: swatch plus Reset to inherit" },
    ],
    mount,
  });
}
