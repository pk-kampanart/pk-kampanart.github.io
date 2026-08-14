/**
 * Owns pure geometry over plan-document values. It does not read the DOM,
 * draw SVG, or dispatch events.
 * Channels: none.
 */
{
  /** @typedef {{x: number, y: number}} Point */
  /** @typedef {{x: number, y: number, width: number, height: number}} Rect */
  /** @typedef {{entity: Element, rect: Rect}} HitCandidate */

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

  /** @param {number} value */
  const snap = (value) => Math.round(value);

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.geo = Object.freeze({
    contains,
    membersOf,
    hit,
    normalize,
    translate,
    resize,
    snap,
  });
}
