/**
 * Owns pure application-document rules. It reads neither the DOM nor storage.
 * Channels: none.
 */
{
  /** @param {unknown} value */
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /** @param {Record<string, any>} plan @param {string} floorId @param {string} id */
  const remove = (plan, floorId, id) => {
    const next = clone(plan);
    const floor = next.floors.find(
      (/** @type {any} */ item) => item.id === floorId,
    );
    if (floor?.applications.length > 1)
      floor.applications = floor.applications.filter(
        (/** @type {any} */ application) => application.id !== id,
      );
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} floorId @param {() => string} ids @param {string} [name] */
  const add = (plan, floorId, ids, name) => {
    const next = clone(plan);
    const floor = next.floors.find(
      (/** @type {any} */ item) => item.id === floorId,
    );
    if (floor)
      floor.applications.push({
        id: ids(),
        name: String(
          name || `Application ${floor.applications.length + 1}`,
        ).trim(),
        groups: [],
        deviceTypes: [],
      });
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} floorId @param {string} id @param {string} name */
  const rename = (plan, floorId, id, name) => {
    const next = clone(plan);
    const application = next.floors
      .find((/** @type {any} */ floor) => floor.id === floorId)
      ?.applications.find((/** @type {any} */ item) => item.id === id);
    if (application)
      application.name = String(name).trim() || "Untitled application";
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} id */
  const find = (plan, id) => {
    for (const floor of plan.floors)
      for (const application of floor.applications)
        if (application.id === id) return application;
    return null;
  };

  /** @param {Record<string, any>} plan @param {string} id */
  const applicationOf = (plan, id) => {
    for (const floor of plan.floors)
      for (const application of floor.applications) {
        if (application.id === id) return application;
        if (
          application.groups.some((/** @type {any} */ group) => group.id === id)
        )
          return application;
        if (
          application.deviceTypes.some(
            (/** @type {any} */ type) =>
              type.id === id ||
              type.instances.some(
                (/** @type {any} */ instance) => instance.id === id,
              ),
          )
        )
          return application;
      }
    return null;
  };

  /** @param {Record<string, any>} plan @param {string} id */
  const groupCount = (plan, id) => find(plan, id)?.groups.length || 0;

  /** @param {Record<string, any>} plan @param {string} id */
  const deviceCount = (plan, id) =>
    find(plan, id)?.deviceTypes.reduce(
      (/** @type {number} */ total, /** @type {any} */ type) =>
        total + type.instances.length,
      0,
    ) || 0;

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.applications = Object.freeze({
    remove,
    add,
    rename,
    applicationOf,
    groupCount,
    deviceCount,
  });
}
