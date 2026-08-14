/**
 * Validates the authored plan schema without production dependencies.
 * Contributes only pure functions to Planner.codec.
 * Channels: none; this script only exports a pure validator.
 */
{
  /** @typedef {Record<string, any>} Schema */

  const SUPPORTED = new Set([
    "$schema",
    "$id",
    "$ref",
    "$defs",
    "title",
    "description",
    "type",
    "const",
    "enum",
    "pattern",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "minItems",
    "minLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "persisted",
  ]);

  /** @param {unknown} value */
  const typeOf = (value) => {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (Number.isInteger(value)) return "integer";
    if (typeof value === "number" && !Number.isFinite(value))
      return "non-finite number";
    return typeof value;
  };

  /** @param {unknown} value @param {string} expected */
  const matchesType = (value, expected) => {
    if (expected === "number")
      return typeof value === "number" && Number.isFinite(value);
    return typeOf(value) === expected;
  };

  /** @param {string} ref @param {Schema} root @returns {Schema} */
  const resolve = (ref, root) => {
    if (!ref.startsWith("#/")) throw new Error(`unsupported $ref: ${ref}`);
    return ref
      .slice(2)
      .split("/")
      .reduce((node, key) => {
        if (!node || !Object.hasOwn(node, key))
          throw new Error(`unresolvable $ref: ${ref}`);
        return node[key];
      }, root);
  };

  /**
   * @param {unknown} value
   * @param {Schema} schema
   * @param {Schema} root
   * @param {string} path
   * @param {string[]} errors
   * @returns {string[]}
   */
  const walk = (value, schema, root, path, errors) => {
    for (const keyword of Object.keys(schema)) {
      if (!SUPPORTED.has(keyword))
        throw new Error(`unsupported schema keyword: ${keyword}`);
    }

    if (schema.$ref)
      return walk(value, resolve(schema.$ref, root), root, path, errors);

    /** @param {string} message */
    const fail = (message) => errors.push(`${path || "(root)"}: ${message}`);

    if (schema.const !== undefined && value !== schema.const) {
      fail(
        `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`,
      );
      return errors;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      fail(`expected one of ${JSON.stringify(schema.enum)}`);
      return errors;
    }

    if (schema.type) {
      const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!allowed.some((expected) => matchesType(value, expected))) {
        fail(`expected ${allowed.join(" or ")}, got ${typeOf(value)}`);
        return errors;
      }
    }

    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength)
        fail(`shorter than ${schema.minLength}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value))
        fail(`does not match ${schema.pattern}`);
    }

    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum)
        fail(`below ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum)
        fail(`above ${schema.maximum}`);
      if (
        schema.exclusiveMinimum !== undefined &&
        value <= schema.exclusiveMinimum
      )
        fail(`not above ${schema.exclusiveMinimum}`);
    }

    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems)
        fail(`fewer than ${schema.minItems} items`);
      if (schema.items)
        value.forEach((entry, index) =>
          walk(entry, schema.items, root, `${path}[${index}]`, errors),
        );
    }

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const object = /** @type {Record<string, unknown>} */ (value);
      for (const key of schema.required || []) {
        if (!Object.hasOwn(object, key))
          fail(`missing required property "${key}"`);
      }
      const properties = /** @type {Record<string, Schema>} */ (
        schema.properties || {}
      );
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(object)) {
          if (!Object.hasOwn(properties, key))
            fail(`unknown property "${key}"`);
        }
      }
      for (const [key, sub] of Object.entries(properties)) {
        if (Object.hasOwn(object, key))
          walk(object[key], sub, root, path ? `${path}.${key}` : key, errors);
      }
    }

    return errors;
  };

  /** @param {unknown} value @param {Schema} schema */
  const validate = (value, schema) => walk(value, schema, schema, "", []);

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.codec ||= /** @type {PlannerNamespace["codec"]} */ ({});
  planner.codec.validate = validate;
}
