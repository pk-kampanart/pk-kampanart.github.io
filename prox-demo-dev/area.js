/**
 * Owns pure Area-document rules: Area membership and edits. It reads neither
 * the DOM nor storage.
 * Channels: none.
 */
{
  const GRID_MIN_SPACING = 2;
  const GRID_MAX_SPACING = 200;
  const GRID_DEFAULTS = Object.freeze({ originX: 0, originY: 0, spacing: 10 });

  /** A plan keeps at least one Area. @param {PlanDocument} plan */
  const removable = (plan) => plan.areas.length > 1;

  /** @param {PlanDocument} plan @param {TargetId} id */
  const remove = (plan, id) => {
    if (!removable(plan)) return planner.codec.copy(plan);
    return {
      ...planner.codec.copy(plan),
      areas: plan.areas.filter((area) => area.id !== id),
    };
  };

  /**
   * @param {PlanDocument} plan @param {() => string} ids @param {string} [name]
   * @param {() => string} [areaId] mints the Area's own id; defaults to `ids`
   */
  const add = (plan, ids, name, areaId = ids) => {
    const next = planner.codec.copy(plan);
    const areaNumber = next.areas.length + 1;
    const id = areaId();
    next.areas.push({
      id,
      name: name?.trim() || `Area ${areaNumber}`,
      background: null,
      applications: [],
    });
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {(area: Area) => void} change */
  const edit = (plan, id, change) => {
    const next = planner.codec.copy(plan);
    const area = next.areas.find((item) => item.id === id);
    if (area) change(area);
    return next;
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {Background | null} background */
  const setBackground = (plan, id, background) =>
    edit(plan, id, (area) => {
      area.background =
        background === null ? null : planner.codec.copy(background);
    });

  /** @param {PlanDocument} plan @param {TargetId} id @param {number | string} opacity */
  const setOpacity = (plan, id, opacity) => {
    const value = Number(opacity);
    if (!Number.isInteger(value) || value < 0 || value > 100)
      throw new RangeError("opacity must be an integer from 0 to 100");
    return edit(plan, id, (area) => {
      area.background = area.background
        ? { ...area.background, opacity: value }
        : { src: "", opacity: value };
    });
  };

  /** @param {Area | null | undefined} area @returns {Grid} */
  const gridOf = (area) => {
    const grid = area?.grid;
    const originX = Number(grid?.originX);
    const originY = Number(grid?.originY);
    const spacing = Number(grid?.spacing);
    return {
      originX: Number.isFinite(originX) ? originX : GRID_DEFAULTS.originX,
      originY: Number.isFinite(originY) ? originY : GRID_DEFAULTS.originY,
      spacing:
        Number.isFinite(spacing) &&
        spacing >= GRID_MIN_SPACING &&
        spacing <= GRID_MAX_SPACING
          ? spacing
          : GRID_DEFAULTS.spacing,
    };
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {unknown} value */
  const setGrid = (plan, id, value) => {
    const grid = /** @type {Partial<Grid>} */ (
      value && typeof value === "object" ? value : {}
    );
    const originX = Number(grid.originX);
    const originY = Number(grid.originY);
    const spacing = Number(grid.spacing);
    if (!Number.isFinite(originX) || !Number.isFinite(originY))
      throw new RangeError("grid origin must be finite numbers");
    if (
      !Number.isFinite(spacing) ||
      spacing < GRID_MIN_SPACING ||
      spacing > GRID_MAX_SPACING
    )
      throw new RangeError(
        `grid spacing must be between ${GRID_MIN_SPACING} and ${GRID_MAX_SPACING}`,
      );
    return edit(plan, id, (area) => {
      area.grid = { originX, originY, spacing };
    });
  };

  /** @param {PlanDocument} plan @param {TargetId} id @param {string} name */
  const rename = (plan, id, name) =>
    edit(plan, id, (area) => {
      area.name = String(name).trim() || "Untitled Area";
    });

  /** @param {PlanDocument} plan @param {TargetId} id */
  const areaOf = (plan, id) => {
    for (const area of plan.areas) {
      if (area.id === id) return area.id;
      for (const application of area.applications) {
        if (
          application.id === id ||
          application.groups.some((group) => group.id === id)
        )
          return area.id;
        if (
          application.deviceTypes.some(
            (type) =>
              type.id === id ||
              type.instances.some((instance) => instance.id === id),
          )
        )
          return area.id;
      }
    }
    return null;
  };

  /** @param {PlanDocument} before @param {PlanDocument} after */
  const changedId = (before, after) => {
    const ids = [
      ...(before.areas || []).map((area) => area.id),
      ...(after.areas || []).map((area) => area.id),
    ].filter(
      (/** @type {string | undefined} */ id, index, all) =>
        id && all.indexOf(id) === index,
    );
    return (
      ids.find(
        (/** @type {string} */ id) =>
          !planner.codec.equal(
            (before.areas || []).find((area) => area.id === id),
            (after.areas || []).find((area) => area.id === id),
          ),
      ) || null
    );
  };

  /**
   * What deleting an Area takes with it: its applications and everything in
   * them, and its background image. Reads the plan; changes nothing.
   * @param {PlanDocument} plan @param {TargetId} id @returns {AreaContents}
   */
  const contents = (plan, id) => {
    const area = plan.areas.find((item) => item.id === id);
    const applications = area?.applications || [];
    const groups = applications.flatMap((item) => item.groups || []);
    const deviceTypes = applications.flatMap((item) => item.deviceTypes || []);
    return {
      applications: applications.length,
      groups: groups.length,
      groupColors: groups.map((group) => group.color),
      deviceTypes: deviceTypes.length,
      devices: deviceTypes.flatMap((type) => type.instances || []).length,
      image: area?.background?.src || "",
    };
  };

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.areas = Object.freeze({
    contents,
    remove,
    removable,
    add,
    rename,
    areaOf,
    changedId,
    setBackground,
    setOpacity,
    gridOf,
    setGrid,
    GRID_DEFAULTS,
    GRID_MIN_SPACING,
    GRID_MAX_SPACING,
  });
}
