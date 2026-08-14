/**
 * Registers every document command in one place.
 * Contributes commands to Planner; pure rule files own document transitions.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @param {any} options */
  const create = (options) => {
    if (!options?.store || typeof options.store.read !== "function")
      throw new TypeError("commands require a store");
    const ids =
      options.ids || planner.db?.createId || (() => crypto.randomUUID());
    const areaIds =
      options.areaIds ||
      planner.areaIds.create({
        storage: options.storage,
        createId: ids,
      });
    areaIds.remember(options.store.read());
    options.store.subscribe?.(() => areaIds.remember(options.store.read()));
    const registry = planner.dom.createCommandRegistry(options.store);
    /**
     * @param {string} entity
     * @param {string} action
     * @param {(plan: PlanDocument, intent: CommandIntent) => PlanDocument} handler
     */
    const register = (entity, action, handler) =>
      registry.register(entity, action, handler);

    register("area", "add", (plan) =>
      planner.areas.add(plan, ids, undefined, () =>
        areaIds.mint(plan.project.id),
      ),
    );
    register("area", "rename", (plan, intent) =>
      planner.areas.rename(plan, intent.id, intent.value),
    );
    register("area", "delete", (plan, intent) =>
      planner.areas.remove(plan, intent.id),
    );
    register("area", "set-background", (plan, intent) =>
      planner.areas.setBackground(plan, intent.id, intent.value),
    );
    register("area", "set-opacity", (plan, intent) =>
      planner.areas.setOpacity(plan, intent.id, intent.value),
    );
    register("area", "set-grid", (plan, intent) =>
      planner.areas.setGrid(plan, intent.id, intent.value),
    );
    register("area", "add-application", (plan, intent) =>
      planner.applications.add(plan, intent.id, ids, intent.value),
    );

    register("project", "rename", (plan, intent) =>
      planner.projects.rename(plan, intent.id, intent.value),
    );

    register("application", "rename", (plan, intent) =>
      planner.applications.rename(plan, intent.id, intent.value),
    );
    register("application", "delete", (plan, intent) => {
      const areaId = planner.areas.areaOf(plan, intent.id);
      return areaId
        ? planner.applications.remove(plan, areaId, intent.id)
        : plan;
    });
    register("application", "add-group", (plan, intent) =>
      planner.groups.add(plan, intent.id, ids, intent.value),
    );
    register("application", "add-device-type", (plan, intent) =>
      planner.devices.addType(plan, intent.id, ids, intent.value),
    );

    register("group", "rename", (plan, intent) =>
      planner.groups.rename(plan, intent.id, intent.value),
    );
    register("group", "recolor", (plan, intent) =>
      planner.groups.recolor(plan, intent.id, intent.value),
    );
    register("group", "set-stroke-type", (plan, intent) =>
      planner.groups.setStrokeType(plan, intent.id, intent.value),
    );
    register("group", "set-stroke-width", (plan, intent) =>
      planner.groups.setStrokeWidth(plan, intent.id, intent.value),
    );
    register("group", "set-stroke-opacity", (plan, intent) =>
      planner.groups.setStrokeOpacity(plan, intent.id, intent.value),
    );
    register("group", "set-opacity", (plan, intent) =>
      planner.groups.setOpacity(plan, intent.id, intent.value),
    );
    register("group", "set-stroke-color", (plan, intent) =>
      planner.groups.setStrokeColor(plan, intent.id, intent.value),
    );
    register("group", "delete", (plan, intent) =>
      planner.groups.remove(plan, intent.id),
    );
    register("group", "reorder", (plan, intent) =>
      planner.groups.move(
        plan,
        intent.id,
        intent.targetApplicationId,
        intent.index,
      ),
    );
    register("group", "set-rect", (plan, intent) =>
      planner.groups.setRect(plan, intent.id, intent.rect),
    );

    register("deviceType", "rename", (plan, intent) =>
      planner.devices.renameType(plan, intent.id, intent.value),
    );
    register("deviceType", "delete", (plan, intent) =>
      planner.devices.removeType(plan, intent.id),
    );
    register("deviceType", "add-instance", (plan, intent) =>
      planner.devices.addInstance(
        plan,
        intent.id,
        ids,
        intent.x ?? /** @type {any} */ (intent.value)?.x ?? 500,
        intent.y ?? /** @type {any} */ (intent.value)?.y ?? 350,
      ),
    );
    register("deviceType", "reorder", (plan, intent) =>
      planner.devices.reorderType(
        plan,
        intent.id,
        intent.targetId,
        intent.where,
      ),
    );
    register("deviceType", "move", (plan, intent) =>
      planner.devices.moveType(
        plan,
        intent.id,
        intent.targetApplicationId,
        intent.index,
      ),
    );

    register("deviceInstance", "move", (plan, intent) =>
      planner.devices.moveInstance(
        plan,
        intent.id,
        intent.x ?? /** @type {any} */ (intent.value)?.x,
        intent.y ?? /** @type {any} */ (intent.value)?.y,
      ),
    );
    register("deviceInstance", "delete", (plan, intent) =>
      planner.devices.removeInstance(plan, intent.id),
    );
    register("deviceInstance", "assign", (plan, intent) =>
      planner.devices.assign(
        plan,
        intent.id,
        /** @type {any} */ (intent.value)?.node,
        /** @type {any} */ (intent.value)?.channels || [],
      ),
    );
    register("deviceInstance", "unassign", (plan, intent) =>
      planner.devices.unassign(
        plan,
        intent.id,
        /** @type {any} */ (intent.value)?.channels,
      ),
    );

    return registry;
  };

  planner.commands = Object.freeze({ create });
}
