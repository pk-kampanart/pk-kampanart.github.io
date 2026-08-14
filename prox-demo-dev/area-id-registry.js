/**
 * Keeps every Area identity issued or observed for a project in browser-local
 * storage. Network-key fingerprints share the same registry record.
 * Channels: plan snapshots and Area minting update the project registry.
 */
{
  /** @param {{storage?: Storage, createId?: () => string}} [options] */
  const create = (options = {}) => {
    const storage = options.storage || globalThis.localStorage;
    const createId = options.createId || (() => crypto.randomUUID());
    const keyOf = (projectId) => `mesh-planner:mesh-key-registry:${projectId}`;

    /** @param {string} projectId */
    const read = (projectId) => {
      try {
        const value = JSON.parse(storage.getItem(keyOf(projectId)) || "null");
        return {
          keys: Array.isArray(value?.keys)
            ? value.keys.filter((key) => typeof key === "string")
            : [],
          areas: Array.isArray(value?.areas)
            ? value.areas.filter((area) => typeof area === "string")
            : [],
        };
      } catch {
        return { keys: [], areas: [] };
      }
    };
    /** @param {string} projectId @param {{keys: string[], areas: string[]}} value */
    const write = (projectId, value) =>
      storage.setItem(keyOf(projectId), JSON.stringify(value));

    /** @param {string} projectId @param {string} areaId */
    const rememberArea = (projectId, areaId) => {
      if (
        typeof projectId !== "string" ||
        !projectId ||
        typeof areaId !== "string" ||
        !areaId
      )
        return;
      const registry = read(projectId);
      if (registry.areas.includes(areaId)) return;
      registry.areas.push(areaId);
      write(projectId, registry);
    };
    /** @param {PlanDocument} plan */
    const remember = (plan) => {
      const projectId = plan?.project?.id;
      if (typeof projectId !== "string" || !projectId) return;
      for (const area of plan.areas || []) rememberArea(projectId, area?.id);
    };

    /** @param {string} projectId */
    const mint = (projectId) => {
      if (typeof projectId !== "string" || !projectId)
        throw new TypeError("Area IDs require a project id");
      const registry = read(projectId);
      const unavailable = new Set([...registry.areas, projectId]);
      for (let attempt = 0; attempt < 128; attempt += 1) {
        const areaId = createId();
        if (typeof areaId !== "string" || !areaId || unavailable.has(areaId))
          continue;
        registry.areas.push(areaId);
        write(projectId, registry);
        return areaId;
      }
      throw new Error("a unique Area id could not be generated");
    };

    return Object.freeze({ mint, remember, rememberArea });
  };

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @type {any} */ (planner).areaIds = Object.freeze({ create });
}
