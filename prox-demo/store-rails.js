/**
 * Guards stored records against format skew and provides the D2a export rail.
 * Contributes storeRails to Planner; it never adapts an unknown document.
 * Channels: none; callers report refusals and decide when a real edit replaces
 * a refused record.
 */
{
  /** @typedef {Record<string, any>} Value */

  /** @param {unknown} record @returns {Value | null} */
  const objectOf = (record) =>
    record && typeof record === "object" && !Array.isArray(record)
      ? /** @type {Value} */ (record)
      : null;

  /** @param {unknown} record @returns {unknown} */
  const versionOf = (record) => {
    const value = objectOf(record);
    if (!value) return undefined;
    if (Object.hasOwn(value, "formatVersion")) return value.formatVersion;
    const payload = objectOf(value.payload);
    return payload?.formatVersion;
  };

  /** @param {unknown} value @returns {string} */
  const textOf = (value) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(error);
    }
  };

  /** @param {Value} record */
  const rawExport = (record) => ({
    filename: `${String(record.name || record.id || "project")}.json`,
    mimeType: "application/json",
    text: textOf(record),
  });

  /** @param {unknown} record @param {number} expectedVersion @returns {any} */
  const inspect = (record, expectedVersion) => {
    const value = objectOf(record);
    if (!value)
      return {
        ok: false,
        kind: "invalid-record",
        reason: "not a project record",
      };
    const version = versionOf(value);
    if (version !== expectedVersion)
      return {
        ok: false,
        kind: "unsupported-format",
        version,
        expectedVersion,
        reason: `unsupported stored formatVersion ${JSON.stringify(version)}; this build reads ${expectedVersion}`,
      };
    return { ok: true, record: value };
  };

  /** @param {unknown} options */
  const create = (options) => {
    const config = objectOf(options);
    const db = config?.db;
    const codec = config?.codec;
    if (
      !db ||
      typeof db.getProject !== "function" ||
      typeof db.putProject !== "function"
    )
      throw new TypeError(
        "store rails require db.getProject() and db.putProject()",
      );
    if (
      !codec ||
      typeof codec.read !== "function" ||
      typeof codec.write !== "function"
    )
      throw new TypeError("store rails require codec.read() and codec.write()");
    const expectedVersion = Number.isInteger(config.formatVersion)
      ? config.formatVersion
      : codec.FORMAT_VERSION;
    if (!Number.isInteger(expectedVersion))
      throw new TypeError("store rails require an integer formatVersion");
    const report =
      typeof config.report === "function" ? config.report : () => {};
    const offerExport =
      typeof config.offerExport === "function" ? config.offerExport : () => {};
    const offered = new Set();

    /** @param {Value} record */
    const recordKey = (record) => String(record.id || rawExport(record).text);

    /** @param {Value} record */
    const refusal = (record) => {
      const result = inspect(record, expectedVersion);
      if (result.ok || result.kind !== "unsupported-format") {
        report(result);
        return result;
      }
      const exportFile = rawExport(record);
      const key = recordKey(record);
      const firstOffer = !offered.has(key);
      if (firstOffer) {
        offered.add(key);
        offerExport(exportFile, result);
      }
      const reported = {
        ...result,
        rawExport: exportFile,
        exportOffered: firstOffer,
      };
      report(reported);
      return reported;
    };

    /** @param {Value} record */
    const decode = (record) => {
      const checked = inspect(record, expectedVersion);
      if (!checked.ok) return refusal(record);
      const result = codec.read(record.payload);
      if (!result.ok)
        return { ok: false, kind: "invalid-plan", reason: result.reason };
      return { ok: true, record, plan: result.plan };
    };

    /** @param {string} id */
    const open = (id) =>
      Promise.resolve(db.getProject(id)).then((record) => {
        if (!record)
          return {
            ok: false,
            kind: "missing-record",
            missing: true,
            reason: `project "${id}" was not found`,
          };
        const result = decode(record);
        if (!result.ok) return result;
        return Promise.resolve(db.setLastProjectId?.(id)).then(() => result);
      });

    /** @param {string} name */
    const createProject = (name) => {
      if (typeof codec.emptyPlan !== "function")
        return Promise.reject(
          new TypeError("store rails require codec.emptyPlan()"),
        );
      const id = db.createId();
      const plan = codec.emptyPlan(id, name, db.createId);
      const now = new Date().toISOString();
      const record = {
        id,
        name,
        createdAt: now,
        updatedAt: now,
        formatVersion: expectedVersion,
        payload: codec.write(plan),
      };
      return db.createProject(record).then((/** @type {any} */ stored) => ({
        ok: true,
        record: stored,
        plan,
      }));
    };

    /** @param {unknown} input */
    const importProject = (input) => {
      let result;
      try {
        result = codec.read(input);
      } catch (error) {
        return Promise.resolve({
          ok: false,
          kind: "invalid-import",
          reason: `cannot read plan: ${String(error)}`,
        });
      }
      if (!result.ok)
        return Promise.resolve({
          ok: false,
          kind: "invalid-import",
          reason: result.reason,
        });

      const plan = JSON.parse(JSON.stringify(result.plan));
      return Promise.resolve(
        typeof db.getAllProjects === "function" ? db.getAllProjects() : [],
      )
        .then((projects) => {
          const existing = new Set(
            projects
              .map((/** @type {Value} */ record) => record.id)
              .filter((/** @type {unknown} */ id) => typeof id === "string"),
          );
          existing.add(String(plan.project.id));
          let id = String(db.createId());
          while (existing.has(id)) id = String(db.createId());
          plan.project.id = id;
          const payload = codec.write(plan);
          const now = new Date().toISOString();
          const record = {
            id,
            name: plan.project.name,
            createdAt: now,
            updatedAt: now,
            formatVersion: expectedVersion,
            payload,
          };
          return db.createProject(record).then((/** @type {any} */ stored) => ({
            ok: true,
            record: stored,
            plan,
          }));
        })
        .catch((error) => ({
          ok: false,
          kind: "import-failed",
          reason: String(error),
        }));
    };

    const openOrCreate = () => {
      const pointer = db.getLastProjectId?.();
      if (pointer)
        return open(pointer).then((result) => {
          if (result.ok) return result;
          if (!result.missing) return result;
          db.clearLastProjectId?.();
          return openMostRecent();
        });
      return openMostRecent();
    };

    const openMostRecent = () =>
      Promise.resolve(db.getAllProjects())
        .then((projects) => {
          if (projects.length === 0)
            return Promise.resolve(
              db.defaultProjectName?.() || "Untitled Project",
            ).then(createProject);
          return open(projects[0].id);
        })
        .then((result) => {
          if (result.ok) db.setLastProjectId?.(result.record.id);
          return result;
        });

    /** @param {Value} record @param {Value} plan */
    const replace = (record, plan) => {
      const value = objectOf(record);
      if (!value) return Promise.resolve(inspect(record, expectedVersion));
      const checked = inspect(value, expectedVersion);
      if (!checked.ok && checked.kind !== "unsupported-format")
        return Promise.resolve(refusal(value));
      if (!plan || typeof plan !== "object")
        return Promise.resolve({
          ok: false,
          kind: "invalid-plan",
          reason: "not a plan document",
        });
      if (plan.project?.id !== value.id)
        return Promise.resolve({
          ok: false,
          kind: "wrong-project",
          reason: "plan project does not match record",
        });
      let payload;
      try {
        payload = codec.write(plan);
      } catch (error) {
        return Promise.resolve({
          ok: false,
          kind: "invalid-plan",
          reason: String(error),
        });
      }
      if (!checked.ok) refusal(value);
      const updated = {
        ...value,
        name: plan.project.name,
        updatedAt: new Date().toISOString(),
        formatVersion: expectedVersion,
        payload,
      };
      return db.putProject(updated).then((/** @type {any} */ stored) => ({
        ok: true,
        record: stored,
        plan,
      }));
    };

    return Object.freeze({
      open,
      openOrCreate,
      createProject,
      importProject,
      replace,
    });
  };

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.storeRails = Object.freeze({ inspect, create });
}
