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
    const clone = /** @type {Element | null} */ (
      template?.content.firstElementChild?.cloneNode(true) || null
    );
    clone
      ?.querySelectorAll(
        '[data-part="tree-name-input"], [data-part="tree-background-input"]',
      )
      .forEach((input) => input.setAttribute("hidden", ""));
    return clone;
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
    for (const area of plan.areas || []) {
      if (area.id === id) return area;
      for (const application of area.applications || []) {
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

  /** @param {number} count */
  const deviceCount = (count) => `${count} device${count === 1 ? "" : "s"}`;

  /**
   * A row's view: its record with the facts the tree derives for it.
   * @param {string} kind @param {any} entity @param {string} label
   * @param {string} [detail]
   * @param {Record<string, unknown>} [shown] derived facts a row shows but
   *   does not announce, its name already carrying the same fact
   */
  const rowView = (kind, entity, label, detail = "", shown = {}) => ({
    ...entity,
    ...(kind === "group" ? planner.groups?.strokeSlots?.(entity) : null),
    ...shown,
    ariaLabel: `${label}${detail ? `, ${detail}` : ""}`,
    detail,
  });

  /**
   * @param {Element} anchor @param {string} kind @param {any} entity
   * @param {string} label @param {string} [detail]
   * @param {Record<string, unknown>} [shown]
   */
  const fillAnchor = (anchor, kind, entity, label, detail = "", shown = {}) => {
    if (typeof planner.dom?.render === "function")
      planner.dom.render(
        anchor,
        kind,
        rowView(kind, entity, label, detail, shown),
      );
    else anchor.setAttribute("data-id", entity.id);
    return anchor;
  };

  /**
   * What a group row shows of its own visibility on the plan: the eye says
   * what a press does, and its icon the state it is in.
   * @param {Group} group @param {GroupVisibility | undefined} visibility
   */
  const groupShown = (group, visibility) => {
    const hidden = Boolean(visibility?.isHidden(group.id));
    return {
      eyeLabel: `${hidden ? "Show" : "Hide"} ${group.name}`,
      visibility: hidden ? "hidden" : "shown",
    };
  };

  /**
   * A group row's whole view in `plan`: its record and the facts the tree
   * derives for it. A redraw of the row from the record alone blanks its
   * member count and its accessible name.
   * @param {PlanDocument} plan @param {TargetId} id
   * @param {GroupVisibility} [visibility]
   */
  const groupRowView = (plan, id, visibility) => {
    for (const area of plan.areas || [])
      for (const application of area.applications || []) {
        const group = (application.groups || []).find((item) => item.id === id);
        if (!group) continue;
        const devices = (application.deviceTypes || []).flatMap(
          (type) => type.instances || [],
        );
        return rowView(
          "group",
          group,
          group.name,
          deviceCount(groupDevices(group, devices).length),
          groupShown(group, visibility),
        );
      }
    return null;
  };

  /** @param {TreeOptions} options */
  const create = (options) => {
    if (!options?.root || typeof options.store?.read !== "function")
      throw new TypeError("tree requires root, store, and registry");
    const { root, store, surface, surfaceRenderer, visibility } = options;
    const { registry } = options;
    if (typeof registry?.dispatch !== "function")
      throw new TypeError("tree requires a command registry");
    if (surface && typeof surfaceRenderer?.render !== "function")
      throw new TypeError("tree requires a surface renderer");
    setState(root, "tree", true);
    const status = planner.status?.create({ root, store, visibility });
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

    /** @param {Area} area @param {PlanDocument} plan @param {Element} branch @returns {Element} */
    const renderArea = (area, plan, branch) => {
      const activeAreaId = planner.selection.activeArea(plan);
      const placed = (area.applications || [])
        .flatMap((application) => application.deviceTypes || [])
        .flatMap((type) => type.instances || []).length;
      fillAnchor(
        branch,
        "area",
        area,
        area.name,
        `${deviceCount(placed)} placed`,
        { undeletable: !planner.areas.removable(plan) },
      );
      setState(branch, "active", area.id === activeAreaId);
      branch.setAttribute(
        "aria-current",
        area.id === activeAreaId ? "true" : "false",
      );
      branch
        .querySelector(':scope > [data-part="tree-add-application"]')
        ?.setAttribute("title", `Add an application to ${area.name}`);
      const children = branch.querySelector('[data-part="tree-children"]');
      if (children)
        treeView.reconcile(children, area.applications || [], {
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
        deviceCount(devices.length),
        application.preset
          ? {
              renameHint: application.name,
              nameHint: `${application.name} keeps its name`,
            }
          : {
              renameHint: `Double-click to rename ${application.name}`,
              nameHint: "Saves as you type",
            },
      );
      // A preset's name is fixed: its settings show it and do not edit it.
      const nameField = /** @type {HTMLInputElement | null} */ (
        branch.querySelector(
          ':scope > [data-part="tree-props-popover"] [data-part="tree-props-name"]',
        )
      );
      if (nameField) {
        nameField.readOnly = Boolean(application.preset);
        nameField.setAttribute(
          "aria-label",
          application.preset ? "Application name" : "Rename application",
        );
        nameField.setAttribute(
          "aria-description",
          application.preset
            ? `${application.name} keeps its name`
            : "Saves as you type",
        );
      }
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
            const size = value.records.length;
            const hidden =
              value.kind === "group"
                ? (visibility?.countHidden(value.records) ?? 0)
                : 0;
            planner.dom.render(section, "section", {
              count:
                value.kind === "group"
                  ? String(size)
                  : `${size} Type${size === 1 ? "" : "s"}`,
              hidden: hidden ? `· ${hidden} hidden` : "",
            });
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
                    deviceCount(groupDevices(record, devices).length),
                    groupShown(record, visibility),
                  );
                else {
                  fillAnchor(
                    node,
                    "deviceType",
                    record,
                    record.name,
                    deviceCount((record.instances || []).length),
                    { placed: `${(record.instances || []).length} placed` },
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
      const activeAreaId = planner.selection.activeArea(
        plan,
        selection ? planner.areas.areaOf(plan, selection.id) || "" : "",
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
        if (anchorKind === "area")
          anchor.setAttribute(
            "aria-current",
            anchor.getAttribute("data-id") === activeAreaId ? "true" : "false",
          );
      }
      // The application holding the selection — itself or anything inside it
      // — is the current one, as the accent on its card shows.
      for (const anchor of root.querySelectorAll('[data-anchor="application"]'))
        anchor.setAttribute(
          "aria-current",
          anchor.querySelector('input[name="planner-selection"]:checked')
            ? "true"
            : "false",
        );
      if (surface)
        surfaceRenderer.render(plan, activeAreaId || null, selection);
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
      const areas = Array.isArray(plan.areas) ? plan.areas : [];
      planner.selection.activeArea(plan);
      if (typeof planner.dom?.render === "function")
        planner.dom.render(project, "project", plan.project || {});
      const areaList = project.querySelector('[data-part="tree-areas"]');
      if (areaList)
        treeView.reconcile(areaList, areas, {
          nodeKey: (node) => node.getAttribute("data-id") || "",
          recordKey: (area) => String(area.id),
          createNode: () => cloneTemplate("tree-area"),
          updateNode: (branch, area) => renderArea(area, plan, branch),
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
      const changedAreaId = planner.areas.changedId(before, after);
      planner.selection.activeArea(after, changedAreaId || "");
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
        // A name the rules refuse is not saved; the field's hint says why
        // until the name is one they take.
        const refusal = renameRefusal(entity, id, target.value);
        if (entity === "application") {
          const hint = target
            .closest('[data-part="tree-props-field"]')
            ?.querySelector('[data-part="tree-props-hint"]');
          if (hint) hint.textContent = refusal || "Saves as you type";
        }
        if (refusal) return;
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
      const area = target.closest('[data-anchor="area"]');
      if (
        !area ||
        area.getAttribute("data-id") !==
          document.documentElement.getAttribute("data-active-area")
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
        const area = target.closest('[data-anchor="area"]');
        const id = area?.getAttribute("data-id");
        if (!file || !id || !registry) return;
        const refused = !["image/png", "image/jpeg", "image/svg+xml"].includes(
          file.type,
        )
          ? "is not a PNG, JPG or SVG"
          : file.size > 8 * 1024 * 1024
            ? "is larger than 8 MB"
            : "";
        if (refused) {
          announce(`Background not set: ${file.name} ${refused}`);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          registry.dispatch({
            entity: "area",
            action: "set-background",
            id,
            value: {
              src: String(reader.result),
              name: file.name,
              opacity:
                store.read().areas.find((area) => area.id === id)?.background
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
        const area = target.closest('[data-anchor="area"]');
        const id = area?.getAttribute("data-id");
        if (!id || !registry) return;
        registry.dispatch({
          entity: "area",
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
            .closest('[data-anchor="area"]')
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
      if (entity === "project" && action === "add-area") {
        intent.entity = "area";
        intent.action = "add";
      }
      if (entity === "application" && action === "delete")
        intent.areaId = planner.areas.areaOf(store.read(), id);
      if (entity === "deviceType" && action === "add-instance") {
        intent.x = 500;
        intent.y = 350;
      }
      const run = () => {
        if (action === "delete") {
          remove(intent);
          return;
        }
        const result = dispatchTree(intent);
        if (result && action === "add-group") {
          const application = entityOf(result, id);
          const added = application?.groups?.at(-1);
          if (added) select("group", added.id);
        } else if (result && action === "add-device-type") {
          const application = entityOf(result, id);
          const added = application?.deviceTypes?.at(-1);
          if (added) select("device-type", added.id);
        }
      };
      // An Area or an application that holds something asks first; the
      // action itself is the same either way.
      if (
        (entity === "area" || entity === "application") &&
        action === "delete"
      ) {
        const plan = store.read();
        const contents =
          entity === "area"
            ? planner.areas.contents(plan, id)
            : planner.applications.contents(plan, id);
        if (planner.deleteConfirm?.needed(contents)) {
          // The answer decides the delete, so no later listener on this click
          // may act on it meanwhile: the application panel's would delete now.
          event.stopImmediatePropagation();
          /** @type {HTMLElement | null} */ (
            anchor?.querySelector(':scope > [data-part="tree-props-popover"]')
          )?.hidePopover();
          planner.deleteConfirm
            .ask({
              noun: entity === "area" ? "Area" : entity,
              name: entityOf(plan, id)?.name || "",
              contents,
              opener: /** @type {HTMLElement | null} */ (
                anchor?.querySelector(
                  ':scope > [data-part="tree-line"] [data-part="tree-props-toggle"]',
                ) || null
              ),
            })
            .then((confirmed) => {
              if (confirmed) run();
            });
          return;
        }
      }
      run();
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

    // A preset application cannot be renamed, so a double press on its header
    // opens or closes it, as its arrow does; a custom one's renames it. Its
    // menu keeps its own presses.
    /** @param {Event} event */
    const applicationHeader = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const header = target?.closest?.('[data-anchor="application"] > summary');
      const id = header?.parentElement?.getAttribute("data-id") || "";
      return header &&
        !target?.closest?.("button") &&
        entityOf(store.read(), id)?.preset
        ? header
        : null;
    };
    root.addEventListener("mousedown", (event) => {
      // The second press would otherwise select the name as text.
      if (event.detail > 1 && applicationHeader(event)) event.preventDefault();
    });
    root.addEventListener("dblclick", (event) => {
      const header = applicationHeader(event);
      const branch = /** @type {HTMLDetailsElement | null | undefined} */ (
        header?.parentElement
      );
      if (branch) branch.open = !branch.open;
    });

    const announce = (/** @type {string} */ message) =>
      document
        .querySelector('[data-part="surface-announcer"]')
        ?.replaceChildren(message);

    /**
     * Deletes one entity, from its menu or the Delete key alike. The row goes
     * with the entity, so focus is handed to a neighbour first, unless it is
     * on the plan; the delete is announced either way.
     * @param {Record<string, any>} intent
     */
    const remove = (intent) => {
      const { entity, id } = intent;
      const before = store.read();
      const anchor = anchorOf(entity, id);
      const heir = surface?.contains(document.activeElement)
        ? null
        : anchor?.nextElementSibling ||
          anchor?.previousElementSibling ||
          anchor?.parentElement?.closest("[data-anchor]");
      const result = dispatchTree(intent, intent.coalesce ?? null);
      if (selection?.id === id) selection = null;
      const next = result || before;
      planner.selection.activeArea(next);
      if (!entityOf(next, id)) {
        if (heir)
          focusRow(
            heir.getAttribute("data-anchor") || "",
            heir.getAttribute("data-id") || "",
          );
        const noun =
          entity === "deviceType"
            ? "device type"
            : entity === "deviceInstance"
              ? "device"
              : entity === "area"
                ? "Area"
                : entity;
        announce(`Deleted ${noun} ${entityOf(before, id)?.name || ""}`);
      }
      return result;
    };
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
      panel: root,
      surface: document.querySelector('[data-part="surface-region"]'),
      storage: localStorage,
    });

    /** @param {string} entity @param {string} id @param {unknown} name */
    const renameRefusal = (entity, id, name) =>
      entity === "application"
        ? planner.applications.renameRefusal(store.read(), id, name)
        : "";
    /** A refused name is said on the plan and to assistive technology. */
    const refused = (/** @type {string} */ message) => {
      announce(message);
      planner.dom.notice(message);
    };
    const rename = planner.treeRename.create({
      root,
      registry,
      render,
      focusRow,
      refusal: renameRefusal,
      refused,
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
      remove,
      read: store.read,
      select,
      renameProject: () =>
        rename.startRename(root.querySelector('[data-anchor="project"]')),
      renameApplication: (/** @type {string} */ id) =>
        rename.startRename(anchorOf("application", id)),
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

  planner.tree = Object.freeze({ create, groupRowView });
}
