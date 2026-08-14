/**
 * Starts the planner, owns both normal and saved-page boot paths, and mounts
 * the document store's projections and input surfaces.
 * Saved-page reader marker: restoration is delegated to restore-from-dom.js.
 * Channels: listens planner:selection-changed, to tell the Mesh engine when
 * the active Area changes; input controllers report through their callbacks.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @type {Promise<any> | null} */
  let startup = null;
  /** @type {any} */
  let controller = null;
  /** @type {MeshEngine | null} */
  let meshEngine = null;

  const schemaOf = () => {
    const block = [...document.scripts].find(
      (script) => script.dataset.part === "schema",
    );
    if (!block) throw new Error("index.html has no schema block");
    return JSON.parse(block.textContent || "{}");
  };

  planner.schema = Object.freeze({
    read: schemaOf,
    setup: () => {
      const schema = schemaOf();
      return { schema, codec: planner.codec.create(schema) };
    },
  });

  const savedPage = () => {
    const vocabulary = planner.dom.vocabulary;
    return (
      document.documentElement.hasAttribute(vocabulary.FORMAT_VERSION) ||
      document.documentElement.hasAttribute(vocabulary.PROJECT_ID)
    );
  };

  /** Announces a legacy plan conversion to sight and the live region. @param {number} count */
  const announceMigration = (count) => {
    if (!(count > 0)) return;
    const message = `This project was converted to Areas. ${count} device assignment${count === 1 ? " was" : "s were"} removed; import the network backup or add the devices again.`;
    const announcer = document.querySelector('[data-part="surface-announcer"]');
    if (announcer) announcer.textContent = message;
    planner.dom.notice(message);
  };
  /** @param {any} store @param {any} registry @param {any} projectPanel
   * @param {MeshEngine | null} engine
   * @param {() => number | null} [lastSaved]
   */
  const mount = (store, registry, projectPanel, engine, lastSaved) => {
    const root = /** @type {HTMLElement | null} */ (
      document.querySelector('[data-part="workflow"]')
    );
    const surface = /** @type {SVGSVGElement | null} */ (
      document.querySelector('[data-part="surface"]')
    );
    if (!root || !surface)
      throw new Error("application shell is missing its mount points");

    // Which groups are hidden on the plan: this browser's view, not the plan.
    const visibility = planner.groupVisibility.create({
      project: () => store.read().project.id,
    });
    const surfaceRenderer = planner.surfaceRender.create({
      surface,
      visibility,
    });
    const tree = planner.tree.create({
      root,
      surface,
      store,
      registry,
      surfaceRenderer,
      visibility,
    });
    const areaPanel = planner.areaPanel.create({
      root,
      surface,
      store,
      registry,
      surfaceRenderer,
      projectDocument: false,
    });
    const applicationPanel = planner.applicationPanel.create({
      root,
      store,
      registry,
      projectDocument: false,
      refresh: areaPanel.render,
    });
    const groupPanel = planner.groupPanel.create({
      root,
      surface,
      store,
      registry,
      projectDocument: false,
      refresh: applicationPanel.render,
      visibility,
      redraw: () => tree.render(),
    });
    const devicePanel = planner.devicePanel.create({
      root,
      surface,
      store,
      registry,
      projectDocument: false,
      refresh: groupPanel.render,
    });
    const viewport = planner.surfaceViewport.create({ root, surface });
    const grid = planner.grid.create({
      root,
      surface,
      store,
      dispatch: (command) => dispatch(command),
    });
    const selection = planner.selection.create({
      root,
      surface,
      store,
      refresh: areaPanel.render,
    });
    const hover = planner.surfaceHover.create({
      root,
      surface,
      store,
      pane: document.querySelector('[data-part="mesh"]'),
    });
    let activeAreaId = planner.selection.activeArea(store.read());
    const areaChange = () => {
      const next =
        document.documentElement.getAttribute("data-active-area") || "";
      if (next === activeAreaId) return;
      activeAreaId = next;
      void engine?.areaChanged?.();
    };
    const unsubscribeArea = store.subscribe(areaChange);
    document.addEventListener("planner:selection-changed", areaChange);

    // A save asked for — Ctrl+S or the project menu — says so once it
    // lands; the caller still gets the save's own outcome.
    const saveNow = () => {
      const saving = store.save();
      saving.then(
        () => projectMenu.confirmSaved(),
        () => {},
      );
      return saving;
    };

    const dispatch = (/** @type {CommandIntent} */ command) => {
      if (command.command === "undo" || command.command === "redo") {
        if (typeof tree.history === "function")
          return tree.history(command.command);
        return store[command.command]();
      }
      if (command.command === "save") return saveNow();
      if (command.command === "open-project") return projectPanel.open();
      if (command.command === "help") return shortcuts.openHelp();
      if (command.command === "delete") {
        const remove = () =>
          tree.remove({
            entity:
              command.entity === "device" ? "deviceInstance" : command.entity,
            action: "delete",
            id: command.id,
            areaId: command.areaId,
            coalesce: command.coalesce,
          });
        // An Area or an application that holds something asks first, as its
        // menu's Delete does; the delete itself is the same either way.
        const { entity, id } = command;
        if ((entity === "area" || entity === "application") && id) {
          const plan = store.read();
          const contents =
            entity === "area"
              ? planner.areas.contents(plan, id)
              : planner.applications.contents(plan, id);
          if (planner.deleteConfirm?.needed(contents)) {
            const name =
              entity === "area"
                ? plan.areas.find((area) => area.id === id)?.name
                : plan.areas
                    .flatMap((area) => area.applications)
                    .find((application) => application.id === id)?.name;
            const opener =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            void planner.deleteConfirm
              .ask({
                noun: entity === "area" ? "Area" : entity,
                name: name || "",
                contents,
                opener,
              })
              .then((confirmed) => {
                if (confirmed) remove();
              });
            return null;
          }
        }
        return remove();
      }
      if (command.command === "place-instance")
        return registry.dispatch({
          entity: "deviceType",
          action: "add-instance",
          id: command.typeId,
          x: command.point?.x,
          y: command.point?.y,
          coalesce: command.coalesce,
        });
      if (command.command === "draw-group")
        return registry.dispatch({
          entity: "group",
          action: "set-rect",
          id: command.groupId,
          rect: command.rect,
          coalesce: command.coalesce,
        });
      if (command.command === "set-grid")
        return registry.dispatch({
          entity: "area",
          action: "set-grid",
          id: command.areaId,
          value: command.value,
          coalesce: command.coalesce,
        });
      if (command.command === "zoom-in") return viewport.zoomIn();
      if (command.command === "zoom-out") return viewport.zoomOut();
      if (command.command === "reset-zoom") return viewport.reset();
      if (command.command === "toggle-grid") return Boolean(grid.toggleGrid());
      if (command.command === "toggle-snap") return Boolean(grid.toggleSnap());
      if (command.command === "toggle-align")
        return Boolean(grid.toggleAlign());
      if (command.command === "toggle-mesh") return mesh.toggle();
      if (command.command === "nudge") {
        // A nudge knows the delta; only here is the entity's current position
        // known, so this is where the result rounds to the grid (ADR-0035).
        // Only the axis that moved rounds: an arrow pressed sideways has no
        // business moving anything up or down.
        const step = command.snap ? planner.grid.step() : 1;
        const origin = planner.grid.origin();
        const along = (
          /** @type {number} */ value,
          /** @type {number} */ delta,
          /** @type {number} */ axisOrigin,
        ) => planner.geo.stepTo(value, delta, step, axisOrigin);
        const plan = store.read();
        for (const area of plan.areas || [])
          for (const application of area.applications || []) {
            const group = (application.groups || []).find(
              (value) => value.id === command.id,
            );
            if (group?.rect)
              return registry.dispatch({
                entity: "group",
                action: "set-rect",
                id: command.id,
                rect: {
                  ...group.rect,
                  x: along(group.rect.x, command.delta.x, origin.x),
                  y: along(group.rect.y, command.delta.y, origin.y),
                },
                coalesce: command.coalesce,
              });
            for (const type of application.deviceTypes || []) {
              const instance = (type.instances || []).find(
                (value) => value.id === command.id,
              );
              if (instance)
                return registry.dispatch({
                  entity: "deviceInstance",
                  action: "move",
                  id: command.id,
                  x: along(instance.x, command.delta.x, origin.x),
                  y: along(instance.y, command.delta.y, origin.y),
                  coalesce: command.coalesce,
                });
            }
          }
      }
      return null;
    };

    const keymap = planner.keymap.create({
      root,
      surface,
      store,
      dispatch,
      refuseHidden: groupPanel.refuseHidden,
    });
    const shortcuts = planner.shortcuts.create({
      root,
      keymap: planner.keymap,
      dispatch,
      openProject: projectPanel.open,
    });
    const hub = planner.hub.create({
      root,
      surface,
      dispatch,
      gestures: keymap,
    });
    const toolbar = planner.toolbar.create({
      store,
      openShortcuts: shortcuts.openHelp,
      // Settings mounts after the Mesh pane, whose notice it shows.
      openSettings: (opener) => settings.open(opener),
      dispatch,
      history: tree.history,
    });
    // The header's zoom readout mounts after the viewport first wrote one.
    viewport.refresh();
    const projectMenu = planner.projectMenu.create({
      root,
      save: saveNow,
      lastSaved,
      rename: tree.renameProject,
      openProject: projectPanel.open,
      openExport: projectPanel.openExport,
      openImport: projectPanel.openImport,
    });
    const applicationMenu = planner.applicationMenu.create({
      root,
      read: store.read,
      dispatch: registry.dispatch,
      select: tree.select,
      rename: tree.renameApplication,
      announce: (message) =>
        document
          .querySelector('[data-part="surface-announcer"]')
          ?.replaceChildren(message),
    });
    const mesh = planner.meshPane.create({
      pane: /** @type {Element} */ (
        document.querySelector('[data-part="mesh"]')
      ),
      workspace: document.querySelector('[data-part="workspace"]'),
      splitter: /** @type {HTMLElement | null} */ (
        document.querySelector('[data-part="mesh-splitter"]')
      ),
      surface: document.querySelector('[data-part="surface-region"]'),
      storage: localStorage,
      store,
      registry,
      drawing: surface,
      engine,
    });
    const meshNotice = planner.meshNotice.create({
      pane: /** @type {Element} */ (
        document.querySelector('[data-part="mesh"]')
      ),
      storage: localStorage,
    });
    const settings = planner.settings.create({ grid, meshNotice });

    return Object.freeze({
      read: store.read,
      dispatch: registry.dispatch,
      replace: store.replace,
      restore: store.restore,
      save: store.save,
      flush: store.flush,
      disconnect: () => {
        document.removeEventListener("planner:selection-changed", areaChange);
        unsubscribeArea();
        tree.disconnect?.();
        grid.disconnect?.();
        selection.disconnect?.();
        hover.disconnect?.();
        viewport.disconnect?.();
        keymap.disconnect?.();
        hub.disconnect?.();
        shortcuts.disconnect?.();
        settings.disconnect();
        toolbar.disconnect?.();
        projectMenu.disconnect();
        applicationMenu.disconnect();
        meshNotice.disconnect();
        mesh.disconnect();
        devicePanel.disconnect?.();
        groupPanel.disconnect?.();
        applicationPanel.disconnect?.();
        areaPanel.disconnect?.();
      },
      controllers: Object.freeze({
        areaPanel,
        applicationPanel,
        groupPanel,
        devicePanel,
        viewport,
        tree,
        selection,
        hover,
        keymap,
        shortcuts,
        mesh,
      }),
    });
  };

  const boot = async () => {
    const { schema, codec } = planner.schema.setup();
    const areaIds = planner.areaIds.create({
      storage: localStorage,
      createId: planner.db.createId,
    });
    const rails = planner.storeRails.create({
      db: planner.db,
      codec,
      areaIds,
      trackRealProject: planner.meshEngineForced !== true,
    });
    /** @type {BootResult} */
    let result;

    if (savedPage()) {
      const restored = await planner.dom.restoreFromDom
        .create({
          root: document.documentElement,
          codec,
          schema,
          storage: planner.db,
          areaIds,
        })
        .run();
      if (!restored.ok) throw new Error(restored.reason);
      result = restored.skipped
        ? await rails.open(/** @type {string} */ (restored.recordId))
        : restored;
      if (
        !restored.skipped &&
        restored.plan &&
        !planner.projects.isDemo(restored.plan) &&
        planner.meshEngineForced !== true
      )
        planner.db.setLastRealProjectId(
          /** @type {PlanDocument} */ (restored.plan).project.id,
        );
    } else result = await rails.openOrCreate();
    if (!result.ok)
      throw new Error(result.reason || "project could not be opened");
    if (!result.plan || !result.record)
      throw new Error("project could not be opened");
    if (result.migrated) {
      const droppedAssignments = result.migrated.droppedAssignments;
      const migrated = await rails.replace(result.record, result.plan);
      if (!migrated.ok)
        throw new Error(
          migrated.reason || "converted project could not be saved",
        );
      result = { ...result, record: migrated.record };
      if (droppedAssignments) announceMigration(droppedAssignments);
    }

    const plan = /** @type {PlanDocument} */ (result.plan);
    let currentRecord = /** @type {ProjectRecord} */ (result.record);
    // When the open project last reached storage, for the project menu: its
    // record's time until this session writes it, then each write's.
    /** @param {ProjectRecord} record */
    const storedAt = (record) => Date.parse(record.updatedAt) || null;
    /** @type {number | null} */
    let lastSavedAt = storedAt(currentRecord);

    const store = planner.autosave.create({
      initial: plan,
      // A refused write resolves rather than rejecting, so without this the
      // autosave's failure path never runs, `flush()` reports clean, and
      // Ctrl+S says the work was saved when it was thrown away.
      persist: (/** @type {PlanDocument} */ next) =>
        rails.replace(currentRecord, next).then((result) => {
          if (result && result.ok === false)
            throw new Error(
              result.reason || `the project store refused the write`,
            );
          return result;
        }),
      onSaved: (_result, savedAt) => {
        lastSavedAt = savedAt;
      },
      history: planner.history.create(plan),
    });
    const ids = planner.db.createId;
    const registry = planner.commands.create({
      store,
      ids,
      areaIds,
      storage: localStorage,
    });
    meshEngine =
      planner.projects.engineFactoryFor(plan)?.create({
        project: () => store.read().project.id,
        area: () => planner.selection.activeArea(store.read()),
        areas: () => store.read().areas.map(({ id, name }) => ({ id, name })),
        areaIds,
      }) || null;
    const projectPanel = planner.projectPanel.create({
      store,
      rails,
      onActivated: (record) => {
        currentRecord = record;
        lastSavedAt = storedAt(record);
      },
      onMigrated: announceMigration,
      onSwitched: () => meshEngine?.areaChanged?.(),
    });
    controller = mount(
      store,
      registry,
      projectPanel,
      meshEngine,
      () => lastSavedAt,
    );
    return controller;
  };

  const start = () => {
    if (!startup) startup = boot();
    return startup;
  };

  // The facade is the browser harness seam; production starts through start().
  const controllerOf = () => {
    if (!controller) throw new Error("planner app has not started");
    return controller;
  };

  planner.app = Object.freeze({
    start,
    ready: start,
    meshEngine: () => meshEngine,
    read: () => controllerOf().read(),
    dispatch: (/** @type {CommandIntent} */ command) =>
      controllerOf().dispatch(command),
    replace: (/** @type {PlanDocument} */ next) => {
      return controllerOf().replace(next);
    },
    restore: (/** @type {PlanDocument} */ next) => {
      return controllerOf().restore(next);
    },
    flush: () => controllerOf().flush(),
  });

  document.addEventListener(
    "DOMContentLoaded",
    () =>
      void start().catch((/** @type {unknown} */ error) =>
        console.error(`app failed to start: ${String(error)}`),
      ),
    { once: true },
  );
}
