/**
 * Development-only tree indentation prototype. It keeps markup, CSS, sample
 * Plan data, and render helpers in one file for speed. Replacing workflow
 * markup and using innerHTML are safe here because the review host reloads the
 * original planner between prototypes and this stub never persists a Plan.
 */
{
  const levels = Object.freeze({
    project: 0,
    floor: 1,
    application: 2,
    section: 3,
    item: 4,
    instance: 5,
  });
  const selectedId = "sensor-02";
  const plan = Object.freeze({
    name: "Harbor Office Mesh",
    floors: [
      {
        name: "Floor 1 — Public Areas",
        open: true,
        applications: [
          {
            name: "Lighting and Wayfinding",
            open: true,
            groups: ["Lobby and Corridors", "Emergency Egress"],
            types: [
              {
                name: "Ceiling Presence Sensor",
                open: true,
                instances: ["sensor-01", "sensor-02", "sensor-03"],
              },
              {
                name: "Wall Display Controller",
                open: true,
                instances: ["display-01", "display-02"],
              },
            ],
          },
          {
            name: "Environmental Monitoring",
            open: true,
            groups: ["North Wing"],
            types: [
              {
                name: "CO₂ and Temperature Sensor",
                open: true,
                instances: ["environment-01", "environment-02"],
              },
            ],
          },
        ],
      },
      {
        name: "Floor 2 — Private Offices",
        open: false,
        applications: [
          {
            name: "Room Automation",
            open: true,
            groups: ["Meeting Rooms"],
            types: [
              {
                name: "Room Occupancy Sensor",
                open: true,
                instances: ["room-01", "room-02"],
              },
            ],
          },
        ],
      },
    ],
  });

  const variants = Object.freeze([
    {
      key: "css-depth",
      name: "CSS depth",
      description:
        "Nested child containers alone indicate depth; no prototype JavaScript handles the tree.",
      treePart: "prototype-css-tree",
    },
    {
      key: "stepped-levels",
      name: "Stepped levels",
      description:
        "Each domain level gets a fixed step, with the chevron and label moving together.",
      treePart: "prototype-stepped-tree",
    },
    {
      key: "scoped-lanes",
      name: "Scoped lanes",
      description:
        "Floor, Application, section, and Device type scopes carry aligned guide lanes.",
      treePart: "prototype-scoped-tree",
    },
  ]);

  const styleText = `
    [data-part="indent-prototype"] {
      --prototype-chevron-size: var(--tree-indent);
      --prototype-indent-step: var(--space-6);
      --prototype-lane-padding: var(--space-3);
      --prototype-rail-gap: var(--space-3);
      display: flex;
      flex-direction: column;
      min-height: 100%;
      background: var(--surface-raised);
    }

    [data-part="prototype-tree-frame"] {
      min-height: 0;
      flex: 1 1 auto;
      overflow: auto;
      padding: var(--space-3) var(--space-3) var(--space-6);
    }

    [data-part="prototype-tree"] {
      min-width: max-content;
    }

    [data-part="tree-line"] {
      display: grid;
      grid-template-columns: var(--prototype-chevron-size) minmax(0, 1fr) auto;
      min-width: 100%;
      min-height: var(--row-height);
      align-items: center;
      column-gap: var(--space-2);
      padding-block: var(--space-1);
      padding-inline-end: var(--space-2);
      border: var(--border-width) solid transparent;
      border-radius: var(--radius-sm);
      background: var(--prototype-row-tint, transparent);
    }

    summary[data-part="tree-line"] {
      cursor: pointer;
      list-style: none;
    }

    summary[data-part="tree-line"]::-webkit-details-marker {
      display: none;
    }

    [data-part="tree-chevron"] {
      display: flex;
      grid-column: 1;
      width: var(--prototype-chevron-size);
      min-height: var(--row-height);
      align-items: center;
      justify-content: center;
      color: var(--text-faint);
      font-size: var(--size-1);
    }

    [data-part="tree-chevron"]::before {
      content: "";
    }

    [data-part="tree-chevron"][data-state~="branch"]::before {
      content: "▸";
    }

    details[open] > summary[data-part="tree-line"]
      [data-part="tree-chevron"][data-state~="branch"]::before {
      content: "▾";
    }

    [data-part="prototype-content"],
    [data-part="tree-line"] > [data-part="tree-row"] {
      grid-column: 2;
      min-width: 0;
    }

    [data-part="tree-row"] {
      display: flex;
      min-width: 0;
      min-height: var(--row-height);
      align-items: center;
      gap: var(--space-2);
      cursor: pointer;
    }

    [data-part="prototype-content"] > [data-part="tree-row"] {
      width: 100%;
    }

    [data-part="tree-radio"] {
      flex: 0 0 auto;
      margin: 0;
    }

    [data-part="prototype-name"],
    [data-part="prototype-project-name"],
    [data-part="prototype-section-name"] {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    [data-part="prototype-name"],
    [data-part="prototype-project-name"] {
      flex: 1 1 auto;
    }

    [data-part="prototype-detail"] {
      flex: 0 0 auto;
      color: var(--text-faint);
      font-size: var(--size-1);
      white-space: nowrap;
    }

    [data-part="prototype-project-name"] {
      color: var(--text-muted);
      font-weight: 600;
    }

    [data-part="prototype-section-name"] {
      color: var(--text-muted);
      font-size: var(--size-1);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    [data-part="prototype-actions"] {
      display: flex;
      grid-column: 3;
      align-items: center;
      gap: var(--space-1);
    }

    [data-part="prototype-control"] {
      width: var(--control-size);
      height: var(--control-size);
      min-height: var(--control-size);
      padding: 0;
      border: var(--border-width) dashed var(--accent);
      border-radius: var(--radius-sm);
      color: var(--accent);
      font-size: var(--size-2);
      line-height: 1;
    }

    [data-part="prototype-control"]:disabled {
      opacity: 0.8;
      color: var(--accent);
    }

    [data-part="tree-line"]:hover,
    [data-part="tree-line"]:focus-within {
      --prototype-row-tint: var(--row-hover-surface);
    }

    [data-part="tree-line"]:has(input:checked) {
      --prototype-row-tint: var(--state-selected-background);
      border-color: var(--state-selected-outline);
    }

    [data-part="prototype-css-children"] {
      margin-inline-start: var(--tree-indent);
      padding-inline-start: var(--prototype-rail-gap);
      border-inline-start: var(--border-width) solid var(--border);
    }

    [data-part="prototype-stepped-tree"] [data-part="tree-line"] {
      padding-inline-start: calc(
        var(--prototype-depth) * var(--prototype-indent-step)
      );
    }

    [data-part="prototype-scoped-children"] {
      margin-inline-start: var(--tree-indent);
    }

    [data-part="prototype-floor-scope"],
    [data-part="prototype-application-scope"],
    [data-part="prototype-section-scope"],
    [data-part="prototype-type-scope"] {
      padding-inline-start: var(--prototype-lane-padding);
      border-inline-start: var(--border-width) solid var(--border-strong);
    }

    [data-part="prototype-floor-scope"] {
      background: var(--surface-inset);
    }

    [data-part="prototype-application-scope"] {
      background: color-mix(in srgb, var(--accent-surface) 28%, transparent);
    }

    [data-part="prototype-section-scope"],
    [data-part="prototype-type-scope"] {
      border-inline-start-color: var(--accent-soft);
    }

  `;

  /** @param {string} value @returns {string} */
  const text = (value) => value;

  /** @param {string} id @param {string} kind @param {string} label @param {string} [detail] */
  const selectable = (id, kind, label, detail = "") => `
    <label data-part="tree-row">
      <input
        type="radio"
        name="prototype-selection"
        data-part="tree-radio"
        value="${id}"
        aria-label="Select ${text(kind)}: ${text(label)}"
        ${id === selectedId ? "checked" : ""}
      />
      <span data-part="prototype-name">${text(label)}</span>
      ${detail ? `<span data-part="prototype-detail">${text(detail)}</span>` : ""}
    </label>`;

  /** @param {string} label */
  const addControl = (label) => `
    <span data-part="prototype-actions">
      <button
        type="button"
        data-part="prototype-control"
        title="${text(label)}"
        aria-label="${text(label)}"
        disabled
      >+</button>
    </span>`;

  /** @param {string} variantKey @param {number} depth @returns {string} */
  const lineStyle = (variantKey, depth) =>
    variantKey === "stepped-levels"
      ? ` style="--prototype-depth: ${depth}"`
      : "";

  /**
   * @param {object} args
   * @param {string} args.variantKey
   * @param {"summary"|"div"} args.element
   * @param {number} args.depth
   * @param {string} args.content
   * @param {string} [args.actions]
   * @param {boolean} [args.branch]
   */
  const line = ({
    variantKey,
    element,
    depth,
    content,
    actions = "",
    branch = false,
  }) => `
    <${element} data-part="tree-line"${lineStyle(variantKey, depth)}>
      <span
        data-part="tree-chevron"
        data-state="${branch ? "branch" : "empty"}"
        aria-hidden="true"
      ></span>
      ${content}
      ${actions}
    </${element}>`;

  /** @param {string} variantKey @param {string} content */
  const children = (variantKey, content) =>
    `<div data-part="${
      variantKey === "css-depth"
        ? "prototype-css-children"
        : variantKey === "stepped-levels"
          ? "prototype-stepped-children"
          : "prototype-scoped-children"
    }">${content}</div>`;

  /** @param {string} variantKey @param {string} scope @param {string} content */
  const scope = (variantKey, scope, content) =>
    variantKey === "scoped-lanes"
      ? `<div data-part="prototype-${scope}-scope">${content}</div>`
      : content;

  /**
   * @param {string} variantKey
   * @param {string} kind
   * @param {string} label
   * @param {number} depth
   * @param {boolean} open
   * @param {string} content
   * @param {string} [detail]
   * @param {string} [actions]
   * @param {string} [scopeName]
   */
  const branch = (
    variantKey,
    kind,
    label,
    depth,
    open,
    content,
    detail = "",
    actions = "",
    scopeName = "",
  ) =>
    scope(
      variantKey,
      scopeName,
      `<details data-part="prototype-branch"${open ? " open" : ""}>
        ${line({
          variantKey,
          element: "summary",
          depth,
          branch: true,
          content: `<span data-part="prototype-content">${selectable(
            `${kind}-${label}`,
            kind,
            label,
            detail,
          )}</span>`,
          actions,
        })}
        ${children(variantKey, content)}
      </details>`,
    );

  /** @param {string} variantKey @param {string} label @param {number} depth */
  const section = (variantKey, label, depth, content) =>
    scope(
      variantKey,
      "section",
      `<details data-part="prototype-branch" open>
        ${line({
          variantKey,
          element: "summary",
          depth,
          branch: true,
          content: `<span data-part="prototype-content">
            <span data-part="tree-row" data-state="section">
              <span data-part="prototype-section-name">${text(label)}</span>
            </span>
          </span>`,
          actions: addControl(
            `Add ${label.toLowerCase().replace(/s$/, "")} to application`,
          ),
        })}
        ${children(variantKey, content)}
      </details>`,
    );

  /** @param {string} variantKey @param {string} id @param {string} label @param {number} depth */
  const leaf = (variantKey, id, label, depth) =>
    line({
      variantKey,
      element: "div",
      depth,
      content: `<span data-part="prototype-content">${selectable(
        id,
        "device instance",
        label,
      )}</span>`,
    });

  /** @param {string} variantKey @param {string} name @param {number} depth */
  const group = (variantKey, name, depth) =>
    line({
      variantKey,
      element: "div",
      depth,
      content: `<span data-part="prototype-content">${selectable(
        `group-${name}`,
        "group",
        name,
      )}</span>`,
    });

  /** @param {string} variantKey @param {object} type @param {number} depth */
  const deviceType = (variantKey, type, depth) =>
    branch(
      variantKey,
      "device type",
      type.name,
      depth,
      type.open,
      type.instances
        .map((id, index) =>
          leaf(
            variantKey,
            id,
            `${type.name} #${String(index + 1).padStart(2, "0")}`,
            levels.instance,
          ),
        )
        .join(""),
      `${type.instances.length} devices`,
      "",
      "type",
    );

  /** @param {string} variantKey @param {object} application @param {number} depth */
  const application = (variantKey, application, depth) =>
    branch(
      variantKey,
      "application",
      application.name,
      depth,
      application.open,
      [
        section(
          variantKey,
          "Groups",
          levels.section,
          application.groups
            .map((name) => group(variantKey, name, levels.item))
            .join(""),
        ),
        section(
          variantKey,
          "Device types",
          levels.section,
          application.types
            .map((type) => deviceType(variantKey, type, levels.item))
            .join(""),
        ),
      ].join(""),
      `${application.types.reduce((count, type) => count + type.instances.length, 0)} devices`,
      "",
      "application",
    );

  /** @param {string} variantKey @param {object} floor @param {number} depth */
  const floor = (variantKey, floor, depth) =>
    branch(
      variantKey,
      "floor",
      floor.name,
      depth,
      floor.open,
      floor.applications
        .map((applicationRecord) =>
          application(variantKey, applicationRecord, levels.application),
        )
        .join(""),
      "",
      "",
      "floor",
    );

  /** @param {{key: string, treePart: string}} variant */
  const tree = (variant) => `
    <div data-part="${variant.treePart}" aria-label="Workflow tree">
      <div data-part="prototype-project">
        ${line({
          variantKey: variant.key,
          element: "div",
          depth: levels.project,
          content: `<span data-part="prototype-content">
            <span data-part="tree-row">
              <span data-part="prototype-project-name">${text(plan.name)}</span>
            </span>
          </span>`,
          actions: addControl("Add floor to project"),
        })}
        ${children(
          variant.key,
          plan.floors
            .map((floorRecord) => floor(variant.key, floorRecord, levels.floor))
            .join(""),
        )}
      </div>
    </div>`;


  const mount = async ({ variant: variantKey }) => {
    const ready = window.Planner?.app?.ready?.();
    if (ready && typeof ready.then === "function") await ready;
    const workflow = document.querySelector('[data-part="workflow"]');
    if (!workflow) throw new Error("tree indentation prototype needs workflow");
    const variant =
      variants.find((candidate) => candidate.key === variantKey) || variants[0];
    const mountedStyle = document.createElement("style");
    mountedStyle.textContent = styleText;
    document.head.append(mountedStyle);
    workflow.innerHTML = `
      <section data-part="indent-prototype" aria-label="Tree indentation prototype">
        <div data-part="prototype-tree-frame">${tree(variant)}</div>
      </section>`;
  };

  window.PlannerDev.register({
    title: "Tree indent scopes",
    question:
      "Can Floor → Application → section → item → Instance stay clear while every label starts after its chevron?",
    default: true,
    variants,
    state: [
      { label: "Plan", value: plan.name },
      { label: "Selection", value: "Ceiling Presence Sensor #02" },
      {
        label: "Open",
        value: "Floor 1 and its two Applications; Floor 2 collapsed",
      },
    ],
    mount,
  });
}
