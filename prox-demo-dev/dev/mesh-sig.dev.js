/**
 * Maps catalog products to sandbox compositions and model behavior.
 * Ships as Demo mode under ADR-0013; it is not the SIG Mesh implementation.
 * Channels: provides meshSig rules to the fake Mesh engine.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @typedef {{sku: string, elements: string[], companyId: string, productId: string, versionId: string, features: string, crpl: string}} CatalogProduct */
  /** @typedef {{companyId?: string, productId?: string, versionId?: string | null, features: string, crpl?: string, elements: {models: {id: string}[]}[]}} Composition */

  /** @param {CatalogProduct} product @param {Record<string, {models: string[]}>} templates @returns {Composition} */
  const composition = (product, templates) => {
    if (["primary-extra", ...product.elements].some((name) => !templates[name]))
      throw new Error("Device catalog has an unknown element template");
    return {
      companyId: product.companyId,
      productId: product.productId,
      versionId: product.versionId,
      features: product.features,
      crpl: product.crpl,
      elements: product.elements.map((name, index) => ({
        models: [
          ...(index === 0 ? templates["primary-extra"].models : []),
          ...templates[name].models,
        ].map((id) => ({ id })),
      })),
    };
  };

  /** @param {{min: number, max: number}} range @param {{min: number, max: number} | undefined} limits */
  const withinRange = (range, limits) =>
    Boolean(
      limits &&
      Number.isFinite(range.min) &&
      Number.isFinite(range.max) &&
      range.min <= range.max &&
      range.min >= limits.min &&
      range.max <= limits.max,
    );

  /** @param {{sig: {models: Record<string, {states?: Record<string, {min: number, max: number}>}>}}} file */
  const ctlLimits = (file) =>
    file.sig.models["1303"]?.states?.["Light CTL Temperature"];

  /** @param {{last?: number, default?: number}} state @param {{on: boolean} | {level: number} | {lightness: number}} change */
  const bindState = (state, change) => {
    const last = state.last ?? 0xffff;
    const lightness =
      "on" in change
        ? change.on
          ? state.default || last
          : 0
        : "level" in change
          ? Math.max(0, Math.min(0xffff, change.level + 0x8000))
          : change.lightness;
    return {
      ...state,
      on: lightness > 0,
      level: lightness - 0x8000,
      lightness,
      last: lightness > 0 ? lightness : last,
    };
  };

  /** @param {"accept" | "reject"} type @param {string[]} addresses @param {string} destination */
  const proxyAllows = (type, addresses, destination) =>
    type === "accept"
      ? addresses.includes(destination)
      : type === "reject" && !addresses.includes(destination);

  /** @param {number} current @param {number} steps */
  const stepLightness = (current, steps) =>
    Math.max(0, Math.min(0xffff, current + Math.round((0xffff * steps) / 16)));
  // ponytail: maps CTL turns to 16 steps until PROX publishes its encoder step table.
  /** @param {number} current @param {{min: number, max: number}} range @param {number} steps */
  const stepTemperature = (current, range, steps) =>
    Math.max(
      range.min,
      Math.min(
        range.max,
        Math.round(current + ((range.max - range.min) * steps) / 16),
      ),
    );

  planner.meshSig = Object.freeze({
    composition,
    withinRange,
    ctlLimits,
    bindState,
    proxyAllows,
    stepLightness,
    stepTemperature,
  });
}
