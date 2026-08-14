/**
 * Owns derived device containment links. It never changes or persists a plan.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {PlanDocument} plan */
  const derive = (plan) => {
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
              if (planner.geo.contains(group.rect, device))
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
