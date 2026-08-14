/**
 * Draws the active floor background and the four work-surface layers.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const extent = planner.geo.WORLD_EXTENT;

  /** @param {Element} element @param {string} token @param {boolean} on */
  const setState = (element, token, on) => {
    const tokens = new Set(
      (element.getAttribute("data-state") || "").split(/\s+/),
    );
    tokens.delete("");
    if (on) tokens.add(token);
    else tokens.delete(token);
    if (tokens.size) element.setAttribute("data-state", [...tokens].join(" "));
    else element.removeAttribute("data-state");
  };

  /** @param {{applications?: Application[]} | undefined} floor @returns {any[]} */
  const devicesOf = (floor) =>
    (floor?.applications || []).flatMap((application) =>
      (application.deviceTypes || []).flatMap((deviceType) =>
        (deviceType.instances || []).map((instance) => ({
          ...instance,
          deviceType,
        })),
      ),
    );

  /** @param {Group} group @param {any[]} devices @returns {any[]} */
  const groupDevices = (group, devices) =>
    group?.rect && planner.geo?.contains
      ? devices.filter((device) => planner.geo?.contains?.(group.rect, device))
      : [];

  /** @param {SVGSVGElement} surface @param {string} part @returns {Element | null} */
  const surfacePart = (surface, part) => {
    const template = /** @type {HTMLTemplateElement | null} */ (
      surface.ownerDocument.querySelector('[data-part="' + part + '-template"]')
    );
    const wrapper = template?.content.firstElementChild;
    return /** @type {Element | null} */ (
      wrapper?.firstElementChild?.cloneNode(true) || null
    );
  };

  /** @param {SurfaceRenderOptions} options */
  const create = (options) => {
    if (!options?.surface)
      throw new TypeError("surface render requires surface");

    const { surface } = options;

    /**
     * @param {PlanDocument} plan
     * @param {string | null} activeFloorId
     * @param {{kind: string, id: string} | null} [selection]
     */
    const render = (plan, activeFloorId, selection = null) => {
      setState(surface, "opacity-preview", false);
      surface.style.removeProperty("--surface-background-opacity");
      const floor = (plan.floors || []).find(
        (item) => item.id === activeFloorId,
      );
      const devices = devicesOf(floor);
      surface.setAttribute("data-active-floor", activeFloorId || "");
      surface.setAttribute("data-active-kind", selection?.kind || "");
      surface.setAttribute("data-active-entity", selection?.id || "");
      for (const layer of [
        "background-layer",
        "group-layer",
        "link-layer",
        "device-layer",
      ])
        surface.querySelector('[data-part="' + layer + '"]')?.replaceChildren();

      const backgroundLayer = surface.querySelector(
        '[data-part="background-layer"]',
      );
      if (backgroundLayer && floor?.background?.src) {
        const image = surfacePart(surface, "surface-background");
        if (image) {
          for (const [name, value] of Object.entries({
            x: extent.x,
            y: extent.y,
            width: extent.width,
            height: extent.height,
            preserveAspectRatio: "xMidYMid meet",
            href: floor.background.src,
          }))
            image.setAttribute(name, String(value));
          image.setAttribute(
            "opacity",
            String((floor.background.opacity ?? 100) / 100),
          );
          backgroundLayer.append(image);
        }
      }

      const groupLayer = surface.querySelector('[data-part="group-layer"]');
      for (const group of (floor?.applications || []).flatMap(
        (item) => item.groups || [],
      )) {
        if (!group.rect || !groupLayer) continue;
        const rect = surfacePart(surface, "surface-group");
        if (!rect) continue;
        const stroke = planner.groups.strokeOf(group);
        for (const [name, value] of Object.entries({
          x: group.rect.x,
          y: group.rect.y,
          width: group.rect.width,
          height: group.rect.height,
          fill: group.color,
          stroke: stroke.type === "none" ? "none" : stroke.color,
          "stroke-width": stroke.width,
          "stroke-opacity": stroke.opacity,
          "stroke-dasharray": stroke.dasharray,
          "stroke-linecap": stroke.linecap,
          "data-id": group.id,
          "data-kind": "group",
          role: "button",
          tabindex: "0",
          "aria-label":
            group.name +
            ", " +
            groupDevices(group, devices).length +
            " devices",
        }))
          rect.setAttribute(name, String(value));
        setState(
          rect,
          "selected",
          selection?.kind === "group" && selection.id === group.id,
        );
        groupLayer.append(rect);
      }

      const linkLayer = surface.querySelector('[data-part="link-layer"]');
      for (const group of (floor?.applications || []).flatMap(
        (item) => item.groups || [],
      )) {
        if (!group.rect || !linkLayer) continue;
        for (const device of groupDevices(group, devices)) {
          const line = surfacePart(surface, "surface-link");
          if (!line) continue;
          for (const [name, value] of Object.entries({
            x1: group.rect.x + group.rect.width / 2,
            y1: group.rect.y + group.rect.height / 2,
            x2: device.x,
            y2: device.y,
            "data-id": group.id + "-" + device.id,
          }))
            line.setAttribute(name, String(value));
          linkLayer.append(line);
        }
      }

      const deviceLayer = surface.querySelector('[data-part="device-layer"]');
      for (const device of devices) {
        if (!deviceLayer) continue;
        const circle = surfacePart(surface, "surface-device");
        if (!circle) continue;
        for (const [name, value] of Object.entries({
          cx: device.x,
          cy: device.y,
          "data-id": device.id,
          "data-kind": "device",
          "data-type-id": device.deviceType.id,
          role: "button",
          tabindex: "0",
          "aria-label":
            planner.devices.instanceName(plan, device.id) || "Device instance",
        }))
          circle.setAttribute(name, String(value));
        setState(
          circle,
          "selected",
          selection?.kind === "device" && selection.id === device.id,
        );
        setState(
          circle,
          "affinity",
          selection?.kind === "device-type" &&
            selection.id === device.deviceType.id,
        );
        deviceLayer.append(circle);
      }
    };

    return Object.freeze({ render });
  };

  planner.surfaceRender = Object.freeze({ create });
}
