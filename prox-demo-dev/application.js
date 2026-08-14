/**
 * Owns pure application-document rules. It reads neither the DOM nor storage.
 * Channels: none.
 */
{
  /** A floor keeps at least one application. @param {PlanDocument} plan @param {string} floorId */
  const removable = (plan, floorId) =>
    (plan.floors.find((item) => item.id === floorId)?.applications.length ??
      0) > 1;

  /** @param {PlanDocument} plan @param {string} floorId @param {TargetId} id */
  const remove = (plan, floorId, id) => {
    const next = planner.codec.copy(plan);
    const floor = next.floors.find((item) => item.id === floorId);
    if (floor && removable(plan, floorId))
      floor.applications = floor.applications.filter(
        (application) => application.id !== id,
      );
    return next;
  };

  /** @param {PlanDocument} plan @param {string} floorId @param {() => string} ids @param {string} [name] */
  const add = (plan, floorId, ids, name) => {
    const next = planner.codec.copy(plan);
    const floor = next.floors.find((item) => item.id === floorId);
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

  /** @param {PlanDocument} plan @param {string} floorId @param {TargetId} id @param {string} name */
  const rename = (plan, floorId, id, name) => {
    const next = planner.codec.copy(plan);
    const application = next.floors
      .find((floor) => floor.id === floorId)
      ?.applications.find((item) => item.id === id);
    if (application)
      application.name = String(name).trim() || "Untitled application";
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id */
  const find = (plan, id) => {
    for (const floor of plan.floors)
      for (const application of floor.applications)
        if (application.id === id) return application;
    return null;
  };

  /** @param {PlanDocument} plan @param {TargetId} id */
  const groupCount = (plan, id) => find(plan, id)?.groups.length || 0;

  /** @param {PlanDocument} plan @param {TargetId} id */
  const deviceCount = (plan, id) =>
    find(plan, id)?.deviceTypes.reduce(
      (/** @type {number} */ total, type) => total + type.instances.length,
      0,
    ) || 0;

  /**
   * What deleting an application takes with it: its groups, its device types
   * and their placed devices. Reads the plan; changes nothing.
   * @param {PlanDocument} plan @param {TargetId} id @returns {FloorContents}
   */
  const contents = (plan, id) => {
    const application = find(plan, id);
    const groups = application?.groups || [];
    const deviceTypes = application?.deviceTypes || [];
    return {
      applications: 0,
      groups: groups.length,
      groupColors: groups.map((group) => group.color),
      deviceTypes: deviceTypes.length,
      devices: deviceTypes.flatMap((type) => type.instances || []).length,
      image: "",
    };
  };

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.applications = Object.freeze({
    contents,
    remove,
    removable,
    add,
    rename,
    groupCount,
    deviceCount,
  });
}
