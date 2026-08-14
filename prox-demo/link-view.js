/**
 * Projects derived device links onto the tree and active floor surface.
 * Channels: none.
 */
{
  /** @typedef {{root: Element, surface: Element, store: any}} LinkViewOptions */
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {Element} surface */
  const linkTemplate = (surface) => {
    const template = /** @type {HTMLTemplateElement | null} */ (
      surface.ownerDocument.querySelector('[data-part="surface-link-template"]')
    );
    return /** @type {Element | null} */ (
      template?.content.firstElementChild?.firstElementChild?.cloneNode(true) ||
        null
    );
  };

  /** @param {Document} document @param {string} entity @param {string} field */
  const derivedAttribute = (document, entity, field) => {
    for (const template of document.querySelectorAll("template[data-entity]")) {
      if (template.getAttribute("data-entity") !== entity) continue;
      const slot = /** @type {HTMLTemplateElement} */ (
        template
      ).content.querySelector(`[data-slot="${field}"][data-slot-derived]`);
      const landing = slot?.getAttribute("data-slot-as") || "";
      if (landing.startsWith("attr:") && landing.length > 5)
        return landing.slice(5);
    }
    return null;
  };

  /** @param {LinkViewOptions} options */
  const create = (options) => {
    if (
      !options?.root ||
      !options.surface ||
      typeof options.store?.read !== "function"
    )
      throw new TypeError("link view requires root, surface, and store");

    const { root, surface, store } = options;
    const document = root.ownerDocument;
    const groupCountAttribute = derivedAttribute(
      document,
      "group",
      "deviceCount",
    );
    const containedGroupsAttribute = derivedAttribute(
      document,
      "deviceInstance",
      "containedGroups",
    );
    const render = () => {
      const plan = store.read();
      const derived = planner.links.derive(plan);
      const counts = new Map();
      const contained = new Map();
      for (const link of derived) {
        counts.set(link.groupId, (counts.get(link.groupId) || 0) + 1);
        const groups = contained.get(link.deviceId) || [];
        groups.push(link.groupId);
        contained.set(link.deviceId, groups);
      }
      for (const group of root.querySelectorAll('[data-anchor="group"]')) {
        const id = group.getAttribute("data-id") || "";
        const count = counts.get(id) || 0;
        if (groupCountAttribute)
          group.setAttribute(groupCountAttribute, String(count));
        const name =
          group
            .querySelector('[data-slot="name"][data-slot-as="text"]')
            ?.textContent?.trim() || id;
        const radio = group.querySelector('input[name="planner-selection"]');
        if (radio)
          radio.setAttribute(
            "aria-label",
            `Select group ${name}, ${count} devices`,
          );
      }
      if (containedGroupsAttribute)
        for (const device of root.querySelectorAll(
          '[data-anchor="deviceInstance"]',
        ))
          device.setAttribute(
            containedGroupsAttribute,
            (contained.get(device.getAttribute("data-id") || "") || []).join(
              " ",
            ),
          );

      const layer = surface.querySelector('[data-part="link-layer"]');
      if (!layer) return derived;
      layer.replaceChildren();
      const activeFloor =
        surface.getAttribute("data-active-floor") || plan.floors[0]?.id;
      const groups = new Map();
      const devices = new Map();
      for (const floor of plan.floors)
        for (const application of floor.applications) {
          for (const group of application.groups)
            groups.set(group.id, { ...group, floorId: floor.id });
          for (const type of application.deviceTypes)
            for (const instance of type.instances)
              devices.set(instance.id, { ...instance, floorId: floor.id });
        }
      for (const link of derived) {
        const group = groups.get(link.groupId);
        const device = devices.get(link.deviceId);
        if (
          !group ||
          !device ||
          group.floorId !== activeFloor ||
          device.floorId !== activeFloor ||
          !group.rect
        )
          continue;
        const line = linkTemplate(surface);
        if (!line) continue;
        for (const [name, value] of Object.entries({
          x1: group.rect.x + group.rect.width / 2,
          y1: group.rect.y + group.rect.height / 2,
          x2: device.x,
          y2: device.y,
          "data-id": `${group.id}-${device.id}`,
          "aria-hidden": "true",
        }))
          line.setAttribute(name, String(value));
        layer.append(line);
      }
      return derived;
    };

    render();
    return Object.freeze({ render });
  };

  planner.linkView = Object.freeze({ create });
}
