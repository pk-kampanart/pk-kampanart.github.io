/**
 * Registers every document command in one place.
 * Contributes commands to Planner; pure rule files own document transitions.
 * Channels: none.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @param {any} options */
  const create = (options) => {
    if (!options?.store || typeof options.store.read !== "function")
      throw new TypeError("commands require a store");
    const ids = options.ids || planner.db?.createId || (() => crypto.randomUUID());
    const registry = planner.dom.createCommandRegistry(options.store);
    /**
     * @param {string} entity
     * @param {string} action
     * @param {(plan: Record<string, any>, intent: Record<string, any>) => Record<string, any>} handler
     */
    const register = (entity, action, handler) =>
      registry.register(entity, action, handler);

    register("floor", "add", (plan) => planner.floors.add(plan, ids));
    register("floor", "rename", (plan, intent) =>
      planner.floors.rename(plan, intent.id, intent.value),
    );
    register("floor", "delete", (plan, intent) =>
      planner.floors.remove(plan, intent.id),
    );
    register("floor", "set-background", (plan, intent) =>
      planner.floors.setBackground(plan, intent.id, intent.value),
    );
    register("floor", "set-opacity", (plan, intent) =>
      planner.floors.setOpacity(plan, intent.id, intent.value),
    );
    register("floor", "add-application", (plan, intent) =>
      planner.applications.add(plan, intent.id, ids, intent.value),
    );

    register("application", "rename", (plan, intent) => {
      const floorId = planner.floors.floorOf(plan, intent.id);
      return floorId
        ? planner.applications.rename(plan, floorId, intent.id, intent.value)
        : plan;
    });
    register("application", "delete", (plan, intent) => {
      const floorId = planner.floors.floorOf(plan, intent.id);
      return floorId
        ? planner.applications.remove(plan, floorId, intent.id)
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
        intent.x ?? intent.value?.x ?? 500,
        intent.y ?? intent.value?.y ?? 350,
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
        intent.x ?? intent.value?.x,
        intent.y ?? intent.value?.y,
      ),
    );
    register("deviceInstance", "delete", (plan, intent) =>
      planner.devices.removeInstance(plan, intent.id),
    );

    return registry;
  };

  planner.commands = Object.freeze({ create });
}
