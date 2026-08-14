/**
 * Owns pure application-document rules. It reads neither the DOM nor storage.
 * Channels: none.
 */
{
  /** @param {PlanDocument} plan @param {string} areaId @param {TargetId} id */
  const remove = (plan, areaId, id) => {
    const next = planner.codec.copy(plan);
    const area = next.areas.find((item) => item.id === areaId);
    if (area)
      area.applications = area.applications.filter(
        (application) => application.id !== id,
      );
    return next;
  };

  /**
   * The presets an Area can still add, in the order they are offered.
   * @param {PlanDocument} plan @param {string} areaId @returns {ApplicationPreset[]}
   */
  const missing = (plan, areaId) => {
    const held = new Set(
      plan.areas
        .find((item) => item.id === areaId)
        ?.applications.map((application) => application.preset),
    );
    return /** @type {ApplicationPreset[]} */ (
      Object.keys(planner.codec.PRESETS)
    ).filter((preset) => !held.has(preset));
  };

  /**
   * The first "Application N" the Area does not hold.
   * @param {{applications: {name: string}[]}} area
   */
  const otherName = (area) => {
    const names = new Set(area.applications.map((item) => item.name));
    let number = area.applications.length + 1;
    while (names.has(`Application ${number}`)) number += 1;
    return `Application ${number}`;
  };

  /**
   * Adds a preset application, named by its preset, or with "other" one the
   * user names, called "Application N" until they do. A preset the Area
   * already holds, or any other value, changes nothing.
   * @param {PlanDocument} plan @param {string} areaId @param {() => string} ids @param {unknown} preset
   */
  const add = (plan, areaId, ids, preset) => {
    const next = planner.codec.copy(plan);
    const area = next.areas.find((item) => item.id === areaId);
    if (!area) return next;
    if (preset === "other")
      area.applications.push({
        id: ids(),
        name: otherName(area),
        groups: [],
        deviceTypes: [],
      });
    else if (missing(plan, areaId).includes(/** @type {any} */ (preset))) {
      const wanted = /** @type {ApplicationPreset} */ (preset);
      area.applications.push({
        id: ids(),
        name: planner.codec.PRESETS[wanted],
        preset: wanted,
        groups: [],
        deviceTypes: [],
      });
    }
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id */
  const find = (plan, id) => {
    for (const area of plan.areas)
      for (const application of area.applications)
        if (application.id === id) return application;
    return null;
  };

  /**
   * Why `name` cannot be the application's, or "" when it can. A preset keeps
   * its own name; any other application needs a name, and not a preset's,
   * which would read as the preset it is not.
   * @param {PlanDocument} plan @param {TargetId} id @param {unknown} name
   */
  const renameRefusal = (plan, id, name) => {
    const application = find(plan, id);
    if (!application) return "";
    if (application.preset) return `${application.name} keeps its name`;
    const wanted = String(name ?? "").trim();
    if (!wanted) return "An application needs a name";
    const preset = Object.values(planner.codec.PRESETS).find(
      (label) => label.toLowerCase() === wanted.toLowerCase(),
    );
    return preset
      ? `${preset} is a ready-made application; add it from Add Application`
      : "";
  };

  /**
   * Renames an application the user named. A name `renameRefusal` refuses
   * leaves it as it was.
   * @param {PlanDocument} plan @param {TargetId} id @param {unknown} name
   */
  const rename = (plan, id, name) => {
    const next = planner.codec.copy(plan);
    const application = find(next, id);
    if (application && !renameRefusal(plan, id, name))
      application.name = String(name).trim();
    return next;
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
   * @param {PlanDocument} plan @param {TargetId} id @returns {AreaContents}
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
    missing,
    add,
    rename,
    renameRefusal,
    groupCount,
    deviceCount,
  });
}
