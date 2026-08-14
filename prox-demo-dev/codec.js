/**
 * Reads and writes the versioned plan document.
 * Contributes pure codec functions to Planner.codec; schema loading belongs to
 * the caller because the authored schema lives inline in index.html.
 * Channels: none; this script only exports pure document functions.
 */
{
  /**
   * @typedef {{
   *   FORMAT_VERSION: number,
   *   read: (value: unknown) => ReadResult,
   *   write: (plan: object) => object,
   *   emptyPlan: (projectId: string, projectName: string, ids: () => string) => object,
   * }} Codec
   * @typedef {{ ok: true, plan: object, migrated?: { droppedAssignments: number } } | { ok: false, reason: string }} ReadResult
   */

  /**
   * The ready-made applications an Area may hold one of each, by preset, with
   * the fixed name each shows; the Add Application menu offers them in this
   * order. The schema's preset enum lists the same keys, and a test holds them
   * together. An application without a preset is one the user named.
   */
  const PRESETS = Object.freeze({ lighting: "Lighting", hvac: "HVAC" });

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const codec =
    planner.codec ||
    (planner.codec = /** @type {PlannerNamespace["codec"]} */ ({}));

  /** @param {unknown} error */
  const messageOf = (error) => String(error);

  /** @param {object} schema @returns {Codec} */
  const create = (schema) => {
    const definition = /** @type {any} */ (schema);
    const validate = codec.validate;
    if (typeof validate !== "function")
      throw new Error("schema validator is not loaded");

    const formatVersion = definition.properties?.formatVersion?.const;
    if (!Number.isInteger(formatVersion))
      throw new Error("schema formatVersion must be an integer");

    /** @param {unknown} input @returns {ReadResult} */
    const read = (input) => {
      let value = input;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch (error) {
          return { ok: false, reason: `not valid JSON: ${messageOf(error)}` };
        }
      }
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return { ok: false, reason: "not a plan document" };
      const document = /** @type {any} */ (value);

      if (document.formatVersion !== formatVersion) {
        return {
          ok: false,
          reason: `unsupported formatVersion ${JSON.stringify(document.formatVersion)}; this build reads ${formatVersion}`,
        };
      }
      const migrated =
        !Object.hasOwn(document, "areas") && Object.hasOwn(document, "floors");
      const plan = copy(document);
      let droppedAssignments = 0;
      if (migrated) {
        plan.areas = copy(document.floors);
        if (Array.isArray(plan.areas))
          for (const area of plan.areas) {
            if (!area || typeof area !== "object") continue;
            if (!Array.isArray(area.applications)) continue;
            for (const application of area.applications) {
              if (!application || typeof application !== "object") continue;
              if (!Array.isArray(application.deviceTypes)) continue;
              for (const deviceType of application.deviceTypes) {
                if (!deviceType || typeof deviceType !== "object") continue;
                if (!Array.isArray(deviceType.instances)) continue;
                for (const instance of deviceType.instances) {
                  if (!instance || typeof instance !== "object") continue;
                  if (Object.hasOwn(instance, "assignment")) {
                    delete instance.assignment;
                    droppedAssignments += 1;
                  }
                }
              }
            }
          }
      }
      delete plan.floors;
      let errors;
      try {
        errors = validate(plan, schema);
      } catch (error) {
        return {
          ok: false,
          reason: `invalid plan document: ${messageOf(error)}`,
        };
      }
      if (errors.length > 0)
        return {
          ok: false,
          reason: `invalid plan document: ${errors.join("; ")}`,
        };
      return migrated
        ? { ok: true, plan, migrated: { droppedAssignments } }
        : { ok: true, plan };
    };
    /** @param {PlanDocument} plan */
    const write = (plan) => {
      const document = { ...plan };
      const errors = validate(document, schema);
      if (errors.length > 0)
        throw new Error(
          `refusing to write an invalid plan: ${errors.join("; ")}`,
        );
      return JSON.parse(JSON.stringify(document));
    };

    /**
     * @param {string} projectId
     * @param {string} projectName
     * @param {() => string} ids
     */
    const emptyPlan = (projectId, projectName, ids) => ({
      formatVersion,
      project: { id: projectId, name: projectName },
      areas: [
        {
          id: ids(),
          name: "Area 1",
          background: null,
          grid: { originX: 0, originY: 0, spacing: 10 },
          applications: [],
        },
      ],
    });

    return Object.freeze({
      FORMAT_VERSION: formatVersion,
      read,
      write,
      emptyPlan,
    });
  };

  /** @param {unknown} value @param {object} schema @returns {ReadResult} */
  const read = (value, schema) => {
    try {
      return create(schema).read(value);
    } catch (error) {
      return { ok: false, reason: `cannot read plan: ${messageOf(error)}` };
    }
  };

  /** @param {object} plan @param {object} schema */
  const write = (plan, schema) => create(schema).write(plan);
  /** @param {string} projectId @param {string} projectName @param {() => string} ids @param {object} schema */
  const emptyPlan = (projectId, projectName, ids, schema) =>
    create(schema).emptyPlan(projectId, projectName, ids);

  /**
   * A deep copy of a JSON-shaped value that shares its strings: an Area's
   * floor-plan background is a data URL of megabytes, and a JSON round trip allocates it
   * again on every edit. Undefined object members are dropped, as JSON drops
   * them.
   * @template T @param {T} value @returns {T}
   */
  const copy = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value))
      return /** @type {T} */ (/** @type {unknown} */ (value.map(copy)));
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const [key, member] of Object.entries(value))
      if (member !== undefined) result[key] = copy(member);
    return /** @type {T} */ (result);
  };

  /** @param {unknown} left @param {unknown} right @returns {boolean} */
  const equal = (left, right) => {
    if (left === right) return true;
    if (
      left === null ||
      right === null ||
      typeof left !== "object" ||
      typeof right !== "object" ||
      Array.isArray(left) !== Array.isArray(right)
    )
      return false;
    const a = /** @type {Record<string, unknown>} */ (left);
    const b = /** @type {Record<string, unknown>} */ (right);
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    return (
      keys.length ===
        Object.keys(b).filter((key) => b[key] !== undefined).length &&
      keys.every((key) => equal(a[key], b[key]))
    );
  };

  codec.PRESETS = PRESETS;
  codec.copy = copy;
  codec.equal = equal;
  codec.create = create;
  codec.read = read;
  codec.write = write;
  codec.emptyPlan = emptyPlan;
}
