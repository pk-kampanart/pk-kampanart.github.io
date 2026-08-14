/**
 * Starts the planner, owns both normal and saved-page boot paths, and mounts
 * the document store's projections and input surfaces.
 * Saved-page reader marker: restoration is delegated to restore-from-dom.js.
 * Channels: none; input controllers report through their supplied callbacks.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
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

  /** @param {any} store @param {any} registry @param {any} projectPanel */
  const mount = (store, registry, projectPanel) => {
    const root = document.querySelector('[data-part="workflow"]');
    const surface = document.querySelector('[data-part="surface"]');
    if (!root || !surface)
      throw new Error("application shell is missing its mount points");

    const tree = planner.tree.create({ root, surface, store, registry });
    const floorPanel = planner.floorPanel.create({
      root,
      surface,
      store,
      registry,
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
    const selection = planner.selection.create({
      root,
      surface,
      store,
      refresh: floorPanel.render,
    });
    const hover = planner.surfaceHover.create({ root, surface, store });
    const cursor = planner.surfaceCursor.create({ root, surface });

    const dispatch = (/** @type {Record<string, any>} */ command) => {
      if (command.command === "undo" || command.command === "redo") {
        if (typeof tree.history === "function")
          return tree.history(command.command);
        return store[command.command]();
      }
      if (command.command === "save") return store.save();
      if (command.command === "open-project") return projectPanel.open();
      if (command.command === "delete")
        return registry.dispatch({
          entity:
          command.entity === "device"
            ? "deviceInstance"
            : command.entity,
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
      if (command.command === "nudge") {
        const plan = store.read();
        for (const floor of plan.floors || [])
          for (const application of floor.applications || []) {
            const group = (application.groups || []).find(
              (/** @type {any} */ value) => value.id === command.id,
            );
            if (group?.rect)
              return registry.dispatch({
                entity: "group",
                action: "set-rect",
                id: command.id,
                rect: {
                  ...group.rect,
                  x: group.rect.x + command.delta.x,
                  y: group.rect.y + command.delta.y,
                },
                coalesce: command.coalesce,
              });
            for (const type of application.deviceTypes || []) {
              const instance = (type.instances || []).find(
                (/** @type {any} */ value) => value.id === command.id,
              );
              if (instance)
                return registry.dispatch({
                  entity: "deviceInstance",
                  action: "move",
                  id: command.id,
                  x: instance.x + command.delta.x,
                  y: instance.y + command.delta.y,
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
    const toolbar = planner.toolbar.create({
      store,
      openProject: projectPanel.open,
      openExport: projectPanel.openExport,
      openImport: projectPanel.openImport,
      openShortcuts: shortcuts.openHelp,
      history: tree.history,
    });

    return Object.freeze({
      read: store.read,
      replace: store.replace,
      restore: store.restore,
      save: store.save,
      flush: store.flush,
      disconnect: () => {
        tree.disconnect?.();
        selection.disconnect?.();
        hover.disconnect?.();
        cursor.disconnect?.();
        viewport.disconnect?.();
        keymap.disconnect?.();
        shortcuts.disconnect?.();
        toolbar.disconnect?.();
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
        cursor,
        keymap,
        shortcuts,
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
      result = restored;
    } else result = await rails.openOrCreate();

    if (!result.ok)
      throw new Error(result.reason || "project could not be opened");
    if (!result.plan || !result.record)
      throw new Error("project could not be opened");
    const { plan } = result;
    let currentRecord = result.record;

    const store = planner.autosave.create({
      initial: plan,
      persist: (/** @type {Record<string, any>} */ next) =>
        rails.replace(currentRecord, next),
      history: planner.history.create(plan),
    });
    const ids = planner.db.createId;
    const registry = planner.commands.create({ store, ids });
    const projectPanel = planner.projectPanel.create({
      store,
      rails,
      onActivated: (/** @type {any} */ record) => {
        currentRecord = record;
      },
    });
    controller = mount(store, registry, projectPanel);
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
    replace: (/** @type {Record<string, any>} */ next) => {
      return controllerOf().replace(next);
    },
    restore: (/** @type {Record<string, any>} */ next) => {
      return controllerOf().restore(next);
    },
    save: () => controllerOf().save(),
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
