/**
 * Projects a plan document through the declared DOM binder.
 * Contributes project to Planner.dom; it reads the store and never writes it.
 * Channels: none; callers decide when to project.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  const dom =
    planner.dom || (planner.dom = /** @type {DomNamespace} */ ({}));

  /** @param {Document} document @param {Record<string, any> | null} plan */
  const reflectIdentity = (document, plan) => {
    const root = document.documentElement;
    const attrs = dom.vocabulary;
    if (!root || !attrs) return;
    if (plan) {
      root.setAttribute(attrs.FORMAT_VERSION, String(plan.formatVersion));
      root.setAttribute(attrs.PROJECT_ID, String(plan.project?.id || ""));
    } else {
      root.removeAttribute(attrs.FORMAT_VERSION);
      root.removeAttribute(attrs.PROJECT_ID);
    }
  };

  /** @param {Document} document @returns {Record<string, any>} */
  const schemaOf = (document) => {
    const block = document.querySelector('[data-part="schema"]');
    if (!block) throw new Error("index.html has no schema block");
    return JSON.parse(block.textContent || "{}");
  };

  /** @param {Record<string, any>} schema @param {string} entity */
  const definitionOf = (schema, entity) =>
    entity === "plan" ? schema : schema.$defs?.[entity];

  /**
   * @param {Record<string, any>} schema
   * @param {string} entity
   * @param {string} field
   * @returns {string | null}
   */
  const childEntityOf = (schema, entity, field) => {
    const definition = definitionOf(schema, entity);
    let property = definition?.properties?.[field];
    if (property?.type === "array") property = property.items;
    const reference = property?.$ref;
    return reference?.startsWith("#/$defs/")
      ? reference.slice("#/$defs/".length)
      : null;
  };

  /**
   * @param {Document} document
   * @param {Record<string, any>} schema
   * @param {string} entity
   * @param {Record<string, any>} value
   * @returns {Element}
   */
  const projectEntity = (document, schema, entity, value) => {
    const node = dom.instantiate(document, entity);
    dom.render(node, entity, value);
    const definition = definitionOf(schema, entity);
    if (!definition) throw new Error(`no schema entity "${entity}"`);

    for (const field of Object.keys(definition.properties || {})) {
      const childEntity = childEntityOf(schema, entity, field);
      if (!childEntity) continue;
      const child = dom.regionOf(node, field);
      if (!child) continue;
      const children = value[field];
      child.replaceChildren();
      if (Array.isArray(children)) {
        for (const item of children)
          child.append(projectEntity(document, schema, childEntity, item));
      } else if (children && typeof children === "object") {
        child.append(projectEntity(document, schema, childEntity, children));
      }
    }

    return node;
  };

  /**
   * @param {Element} root
   * @param {{read: () => Record<string, any>}} store
   * @returns {Element | null}
   */
  const project = (root, store) => {
    if (!root || typeof store?.read !== "function")
      throw new TypeError("project requires a DOM root and store.read()");

    for (const old of root.querySelectorAll('[data-anchor="plan"]'))
      old.remove();

    const plan = store.read();
    reflectIdentity(root.ownerDocument, plan);
    if (!plan) return null;
    const node = projectEntity(
      root.ownerDocument,
      schemaOf(root.ownerDocument),
      "plan",
      plan,
    );
    root.append(node);
    return node;
  };

  dom.project = project;
}
