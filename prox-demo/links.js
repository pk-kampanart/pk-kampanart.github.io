/**
 * Owns derived device containment links. It never changes or persists a plan.
 * Channels: none.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {Record<string, any>} plan @param {(rect: Rect, point: Point) => boolean} [contains] */
  const derive = (plan, contains) => {
    const inside = contains || planner.geo?.contains;
    if (typeof inside !== "function")
      throw new TypeError("links require geometry containment");
    const result = [];
    for (const floor of plan.floors) {
      const groups = [];
      const devices = [];
      for (const application of floor.applications) {
        groups.push(...application.groups);
        for (const type of application.deviceTypes)
          devices.push(...type.instances);
      }
      for (const group of groups)
        if (group.rect)
          for (const device of devices)
            if (inside(group.rect, device))
              result.push({
                floorId: floor.id,
                groupId: group.id,
                deviceId: device.id,
              });
    }
    return result;
  };

  planner.links = Object.freeze({ derive });
}
