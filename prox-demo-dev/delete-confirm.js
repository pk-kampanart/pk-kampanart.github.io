/**
 * Asks before a delete that takes more than its own row: a window naming what
 * else goes, with Cancel focused first and Escape cancelling. It resolves true
 * only when Delete is pressed; the delete itself stays with the caller.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {string} name */
  const templateNode = (name) => {
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector(`[data-part="${name}-template"]`)
    );
    return /** @type {Element | null} */ (
      template?.content.firstElementChild?.cloneNode(true) || null
    );
  };

  /** @param {number} count @param {string} noun */
  const counted = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

  /**
   * A delete asks only when something besides the row itself would go.
   * @param {AreaContents} contents
   */
  const needed = (contents) =>
    contents.groups + contents.deviceTypes + contents.devices > 0 ||
    Boolean(contents.image);

  /** @type {HTMLDialogElement | null} */
  let dialog = null;

  const mount = () => {
    const node = /** @type {HTMLDialogElement | null} */ (
      templateNode("delete-confirm")
    );
    if (!node) throw new TypeError("delete confirmation template is missing");
    document.body.append(node);
    return node;
  };

  /**
   * One row of what else goes. Its state picks the mark it shows.
   * @param {string} state @param {string} text
   */
  const row = (state, text) => {
    const node = templateNode("delete-confirm-row");
    if (!node) throw new TypeError("delete confirmation row is missing");
    node.setAttribute("data-state", state);
    node.querySelector('[data-part="delete-confirm-text"]')?.append(text);
    return node;
  };

  /** @param {AreaContents} contents */
  const rows = (contents) => {
    const list = [];
    if (contents.applications)
      list.push(
        row("applications", counted(contents.applications, "application")),
      );
    if (contents.groups) {
      const groups = row("groups", counted(contents.groups, "group"));
      // Up to three distinct colours, as many as the template declares dots:
      // what fits the mark, none repeated.
      const colors = [...new Set(contents.groupColors)];
      groups
        .querySelectorAll('[data-part="delete-confirm-dot"]')
        .forEach((dot, index) => {
          if (!(dot instanceof HTMLElement)) return;
          // Hidden here, not in the template: a snapshot drops hidden markup.
          dot.hidden = !colors[index];
          if (colors[index]) dot.style.setProperty("background", colors[index]);
        });
      list.push(groups);
    }
    if (contents.deviceTypes)
      list.push(
        row(
          "device-types",
          contents.devices
            ? `${counted(contents.deviceTypes, "device type")}, ${counted(contents.devices, "placed device")}`
            : counted(contents.deviceTypes, "device type"),
        ),
      );
    if (contents.image) {
      const image = row("image", "The floor plan image");
      image
        .querySelector('[data-part="delete-confirm-thumb"]')
        ?.setAttribute("src", contents.image);
      list.push(image);
    }
    return list;
  };

  /** @param {DeleteConfirmRequest} request @returns {Promise<boolean>} */
  const ask = (request) =>
    new Promise((resolve) => {
      dialog ||= mount();
      const box = dialog;
      box
        .querySelector('[data-part="delete-confirm-title"]')
        ?.replaceChildren(`Delete “${request.name}”?`);
      box
        .querySelector('[data-part="delete-confirm-losses"]')
        ?.replaceChildren(...rows(request.contents));
      box
        .querySelector('[data-part="delete-confirm-delete"]')
        ?.replaceChildren(`Delete ${request.noun}`);
      box.returnValue = "";
      box.addEventListener(
        "close",
        () => {
          const confirmed = box.returnValue === "delete";
          if (!confirmed) request.opener?.focus();
          resolve(confirmed);
        },
        { once: true },
      );
      box.showModal();
      /** @type {HTMLElement | null} */ (
        box.querySelector('[data-part="delete-confirm-cancel"]')
      )?.focus();
    });

  planner.deleteConfirm = Object.freeze({ needed, ask });
}
