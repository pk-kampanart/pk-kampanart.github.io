/**
 * Routes named commands to document transitions.
 * Contributes createCommandRegistry to Planner.dom; it is the only caller of
 * the store's replacement method and dispatches no channels.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const dom = planner.dom || (planner.dom = /** @type {DomNamespace} */ ({}));
  /** @type {Record<string, string[]>} */
  const commands = Object.freeze({
    project: ["rename"],
    group: [
      "rename",
      "recolor",
      "set-stroke-type",
      "set-stroke-width",
      "set-stroke-opacity",
      "set-stroke-color",
      "delete",
      "reorder",
      "set-rect",
    ],
    floor: [
      "add",
      "rename",
      "delete",
      "set-background",
      "set-opacity",
      "add-application",
    ],
    application: ["rename", "delete", "add-group", "add-device-type"],
    deviceType: ["rename", "delete", "add-instance", "reorder", "move"],
    deviceInstance: ["move", "delete"],
  });

  /**
   * @param {{read: () => PlanDocument, replace: (value: PlanDocument, change?: {coalesce?: unknown}) => PlanDocument}} store
   */
  const createCommandRegistry = (store) => {
    if (
      !store ||
      typeof store.read !== "function" ||
      typeof store.replace !== "function"
    )
      throw new TypeError(
        "command registry requires store.read() and store.replace()",
      );

    const handlers = new Map();
    /**
     * @param {string} entity
     * @param {string} action
     * @param {(document: PlanDocument, intent: CommandIntent) => PlanDocument} handler
     */
    const register = (entity, action, handler) => {
      if (!commands[entity]?.includes(action))
        throw new RangeError(`unknown command "${entity}:${action}"`);
      if (typeof handler !== "function")
        throw new TypeError("command handler must be a function");
      const key = `${entity}:${action}`;
      if (handlers.has(key))
        throw new Error(`command already registered: ${key}`);
      handlers.set(key, handler);
    };
    /** @param {CommandIntent} intent */
    const dispatch = (intent) => {
      if (!intent || typeof intent !== "object")
        throw new TypeError("command must be an object");
      const key = `${intent.entity}:${intent.action}`;
      const handler = handlers.get(key);
      if (!handler) throw new Error(`no command registered for "${key}"`);
      return store.replace(handler(store.read(), intent), {
        coalesce: intent.coalesce,
      });
    };

    return Object.freeze({ register, dispatch });
  };

  dom.createCommandRegistry = createCommandRegistry;
}
