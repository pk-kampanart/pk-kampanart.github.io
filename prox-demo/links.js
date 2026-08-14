/**
 * Owns derived device containment links. It never changes or persists a plan.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {PlanDocument} plan @param {(rect: Rect, point: Point) => boolean} [contains] */
  const derive = (plan, contains) => {
    const inside = contains || planner.geo?.contains;
    if (typeof inside !== "function")
      throw new TypeError("links require geometry containment");
    const result = [];
    // An application is one mesh application key, so a link never crosses one.
    for (const floor of plan.floors)
      for (const application of floor.applications) {
        const devices = application.deviceTypes.flatMap(
          (type) => type.instances,
        );
        for (const group of application.groups)
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
