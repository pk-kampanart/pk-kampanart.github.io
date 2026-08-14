/**
 * Turns DOM events into binding intents.
 * Contributes intentFrom and instantiate to Planner.dom; it reads declared
 * vocabulary only and listens to no channels.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  const dom =
    planner.dom || (planner.dom = /** @type {DomNamespace} */ ({}));
  const carriesInput = new Set(["value", "checked"]);

  const vocabulary = () =>
    /** @type {Record<string, string>} */ (dom.vocabulary);

  /** @param {Element} element @returns {Element | null} */
  const carrierIn = (element) => {
    const attrs = vocabulary();
    const candidates = [
      element,
      ...element.querySelectorAll(`[${attrs.SLOT}]`),
    ];
    return (
      candidates.find(
        (candidate) =>
          candidate.hasAttribute(attrs.SLOT) &&
          carriesInput.has(candidate.getAttribute(attrs.SLOT_AS) || ""),
      ) || null
    );
  };

  /** @param {Element} element @returns {unknown} */
  const valueOf = (element) => {
    const attrs = vocabulary();
    if (element.getAttribute(attrs.SLOT_AS) === "checked")
      return /** @type {HTMLInputElement} */ (element).checked;
    return (
      /** @type {HTMLInputElement} */ (element).value ??
      element.getAttribute("value") ??
      ""
    );
  };

  /**
   * @param {Event | {target: EventTarget | null}} event
   * @returns {{action: string | null, entity: string | null, id: string | null, value: unknown} | null}
   */
  const intentFrom = (event) => {
    const attrs = vocabulary();
    const target = /** @type {Element | null} */ (event.target);
    const control = target?.closest?.(`[${attrs.ACT}]`);
    if (!control) return null;
    const anchor = control.closest(`[${attrs.ANCHOR}]`);
    if (!anchor) return null;
    const carrier = carrierIn(control);
    return {
      action: control.getAttribute(attrs.ACT),
      entity: anchor.getAttribute(attrs.ANCHOR),
      id: anchor.getAttribute(attrs.ID),
      value: carrier ? valueOf(carrier) : undefined,
    };
  };

  /** @param {Document} document @param {string} entity @returns {Element} */
  const instantiate = (document, entity) => {
    const attrs = vocabulary();
    for (const template of /** @type {NodeListOf<HTMLTemplateElement>} */ (
      document.querySelectorAll("template[data-entity]")
    )) {
      if (template.getAttribute(attrs.ENTITY) !== entity) continue;
      const root = template.content.firstElementChild;
      if (root) return /** @type {Element} */ (root.cloneNode(true));
    }
    throw new Error(`no template declares data-entity="${entity}"`);
  };

  dom.intentFrom = intentFrom;
  dom.instantiate = instantiate;
}
