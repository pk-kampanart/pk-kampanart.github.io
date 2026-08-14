/**
 * Owns pure group-document rules. It reads neither the DOM nor storage.
 * Channels: none.
 */
{
  const PALETTE = Object.freeze([
    "#1772e8",
    "#e8590c",
    "#2f9e44",
    "#c2255c",
    "#7048e8",
    "#0c8599",
    "#f08c00",
    "#5c940d",
    "#e03131",
    "#495057",
  ]);

  /** @param {unknown} value */
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /** @param {Record<string, any>} plan @param {string} id */
  const applicationOf = (plan, id) => {
    for (const floor of plan.floors)
      for (const application of floor.applications)
        if (application.id === id) return application;
    return null;
  };

  /** @param {Record<string, any>} plan @param {string} applicationId */
  const floorOfApplication = (plan, applicationId) =>
    plan.floors.find((/** @type {any} */ floor) =>
      floor.applications.some(
        (/** @type {any} */ application) => application.id === applicationId,
      ),
    ) || null;

  /** @param {Record<string, any>} plan @param {string} id */
  const groupOf = (plan, id) => {
    for (const floor of plan.floors)
      for (const application of floor.applications) {
        const group = application.groups.find(
          (/** @type {any} */ item) => item.id === id,
        );
        if (group) return group;
      }
    return null;
  };

  /** @param {Record<string, any>} plan @param {string} applicationId @param {() => string} ids @param {string} [name] */
  const add = (plan, applicationId, ids, name) => {
    const next = clone(plan);
    const application = applicationOf(next, applicationId);
    const floor = floorOfApplication(next, applicationId);
    if (!application || !floor) return next;
    const floorGroups = floor.applications.flatMap(
      (/** @type {any} */ item) => item.groups,
    );
    const color =
      PALETTE.find(
        (/** @type {string} */ value) =>
          !floorGroups.some(
            (/** @type {any} */ group) => group.color === value,
          ),
      ) ||
      PALETTE[floorGroups.length % PALETTE.length] ||
      "#1772e8";
    application.groups.push({
      id: ids(),
      name: String(name || `Group ${application.groups.length + 1}`).trim(),
      color,
      rect: null,
    });
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} id */
  const remove = (plan, id) => {
    const next = clone(plan);
    for (const floor of next.floors)
      for (const application of floor.applications)
        application.groups = application.groups.filter(
          (/** @type {any} */ group) => group.id !== id,
        );
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} id @param {string} name */
  const rename = (plan, id, name) => {
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group) group.name = String(name).trim() || "Untitled group";
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} id @param {string} color */
  const recolor = (plan, id, color) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(color)))
      throw new RangeError("color must be a six-digit hexadecimal value");
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group) group.color = String(color);
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} id @param {Record<string, number> | null} rect */
  const setRect = (plan, id, rect) => {
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group) group.rect = rect === null ? null : { ...rect };
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} id @param {string} applicationId @param {number} [index] */
  const move = (plan, id, applicationId, index) => {
    const next = clone(plan);
    let source = null;
    let group = null;
    let sourceFloor = null;
    for (const floor of next.floors)
      for (const application of floor.applications) {
        const found = application.groups.find(
          (/** @type {any} */ item) => item.id === id,
        );
        if (found) {
          source = application;
          group = found;
          sourceFloor = floor;
        }
      }
    const target = applicationOf(next, applicationId);
    const targetFloor = floorOfApplication(next, applicationId);
    if (!source || !group || !target || sourceFloor !== targetFloor)
      return next;
    source.groups.splice(source.groups.indexOf(group), 1);
    const at = Number.isInteger(index)
      ? Math.min(target.groups.length, Math.max(0, index ?? 0))
      : target.groups.length;
    target.groups.splice(at, 0, group);
    return next;
  };

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.groups = Object.freeze({
    add,
    remove,
    rename,
    recolor,
    setRect,
    move,
  });
}
