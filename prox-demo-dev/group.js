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
  const STROKE_TYPES = Object.freeze(["none", "solid", "dashed", "dotted"]);
  const STROKE_DEFAULTS = Object.freeze({
    type: "solid",
    width: 2,
    opacity: 100,
  });
  const STROKE_DASHES = Object.freeze({
    none: "none",
    solid: "none",
    dashed: "6 4",
    dotted: "1 3",
  });

  /** @template T @param {T} value @returns {T} */
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /** @param {PlanDocument} plan @param {TargetId} id */
  const applicationOf = (plan, id) => {
    for (const floor of plan.floors)
      for (const application of floor.applications)
        if (application.id === id) return application;
    return null;
  };

  /** @param {PlanDocument} plan @param {string} applicationId */
  const floorOfApplication = (plan, applicationId) =>
    plan.floors.find((floor) =>
      floor.applications.some(
        (application) => application.id === applicationId,
      ),
    ) || null;

  /** @param {PlanDocument} plan @param {TargetId} id */
  const groupOf = (plan, id) => {
    for (const floor of plan.floors)
      for (const application of floor.applications) {
        const group = application.groups.find((item) => item.id === id);
        if (group) return group;
      }
    return null;
  };

  /** @param {PlanDocument} plan @param {string} applicationId @param {() => string} ids @param {string} [name] */
  const add = (plan, applicationId, ids, name) => {
    const next = clone(plan);
    const application = applicationOf(next, applicationId);
    const floor = floorOfApplication(next, applicationId);
    if (!application || !floor) return next;
    const floorGroups = floor.applications.flatMap((item) => item.groups);
    const color =
      PALETTE.find(
        (/** @type {string} */ value) =>
          !floorGroups.some((group) => group.color === value),
      ) ||
      PALETTE[floorGroups.length % PALETTE.length] ||
      "#1772e8";
    application.groups.push({
      id: ids(),
      name: String(name || `Group ${application.groups.length + 1}`).trim(),
      color,
      strokeType: STROKE_DEFAULTS.type,
      strokeWidth: STROKE_DEFAULTS.width,
      strokeOpacity: STROKE_DEFAULTS.opacity,
      rect: null,
    });
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id */
  const remove = (plan, id) => {
    const next = clone(plan);
    for (const floor of next.floors)
      for (const application of floor.applications)
        application.groups = application.groups.filter(
          (group) => group.id !== id,
        );
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {string} name */
  const rename = (plan, id, name) => {
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group) group.name = String(name).trim() || "Untitled group";
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {string} color */
  const recolor = (plan, id, color) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(color)))
      throw new RangeError("color must be a six-digit hexadecimal value");
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group) group.color = String(color);
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {unknown} type */
  const setStrokeType = (plan, id, type) => {
    const value = String(type);
    if (!STROKE_TYPES.includes(value))
      throw new RangeError(
        `strokeType must be one of ${STROKE_TYPES.join(", ")}`,
      );
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group)
      group.strokeType = /** @type {Group["strokeType"]} */ (value);
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {unknown} width */
  const setStrokeWidth = (plan, id, width) => {
    const value = Number(width);
    if (!Number.isFinite(value) || value < 1 || value > 20)
      throw new RangeError("strokeWidth must be a number from 1 to 20");
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group) group.strokeWidth = value;
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {unknown} opacity */
  const setStrokeOpacity = (plan, id, opacity) => {
    const value = Number(opacity);
    if (!Number.isInteger(value) || value < 0 || value > 100)
      throw new RangeError("strokeOpacity must be an integer from 0 to 100");
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group) group.strokeOpacity = value;
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {unknown} color */
  const setStrokeColor = (plan, id, color) => {
    const value = color === null ? null : String(color);
    if (value !== null && !/^#[0-9a-fA-F]{6}$/.test(value))
      throw new RangeError("strokeColor must be a six-digit hexadecimal value or null");
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group) group.strokeColor = value;
    return next;
  };

  /** @param {Group} group @returns {StrokeStyle} */
  const strokeOf = (group) => {
    const type = group.strokeType ?? STROKE_DEFAULTS.type;
    return {
      type,
      color: group.strokeColor ?? group.color,
      width: group.strokeWidth ?? STROKE_DEFAULTS.width,
      opacity: (group.strokeOpacity ?? STROKE_DEFAULTS.opacity) / 100,
      dasharray:
        STROKE_DASHES[/** @type {keyof typeof STROKE_DASHES} */ (type)] ||
        STROKE_DASHES.none,
      linecap: type === "dotted" ? "round" : "butt",
    };
  };

  /** @param {Group} group @returns {Group} */
  const withStrokeDefaults = (group) => ({
    ...group,
    strokeType: group.strokeType ?? STROKE_DEFAULTS.type,
    strokeWidth: group.strokeWidth ?? STROKE_DEFAULTS.width,
    strokeOpacity: group.strokeOpacity ?? STROKE_DEFAULTS.opacity,
    strokeColor: group.strokeColor ?? null,
  });

  /** @param {PlanDocument} plan @param {TargetId} id @param {Rect | null} rect */
  const setRect = (plan, id, rect) => {
    const next = clone(plan);
    const group = groupOf(next, id);
    if (group) group.rect = rect === null ? null : { ...rect };
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {string} applicationId @param {number} [index] */
  const move = (plan, id, applicationId, index) => {
    const next = clone(plan);
    let source = null;
    let group = null;
    let sourceFloor = null;
    for (const floor of next.floors)
      for (const application of floor.applications) {
        const found = application.groups.find((item) => item.id === id);
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

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.groups = Object.freeze({
    add,
    remove,
    rename,
    recolor,
    setStrokeType,
    setStrokeWidth,
    setStrokeOpacity,
    setStrokeColor,
    strokeOf,
    withStrokeDefaults,
    setRect,
    move,
  });
}
