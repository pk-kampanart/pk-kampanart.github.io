/**
 * Owns pure floor-document rules: floor membership, scope-safe edits, and
 * derived floor contents. It reads neither the DOM nor storage.
 * Channels: none.
 */
{
  /** @param {unknown} value */
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /** @param {Record<string, any>} plan @param {string} id */
  const remove = (plan, id) => {
    if (plan.floors.length < 2) return clone(plan);
    return {
      ...clone(plan),
      floors: plan.floors.filter((/** @type {any} */ floor) => floor.id !== id),
    };
  };

  /** @param {Record<string, any>} plan @param {() => string} ids @param {string} [name] */
  const add = (plan, ids, name) => {
    const next = clone(plan);
    const floorNumber = next.floors.length + 1;
    next.floors.push({
      id: ids(),
      name: name?.trim() || `Floor ${floorNumber}`,
      background: null,
      applications: [
        { id: ids(), name: "Application 1", groups: [], deviceTypes: [] },
      ],
    });
    return next;
  };

  /** @param {{floors: {id: string}[]} } plan @param {string} [initial] */
  const createScope = (plan, initial) => {
    let active = plan.floors.some(
      (/** @type {{id: string}} */ floor) => floor.id === initial,
    )
      ? initial
      : plan.floors[0]?.id;
    return Object.freeze({
      read: () => active,
      activate: (/** @type {string} */ id) => {
        if (
          plan.floors.some(
            (/** @type {{id: string}} */ floor) => floor.id === id,
          )
        )
          active = id;
        return active;
      },
    });
  };

  /** @param {Record<string, any>} plan @param {string} id */
  const contents = (plan, id) => {
    const floor = plan.floors.find((/** @type {any} */ item) => item.id === id);
    if (!floor) return { groups: [], devices: [] };
    const groups = [];
    const devices = [];
    for (const application of floor.applications) {
      groups.push(...application.groups);
      for (const deviceType of application.deviceTypes)
        devices.push(...deviceType.instances);
    }
    return clone({ groups, devices });
  };

  /** @param {Record<string, any>} plan @param {string} id @param {(floor: Record<string, any>) => void} change */
  const edit = (plan, id, change) => {
    const next = clone(plan);
    const floor = next.floors.find((/** @type {any} */ item) => item.id === id);
    if (floor) change(floor);
    return next;
  };

  /** @param {Record<string, any>} plan @param {string} id @param {Record<string, any> | null} background */
  const setBackground = (plan, id, background) =>
    edit(plan, id, (floor) => {
      floor.background = background === null ? null : clone(background);
    });

  /** @param {Record<string, any>} plan @param {string} id @param {number | string} opacity */
  const setOpacity = (plan, id, opacity) => {
    const value = Number(opacity);
    if (!Number.isInteger(value) || value < 0 || value > 100)
      throw new RangeError("opacity must be an integer from 0 to 100");
    return edit(plan, id, (floor) => {
      floor.background = floor.background
        ? { ...floor.background, opacity: value }
        : { src: "", opacity: value };
    });
  };

  /** @param {Record<string, any>} plan @param {string} id @param {string} name */
  const rename = (plan, id, name) =>
    edit(plan, id, (floor) => {
      floor.name = String(name).trim() || "Untitled floor";
    });

  /** @param {Record<string, any>} plan @param {string} [id] */
  const deviceCount = (plan, id) =>
    id === undefined
      ? plan.floors.reduce(
          (/** @type {number} */ total, /** @type {any} */ floor) =>
            total + contents({ floors: [floor] }, floor.id).devices.length,
          0,
        )
      : contents(plan, id).devices.length;

  /** @param {Record<string, any>} plan @param {string} id */
  const floorOf = (plan, id) => {
    for (const floor of plan.floors) {
      if (floor.id === id) return floor.id;
      for (const application of floor.applications) {
        if (
          application.id === id ||
          application.groups.some((/** @type {any} */ group) => group.id === id)
        )
          return floor.id;
        if (
          application.deviceTypes.some(
            (/** @type {any} */ type) =>
              type.id === id ||
              type.instances.some(
                (/** @type {any} */ instance) => instance.id === id,
              ),
          )
        )
          return floor.id;
      }
    }
    return null;
  };

  /** @param {Record<string, any>} before @param {Record<string, any>} after */
  const changedId = (before, after) => {
    const ids = [
      ...(before.floors || []).map((/** @type {any} */ floor) => floor.id),
      ...(after.floors || []).map((/** @type {any} */ floor) => floor.id),
    ].filter(
      (/** @type {string | undefined} */ id, index, all) =>
        id && all.indexOf(id) === index,
    );
    return (
      ids.find(
        (/** @type {string} */ id) =>
          JSON.stringify(
            (before.floors || []).find(
              (/** @type {any} */ floor) => floor.id === id,
            ),
          ) !==
          JSON.stringify(
            (after.floors || []).find(
              (/** @type {any} */ floor) => floor.id === id,
            ),
          ),
      ) || null
    );
  };

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.floors = Object.freeze({
    remove,
    add,
    rename,
    createScope,
    contents,
    deviceCount,
    floorOf,
    changedId,
    setBackground,
    setOpacity,
  });
}
