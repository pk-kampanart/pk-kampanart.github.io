/**
 * Owns workflow panel width and its splitter input.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {PanelWidthOptions} options */
  const create = (options) => {
    if (!options?.root || !options.storage)
      throw new TypeError("panel width requires root and storage");
    const { root, workspace, splitter, storage } = options;
    const workflowWidthKey = "mesh-planner:workflow-width";
    let workflowWidth = Number(storage.getItem(workflowWidthKey)) || 320;
    // The splitter announces its own floor, so aria-valuemin in the markup is
    // the one place the minimum width is written down.
    const minimumWidth = Number(splitter?.getAttribute("aria-valuemin")) || 0;
    const maximumWidth = () => {
      if (!workspace || !splitter) return 640;
      return Math.max(
        minimumWidth,
        workspace.getBoundingClientRect().width -
          320 -
          splitter.getBoundingClientRect().width,
      );
    };
    const applyWidth = (/** @type {number} */ value) => {
      workflowWidth = Math.min(maximumWidth(), Math.max(minimumWidth, value));
      root.style.setProperty("--workflow-width", `${workflowWidth}px`);
      storage.setItem(workflowWidthKey, String(workflowWidth));
      splitter?.setAttribute("aria-valuemax", String(maximumWidth()));
      splitter?.setAttribute(
        "aria-valuenow",
        String(Math.round(workflowWidth)),
      );
    };
    applyWidth(workflowWidth);
    let dragging = false;
    const onPointerDown = (/** @type {PointerEvent} */ event) => {
      dragging = true;
      splitter?.setPointerCapture(event.pointerId);
      applyWidth(
        event.clientX - (workspace?.getBoundingClientRect().left || 0),
      );
    };
    const onPointerMove = (/** @type {PointerEvent} */ event) => {
      if (!dragging) return;
      applyWidth(
        event.clientX - (workspace?.getBoundingClientRect().left || 0),
      );
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onPointerCancel = () => {
      dragging = false;
    };
    const onKeyDown = (/** @type {KeyboardEvent} */ event) => {
      const step = event.shiftKey ? 1 : 16;
      if (event.key === "Home") applyWidth(minimumWidth);
      else if (event.key === "End") applyWidth(maximumWidth());
      else if (event.key === "ArrowLeft") applyWidth(workflowWidth - step);
      else if (event.key === "ArrowRight") applyWidth(workflowWidth + step);
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
