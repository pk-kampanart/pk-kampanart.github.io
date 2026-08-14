/**
 * Owns a side panel's width and its splitter input: the workflow panel at the
 * start edge by default, or the Mesh pane at the end edge.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {PanelWidthOptions} options */
  const create = (options) => {
    if (!options?.root || !options.storage)
      throw new TypeError("panel width requires root and storage");
    const { root, workspace, splitter, panel, surface, storage } = options;
    const key = options.key || "mesh-planner:workflow-width";
    const property = options.property || "--workflow-width";
    const end = options.edge === "end";
    // Unstored, the panel keeps the width the stylesheet gave it.
    let width =
      Number(storage.getItem(key)) ||
      panel?.getBoundingClientRect().width ||
      320;
    // The stylesheet's px token is the one place the minimum is written down;
    // the splitter announces what it read.
    const minimumWidth =
      parseFloat(
        getComputedStyle(root).getPropertyValue(
          options.minimum || "--workflow-min-width",
        ),
      ) || 0;
    splitter?.setAttribute("aria-valuemin", String(minimumWidth));
    // Whatever the surface holds above its own minimum is what this panel may
    // take, whatever the other panel's width.
    const maximumWidth = () => {
      if (!panel || !surface) return 640;
      return Math.max(
        minimumWidth,
        panel.getBoundingClientRect().width +
          surface.getBoundingClientRect().width -
          (parseFloat(getComputedStyle(surface).minWidth) || 0),
      );
    };
    const applyWidth = (/** @type {number} */ value) => {
      width = Math.min(maximumWidth(), Math.max(minimumWidth, value));
      root.style.setProperty(property, `${width}px`);
      storage.setItem(key, String(width));
      splitter?.setAttribute("aria-valuemax", String(maximumWidth()));
      splitter?.setAttribute("aria-valuenow", String(Math.round(width)));
    };
    const widthAt = (/** @type {PointerEvent} */ event) => {
      const box = workspace?.getBoundingClientRect();
      return end
        ? (box?.right || 0) - event.clientX
        : event.clientX - (box?.left || 0);
    };
    applyWidth(width);
    let dragging = false;
    const onPointerDown = (/** @type {PointerEvent} */ event) => {
      dragging = true;
      splitter?.setPointerCapture(event.pointerId);
      applyWidth(widthAt(event));
    };
    const onPointerMove = (/** @type {PointerEvent} */ event) => {
      if (!dragging) return;
      applyWidth(widthAt(event));
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onPointerCancel = () => {
      dragging = false;
    };
    const onKeyDown = (/** @type {KeyboardEvent} */ event) => {
      // The arrow moves the splitter, so at the end edge it grows the panel
      // the other way.
      const step = (event.shiftKey ? 1 : 16) * (end ? -1 : 1);
      if (event.key === "Home") applyWidth(minimumWidth);
      else if (event.key === "End") applyWidth(maximumWidth());
      else if (event.key === "ArrowLeft") applyWidth(width - step);
      else if (event.key === "ArrowRight") applyWidth(width + step);
      else return;
      event.preventDefault();
    };
    if (splitter) {
      splitter.addEventListener("pointerdown", onPointerDown);
      splitter.addEventListener("pointermove", onPointerMove);
      splitter.addEventListener("pointerup", onPointerUp);
      splitter.addEventListener("pointercancel", onPointerCancel);
      splitter.addEventListener("keydown", onKeyDown);
    }

    return Object.freeze({
      disconnect: () => {
        splitter?.removeEventListener("pointerdown", onPointerDown);
        splitter?.removeEventListener("pointermove", onPointerMove);
        splitter?.removeEventListener("pointerup", onPointerUp);
        splitter?.removeEventListener("pointercancel", onPointerCancel);
        splitter?.removeEventListener("keydown", onKeyDown);
      },
    });
  };

  planner.panelWidth = Object.freeze({ create });
}
