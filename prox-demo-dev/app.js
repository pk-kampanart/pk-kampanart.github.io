/**
 * Starts the planner, owns both normal and saved-page boot paths, and mounts
 * the document store's projections and input surfaces.
 * Saved-page reader marker: restoration is delegated to restore-from-dom.js.
 * Channels: none; input controllers report through their supplied callbacks.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @type {Promise<any> | null} */
  let startup = null;
  /** @type {any} */
  let controller = null;

  const schemaOf = () => {
    const block = [...document.scripts].find(
      (script) => script.dataset.part === "schema",
    );
    if (!block) throw new Error("index.html has no schema block");
    return JSON.parse(block.textContent || "{}");
  };

  const savedPage = () => {
    const vocabulary = planner.dom.vocabulary;
    return (
      document.documentElement.hasAttribute(vocabulary.FORMAT_VERSION) ||
      document.documentElement.hasAttribute(vocabulary.PROJECT_ID)
    );
  };

  /** @param {any} store @param {any} registry @param {any} projectPanel
   * @param {MeshEngine | null} engine
   */
  const mount = (store, registry, projectPanel, engine) => {
    const root = /** @type {HTMLElement | null} */ (
      document.querySelector('[data-part="workflow"]')
    );
    const surface = /** @type {SVGSVGElement | null} */ (
      document.querySelector('[data-part="surface"]')
    );
    if (!root || !surface)
      throw new Error("application shell is missing its mount points");

    const surfaceRenderer = planner.surfaceRender.create({ surface });
    const tree = planner.tree.create({
      root,
      surface,
      store,
      registry,
      surfaceRenderer,
    });
    const floorPanel = planner.floorPanel.create({
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
      refresh: floorPanel.render,
    });
    const groupPanel = planner.groupPanel.create({
      root,
      surface,
      store,
      registry,
      projectDocument: false,
      refresh: applicationPanel.render,
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
      refresh: floorPanel.render,
    });
    const hover = planner.surfaceHover.create({
      root,
      surface,
      store,
      pane: document.querySelector('[data-part="mesh"]'),
    });

    const dispatch = (/** @type {CommandIntent} */ command) => {
      if (command.command === "undo" || command.command === "redo") {
        if (typeof tree.history === "function")
          return tree.history(command.command);
        return store[command.command]();
      }
      if (command.command === "save") return store.save();
      if (command.command === "open-project") return projectPanel.open();
      if (command.command === "help") return shortcuts.openHelp();
      if (command.command === "delete")
        return registry.dispatch({
          entity:
            command.entity === "device" ? "deviceInstance" : command.entity,
          action: "delete",
          id: command.id,
          floorId: command.floorId,
          coalesce: command.coalesce,
        });
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
          entity: "floor",
          action: "set-grid",
          id: command.floorId,
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
        for (const floor of plan.floors || [])
          for (const application of floor.applications || []) {
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
      openProject: projectPanel.open,
      openExport: projectPanel.openExport,
      openImport: projectPanel.openImport,
      openShortcuts: shortcuts.openHelp,
      history: tree.history,
      toggleMesh: () => mesh.toggle(),
    });
    // After the toolbar, whose Mesh toggle it keeps pressed while open.
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

    return Object.freeze({
      read: store.read,
      dispatch: registry.dispatch,
      replace: store.replace,
      restore: store.restore,
      save: store.save,
      flush: store.flush,
      disconnect: () => {
        tree.disconnect?.();
        grid.disconnect?.();
        selection.disconnect?.();
        hover.disconnect?.();
        viewport.disconnect?.();
        keymap.disconnect?.();
        hub.disconnect?.();
        shortcuts.disconnect?.();
        toolbar.disconnect?.();
        mesh.disconnect();
        devicePanel.disconnect?.();
        groupPanel.disconnect?.();
        applicationPanel.disconnect?.();
        floorPanel.disconnect?.();
      },
      controllers: Object.freeze({
        floorPanel,
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
    const schema = schemaOf();
    const codec = planner.codec.create(schema);
    const rails = planner.storeRails.create({ db: planner.db, codec });
    /** @type {BootResult} */
    let result;

    if (savedPage()) {
      const restored = await planner.dom.restoreFromDom
        .create({
          root: document.documentElement,
          codec,
          schema,
          storage: planner.db,
        })
        .run();
      if (!restored.ok) throw new Error(restored.reason);
      result = restored.skipped
        ? await rails.open(restored.recordId)
        : restored;
    } else result = await rails.openOrCreate();

    if (!result.ok)
      throw new Error(result.reason || "project could not be opened");
    if (!result.plan || !result.record)
      throw new Error("project could not be opened");
    const { plan } = result;
    let currentRecord = result.record;

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
      history: planner.history.create(plan),
    });
    const ids = planner.db.createId;
    const registry = planner.commands.create({ store, ids });
    const engine =
      planner.meshEngine?.create({ project: () => store.read().project.id }) ||
      null;
    const projectPanel = planner.projectPanel.create({
      store,
      rails,
      network: engine
        ? { nodes: engine.networkNodes, forget: engine.forgetNetwork }
        : undefined,
      onActivated: (record) => {
        currentRecord = record;
      },
      onSwitched: () => engine?.projectChanged?.(),
    });
    controller = mount(store, registry, projectPanel, engine);
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
