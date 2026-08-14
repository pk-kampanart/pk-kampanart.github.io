/**
 * Development-only properties surface. It builds one row per property the plan
 * schema declares a command for, and edits only by dispatching that command, so
 * history and autosave behave as they do anywhere else. It may use DOM and
 * session APIs freely because it is never included in production output.
 */
{
  const panel = window.PlannerDevPanel;
  if (!panel?.register) throw new Error("Developer panel host is unavailable");

  /** @param {string} kind @returns {string} */
  const normalizeKind = (kind) =>
    kind === "device"
      ? "deviceInstance"
      : kind === "device-type"
        ? "deviceType"
        : kind;

  /** @param {any} plan @param {string} kind @param {string} id @returns {any} */
  const recordFor = (plan, kind, id) => {
    if (kind === "project")
      return plan.project?.id === id ? plan.project : null;
    for (const floor of plan.floors || []) {
      if (kind === "floor" && floor.id === id) return floor;
      for (const application of floor.applications || []) {
        if (kind === "application" && application.id === id) return application;
        for (const group of application.groups || [])
          if (kind === "group" && group.id === id) return group;
        for (const type of application.deviceTypes || []) {
          if (kind === "deviceType" && type.id === id) return type;
          for (const instance of type.instances || [])
            if (kind === "deviceInstance" && instance.id === id)
              return instance;
        }
      }
    }
    return null;
  };

  const schemaOf = () => {
    const block = document.querySelector('[data-part="schema"]');
    if (!block?.textContent) throw new Error("the plan schema is unavailable");
    return JSON.parse(block.textContent);
  };

  /** @param {any} schema @param {string} kind */
  const definitionOf = (schema, kind) =>
    kind === "plan" ? schema : schema.$defs?.[kind];

  /** @param {any} schema @param {any} field */
  const resolve = (schema, field) =>
    field?.$ref?.startsWith("#/$defs/")
      ? schema.$defs?.[field.$ref.slice("#/$defs/".length)]
      : field;

  /** @param {any} field @returns {string} */
  const scalarType = (field) =>
    Array.isArray(field?.type)
      ? field.type.find((/** @type {string} */ name) => name !== "null") || ""
      : field?.type || "";

  /**
   * One control per editable value. A property whose schema is an object — a
   * rectangle — becomes one control per component, so the row set follows the
   * schema rather than a list kept here.
   * @param {any} schema @param {string} property @param {any} field
   */
  const controlsOf = (schema, property, field) => {
    const resolved = resolve(schema, field);
    if (resolved?.properties)
      return Object.entries(resolved.properties).map(([part, component]) => ({
        slot: `${property}.${part}`,
        label: `${property} ${part}`,
        field: resolve(schema, component),
      }));
    return [{ slot: property, label: property, field: resolved }];
  };

  /** @param {any} field @returns {HTMLInputElement} */
  const inputFor = (field) => {
    const input = document.createElement("input");
    const type = scalarType(field);
    if (type === "string" && /0-9a-fA-F\]\{6\}/.test(field?.pattern || ""))
      input.type = "color";
    else if (type === "integer" || type === "number") {
      const bounded =
        field?.minimum !== undefined && field?.maximum !== undefined;
      input.type = bounded ? "range" : "number";
      if (field?.minimum !== undefined) input.min = String(field.minimum);
      if (field?.maximum !== undefined) input.max = String(field.maximum);
      if (type === "integer") input.step = "1";
    } else input.type = "text";
    input.dataset.valueType = type === "integer" ? "number" : type;
    return input;
  };

  /**
   * The anchor carries the entity and its id, so Planner.dom.render fills every
   * slot and Planner.dom.intentFrom reads an edit — the production binder, with
   * no production template.
   * @param {any} schema @param {string} kind
   */
  const buildRows = (schema, kind) => {
    const definition = definitionOf(schema, kind);
    if (!definition?.properties)
      throw new Error(`the schema declares no entity "${kind}"`);
    const anchor = document.createElement("div");
    anchor.setAttribute("data-anchor", kind);
    anchor.dataset.part = "inspector-rows";
    for (const [property, field] of Object.entries(definition.properties)) {
      const command = /** @type {any} */ (field)?.command;
      if (!command) continue;
      for (const control of controlsOf(schema, property, field)) {
        const row = document.createElement("label");
        row.dataset.part = "inspector-row";
        const name = document.createElement("span");
        name.dataset.part = "inspector-label";
        name.textContent = control.label;
        const input = inputFor(control.field);
        input.dataset.part = "inspector-control";
        input.setAttribute("data-slot", control.slot);
        input.setAttribute("data-slot-as", "value");
        input.setAttribute("data-act", command);
        row.append(name, input);
        anchor.append(row);
      }
    }
    return anchor;
  };

  /** @param {HTMLElement} root */
  const mount = (root) => {
    root.innerHTML = `
      <section data-part="inspector-page" aria-label="Selected entity properties">
        <h3 data-part="inspector-heading">Inspector</h3>
        <div data-part="inspector-body"></div>
      </section>`;

    const body = /** @type {HTMLElement} */ (
      root.querySelector('[data-part="inspector-body"]')
    );

    const style = document.createElement("style");
    style.textContent = `
      [data-part="inspector-heading"] { margin: 0 0 12px; }
      [data-part="inspector-body"] { display: grid; gap: 8px; }
      [data-part="inspector-body"] li { list-style: none; }
      [data-part="inspector-empty"] { margin: 0; color: var(--text-muted, #586474); }
      [data-part="inspector-error"] { margin: 0; color: #a61b1b; }

      [data-part="inspector-rows"] { display: grid; gap: 8px; }
      [data-part="inspector-row"] {
        display: grid;
        grid-template-columns: 9rem minmax(0, 1fr);
        align-items: center;
        gap: 8px;
      }
      [data-part="inspector-label"] { color: var(--text-muted, #586474); }
      [data-part="inspector-control"] { min-width: 0; }

      [data-part="inspector-derived-group"] { display: grid; gap: 4px; margin: 12px 0 0; }
      [data-part="inspector-derived-heading"] {
        margin: 0;
        font-size: 0.85rem;
        color: var(--text-muted, #586474);
      }
      [data-part="inspector-derived"] { display: grid; gap: 4px; margin: 0; }
      [data-part="inspector-derived"] div { display: flex; gap: 8px; }
      [data-part="inspector-derived"] dt { font-weight: 600; }
      [data-part="inspector-derived"] dd { margin: 0; }
    `;
    root.append(style);

    /** @returns {{kind: string, id: string}} */
    const currentSelection = () => {
      const surface = document.querySelector('[data-part="surface"]');
      return {
        kind: normalizeKind(surface?.getAttribute("data-active-kind") || ""),
        id: surface?.getAttribute("data-active-entity") || "",
      };
    };

    /** @type {{kind: string, id: string, node: Element} | null} */
    let painted = null;

    /**
     * Derived facts, recomputed from the plan and never stored (CONTEXT.md).
     * Each number comes from the production helper that owns it; Device count
     * for a floor or a device type stays out, because src/status.js owns that
     * rule and a second copy here would fork it.
     * @param {any} plan @param {string} kind @param {any} record
     * @returns {Array<[string, string]>}
     */
    const derivedOf = (plan, kind, record) => {
      const links = window.Planner.links.derive(plan);
      if (kind === "group")
        return [
          [
            "Member count",
            String(links.filter((link) => link.groupId === record.id).length),
          ],
        ];
      if (kind === "deviceInstance") {
        const groups = new Map();
        for (const floor of plan.floors || [])
          for (const application of floor.applications || [])
            for (const group of application.groups || [])
              groups.set(group.id, group.name);
        const names = links
          .filter((link) => link.deviceId === record.id)
          .map((link) => groups.get(link.groupId))
          .filter(Boolean);
        return [["Containment", names.length ? names.join(", ") : "none"]];
      }
      if (kind === "application")
        return [
          [
            "Group count",
            String(window.Planner.applications.groupCount(plan, record.id)),
          ],
          [
            "Device count",
            String(window.Planner.applications.deviceCount(plan, record.id)),
          ],
        ];
      return [];
    };

    const derivedHeadingId = "inspector-derived-heading";

    /** @param {any} plan @param {string} kind @param {any} record */
    const paintDerived = (plan, kind, record) => {
      for (const old of body.querySelectorAll(
        '[data-part="inspector-derived-group"]',
      ))
        old.remove();
      const facts = derivedOf(plan, kind, record);
      if (!facts.length) return;
      const group = document.createElement("section");
      group.dataset.part = "inspector-derived-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-labelledby", derivedHeadingId);
      const heading = document.createElement("h4");
      heading.id = derivedHeadingId;
      heading.dataset.part = "inspector-derived-heading";
      heading.textContent = "Derived";
      const list = document.createElement("dl");
      list.dataset.part = "inspector-derived";
      for (const [label, value] of facts) {
        const pair = document.createElement("div");
        const term = document.createElement("dt");
        term.textContent = label;
        const detail = document.createElement("dd");
        detail.textContent = value;
        pair.append(term, detail);
        list.append(pair);
      }
      group.append(heading, list);
      body.append(group);
    };

    /** @param {{kind: string, id: string}} selection */
    const paint = (selection) => {
      const plan = window.Planner?.app?.read?.();
      if (!plan) throw new Error("Planner.app.read() is unavailable");
      const record = selection.id
        ? recordFor(plan, selection.kind, selection.id)
        : null;
      // Refill the row already on screen rather than rebuilding it: an edit
      // repaints through the observer, and a rebuild would take the focus out
      // of the control being typed in.
      if (
        record &&
        painted &&
        painted.kind === selection.kind &&
        painted.id === selection.id &&
        painted.node.isConnected
      ) {
        window.Planner.dom.render(painted.node, selection.kind, record);
        paintDerived(plan, selection.kind, record);
        return;
      }
      painted = null;
      body.replaceChildren();
      if (!record) {
        const empty = document.createElement("p");
        empty.dataset.part = "inspector-empty";
        empty.textContent = "No selection";
        body.append(empty);
        return;
      }
      const node = buildRows(schemaOf(), selection.kind);
      window.Planner.dom.render(node, selection.kind, record);
      body.append(node);
      painted = { kind: selection.kind, id: selection.id, node };
      paintDerived(plan, selection.kind, record);
    };

    const refresh = () => paint(currentSelection());

    const clearError = () => {
      for (const row of body.querySelectorAll('[data-part="inspector-error"]'))
        row.remove();
    };

    /** @param {unknown} error */
    const showEditError = (error) => {
      const row = document.createElement("p");
      row.dataset.part = "inspector-error";
      row.setAttribute("role", "alert");
      row.textContent = String(error);
      body.append(row);
    };

    /**
     * A command can own several controls — a rectangle's four numbers, a device
     * instance's two coordinates. It is dispatched with every one of them, keyed
     * by property name, which is the shape those handlers already read.
     * @param {Element} control @param {string} action
     */
    const fieldsFor = (control, action) => {
      const anchor = control.closest("[data-anchor]");
      /** @type {Record<string, any>} */
      const fields = {};
      for (const sibling of anchor?.querySelectorAll(
        `[data-act="${action}"][data-slot]`,
      ) || []) {
        const path = (sibling.getAttribute("data-slot") || "").split(".");
        const raw = /** @type {HTMLInputElement} */ (sibling).value;
        const value =
          /** @type {HTMLElement} */ (sibling).dataset.valueType === "number"
            ? Number(raw)
            : raw;
        if (path.length === 1) fields[path[0]] = value;
        else {
          fields[path[0]] = fields[path[0]] || {};
          fields[path[0]][path[1]] = value;
        }
      }
      return fields;
    };

    /** @param {Event} event */
    const edit = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const control = target?.closest?.("[data-act]");
      if (!control || !body.contains(control)) return;
      // A button acts on click and a value control on input; without this a
      // colour swatch would dispatch twice for one change.
      const button = control.matches("button");
      if (event.type === "click" ? !button : button) return;
      const intent = window.Planner.dom.intentFrom(event);
      if (!intent?.action || !intent.entity || !intent.id) return;
      clearError();
      try {
        window.Planner.app.dispatch({
          entity: intent.entity,
          action: intent.action,
          id: intent.id,
          value: intent.value,
          ...fieldsFor(control, intent.action),
          coalesce: `${intent.action}:${intent.id}`,
        });
      } catch (error) {
        // The registry rejects an act that names no command, which is how
        // data-act="select" stays view state. Anything else is a real failure.
        if (
          /^no command registered for /.test(
            String(/** @type {any} */ (error)?.message),
          )
        )
          return;
        showEditError(error);
      }
    };
    body.addEventListener("input", edit);
    body.addEventListener("click", edit);

    const showError = (error) => {
      painted = null;
      body.replaceChildren();
      const message = document.createElement("p");
      message.dataset.part = "inspector-empty";
      message.textContent = String(error);
      body.append(message);
    };

    const ready = window.Planner?.app?.ready?.();
    if (ready && typeof ready.then === "function")
      ready.then(refresh, showError);
    else {
      try {
        refresh();
      } catch (error) {
        showError(error);
      }
    }

    const selection = (event) => {
      const detail = event.detail || {};
      try {
        paint({
          kind: normalizeKind(detail.kind || ""),
          id: detail.id || "",
        });
      } catch (error) {
        showError(error);
      }
    };
    document.addEventListener("planner:selection-changed", selection);

    const observers = [];
    for (const part of ["workflow", "surface"]) {
      const target = document.querySelector(`[data-part="${part}"]`);
      if (!target) continue;
      const observer = new MutationObserver(() => {
        try {
          refresh();
        } catch (error) {
          showError(error);
        }
      });
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      observers.push(observer);
    }

    return () => {
      document.removeEventListener("planner:selection-changed", selection);
      for (const observer of observers) observer.disconnect();
      style.remove();
    };
  };

  panel.register({ title: "Inspector", mount });
}
