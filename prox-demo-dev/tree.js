/**
 * Mounts the workflow tree and coordinates its document and view-state inputs.
 * Channels: dispatches planner:selection-changed.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

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
    if (tokens.size) element.setAttribute("data-state", [...tokens].join(" "));
    else element.removeAttribute("data-state");
  };

  /** @param {PlanDocument} plan @param {string} id @returns {any | null} */
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

  /** @param {Group} group @param {any[]} devices @returns {any[]} */
  const groupDevices = (group, devices) =>
    group?.rect && planner.geo?.contains
      ? devices.filter((device) => planner.geo?.contains?.(group.rect, device))
      : [];

  /** @param {Element} anchor @param {string} kind @param {any} entity @param {string} label @param {string} [detail] */
  const fillAnchor = (anchor, kind, entity, label, detail = "") => {
    const view = {
      ...entity,
      ...(kind === "group" ? planner.groups?.strokeSlots?.(entity) : null),
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
    if (!options?.root || typeof options.store?.read !== "function")
      throw new TypeError("tree requires root, store, and registry");
    const { root, store, surface, surfaceRenderer } = options;
    const { registry } = options;
    if (typeof registry?.dispatch !== "function")
      throw new TypeError("tree requires a command registry");
    if (surface && typeof surfaceRenderer?.render !== "function")
      throw new TypeError("tree requires a surface renderer");
    setState(root, "tree", true);
    const status = planner.status?.create({ root, store });
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector('[data-part="tree-root-template"]')
    );
    const list = template?.content.firstElementChild?.cloneNode(true);
    if (!list) throw new Error("tree root template is missing");
    options.root.replaceChildren(list);

    /** @type {{kind: string, id: string} | null} */
    let selection = null;
    const treeView = planner.treeView.create({
      root,
      onSelect: (anchor) => {
        const anchorKind = anchor.getAttribute("data-anchor") || "";
        const kind =
          anchorKind === "deviceType"
            ? "device-type"
            : anchorKind === "deviceInstance"
              ? "device"
              : anchorKind;
        const id = anchor.getAttribute("data-id") || "";
        if (kind && id && kind !== "project") select(kind, id);
      },
      onClear: () => {
        if (root.querySelector('[data-part="tree-props-popover"]:popover-open'))
          return false;
        if (!selection) return true;
        selection = null;
        reflectSelection();
        announceSelection();
        return true;
      },
    });

    /** @param {string} kind @param {string} id @returns {Element | null} */
    const anchorOf = (kind, id) =>
      [...root.querySelectorAll("[data-anchor]")].find(
        (anchor) =>
          anchor.getAttribute("data-anchor") === kind &&
          anchor.getAttribute("data-id") === id,
      ) || null;

    /** @param {string} kind @param {string} id */
    const focusRow = (kind, id) => {
      const anchor = anchorOf(
        kind === "device"
          ? "deviceInstance"
          : kind === "device-type"
            ? "deviceType"
            : kind,
        id,
      );
      treeView.focusRow(anchor);
      if (kind === "project")
        /** @type {HTMLElement | null} */ (
          anchor?.querySelector('[data-part="tree-project-name"]')
        )?.focus();
    };

    /** @param {Floor} floor @param {PlanDocument} plan @param {Element} branch @returns {Element} */
    const renderFloor = (floor, plan, branch) => {
      const activeFloorId = planner.selection.activeFloor(plan);
      fillAnchor(branch, "floor", floor, floor.name);
      setState(branch, "active", floor.id === activeFloorId);
      branch.setAttribute(
        "aria-current",
        floor.id === activeFloorId ? "true" : "false",
      );
      const children = branch.querySelector('[data-part="tree-children"]');
      if (children)
        treeView.reconcile(children, floor.applications || [], {
          nodeKey: (node) => node.getAttribute("data-id") || "",
          recordKey: (application) => String(application.id),
          createNode: () => cloneTemplate("tree-application"),
          updateNode: (node, application) =>
            renderApplication(application, plan, node),
        });
      return branch;
    };

    /** @param {Application} application @param {PlanDocument} plan @param {Element} branch @returns {Element | null} */
    const renderApplication = (application, plan, branch) => {
      if (!branch) return null;
      const devices = (application.deviceTypes || []).flatMap(
        (type) => type.instances || [],
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
          records: application.groups || [],
          template: "tree-group",
          sectionTemplate: "tree-group-section",
        },
        {
          kind: "deviceType",
          records: application.deviceTypes || [],
          template: "tree-device-type",
          sectionTemplate: "tree-device-section",
        },
      ];
      if (children)
        treeView.reconcile(children, sections, {
          nodeKey: (node) => node.getAttribute("data-section-kind") || "",
          recordKey: (section) => section.kind,
          createNode: (section) => cloneTemplate(section.sectionTemplate),
          updateNode: (section, value) => {
            const sectionChildren = section.querySelector(
              '[data-part="tree-children"]',
            );
            if (!sectionChildren) return;
            treeView.reconcile(sectionChildren, value.records, {
              nodeKey: (node) => node.getAttribute("data-id") || "",
              recordKey: (record) => String(record.id),
              createNode: () => cloneTemplate(value.template),
              updateNode: (node, record) => {
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
                  treeView.reconcile(instanceList, record.instances || [], {
                    nodeKey: (instance) =>
                      instance.getAttribute("data-id") || "",
                    recordKey: (instance) => String(instance.id),
                    createNode: () => cloneTemplate("tree-device-instance"),
                    updateNode: (instanceNode, instance) => {
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
                  });
                }
              },
            });
          },
        });
      return branch;
    };

    const reflectSelection = () => {
      const plan = store.read();
      const activeFloorId = planner.selection.activeFloor(
        plan,
        selection ? planner.floors.floorOf(plan, selection.id) || "" : "",
      );
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
      if (surface)
        surfaceRenderer.render(plan, activeFloorId || null, selection);
      status?.refresh?.();
    };

    const announceSelection = () =>
      document.dispatchEvent(
        new CustomEvent("planner:selection-changed", {
          detail: selection || { kind: "", id: "" },
        }),
      );

    /** @param {PlanDocument} plan */
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
      planner.selection.activeFloor(plan);
      if (typeof planner.dom?.render === "function")
        planner.dom.render(project, "project", plan.project || {});
      const floorList = project.querySelector('[data-part="tree-floors"]');
      if (floorList)
        treeView.reconcile(floorList, floors, {
          nodeKey: (node) => node.getAttribute("data-id") || "",
          recordKey: (floor) => String(floor.id),
          createNode: () => cloneTemplate("tree-floor"),
          updateNode: (branch, floor) => renderFloor(floor, plan, branch),
        });
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
      const changedFloorId = planner.floors.changedId(before, after);
      planner.selection.activeFloor(after, changedFloorId || "");
      render(after);
      return result;
    };

    /** @param {string} kind @param {string} id */
    const select = (kind, id) => {
      const keepSurfaceFocus = Boolean(
        surface && surface.contains(document.activeElement),
      );
      selection = { kind, id };
      reflectSelection();
      announceSelection();
      treeView.openAncestors(
        anchorOf(
          kind === "device"
            ? "deviceInstance"
            : kind === "device-type"
              ? "deviceType"
              : kind,
          id,
        ),
      );
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

    root.addEventListener("input", (event) => {
      const target = /** @type {HTMLInputElement | null} */ (event.target);
      if (target?.matches('[data-part="tree-props-name"]')) {
        const anchor = target.closest("[data-anchor]");
        const entity = anchor?.getAttribute("data-anchor");
        const id = anchor?.getAttribute("data-id");
        if (!anchor || !entity || !id || !registry) return;
        registry.dispatch({
          entity,
          action: "rename",
          id,
          value: target.value,
          coalesce: `rename:${id}`,
        });
        // Rewriting the row from the document would put the caret back at the
        // end of the field on every keystroke, so only the name follows.
        const row = anchor.querySelector(
          '[data-part="tree-row"], [data-part="tree-project-name"]',
        );
        const name = row?.querySelector(
          '[data-slot="name"][data-slot-as="text"]',
        );
        if (name) name.textContent = target.value;
        return;
      }
      if (!target?.matches('[data-part="tree-opacity-slider"]')) return;
      const floor = target.closest('[data-anchor="floor"]');
      if (
        !floor ||
        floor.getAttribute("data-id") !==
          document.documentElement.getAttribute("data-active-floor")
      )
        return;
      if (!surface?.querySelector('[data-part="surface-background"]')) return;
      surface.style.setProperty(
        "--surface-background-opacity",
        String(Number(target.value) / 100),
      );
      setState(surface, "opacity-preview", true);
    });

    root.addEventListener("change", (event) => {
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
                store.read().floors.find((floor) => floor.id === id)?.background
                  ?.opacity ?? 100,
            },
            coalesce: `background:${id}`,
          });
          render();
        };
        reader.readAsDataURL(file);
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

    root.addEventListener("click", (event) => {
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
      if (entity === "project" && action === "add-floor") {
        intent.entity = "floor";
        intent.action = "add";
      }
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
        const next = result || before;
        planner.selection.activeFloor(next);
      } else if (result && action === "add-application") {
        const floor = result.floors.find((floor) => floor.id === id);
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

    root.addEventListener("click", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (
        target?.closest?.(
          '[data-act], [data-part="tree-props-toggle"], [data-part="tree-props-popover"], [data-part="tree-background"], [data-part="tree-background-input"], [data-part="tree-name-input"], summary',
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
    const reorder = planner.treeReorder.create({
      root,
      store,
      dispatch: dispatchTree,
      anchorOf,
      announce,
    });


    surface?.addEventListener("click", (event) => {
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

    const workspace = document.querySelector('[data-part="workspace"]');
    const splitter = /** @type {HTMLElement | null} */ (
      document.querySelector('[data-part="splitter"]')
    );
    const panelWidth = planner.panelWidth.create({
      root: document.documentElement,
      workspace,
      splitter,
      storage: localStorage,
    });

    const rename = planner.treeRename.create({
      root,
      registry,
      render,
      focusRow,
    });
    const keyboard = planner.treeKeyboard.create({
      root,
      surface,
      store,
      registry,
      readSelection: () => selection,
      clearSelection: () => {
        selection = null;
      },
      reflectSelection,
      announceSelection,
      select,
      reorder,
      rename,
      render,
    });

    const unsubscribe = store.subscribe?.(() => render());

    return Object.freeze({
      render,
      history,
      read: store.read,
      select,
      disconnect: () => {
        unsubscribe?.();
        treeView.disconnect();
        reorder.disconnect();
        rename.disconnect();
        keyboard.disconnect();
        panelWidth.disconnect();
        status?.disconnect?.();
      },
    });
  };

  planner.tree = Object.freeze({ create });
}
