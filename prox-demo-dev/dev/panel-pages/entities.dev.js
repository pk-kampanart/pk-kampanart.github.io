/**
 * Development-only persisted Plan inspector. It never writes Plan state and
 * listens only to existing selection and workflow DOM projections.
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

  /** @param {string} kind @param {string} id @returns {string} */
  const recordKey = (kind, id) => `${kind}:${id}`;

  /** @param {HTMLElement} root */
  const mount = (root) => {
    root.innerHTML = `
      <section data-part="entities-page" aria-label="Persisted entities">
        <h3 data-part="entities-heading">Entities</h3>
        <div data-part="entities-layout">
          <nav data-part="entities-tree" aria-label="Plan entities"></nav>
          <pre data-part="entities-json" aria-label="Selected entity JSON"></pre>
        </div>
      </section>`;

    const tree = /** @type {HTMLElement} */ (
      root.querySelector('[data-part="entities-tree"]')
    );
    const json = /** @type {HTMLElement} */ (
      root.querySelector('[data-part="entities-json"]')
    );
    let selected = { kind: "plan", id: "plan" };
    let records = new Map();
    let firstRender = true;

    const style = document.createElement("style");
    style.textContent = `
      [data-part="entities-heading"] { margin: 0 0 12px; }
      [data-part="entities-layout"] {
        display: grid;
        gap: 16px;
      }
      [data-part="entities-tree"] ul {
        display: grid;
        gap: 2px;
        margin: 0;
        padding-inline-start: 18px;
      }
      [data-part="entities-tree"] > ul { padding-inline-start: 0; }
      [data-part="entities-tree"] li { list-style: none; }
      [data-part="entities-tree"] button {
        width: 100%;
        min-height: 30px;
        padding: 4px 8px;
        border: 1px solid transparent;
        border-radius: 4px;
        color: inherit;
        background: transparent;
        text-align: start;
        font: inherit;
      }
      [data-part="entities-tree"] button:hover,
      [data-part="entities-tree"] button[data-state~="selected"] {
        border-color: var(--border-strong, #8b95a5);
        background: var(--accent-surface, #e8f1ff);
      }
      [data-part="entities-json"] {
        min-height: 12rem;
        margin: 0;
        padding: 12px;
        overflow: auto;
        border: 1px solid var(--border, #d5dae2);
        border-radius: 4px;
        background: var(--surface-inset, #f5f7fa);
        font: 12px/1.45 ui-monospace, monospace;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    `;
    root.append(style);

    /** @param {HTMLElement} parent @param {any} node */
    const addNode = (parent, node) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.entityKind = node.kind;
      button.dataset.entityId = node.id;
      button.textContent = node.label;
      button.addEventListener("click", () => {
        selected = { kind: node.kind, id: node.id };
        paintSelection();
      });
      item.append(button);
      parent.append(item);
      records.set(recordKey(node.kind, node.id), node.record);
      if (node.children.length) {
        const children = document.createElement("ul");
        for (const child of node.children) addNode(children, child);
        item.append(children);
      }
    };

    const paintSelection = () => {
      const wanted = recordKey(selected.kind, selected.id);
      for (const button of tree.querySelectorAll("button[data-entity-kind]")) {
        const active =
          recordKey(
            button.getAttribute("data-entity-kind") || "",
            button.getAttribute("data-entity-id") || "",
          ) === wanted;
        if (active) button.setAttribute("data-state", "selected");
        else button.removeAttribute("data-state");
        button.setAttribute("aria-current", active ? "true" : "false");
      }
      json.textContent = JSON.stringify(
        records.get(wanted) ?? records.get("plan:plan"),
        null,
        2,
      );
    };

    const nodesOf = (plan) => {
      const project = plan.project
        ? {
            kind: "project",
            id: plan.project.id,
            label: `Project: ${plan.project.name}`,
            record: plan.project,
            children: [],
          }
        : null;
      const floors = (plan.floors || []).map((floor) => ({
        kind: "floor",
        id: floor.id,
        label: `Floor: ${floor.name}`,
        record: floor,
        children: (floor.applications || []).map((application) => ({
          kind: "application",
          id: application.id,
          label: `Application: ${application.name}`,
          record: application,
          children: [
            ...(application.groups || []).map((group) => ({
              kind: "group",
              id: group.id,
              label: `Group: ${group.name}`,
              record: group,
              children: [],
            })),
            ...(application.deviceTypes || []).map((type) => ({
              kind: "deviceType",
              id: type.id,
              label: `Device type: ${type.name}`,
              record: type,
              children: (type.instances || []).map((instance, index) => ({
                kind: "deviceInstance",
                id: instance.id,
                label: `${type.name} ${index + 1}`,
                record: instance,
                children: [],
              })),
            })),
          ],
        })),
      }));
      return [
        {
          kind: "plan",
          id: "plan",
          label: "Plan document",
          record: plan,
          children: [project, ...floors].filter(Boolean),
        },
      ];
    };

    const currentPlannerSelection = () => {
      const surface = document.querySelector('[data-part="surface"]');
      return {
        kind: normalizeKind(surface?.getAttribute("data-active-kind") || ""),
        id: surface?.getAttribute("data-active-entity") || "",
      };
    };

    const refresh = () => {
      const plan = window.Planner?.app?.read?.();
      if (!plan) throw new Error("Planner.app.read() is unavailable");
      records = new Map();
      tree.replaceChildren();
      const list = document.createElement("ul");
      for (const node of nodesOf(plan)) addNode(list, node);
      tree.append(list);
      if (firstRender) {
        const plannerSelection = currentPlannerSelection();
        if (records.has(recordKey(plannerSelection.kind, plannerSelection.id)))
          selected = plannerSelection;
        firstRender = false;
      }
      if (!records.has(recordKey(selected.kind, selected.id)))
        selected = { kind: "plan", id: "plan" };
      paintSelection();
    };

    const showError = (error) => {
      tree.replaceChildren();
      json.textContent = String(error);
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
      const value = {
        kind: normalizeKind(detail.kind || ""),
        id: detail.id || "",
      };
      if (value.id && records.has(recordKey(value.kind, value.id))) {
        selected = value;
        paintSelection();
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

  panel.register({ title: "Entities", mount });
}
