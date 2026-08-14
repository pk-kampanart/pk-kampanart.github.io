/**
 * Saved-page reader marker. Recovers a plan from a saved page on a cold start.
 * This is the sole production DOM-to-document reader; it reads declared
 * anchors and slots, validates through the codec, and writes only new records.
 * Channels: none; the caller decides how to open the restored project.
 */
{
  /** @typedef {Record<string, any>} Value */

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  const dom =
    planner.dom || (planner.dom = /** @type {DomNamespace} */ ({}));

  const vocabulary = () =>
    /** @type {Record<string, string>} */ (dom.vocabulary);

  /** @param {unknown} value @returns {Value | null} */
  const objectOf = (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? /** @type {Value} */ (value)
      : null;

  /** @param {Value} schema @param {string} ref @returns {Value} */
  const resolve = (schema, ref) => {
    if (!ref.startsWith("#/")) throw new Error(`unsupported schema ref ${ref}`);
    return /** @type {Value} */ (
      ref
        .slice(2)
        .split("/")
        .reduce((/** @type {any} */ node, /** @type {string} key */ key) => {
          if (!node || !Object.hasOwn(node, key))
            throw new Error(`unresolvable schema ref ${ref}`);
          return node[key];
        }, schema)
    );
  };

  /** @param {Value} value @param {Value} schema @returns {Value} */
  const resolved = (value, schema) =>
    value?.$ref ? resolved(resolve(schema, value.$ref), schema) : value || {};

  /** @param {Value} schema @param {string} entity @returns {Value} */
  const definitionOf = (schema, entity) =>
    entity === "plan" ? schema : schema.$defs?.[entity];

  /** @param {Value} schema @param {string} entity @param {string} field */
  const childOf = (schema, entity, field) => {
    const definition = definitionOf(schema, entity);
    const declared = definition?.properties?.[field];
    const property = declared?.type === "array" ? declared.items : declared;
    const child = property?.$ref;
    if (!child?.startsWith("#/$defs/")) return null;
    const name = child.slice("#/$defs/".length);
    return definitionOf(schema, name)?.properties?.id ? name : null;
  };

  /** @param {Element} root @param {string} entity @returns {Element[]} */
  const anchorsOf = (root, entity) => {
    const attrs = vocabulary();
    const anchors = /** @type {Element[]} */ ([]);
    const visit = (/** @type {Element} */ element) => {
      if (element.getAttribute(attrs.ANCHOR) === entity) anchors.push(element);
      for (const child of element.children) visit(child);
    };
    visit(root);
    return anchors;
  };

  /** @param {string} raw @param {Value} property @returns {unknown} */
  const decode = (raw, property) => {
    const types = Array.isArray(property.type)
      ? property.type
      : property.type
        ? [property.type]
        : [];
    if (raw === "" && types.includes("null")) return null;
    if (types.length === 1 && types[0] === "string") return raw;
    try {
      return JSON.parse(raw);
    } catch (error) {
      if (types.includes("string")) return raw;
      throw new Error(`cannot decode slot: ${String(error)}`);
    }
  };

  /** @param {Element} element @param {string} path @returns {{raw: string} | null} */
  const rawSlot = (element, path) => {
    const attrs = vocabulary();
    if (element.hasAttribute(attrs.SLOT_TEMPLATE)) return null;
    const landing = element.getAttribute(attrs.SLOT_AS) || "text";
    if (landing === "pair") return null;
    if (landing === "text") return { raw: element.textContent || "" };
    if (landing === "value") {
      const raw = element.getAttribute("value");
      if (raw === null)
        throw new Error(`${path}: saved value attribute is missing`);
      return { raw };
    }
    if (landing === "checked")
      return { raw: String(element.hasAttribute("checked")) };
    if (landing.startsWith("attr:") && landing.length > 5) {
      const raw = element.getAttribute(landing.slice(5));
      if (raw === null) throw new Error(`${path}: saved attribute is missing`);
      return { raw };
    }
    if (landing.startsWith("style:") && landing.length > 6) {
      const raw = /** @type {HTMLElement} */ (element).style.getPropertyValue(
        landing.slice(6),
      );
      if (!raw) throw new Error(`${path}: saved style is missing`);
      return { raw };
    }
    throw new Error(`${path}: unknown slot landing "${landing}"`);
  };

  /** @param {Element} anchor @param {string} entity @param {string} field @param {Value} property @returns {unknown} */
  const fieldFromSlots = (anchor, entity, field, property) => {
    const attrs = vocabulary();
    const path = `${entity}.${field}`;
    const slots = dom
      .slotsOf(anchor)
      .filter(
        (/** @type {Element} */ element) =>
          !element.hasAttribute(attrs.SLOT_DERIVED) &&
          element.getAttribute(attrs.SLOT) === field,
      );
    const values = [];
    for (const slot of slots) {
      const raw = rawSlot(slot, path);
      if (raw)
        try {
          values.push(decode(raw.raw, property));
        } catch (error) {
          throw new Error(`${path}: ${String(error)}`);
        }
    }
    if (values.length === 0) {
      const generated = field === "id" ? anchor.getAttribute(attrs.ID) : null;
      if (generated) return generated;
      throw new Error(`${path}: no non-derived saved slot`);
    }
    const first = JSON.stringify(values[0]);
    if (values.some((value) => JSON.stringify(value) !== first))
      throw new Error(`${path}: declared slots disagree`);
    return values[0];
  };

  /** @param {Element} anchor @param {string} entity @param {Value} schema @param {string} path @returns {Value} */
  const readEntity = (anchor, entity, schema, path) => {
    const definition = definitionOf(schema, entity);
    if (!definition)
      throw new Error(`${path}: schema entity "${entity}" is missing`);
    const value = /** @type {Value} */ ({});
    const attrs = vocabulary();
    for (const field of Object.keys(definition.properties || {})) {
      const declared = definition.properties[field];
      const property = resolved(declared, schema);
      const child = childOf(schema, entity, field);
      if (!child) {
        value[field] = fieldFromSlots(anchor, path, field, property);
        continue;
      }
      const region = dom.regionOf(anchor, field);
      const childPath = `${path}.${field}`;
      if (!region) throw new Error(`${childPath}: declared region is missing`);
      /** @type {Element[]} */
      const children = [];
      const collect = (/** @type {Element} */ element) => {
        for (const descendant of element.children) {
          const actual = descendant.getAttribute(attrs.ANCHOR);
          if (actual) {
            if (actual !== child)
              throw new Error(
                `${childPath}: unexpected ${actual || "unknown"} anchor`,
              );
            children.push(descendant);
            continue;
          }
          collect(descendant);
        }
      };
      collect(region);
      if (property.type === "array") {
        value[field] = children.map(
          (/** @type {Element} */ element, /** @type {number} */ index) =>
            readEntity(element, child, schema, `${childPath}[${index}]`),
        );
      } else {
        if (children.length !== 1)
          throw new Error(`${childPath}: expected one ${child} anchor`);
        value[field] = readEntity(children[0], child, schema, childPath);
      }
    }
    return value;
  };

  /** @param {Element} root @param {Value} schema @param {any} codec */
  const readDocument = (root, schema, codec) => {
    const attrs = vocabulary();
    const plans = anchorsOf(root, "plan");
    const hasIdentity =
      root.hasAttribute(attrs.FORMAT_VERSION) ||
      root.hasAttribute(attrs.PROJECT_ID);
    if (!hasIdentity && plans.length === 0)
      return { ok: true, plan: null, restored: false };
    const identity = root.getAttribute(attrs.PROJECT_ID);
    const version = root.getAttribute(attrs.FORMAT_VERSION);
    if (!version || !identity)
      return {
        ok: false,
        kind: "invalid-saved-page",
        reason:
          "html: saved page identity requires data-format-version and data-project-id",
      };
    if (version !== String(codec.FORMAT_VERSION))
      return {
        ok: false,
        kind: "unsupported-format",
        reason: `html[data-format-version]: saved page has formatVersion ${version}; this build reads ${codec.FORMAT_VERSION}`,
      };
    if (plans.length !== 1)
      return {
        ok: false,
        kind: "invalid-saved-page",
        reason: "html[data-anchor=plan]: saved page has no single plan anchor",
      };
    let value;
    try {
      value = readEntity(plans[0], "plan", schema, "plan");
    } catch (error) {
      return {
        ok: false,
        kind: "invalid-saved-page",
        reason: String(error),
      };
    }
    const checked = codec.read(value);
    if (!checked.ok)
      return { ok: false, kind: "invalid-saved-page", reason: checked.reason };
    if (checked.plan.formatVersion !== Number(version))
      return {
        ok: false,
        kind: "invalid-saved-page",
        reason: `html[data-format-version]: root formatVersion ${version} does not match plan formatVersion ${checked.plan.formatVersion}`,
      };
    if (checked.plan.project.id !== identity)
      return {
        ok: false,
        kind: "invalid-saved-page",
        reason: `html[data-project-id]: root project id ${JSON.stringify(identity)} does not match plan project id ${JSON.stringify(checked.plan.project.id)}`,
      };
    return { ok: true, plan: checked.plan, identity, restored: false };
  };

  /** @param {unknown} options */
  const create = (options) => {
    const config = objectOf(options);
    const root = /** @type {Element | null} */ (config?.root || null);
    const codec = config?.codec;
    if (!root || !root.ownerDocument)
      throw new TypeError("saved-page reader requires a DOM root");
    if (
      !codec ||
      typeof codec.read !== "function" ||
      typeof codec.write !== "function" ||
      !Number.isInteger(codec.FORMAT_VERSION)
    )
      throw new TypeError("saved-page reader requires a versioned codec");
    const schema = objectOf(config.schema);
    if (!schema) throw new TypeError("saved-page reader requires a schema");
    const storage = config.storage;
    let ran = false;

    const read = () => readDocument(root, schema, codec);

    const run = async () => {
      if (ran)
        return {
          ok: true,
          restored: false,
          skipped: true,
          reason: "restore already ran",
        };
      ran = true;
      const attrs = vocabulary();
      const identity = root.getAttribute(attrs.PROJECT_ID);
      if (!identity) return read();
      if (
        !storage ||
        typeof storage.getAllProjects !== "function" ||
        typeof storage.createProject !== "function" ||
        typeof storage.createId !== "function"
      )
        throw new TypeError("restoreFromDom requires project storage");
      const records = await storage.getAllProjects();
      if (
        identity &&
        records.some(
          (/** @type {Value} */ record) =>
            objectOf(record)?.restoredFrom === identity,
        )
      )
        return {
          ok: true,
          restored: false,
          skipped: true,
          identity,
          reason: "saved page was already restored",
        };
      const result = read();
      if (!result.ok || !result.plan) return result;
      const plan = JSON.parse(JSON.stringify(result.plan));
      const existing = new Set(
        records
          .map((/** @type {Value} */ record) => objectOf(record)?.id)
          .filter((/** @type {unknown} */ id) => typeof id === "string"),
      );
      existing.add(identity);
      let id = String(storage.createId());
      while (existing.has(id)) id = String(storage.createId());
      plan.project.id = id;
      let payload;
      try {
        payload = codec.write(plan);
      } catch (error) {
        return { ok: false, kind: "invalid-saved-page", reason: String(error) };
      }
      const now = new Date().toISOString();
      const record = {
        id,
        name: plan.project.name,
        createdAt: now,
        updatedAt: now,
        formatVersion: plan.formatVersion,
        payload,
        restoredFrom: identity,
      };
      const stored = await storage.createProject(record);
      await storage.setLastProjectId?.(stored.id || id);
      return {
        ok: true,
        restored: true,
        identity,
        plan,
        record: stored,
      };
    };

    return Object.freeze({ read, run });
  };

  dom.restoreFromDom = Object.freeze({ create });
}
