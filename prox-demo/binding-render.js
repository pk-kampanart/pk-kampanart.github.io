/**
 * Projects plan values onto declared template slots.
 * Contributes render, slotsOf, and regionOf to Planner.dom; it reads no
 * document state and listens to no channels.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  const dom =
    planner.dom || (planner.dom = /** @type {DomNamespace} */ ({}));

  const vocabulary = () =>
    /** @type {Record<string, string>} */ (dom.vocabulary);

  /** @param {unknown} value @returns {string} */
  const textOf = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    return JSON.stringify(value) ?? "";
  };

  /** @param {Record<string, unknown>} occurrence @param {string} path */
  const occurrenceValue = (occurrence, path) =>
    path
      .split(".")
      .reduce((/** @type {unknown} */ value, /** @type {string} */ key) => {
        if (value === null || typeof value !== "object") return undefined;
        return /** @type {Record<string, unknown>} */ (value)[key];
      }, /** @type {unknown} */ (occurrence));

  /** @param {string} pattern @param {Record<string, unknown>} occurrence */
  const interpolate = (pattern, occurrence) =>
    pattern.replace(/\{([\w.]+)\}/g, (_, path) =>
      textOf(occurrenceValue(occurrence, path)),
    );

  /** @param {Element} root @returns {Element[]} */
  const slotsOf = (root) => {
    const attrs = vocabulary();
    const found = [];
    /** @param {Element} node */
    const visit = (node) => {
      for (const child of node.children) {
        if (child.hasAttribute(attrs.ANCHOR)) continue;
        if (child.hasAttribute(attrs.SLOT)) found.push(child);
        visit(child);
      }
    };
    if (root.hasAttribute(attrs.SLOT)) found.push(root);
    visit(root);
    return found;
  };

  /**
   * @param {Element} element
   * @param {string} field
   * @param {unknown} value
   * @param {Record<string, unknown>} occurrence
   * @param {string} entity
   */
  const apply = (element, field, value, occurrence, entity) => {
    const attrs = vocabulary();
    const as = element.getAttribute(attrs.SLOT_AS) || "text";
    const pattern = element.getAttribute(attrs.SLOT_TEMPLATE);
    const presentation =
      pattern === null ? value : interpolate(pattern, occurrence);

    if (as === "text") {
      element.textContent = textOf(presentation);
    } else if (as === "value") {
      const text = textOf(value);
      /** @type {HTMLInputElement} */ (element).value = text;
      element.setAttribute("value", text);
    } else if (as === "checked") {
      const checked = Boolean(value);
      /** @type {HTMLInputElement} */ (element).checked = checked;
      if (checked) element.setAttribute("checked", "");
      else element.removeAttribute("checked");
    } else if (as === "pair") {
      const id = textOf(occurrence.id);
      const pair = `${entity}-${id}-${field}`;
      element.id = pair;
      const label = element.closest("label");
      if (label) label.htmlFor = pair;
    } else if (as.startsWith("attr:") && as.length > 5) {
      element.setAttribute(as.slice(5), textOf(presentation));
    } else if (as.startsWith("style:") && as.length > 6) {
      /** @type {HTMLElement} */ (element).style.setProperty(
        as.slice(6),
        textOf(presentation),
      );
    } else {
      throw new Error(`unknown data-slot-as: "${as}"`);
    }
  };

  /**
   * @param {Element} root
   * @param {string} entity
   * @param {Record<string, unknown>} value
   * @returns {Element}
   */
  const render = (root, entity, value) => {
    const attrs = vocabulary();
    if (
      root.hasAttribute(attrs.ANCHOR) &&
      Object.hasOwn(value, "id") &&
      value.id !== null &&
      value.id !== undefined
    )
      root.setAttribute(attrs.ID, textOf(value.id));
    else root.removeAttribute(attrs.ID);

    for (const element of slotsOf(root)) {
      const field = element.getAttribute(attrs.SLOT);
      if (field) apply(element, field, occurrenceValue(value, field), value, entity);
    }
    return root;
  };

  /** @param {Element} root @param {string} field @returns {Element | null} */
  const regionOf = (root, field) => {
    const attrs = vocabulary();
    if (root.getAttribute(attrs.REGION) === field) return root;
    /** @param {Element} node @returns {Element | null} */
    const visit = (node) => {
      for (const child of node.children) {
        if (child.hasAttribute(attrs.ANCHOR)) continue;
        if (child.getAttribute(attrs.REGION) === field) return child;
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(root);
  };

  dom.render = render;
  dom.slotsOf = slotsOf;
  dom.regionOf = regionOf;
}
