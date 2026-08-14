/**
 * Draws the active floor background and the four work-surface layers.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const extent = planner.geo.WORLD_EXTENT;

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

  /** A halo arc of radius r between two angles, in degrees clockwise from
   * the top. @param {number} r @param {number} from @param {number} to */
  const arc = (r, from, to) => {
    /** @param {number} angle */
    const point = (angle) =>
      [
        r * Math.sin((angle * Math.PI) / 180),
        -r * Math.cos((angle * Math.PI) / 180),
      ]
        .map((value) => value.toFixed(2))
        .join(" ");
    return `M${point(from)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
  };

  const HANDLE_SIZE = 10;
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  /**
   * The square a resize handle draws, centred on its point of the rect.
   * @param {Rect} rect @param {string} handle @returns {Rect | undefined}
   */
  const handleBox = (rect, handle) => {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const middleX = rect.x + rect.width / 2;
    const middleY = rect.y + rect.height / 2;
    const point = {
      nw: { x: rect.x, y: rect.y },
      n: { x: middleX, y: rect.y },
      ne: { x: right, y: rect.y },
      e: { x: right, y: middleY },
      se: { x: right, y: bottom },
      s: { x: middleX, y: bottom },
      sw: { x: rect.x, y: bottom },
      w: { x: rect.x, y: middleY },
    }[handle];
    return point
      ? {
          x: point.x - HANDLE_SIZE / 2,
          y: point.y - HANDLE_SIZE / 2,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
        }
      : undefined;
  };

  /** @param {SurfaceRenderOptions} options */
  const create = (options) => {
    if (!options?.surface)
      throw new TypeError("surface render requires surface");

    const { surface } = options;
    /** @type {unknown[]} */
    let built = [];

    /**
     * @param {PlanDocument} plan
     * @param {string | null} activeFloorId
     * @param {{kind: string, id: string} | null} [selection]
     */
    const render = (plan, activeFloorId, selection = null) => {
      planner.dom.state(surface, "opacity-preview", false);
      surface.style.removeProperty("--surface-background-opacity");
      surface.setAttribute("data-active-floor", activeFloorId || "");
      surface.setAttribute("data-active-kind", selection?.kind || "");
      surface.setAttribute("data-active-entity", selection?.id || "");
      // Every subscriber renders on each commit. The store's snapshot is
      // frozen, so the same plan, floor and selection draw the same layers.
      const key = [
        plan,
        activeFloorId || "",
        selection?.kind || "",
        selection?.id || "",
      ];
      if (key.every((value, index) => value === built[index])) return;
      built = key;
      const floor = (plan.floors || []).find(
        (item) => item.id === activeFloorId,
      );
      const devices = devicesOf(floor);
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
      /** @type {Element[]} */
      const rects = [];
      // Handles go after every rectangle, so no later group paints over them.
      /** @type {Element[]} */
      const handles = [];
      for (const group of (floor?.applications || []).flatMap(
        (item) => item.groups || [],
      )) {
        if (!group.rect) continue;
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
          "data-group-color": group.color,
          // Whole units in the spoken name: a screen reader reading 118.4 by
          // 74.6 is noise, and the number here is a label, not a coordinate.
          "aria-label": `${group.name}, ${Math.round(group.rect.width)} by ${Math.round(group.rect.height)} at ${Math.round(group.rect.x)}, ${Math.round(group.rect.y)}`,
        }))
          rect.setAttribute(name, String(value));
        const selected =
          selection?.kind === "group" && selection.id === group.id;
        planner.dom.state(rect, "selected", selected);
        rects.push(rect);
        if (!selected) continue;
        for (const handle of HANDLES) {
          const element = surfacePart(surface, "surface-group-handle");
          const box = handleBox(group.rect, handle);
          if (!element || !box) continue;
          for (const [name, value] of Object.entries({
            ...box,
            "data-id": group.id,
            "data-handle": handle,
            "aria-label": `${handle} resize handle for ${group.name}`,
          }))
            element.setAttribute(name, String(value));
          handles.push(element);
        }
      }
      groupLayer?.append(...rects, ...handles);

      const linkLayer = surface.querySelector('[data-part="link-layer"]');
      const groups = new Map(
        (floor?.applications || [])
          .flatMap((item) => item.groups || [])
          .map((group) => [group.id, group]),
      );
      const placed = new Map(devices.map((device) => [device.id, device]));
      /** @type {Map<string, string[]>} */
      const halos = new Map();
      for (const link of planner.links.derive(plan)) {
        const group = groups.get(link.groupId);
        const device = placed.get(link.deviceId);
        // Both maps hold the active floor only, so a link elsewhere misses.
        if (!group?.rect || !device) continue;
        halos.set(device.id, [
          ...(halos.get(device.id) || []),
          planner.groups.strokeOf(group).color,
        ]);
        if (!linkLayer) continue;
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
        planner.dom.state(
          circle,
          "selected",
          selection?.kind === "device" && selection.id === device.id,
        );
        planner.dom.state(circle, "assigned", Boolean(device.assignment));
        planner.dom.state(
          circle,
          "affinity",
          selection?.kind === "device-type" &&
            selection.id === device.deviceType.id,
        );
        deviceLayer.append(circle);
        const look = surfacePart(surface, "surface-dot");
        if (!look) continue;
        look.setAttribute("data-id", device.id);
        look.setAttribute("transform", `translate(${device.x} ${device.y})`);
        // An unassigned dot keeps the grey ring whatever group it sits in.
        const colors = device.assignment ? halos.get(device.id) || [] : [];
        // Read the halo radius from the template so arcs stay aligned with it.
        const r = Number(
          look.querySelector('[data-part="dot-halo"]')?.getAttribute("r"),
        );
        look.querySelector('[data-part="dot-arcs"]')?.append(
          ...colors.flatMap((color, index) => {
            const path = surfacePart(surface, "surface-dot-arc");
            if (!path) return [];
            const span = 360 / colors.length;
            // One group is a whole ring, drawn as two halves: an arc cannot
            // end where it starts.
            path.setAttribute(
              "d",
              colors.length === 1
                ? arc(r, 0, 180) + arc(r, 180, 360)
                : arc(r, index * span, (index + 1) * span),
            );
            path.setAttribute("stroke", color);
            return [path];
          }),
        );
        deviceLayer.append(look);
      }
    };

    return Object.freeze({ render });
  };

  planner.surfaceRender = Object.freeze({ create, handleBox });
}
