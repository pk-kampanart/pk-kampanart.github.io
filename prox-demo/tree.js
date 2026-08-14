/**
 * Mounts the workflow tree and its accessibility surface.
 * Channels: dispatches planner:selection-changed.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {string} part @returns {Element | null} */
  const cloneTemplate = (part) => {
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector(`[data-part="${part}-template"]`)
    );
    return /** @type {Element | null} */ (
      template?.content.firstElementChild?.cloneNode(true) || null
    );
  };

  /** @param {Element} element @param {string} token @param {boolean} on */
  const setState = (element, token, on) => {
    const tokens = new Set(
      (element.getAttribute("data-state") || "").split(/\s+/),
    );
    tokens.delete("");
    if (on) tokens.add(token);
    else tokens.delete(token);
    element.setAttribute("data-state", [...tokens].join(" "));
  };

  /** @param {Record<string, any>} plan @param {string} id @returns {any | null} */
  const entityOf = (plan, id) => {
    for (const floor of plan.floors || []) {
      if (floor.id === id) return floor;
      for (const application of floor.applications || []) {
        if (application.id === id) return application;
        for (const group of application.groups || [])
          if (group.id === id) return group;
        for (const deviceType of application.deviceTypes || []) {
          if (deviceType.id === id) return deviceType;
          for (const instance of deviceType.instances || [])
            if (instance.id === id) return instance;
        }
      }
    }
    return null;
  };

  /** @param {any} floor @returns {any[]} */
  const devicesOf = (floor) =>
    (floor?.applications || []).flatMap((/** @type {any} */ application) =>
      (application.deviceTypes || []).flatMap((/** @type {any} */ deviceType) =>
        (deviceType.instances || []).map((/** @type {any} */ instance) => ({
          ...instance,
          deviceType,
        })),
      ),
    );

  /** @param {any} group @param {any[]} devices @returns {any[]} */
  const groupDevices = (group, devices) =>
    group?.rect && planner.geo?.contains
      ? devices.filter((/** @type {any} */ device) =>
          planner.geo?.contains?.(group.rect, device),
        )
      : [];

  /** @param {string} part @returns {Element | null} */
  const surfacePart = (part) => {
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector(`[data-part="${part}-template"]`)
    );
    const wrapper = template?.content.firstElementChild;
    return /** @type {Element | null} */ (
      wrapper?.firstElementChild?.cloneNode(true) || null
    );
  };

  /** @param {Element} anchor @param {string} kind @param {any} entity @param {string} label @param {string} [detail] */
  const fillAnchor = (anchor, kind, entity, label, detail = "") => {
    const view = {
      ...entity,
      ariaLabel: `${label}${detail ? `, ${detail}` : ""}`,
      detail,
    };
    if (typeof planner.dom?.render === "function")
      planner.dom.render(anchor, kind, view);
    else anchor.setAttribute("data-id", entity.id);
    return anchor;
  };

  /** @param {TreeOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      typeof options.store?.read !== "function"
    )
      throw new TypeError("tree requires root, store, and registry");
    const { root, store, surface } = options;
    const { registry } = options;
    if (typeof registry?.dispatch !== "function")
      throw new TypeError("tree requires a command registry");
    setState(root, "tree", true);
    const status = planner.status?.create({ root, store });
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="tree-root-template"]')
    );
    const list = template?.content.firstElementChild?.cloneNode(true);
    if (!list) throw new Error("tree root template is missing");
    options.root.replaceChildren(list);

    let activeFloorId = store.read().floors?.[0]?.id || null;
    /** @type {{kind: string, id: string} | null} */
    let selection = null;
    /** @type {HTMLInputElement | null} */
    let cancelInput = null;
    /** @param {string} kind @param {string} id @returns {Element | null} */
    const anchorOf = (kind, id) =>
      [...root.querySelectorAll("[data-anchor]")].find(
        (anchor) =>
          anchor.getAttribute("data-anchor") === kind &&
          anchor.getAttribute("data-id") === id,
      ) || null;

    /** @param {string} kind @param {string} id */
    const focusRow = (kind, id) =>
      /** @type {HTMLElement | null} */ (
        anchorOf(kind, id)?.querySelector(
          '[data-part="tree-row"], [data-part="selection-catcher"], [data-part="tree-instance-row"]',
        )
      )?.focus();

    /** @param {string} kind @param {string} id */
    const openAncestors = (kind, id) => {
      const anchor = anchorOf(
        kind === "device"
          ? "deviceInstance"
          : kind === "device-type"
            ? "deviceType"
            : kind,
        id,
      );
      for (
        let parent = anchor?.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent instanceof HTMLDetailsElement) parent.open = true;
    };

    /**
     * @param {Element} parent
     * @param {any[]} records
     * @param {(node: Element) => string} nodeKey
     * @param {(record: any) => string} recordKey
     * @param {(record: any) => Element | null} createNode
     * @param {(node: Element, record: any) => void} updateNode
     */
    const reconcile = (
      parent,
      records,
      nodeKey,
      recordKey,
      createNode,
      updateNode,
    ) => {
      const existing = new Map(
        [...parent.children].map((node) => [nodeKey(node), node]),
      );
      const next = [];
      for (const record of records) {
        const node = existing.get(recordKey(record)) || createNode(record);
        if (!node) continue;
        updateNode(node, record);
        next.push(node);
      }
      for (let index = 0; index < next.length; index++) {
        const node = next[index];
        if (parent.children[index] !== node)
          parent.insertBefore(node, parent.children[index] || null);
      }
      for (const node of existing.values())
        if (!next.includes(node)) node.remove();
    };

    /** @param {any} floor @param {Record<string, any>} plan @param {Element} branch @returns {Element} */
    const renderFloor = (floor, plan, branch) => {
      fillAnchor(branch, "floor", floor, floor.name);
      setState(branch, "active", floor.id === activeFloorId);
      branch.setAttribute(
        "aria-current",
        floor.id === activeFloorId ? "true" : "false",
      );
      const children = branch.querySelector('[data-part="tree-children"]');
      if (children)
        reconcile(
          children,
          floor.applications || [],
          (node) => node.getAttribute("data-id") || "",
          (application) => String(application.id),
          () => cloneTemplate("tree-application"),
          (node, application) => renderApplication(application, plan, node),
        );
      return branch;
    };

    /** @param {any} application @param {Record<string, any>} plan @param {Element} branch @returns {Element | null} */
    const renderApplication = (application, plan, branch) => {
      if (!branch) return null;
      const devices = (application.deviceTypes || []).flatMap(
        (/** @type {any} */ type) => type.instances || [],
      );
      fillAnchor(
        branch,
        "application",
        application,
        application.name,
        `${devices.length} devices`,
      );
      const children = branch.querySelector('[data-part="tree-children"]');
      const sections = [
        {
          kind: "group",
          label: "Groups",
          emptyLabel: "No groups yet.",
          action: "add-group",
          records: application.groups || [],
          template: "tree-group",
        },
        {
          kind: "deviceType",
          label: "Devices",
          emptyLabel: "No device types yet.",
          action: "add-device-type",
          records: application.deviceTypes || [],
          template: "tree-device-type",
        },
      ];
      if (children)
        reconcile(
          children,
          sections,
          (node) => node.getAttribute("data-section-kind") || "",
          (section) => section.kind,
          () => cloneTemplate("tree-section"),
          (section, value) => {
            section.setAttribute("data-section-kind", value.kind);
            section
              .querySelector('[data-part="tree-section-label"]')
              ?.replaceChildren(value.label);
            const empty = section.querySelector(
              '[data-part="tree-section-empty"]',
            );
            if (empty) {
              empty.replaceChildren(value.emptyLabel);
              empty.toggleAttribute("hidden", value.records.length > 0);
            }
            const add = section.querySelector('[data-part="tree-section-add"]');
            if (add) {
              add.setAttribute("data-act", value.action);
              add.setAttribute(
                "title",
                value.action === "add-group"
                  ? "Add group to application"
                  : "Add device type to application",
              );
              add.replaceChildren("+");
            }
            const sectionChildren = section.querySelector(
              '[data-part="tree-children"]',
            );
            if (!sectionChildren) return;
            reconcile(
              sectionChildren,
              value.records,
              (node) => node.getAttribute("data-id") || "",
              (record) => String(record.id),
              () => cloneTemplate(value.template),
              (node, record) => {
                if (value.kind === "group")
                  fillAnchor(
                    node,
                    "group",
                    record,
                    record.name,
                    `${groupDevices(record, devices).length} devices`,
                  );
                else {
                  fillAnchor(
                    node,
                    "deviceType",
                    record,
                    record.name,
                    `${(record.instances || []).length} devices`,
                  );
                  const instanceList = node.querySelector(
                    '[data-part="tree-children"]',
                  );
                  if (!instanceList) return;
                  reconcile(
                    instanceList,
                    record.instances || [],
                    (instance) => instance.getAttribute("data-id") || "",
                    (instance) => String(instance.id),
                    () => cloneTemplate("tree-device-instance"),
                    (instanceNode, instance) => {
                      const label =
                        planner.devices.instanceName(plan, instance.id) ||
                        "Device instance";
                      if (typeof planner.dom?.render === "function")
                        planner.dom.render(instanceNode, "deviceInstance", {
                          ...instance,
                          label,
                        });
                      else instanceNode.setAttribute("data-id", instance.id);
                    },
                  );
                }
              },
            );
          },
        );
      return branch;
    };

    /** @param {Record<string, any>} plan */
    const draw = (plan) => {
      if (!surface) return;
      const floor = (plan.floors || []).find(
        (/** @type {any} */ item) => item.id === activeFloorId,
      );
      const devices = devicesOf(floor);
      surface.setAttribute("data-active-floor", activeFloorId || "");
      surface.setAttribute("data-active-kind", selection?.kind || "");
      surface.setAttribute("data-active-entity", selection?.id || "");
      for (const layer of [
        "background-layer",
        "group-layer",
        "link-layer",
        "device-layer",
      ])
        surface.querySelector(`[data-part="${layer}"]`)?.replaceChildren();

      const backgroundLayer = surface.querySelector(
        '[data-part="background-layer"]',
      );
      if (backgroundLayer && floor?.background?.src) {
        const image = surfacePart("surface-background");
        if (image) {
          image.setAttribute("href", floor.background.src);
          image.setAttribute(
            "opacity",
            String((floor.background.opacity ?? 100) / 100),
          );
          backgroundLayer.append(image);
        }
      }

      const groupLayer = surface.querySelector('[data-part="group-layer"]');
      for (const group of (floor?.applications || []).flatMap(
        (/** @type {any} */ item) => item.groups || [],
      )) {
        if (!group.rect || !groupLayer) continue;
        const rect = surfacePart("surface-group");
        if (!rect) continue;
        for (const [name, value] of Object.entries({
          x: group.rect.x,
          y: group.rect.y,
          width: group.rect.width,
          height: group.rect.height,
          fill: group.color,
          "data-id": group.id,
          "data-kind": "group",
          role: "button",
          tabindex: "0",
          "aria-label": `${group.name}, ${groupDevices(group, devices).length} devices`,
        }))
          rect.setAttribute(name, String(value));
        setState(
          rect,
          "selected",
          selection?.kind === "group" && selection.id === group.id,
        );
        groupLayer.append(rect);
      }

      const linkLayer = surface.querySelector('[data-part="link-layer"]');
      for (const group of (floor?.applications || []).flatMap(
        (/** @type {any} */ item) => item.groups || [],
      )) {
        if (!group.rect || !linkLayer) continue;
        for (const device of groupDevices(group, devices)) {
          const line = surfacePart("surface-link");
          if (!line) continue;
          for (const [name, value] of Object.entries({
            x1: group.rect.x + group.rect.width / 2,
            y1: group.rect.y + group.rect.height / 2,
            x2: device.x,
            y2: device.y,
            "data-id": `${group.id}-${device.id}`,
          }))
            line.setAttribute(name, String(value));
          linkLayer.append(line);
        }
      }

      const deviceLayer = surface.querySelector('[data-part="device-layer"]');
      for (const device of devices) {
        if (!deviceLayer) continue;
        const circle = surfacePart("surface-device");
        if (!circle) continue;
        for (const [name, value] of Object.entries({
          cx: device.x,
          cy: device.y,
          "data-id": device.id,
          "data-kind": "device",
          "data-type-id": device.deviceType.id,
          role: "button",
          tabindex: "0",
          "aria-label":
            planner.devices.instanceName(plan, device.id) || "Device instance",
        }))
          circle.setAttribute(name, String(value));
        setState(
          circle,
          "selected",
          selection?.kind === "device" && selection.id === device.id,
        );
        setState(
          circle,
          "affinity",
          selection?.kind === "device-type" &&
            selection.id === device.deviceType.id,
        );
        deviceLayer.append(circle);
      }
    };

    const reflectSelection = () => {
      for (const anchor of root.querySelectorAll("[data-anchor]")) {
        const anchorKind = anchor.getAttribute("data-anchor") || "";
        const kind =
          anchorKind === "deviceType"
            ? "device-type"
            : anchorKind === "deviceInstance"
              ? "device"
              : anchorKind;
        const selected = Boolean(
          selection &&
          selection.kind === kind &&
          selection.id === anchor.getAttribute("data-id"),
        );
        setState(anchor, "selected", selected);
        const scope = /** @type {HTMLInputElement | null} */ (
          anchor.querySelector('input[name="planner-scope"]')
        );
        if (scope) {
          scope.value = anchor.getAttribute("data-id") || "";
          scope.checked = anchor.getAttribute("data-id") === activeFloorId;
          scope.toggleAttribute("checked", scope.checked);
        }
        const radio = /** @type {HTMLInputElement | null} */ (
          anchor.querySelector('input[name="planner-selection"]')
        );
        if (radio) {
          radio.checked = selected;
          radio.toggleAttribute("checked", selected);
        }
        if (anchorKind === "floor")
          anchor.setAttribute(
            "aria-current",
            anchor.getAttribute("data-id") === activeFloorId ? "true" : "false",
          );
      }
      root.setAttribute("data-active-floor", activeFloorId || "");
      draw(store.read());
      status?.refresh?.();
    };

    const announceSelection = () =>
      document.dispatchEvent(
        new CustomEvent("planner:selection-changed", {
          detail: selection || { kind: "", id: "" },
        }),
      );

    /** @param {Record<string, any>} plan */
    const render = (plan = store.read()) => {
      const list = root.querySelector('[data-part="tree-list"]');
      if (!list) return plan;
      if (selection && !entityOf(plan, selection.id)) {
        selection = null;
        announceSelection();
      }
      const screen = list.querySelector('[data-part="screen-project"]');
      const host = screen || list;
      let project =
        [...host.children].find(
          (node) => node.getAttribute("data-anchor") === "project",
        ) || null;
      if (!project) project = cloneTemplate("tree-project");
      if (!project) return plan;
      const floors = Array.isArray(plan.floors) ? plan.floors : [];
      if (!floors.some((floor) => floor.id === activeFloorId))
        activeFloorId = floors[0]?.id || null;
      if (typeof planner.dom?.render === "function")
        planner.dom.render(project, "project", plan.project || {});
      const floorList = project.querySelector('[data-part="tree-floors"]');
      if (floorList)
        reconcile(
          floorList,
          floors,
          (node) => node.getAttribute("data-id") || "",
          (floor) => String(floor.id),
          () => cloneTemplate("tree-floor"),
          (branch, floor) => renderFloor(floor, plan, branch),
        );
      if (project.parentElement !== host) host.append(project);
      document.body.dataset.screen = "project";
      reflectSelection();
      return plan;
    };

    render();

    /** @param {"undo" | "redo"} direction */
    const history = (direction) => {
      const before = store.read();
      const result = store[direction]?.();
      const after = result || store.read();
      activeFloorId = planner.floors.changedId(before, after) || activeFloorId;
      render(after);
      return result;
    };

    /** @param {Element | null} anchor @returns {boolean} */
    const startRename = (anchor) => {
      const row = anchor?.querySelector(
        '[data-part="tree-row"], [data-part="selection-catcher"]',
      );
      const name = anchor?.querySelector('[data-part="tree-name"]');
      const input = /** @type {HTMLInputElement | null} */ (
        anchor?.querySelector('[data-part="tree-name-input"]')
      );
      if (!row || !name || !input) return false;
      cancelInput = null;
      input.value = name.textContent || "";
      row.setAttribute("hidden", "");
      input.removeAttribute("hidden");
      input.focus();
      input.select();
      return true;
    };

    /** @param {HTMLInputElement} input @param {boolean} commit */
    const finishRename = (input, commit) => {
      if (input.hasAttribute("hidden")) return;
      const anchor = input.closest("[data-anchor]");
      const id = anchor?.getAttribute("data-id");
      const entity = anchor?.getAttribute("data-anchor");
      anchor
        ?.querySelector(
          '[data-part="tree-row"], [data-part="selection-catcher"]',
        )
        ?.removeAttribute("hidden");
      input.setAttribute("hidden", "");
      if (commit && id && entity && registry) {
        registry.dispatch({
          entity,
          action: "rename",
          id,
          value: input.value,
          coalesce: `rename:${id}`,
        });
      }
      render();
      if (entity && id) queueMicrotask(() => focusRow(entity, id));
    };

    /** @param {string} kind @param {string} id */
    const select = (kind, id) => {
      const keepSurfaceFocus = Boolean(
        surface && surface.contains(document.activeElement),
      );
      selection = { kind, id };
      const floorId = planner.floors.floorOf(store.read(), id);
      if (floorId) activeFloorId = floorId;
      reflectSelection();
      announceSelection();
      openAncestors(kind, id);
      if (
        keepSurfaceFocus &&
        surface &&
        (kind === "device" || kind === "group")
      )
        /** @type {HTMLElement | null} */ (
          surface.querySelector(
            `[data-part="surface-${kind === "device" ? "device" : "group"}"][data-id="${id}"]`,
          )
        )?.focus();
    };

    root.addEventListener("input", (/** @type {Event} */ event) => {
      const target = /** @type {HTMLInputElement | null} */ (event.target);
      if (!target?.matches('[data-part="tree-opacity-slider"]')) return;
      const floor = target.closest('[data-anchor="floor"]');
      if (
        !floor ||
        floor.getAttribute("data-id") !==
          surface?.getAttribute("data-active-floor")
      )
        return;
      surface
        ?.querySelector('[data-part="surface-background"]')
        ?.setAttribute("opacity", String(Number(target.value) / 100));
    });

    root.addEventListener("change", (/** @type {Event} */ event) => {
      const target = /** @type {HTMLInputElement | null} */ (event.target);
      if (target?.matches('[data-part="tree-background-input"]')) {
        const file = target.files?.[0];
        const floor = target.closest('[data-anchor="floor"]');
        const id = floor?.getAttribute("data-id");
        if (!file || file.size > 8 * 1024 * 1024 || !id || !registry) return;
        const reader = new FileReader();
        reader.onload = () => {
          registry.dispatch({
            entity: "floor",
            action: "set-background",
            id,
            value: {
              src: String(reader.result),
              opacity:
                store
                  .read()
                  .floors.find((/** @type {any} */ floor) => floor.id === id)
                  ?.background?.opacity ?? 100,
            },
            coalesce: `background:${id}`,
          });
          render();
        };
        reader.readAsDataURL(file);
        return;
      }
      if (target?.matches('[data-part="tree-opacity-checkbox"]')) {
        const branch = target.closest('[data-part="tree-floor-branch"]');
        const slider = branch?.querySelector(
          '[data-part="tree-opacity-slider"]',
        );
        if (branch) setState(branch, "controls-open", target.checked);
        slider?.toggleAttribute("hidden", !target.checked);
        return;
      }
      if (target?.matches('[data-part="tree-opacity-slider"]')) {
        const floor = target.closest('[data-anchor="floor"]');
        const id = floor?.getAttribute("data-id");
        if (!id || !registry) return;
        registry.dispatch({
          entity: "floor",
          action: "set-opacity",
          id,
          value: target.value,
          coalesce: `opacity:${id}`,
        });
        render();
        return;
      }
      if (target?.matches('input[name="planner-scope"]')) {
        const floor = target.closest('[data-anchor="floor"]');
        const id = floor?.getAttribute("data-id");
        if (id) {
          activeFloorId = id;
          selection = null;
          reflectSelection();
          announceSelection();
        }
        return;
      }
      if (!target?.matches('input[name="planner-selection"]')) return;
      const anchor = target.closest("[data-anchor]");
      const anchorKind = anchor?.getAttribute("data-anchor") || "";
      const kind =
        anchorKind === "deviceType"
          ? "device-type"
          : anchorKind === "deviceInstance"
            ? "device"
            : anchorKind;
      const id = anchor?.getAttribute("data-id") || target.value || "";
      if (kind && id) select(kind, id);
    });

    const dispatchTree = (
      /** @type {Record<string, any>} */ intent,
      /** @type {unknown} */ tag = null,
    ) => {
      if (!registry) return null;
      const result = registry.dispatch({ ...intent, coalesce: tag });
      render();
      return result;
    };

    root.addEventListener("click", (/** @type {Event} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (target?.closest('[data-part="tree-background"]')) {
        event.preventDefault();
        /** @type {HTMLElement | null} */ (
          target
            .closest('[data-anchor="floor"]')
            ?.querySelector('[data-part="tree-background-input"]')
        )?.click();
        return;
      }
      const action = target?.closest?.("[data-act]")?.getAttribute("data-act");
      if (
        !action ||
        action === "select" ||
        action === "rename" ||
        action === "recolor"
      )
        return;
      const anchor = target?.closest?.("[data-anchor]");
      const entity = anchor?.getAttribute("data-anchor");
      const id = anchor?.getAttribute("data-id");
      if (!entity || !id || !registry) return;
      event.preventDefault();
      event.stopPropagation();
      const intent = planner.dom?.intentFrom?.(event) || { entity, action, id };
      intent.entity = entity;
      intent.action = action;
      intent.id = id;
      if (entity === "application" && action === "delete")
        intent.floorId = planner.floors.floorOf(store.read(), id);
      if (entity === "deviceType" && action === "add-instance") {
        intent.x = 500;
        intent.y = 350;
      }
      const before = store.read();
      const result = dispatchTree(intent);
      if (action === "delete") {
        if (selection?.id === id) selection = null;
        activeFloorId =
          planner.floors.floorOf(result || before, activeFloorId) ||
          (result || before).floors[0]?.id ||
          null;
      } else if (result && action === "add-application") {
        const floor = result.floors.find(
          (/** @type {any} */ floor) => floor.id === id,
        );
        const added = floor?.applications.at(-1);
        if (added) select("application", added.id);
      } else if (result && action === "add-group") {
        const application = entityOf(result, id);
        const added = application?.groups?.at(-1);
        if (added) select("group", added.id);
      } else if (result && action === "add-device-type") {
        const application = entityOf(result, id);
        const added = application?.deviceTypes?.at(-1);
        if (added) select("device-type", added.id);
      }
    });

    root.addEventListener("click", (/** @type {Event} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (
        target?.closest?.(
          '[data-act], [data-part="tree-opacity-toggle"], [data-part="tree-background"], [data-part="tree-background-input"], [data-part="tree-name-input"], summary',
        )
      )
        return;
      if (target?.closest?.('[data-part="tree-list"]') && selection) {
        selection = null;
        reflectSelection();
        announceSelection();
      }
    });

    const announce = (/** @type {string} */ message) =>
      document
        .querySelector('[data-part="surface-announcer"]')
        ?.replaceChildren(message);

    const reorderTo = (
      /** @type {Element} */ source,
      /** @type {Element} */ target,
      /** @type {"before" | "after"} */ where,
    ) => {
      const kind = source.getAttribute("data-anchor");
      const id = source.getAttribute("data-id");
      const targetId = target.getAttribute("data-id");
      const section = target.matches('[data-part="tree-section"]');
      const targetKind = section
        ? target.getAttribute("data-section-kind")
        : target.getAttribute("data-anchor");
      const sourceApplication = source.closest('[data-anchor="application"]');
      const targetApplication = target.closest('[data-anchor="application"]');
      const sourceApplicationId = sourceApplication?.getAttribute("data-id");
      const targetApplicationId = targetApplication?.getAttribute("data-id");
      if (
        !kind ||
        !id ||
        !targetKind ||
        kind !== targetKind ||
        !sourceApplicationId ||
        !targetApplicationId ||
        (!section && !targetId)
      )
        return false;
      if (!section && targetId === id) return false;
      const plan = store.read();
      if (
        planner.floors.floorOf(plan, sourceApplicationId) !==
        planner.floors.floorOf(plan, targetApplicationId)
      ) {
        announce(
          `Drop refused: ${kind === "deviceType" ? "Device types" : "Groups"} must stay on the same floor.`,
        );
        return true;
      }
      const collection =
        kind === "group"
          ? targetApplication?.querySelectorAll('[data-anchor="group"]')
          : targetApplication?.querySelectorAll('[data-anchor="deviceType"]');
      if (!collection) return false;
      const targetIndex = targetId
        ? [...collection].findIndex(
            (item) => item.getAttribute("data-id") === targetId,
          )
        : -1;
      if (!section && targetIndex < 0) return false;
      const index = section
        ? collection.length
        : targetIndex + (where === "after" ? 1 : 0);
      if (kind === "group") {
        dispatchTree(
          {
            entity: "group",
            action: "reorder",
            id,
            targetApplicationId,
            index,
          },
        );
      } else if (kind === "deviceType") {
        if (!section && sourceApplicationId === targetApplicationId)
          dispatchTree(
            { entity: "deviceType", action: "reorder", id, targetId, where },
          );
        else
          dispatchTree(
            {
              entity: "deviceType",
              action: "move",
              id,
              targetApplicationId,
              index,
            },
          );
      } else return false;
      return true;
    };

    /** @type {{kind: string, id: string} | null} */
    let dragged = null;
    root.addEventListener(
      "dragstart",
      /** @type {EventListener} */ (
        (/** @type {DragEvent} */ event) => {
          const anchor = /** @type {Element | null} */ (
            event.target
          )?.closest?.('[data-anchor="group"], [data-anchor="deviceType"]');
          const kind = anchor?.getAttribute("data-anchor");
          const id = anchor?.getAttribute("data-id");
          if (!kind || !id) return;
          dragged = { kind, id };
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", id);
          }
        }
      ),
    );
    root.addEventListener(
      "dragover",
      /** @type {EventListener} */ (
        (/** @type {DragEvent} */ event) => {
          const target = /** @type {Element | null} */ (
            event.target
          )?.closest?.(
            '[data-anchor="group"], [data-anchor="deviceType"], [data-part="tree-section"]',
          );
          const targetKind = target?.matches('[data-part="tree-section"]')
            ? target.getAttribute("data-section-kind")
            : target?.getAttribute("data-anchor");
          if (
            !dragged ||
            !target ||
            targetKind !== dragged.kind ||
            target.getAttribute("data-id") === dragged.id
          )
            return;
          event.preventDefault();
          if (event.dataTransfer)
            event.dataTransfer.dropEffect = "move";
          for (const element of root.querySelectorAll("[data-drop]"))
            element.removeAttribute("data-drop");
          target.setAttribute("data-drop", "true");
        }
      ),
    );
    root.addEventListener(
      "drop",
      /** @type {EventListener} */ (
        (/** @type {DragEvent} */ event) => {
          const target = /** @type {Element | null} */ (
            event.target
          )?.closest?.(
            '[data-anchor="group"], [data-anchor="deviceType"], [data-part="tree-section"]',
          );
          const targetKind = target?.matches('[data-part="tree-section"]')
            ? target.getAttribute("data-section-kind")
            : target?.getAttribute("data-anchor");
          if (
            !dragged ||
            !target ||
            targetKind !== dragged.kind ||
            target.getAttribute("data-id") === dragged.id
          )
            return;
          const source = anchorOf(dragged.kind, dragged.id);
          if (!source) return;
          event.preventDefault();
          const box = target.getBoundingClientRect();
          reorderTo(
            source,
            target,
            event.clientY < box.top + box.height / 2 ? "before" : "after",
          );
          for (const element of root.querySelectorAll("[data-drop]"))
            element.removeAttribute("data-drop");
          dragged = null;
        }
      ),
    );
    root.addEventListener("dragend", () => {
      dragged = null;
      for (const element of root.querySelectorAll("[data-drop]"))
        element.removeAttribute("data-drop");
    });

    root.addEventListener("click", (/** @type {Event} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (
        target?.closest?.(
          '[data-act], [data-part="tree-opacity-toggle"], [data-part="tree-background"], [data-part="tree-background-input"], [data-part="tree-name-input"], summary',
        )
      )
        return;
      if (target?.closest?.('[data-part="tree-list"]') && selection) {
        selection = null;
        reflectSelection();
        announceSelection();
      }
    });

    root.addEventListener("keydown", (/** @type {Event} */ event) => {
      const keyEvent = /** @type {KeyboardEvent} */ (event);
      const target = /** @type {Element | null} */ (event.target);
      const branch = target?.closest?.("details");
      if (
        branch &&
        !target?.matches('[data-part="tree-name-input"]') &&
        (keyEvent.key === "ArrowLeft" || keyEvent.key === "ArrowRight")
      ) {
        if (keyEvent.key === "ArrowRight") branch.open = true;
        else if (branch.open) branch.open = false;
        else {
          const parent = branch.parentElement?.closest("details");
          /** @type {HTMLElement | null} */ (
            parent?.querySelector(':scope > [data-part="tree-summary"]')
          )?.focus();
        }
        keyEvent.preventDefault();
        return;
      }
      if (
        keyEvent.key === "Escape" &&
        !target?.matches('[data-part="tree-name-input"]')
      ) {
        if (selection) {
          selection = null;
          reflectSelection();
          announceSelection();
        }
        event.preventDefault();
        return;
      }
      const row = target?.closest?.(
        '[data-part="tree-row"], [data-part="selection-catcher"], [data-part="tree-instance-row"]',
      );
      if (
        row &&
        keyEvent.altKey &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          keyEvent.key,
        )
      ) {
        const anchor = row.closest("[data-anchor]");
        if (!anchor) return;
        const kind = anchor?.getAttribute("data-anchor");
        const id = anchor?.getAttribute("data-id");
        const application = anchor?.closest('[data-anchor="application"]');
        const siblings =
          kind && application
            ? [...application.querySelectorAll(`[data-anchor="${kind}"]`)]
            : [];
        const index = id
          ? siblings.findIndex((item) => item.getAttribute("data-id") === id)
          : -1;
        const delta =
          keyEvent.key === "ArrowUp" || keyEvent.key === "ArrowLeft" ? -1 : 1;
        const targetIndex = index + delta;
        if (
          id &&
          application &&
          (kind === "group" || kind === "deviceType") &&
          siblings[targetIndex]
        ) {
          if (
            reorderTo(
              anchor,
              siblings[targetIndex],
              delta > 0 ? "after" : "before",
            )
          )
            event.preventDefault();
        }
        return;
      }
      if (row && keyEvent.key === "F2") {
        const anchor = row.closest("[data-anchor]");
        if (startRename(anchor)) event.preventDefault();
        return;
      }
      if (!row || (keyEvent.key !== "Enter" && keyEvent.key !== " ")) return;
      const anchor = row.closest("[data-anchor]");
      const anchorKind = anchor?.getAttribute("data-anchor") || "";
      const kind =
        anchorKind === "deviceType"
          ? "device-type"
          : anchorKind === "deviceInstance"
            ? "device"
            : anchorKind;
      const id = anchor?.getAttribute("data-id");
      if (!kind || !id) return;
      event.preventDefault();
      if (kind === "floor") {
        activeFloorId = id;
        selection = null;
        reflectSelection();
        announceSelection();
      } else select(kind, id);
    });

    surface?.addEventListener("click", (/** @type {Event} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      const shape = target?.closest?.(
        '[data-part="surface-group"], [data-part="surface-device"]',
      );
      const kind = shape?.getAttribute("data-kind");
      const id = shape?.getAttribute("data-id");
      if (kind && id) select(kind, id);
      else if (selection) {
        selection = null;
        reflectSelection();
        announceSelection();
      }
    });

    surface?.addEventListener("keydown", (/** @type {Event} */ event) => {
      const keyEvent = /** @type {KeyboardEvent} */ (event);
      const target = /** @type {Element | null} */ (event.target);
      const shape = target?.closest?.(
        '[data-part="surface-group"], [data-part="surface-device"]',
      );
      const kind = shape?.getAttribute("data-kind");
      const id = shape?.getAttribute("data-id");
      if (!shape || !kind || !id) {
        if (
          keyEvent.key === "Escape" &&
          !surface.hasAttribute("data-anchor-x")
        ) {
          event.preventDefault();
          if (selection) {
            selection = null;
            reflectSelection();
            announceSelection();
          }
        }
        return;
      }
      if (keyEvent.key === "Enter" || keyEvent.key === " ") {
        event.preventDefault();
        select(kind, id);
      } else if (
        (keyEvent.key === "Delete" || keyEvent.key === "Backspace") &&
        kind === "device"
      ) {
        event.preventDefault();
        if (registry) {
          registry.dispatch({
            entity: "deviceInstance",
            action: "delete",
            id,
          });
        }
        selection = null;
        render();
      } else if (
        keyEvent.key === "Escape" &&
        !surface.hasAttribute("data-anchor-x")
      ) {
        event.preventDefault();
        if (selection) {
          selection = null;
          reflectSelection();
          announceSelection();
        }
      }
    });

    const workflowWidthKey = "mesh-planner:workflow-width";
    const workspace = document.querySelector('[data-part="workspace"]');
    const splitter = /** @type {HTMLElement | null} */ (
      document.querySelector('[data-part="splitter"]')
    );
    let workflowWidth =
      Number(localStorage.getItem(workflowWidthKey)) || 320;
    const maximumWidth = () => {
      if (!workspace || !splitter) return 640;
      return Math.max(
        220,
        workspace.getBoundingClientRect().width -
          320 -
          splitter.getBoundingClientRect().width,
      );
    };
    const applyWidth = (/** @type {number} */ value) => {
      workflowWidth = Math.min(maximumWidth(), Math.max(220, value));
      document.documentElement.style.setProperty(
        "--workflow-width",
        `${workflowWidth}px`,
      );
      localStorage.setItem(
        workflowWidthKey,
        String(workflowWidth),
      );
      splitter?.setAttribute("aria-valuemin", "220");
      splitter?.setAttribute("aria-valuemax", String(maximumWidth()));
      splitter?.setAttribute(
        "aria-valuenow",
        String(Math.round(workflowWidth)),
      );
    };
    applyWidth(workflowWidth);
    let dragging = false;
    splitter?.addEventListener(
      "pointerdown",
      (/** @type {PointerEvent} */ event) => {
        dragging = true;
        splitter.setPointerCapture(event.pointerId);
        applyWidth(
          event.clientX - (workspace?.getBoundingClientRect().left || 0),
        );
      },
    );
    splitter?.addEventListener(
      "pointermove",
      (/** @type {PointerEvent} */ event) => {
        if (!dragging) return;
        applyWidth(
          event.clientX - (workspace?.getBoundingClientRect().left || 0),
        );
      },
    );
    splitter?.addEventListener("pointerup", () => {
      dragging = false;
    });
    splitter?.addEventListener("pointercancel", () => {
      dragging = false;
    });
    splitter?.addEventListener(
      "keydown",
      (/** @type {KeyboardEvent} */ event) => {
        const step = event.shiftKey ? 1 : 16;
        if (event.key === "Home") applyWidth(220);
        else if (event.key === "End") applyWidth(maximumWidth());
        else if (event.key === "ArrowLeft") applyWidth(workflowWidth - step);
        else if (event.key === "ArrowRight") applyWidth(workflowWidth + step);
        else return;
        event.preventDefault();
      },
    );

    root.addEventListener("dblclick", (/** @type {Event} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      const name = target?.closest?.('[data-part="tree-name"]');
      const anchor = name?.closest?.("[data-anchor]");
      if (!name || !anchor) return;
      startRename(anchor);
    });

    root.addEventListener("keydown", (/** @type {Event} */ event) => {
      const keyEvent = /** @type {KeyboardEvent} */ (event);
      const input = /** @type {HTMLInputElement | null} */ (event.target);
      if (!input?.matches('[data-part="tree-name-input"]')) return;
      if (keyEvent.key === "Escape") {
        event.preventDefault();
        cancelInput = input;
        finishRename(input, false);
      } else if (keyEvent.key === "Enter") {
        event.preventDefault();
        finishRename(input, true);
      }
    });

    root.addEventListener("focusout", (/** @type {Event} */ event) => {
      const input = /** @type {HTMLInputElement | null} */ (event.target);
      if (!input?.matches('[data-part="tree-name-input"]')) return;
      if (cancelInput === input) {
        cancelInput = null;
        return;
      }
      finishRename(input, true);
    });

    const unsubscribe = store.subscribe?.(() => render());

    return Object.freeze({
      render,
      history,
      read: store.read,
      select,
      disconnect: () => {
        unsubscribe?.();
        status?.disconnect?.();
      },
    });
  };

  planner.tree = Object.freeze({ create });
}
