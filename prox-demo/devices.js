/**
 * Owns pure device-type and device-instance document rules.
 * Channels: none.
 */
{
  const MAX_INSTANCES = 255;
  /** @param {unknown} value */
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /** @param {Record<string, any>} plan @param {string} id */
  const findType = (plan, id) => {
    for (const floor of plan.floors)
      for (const application of floor.applications)
        for (const type of application.deviceTypes)
          if (type.id === id) return type;
    return null;
  };

  /** @param {Record<string, any>} plan @param {string} id */
  const findInstance = (plan, id) => {
    for (const floor of plan.floors)
      for (const application of floor.applications)
        for (const type of application.deviceTypes)
          for (const instance of type.instances)
            if (instance.id === id) return { instance, type };
    return null;
  };

  /** @param {Record<string, any>} plan */
  const instanceCount = (plan) => {
    let total = 0;
    for (const floor of plan.floors)
      for (const application of floor.applications)
        for (const type of application.deviceTypes)
          total += type.instances.length;
    return total;
  };

  /** @param {Record<string, any>} plan @param {string} applicationId @param {() => string} ids @param {string} [name] */
  const addType = (plan, applicationId, ids, name) => {
    const next = clone(plan);
    for (const floor of next.floors)
      for (const application of floor.applications)
        if (application.id === applicationId) {
          application.deviceTypes.push({
            id: ids(),
            name:
              String(name ?? "").trim() ||
              `Device type ${application.deviceTypes.length + 1}`,
            instances: [],
          });
          return next;
        }
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} typeId @param {() => string} ids @param {number} x @param {number} y */
  const addInstance = (plan, typeId, ids, x, y) => {
    const next = clone(plan);
    const type = findType(next, typeId);
    if (!type || instanceCount(next) >= MAX_INSTANCES) return next;
    const point = { x: Number(x), y: Number(y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return next;
    type.instances.push({ id: ids(), ...point });
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} typeId @param {string} name */
  const renameType = (plan, typeId, name) => {
    const next = clone(plan);
    const type = findType(next, typeId);
    if (type) type.name = String(name).trim() || "Untitled device type";
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} typeId */
  const removeType = (plan, typeId) => {
    const next = clone(plan);
    for (const floor of next.floors)
      for (const application of floor.applications)
        application.deviceTypes = application.deviceTypes.filter(
          (/** @type {any} */ type) => type.id !== typeId,
        );
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} instanceId @param {number} x @param {number} y */
  const moveInstance = (plan, instanceId, x, y) => {
    const next = clone(plan);
    const found = findInstance(next, instanceId);
    const point = { x: Number(x), y: Number(y) };
    if (found && Number.isFinite(point.x) && Number.isFinite(point.y))
      Object.assign(found.instance, point);
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} instanceId */
  const removeInstance = (plan, instanceId) => {
    const next = clone(plan);
    for (const floor of next.floors)
      for (const application of floor.applications)
        for (const type of application.deviceTypes)
          type.instances = type.instances.filter(
            (/** @type {any} */ instance) => instance.id !== instanceId,
          );
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} typeId @param {string} targetId @param {"before" | "after"} [where] */
  const reorderType = (plan, typeId, targetId, where = "before") => {
    const next = clone(plan);
    for (const floor of next.floors)
      for (const application of floor.applications) {
        const types = application.deviceTypes;
        const from = types.findIndex(
          (/** @type {any} */ type) => type.id === typeId,
        );
        const target = types.findIndex(
          (/** @type {any} */ type) => type.id === targetId,
        );
        if (from < 0 || target < 0 || from === target) continue;
        const [type] = types.splice(from, 1);
        const destination = types.findIndex(
          (/** @type {any} */ item) => item.id === targetId,
        );
        types.splice(destination + (where === "after" ? 1 : 0), 0, type);
        return next;
      }
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} typeId @param {string} applicationId @param {number} [index] */
  const moveType = (plan, typeId, applicationId, index) => {
    const next = clone(plan);
    let source = null;
    let type = null;
    let sourceFloor = null;
    let target = null;
    let targetFloor = null;
    for (const floor of next.floors)
      for (const application of floor.applications) {
        if (application.id === applicationId) {
          target = application;
          targetFloor = floor;
        }
        const found = application.deviceTypes.find(
          (/** @type {any} */ item) => item.id === typeId,
        );
        if (found) {
          source = application;
          type = found;
          sourceFloor = floor;
        }
      }
    if (!source || !type || !target || sourceFloor !== targetFloor)
      return next;
    source.deviceTypes.splice(source.deviceTypes.indexOf(type), 1);
    const at = Number.isInteger(index)
      ? Math.min(target.deviceTypes.length, Math.max(0, index ?? 0))
      : target.deviceTypes.length;
    target.deviceTypes.splice(at, 0, type);
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} instanceId */
  const instanceName = (plan, instanceId) => {
    const found = findInstance(plan, instanceId);
    if (!found) return null;
    const position = found.type.instances.findIndex(
      (/** @type {any} */ instance) => instance.id === instanceId,
    );
    const typeName = String(found.type.name || "").trim() || "Device instance";
    return `${typeName} #${position + 1} at ${found.instance.x}, ${found.instance.y}`;
  };

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.devices = Object.freeze({
    MAX_INSTANCES,
    addType,
    addInstance,
    renameType,
    removeType,
    moveInstance,
    removeInstance,
    reorderType,
    moveType,
    instanceName,
  });
}
