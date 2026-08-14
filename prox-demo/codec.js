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
   * @typedef {{ok: true, plan: object} | {ok: false, reason: string}} ReadResult
   */

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
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

      let errors;
      try {
        errors = validate(document, schema);
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
      return { ok: true, plan: document };
    };

    /** @param {object} plan */
    const write = (plan) => {
      const errors = validate(plan, schema);
      if (errors.length > 0)
        throw new Error(
          `refusing to write an invalid plan: ${errors.join("; ")}`,
        );
      return JSON.parse(JSON.stringify(plan));
    };

    /**
     * @param {string} projectId
     * @param {string} projectName
     * @param {() => string} ids
     */
    const emptyPlan = (projectId, projectName, ids) => ({
      formatVersion,
      project: { id: projectId, name: projectName },
      floors: [
        {
          id: ids(),
          name: "Floor 1",
          background: null,
          applications: [
            { id: ids(), name: "Application 1", groups: [], deviceTypes: [] },
          ],
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

  codec.create = create;
  codec.read = read;
  codec.write = write;
  codec.emptyPlan = emptyPlan;
}
