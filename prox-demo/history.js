/**
 * Keeps the in-memory document history and its cursor.
 * Contributes history to Planner; it knows neither storage nor the DOM.
 * Channels: document -> history snapshots.
 */
{
  /** @param {unknown} value */
  const isDocument = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  /** @template T @param {T} value @returns {T} */
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /** @param {unknown} left @param {unknown} right */
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  /** @param {PlanDocument} initial */
  const create = (initial) => {
    if (!isDocument(initial))
      throw new TypeError("history requires an initial document");

    let current = clone(initial);
    /** @type {PlanDocument[]} */
    const past = [];
    /** @type {PlanDocument[]} */
    const future = [];
    /** @type {unknown} */
    let pendingTag = null;

    /** @param {PlanDocument} value */
    const checked = (value) => {
      if (!isDocument(value))
        throw new TypeError("history accepts only documents");
      return clone(value);
    };

    const read = () => clone(current);

    /** @param {PlanDocument} next @param {unknown} tag */
    const record = (next, tag = null) => {
      const snapshot = checked(next);
      if (same(snapshot, current)) return read();

      if (tag !== null && tag === pendingTag) {
        current = snapshot;
        return read();
      }

      past.push(current);
      current = snapshot;
      future.length = 0;
      pendingTag = tag;
      return read();
    };

    const undo = () => {
      const previous = past.pop();
      if (previous === undefined) return null;
      future.unshift(current);
      current = previous;
      pendingTag = null;
      return read();
    };

    const redo = () => {
      const next = future.shift();
      if (next === undefined) return null;
      past.push(current);
      current = next;
      pendingTag = null;
      return read();
    };

    /** @param {PlanDocument} next */
    const restore = (next) => {
      current = checked(next);
      pendingTag = null;
      return read();
    };

    return Object.freeze({
      read,
      record,
      undo,
      redo,
      restore,
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
    });
  };

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.history = Object.freeze({ create });
}
