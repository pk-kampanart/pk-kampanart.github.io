/**
 * Owns pure geometry over plan-document values. It does not read the DOM,
 * draw SVG, or dispatch events.
 * Channels: none.
 */
{
  /** @typedef {{x: number, y: number}} Point */
  /** @typedef {{x: number, y: number, width: number, height: number}} Rect */
  /** @typedef {{entity: Element, rect: Rect}} HitCandidate */

  const WORLD_EXTENT = Object.freeze({
    x: 0,
    y: 0,
    width: 1000,
    height: 700,
  });

  /** @param {Rect | null} rect @param {Point} point */
  const contains = (rect, point) =>
    Boolean(
      rect &&
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height,
    );

  /** @param {Rect | null} rect @param {Point[]} instances */
  const membersOf = (rect, instances) =>
    rect ? instances.filter((instance) => contains(rect, instance)) : [];

  /** @param {Point} point @param {HitCandidate[]} candidates */
  const hit = (point, candidates) => {
    let winner = null;
    let winnerArea = Infinity;
    for (const candidate of candidates) {
      if (!contains(candidate.rect, point)) continue;
      const area = candidate.rect.width * candidate.rect.height;
      if (area < winnerArea) {
        winner = candidate;
        winnerArea = area;
      }
    }
    return winner === null ? null : winner.entity;
  };

  /** @param {Rect} rect @returns {Rect} */
  const normalize = (rect) => ({
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  });

  /** @param {Rect} rect @param {Point} delta @returns {Rect} */
  const translate = (rect, delta) => ({
    x: rect.x + delta.x,
    y: rect.y + delta.y,
    width: rect.width,
    height: rect.height,
  });

  const HANDLES = new Set(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);

  /**
   * @param {Rect} rect
   * @param {string} handle
   * @param {Point} delta
   * @returns {Rect}
   */
  const resize = (rect, handle, delta) => {
    if (!HANDLES.has(handle))
      throw new RangeError(`unknown resize handle: ${handle}`);
    const next = { ...rect };
    if (handle.includes("w")) {
      next.x += delta.x;
      next.width -= delta.x;
    } else if (handle.includes("e")) {
      next.width += delta.x;
    }
    if (handle.includes("n")) {
      next.y += delta.y;
      next.height -= delta.y;
    } else if (handle.includes("s")) {
      next.height += delta.y;
    }
    return normalize(next);
  };

  /**
   * Rounds to the nearest multiple of `step`. A step of 0 or less is no grid,
   * so the value passes through (ADR-0035).
   * @param {number} value @param {number} [step]
   */
  const snap = (value, step = 1) =>
    step > 0 ? Math.round(value / step) * step : value;

  /** @param {Point} point @param {number} [step] @returns {Point} */
  const snapPoint = (point, step = 1) => ({
    x: snap(point.x, step),
    y: snap(point.y, step),
  });

  /**
   * One press is one cell: a value off the grid moves to the next line in the
   * direction of travel rather than across to the far side of it. A step of one
   * or less is no grid, so the delta applies as it stands.
   * @param {number} value @param {number} delta @param {number} step
   */
  const stepTo = (value, delta, step) => {
    if (delta === 0) return value;
    if (step <= 1) return value + delta;
    const cell = value / step;
    return delta > 0
      ? (Math.floor(cell) + 1) * step
      : (Math.ceil(cell) - 1) * step;
  };

  /**
   * A snapped rectangle keeps at least one cell, so a small drag on a coarse
   * grid draws the smallest thing the grid can express rather than nothing.
   * @param {Rect} rect @param {number} [step] @returns {Rect}
   */
  const snapRect = (rect, step = 1) => ({
    x: snap(rect.x, step),
    y: snap(rect.y, step),
    width: step > 0 ? Math.max(step, snap(rect.width, step)) : rect.width,
    height: step > 0 ? Math.max(step, snap(rect.height, step)) : rect.height,
  });

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.geo = Object.freeze({
    WORLD_EXTENT,
    contains,
    membersOf,
    hit,
    normalize,
    translate,
    resize,
    snap,
    snapPoint,
    snapRect,
    stepTo,
  });
}
