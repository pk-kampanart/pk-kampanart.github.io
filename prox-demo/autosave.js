/**
 * Owns the current plan snapshot and its queued persistence.
 * Contributes autosave to Planner; callers supply the storage boundary.
 * Channels: command -> document -> persistence.
 */
{
  /**
   * @typedef {{
   *   initial: PlanDocument,
   *   persist: (document: PlanDocument, savedAt: number) => unknown,
   *   clock?: () => number,
   *   onSaved?: (result: unknown, savedAt: number) => void,
   *   onError?: (error: unknown) => void,
   *   history?: {
   *     record: (document: PlanDocument, tag?: unknown) => unknown,
   *     undo: () => PlanDocument | null,
   *     redo: () => PlanDocument | null,
   *     restore: (document: PlanDocument) => unknown,
   *     canUndo?: () => boolean,
   *     canRedo?: () => boolean,
   *   },
   * }} AutosaveOptions
   */

  /**
   * Every reader shares the one snapshot, so it is frozen: a classic script
   * is sloppy mode, where a write into it is ignored rather than thrown.
   * @template T @param {T} value @returns {T}
   */
  const freeze = (value) => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value))
      return value;
    for (const member of Object.values(value)) freeze(member);
    return Object.freeze(value);
  };

  /** @template T @param {T} value @returns {T} */
  const snapshotOf = (value) => freeze(planner.codec.copy(value));

  /** @param {unknown} value */
  const isDocument = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  /** @param {AutosaveOptions} options */
  const create = (options) => {
    if (!options || !isDocument(options.initial))
      throw new TypeError("autosave requires an initial document");
    if (typeof options.persist !== "function")
      throw new TypeError("autosave requires persist(document, savedAt)");
    if (
      options.history &&
      (typeof options.history.record !== "function" ||
        typeof options.history.undo !== "function" ||
        typeof options.history.redo !== "function" ||
        typeof options.history.restore !== "function")
    )
      throw new TypeError("autosave history is incomplete");

    const clock = options.clock || Date.now;
    if (typeof clock !== "function")
      throw new TypeError("autosave clock must be a function");

    let current = snapshotOf(options.initial);
    /** @type {{document: PlanDocument, savedAt: number} | null} */
    let queued = null;
    /** @type {Promise<unknown> | null} */
    let writing = null;
    let scheduled = false;
    /** @type {unknown} */
    let failure = null;
    const listeners = new Set();

    const notify = () => {
      for (const listener of listeners) listener(current);
    };

    const pump = () => {
      scheduled = false;
      if (writing || !queued) return;

      const job = queued;
      queued = null;
      writing = Promise.resolve()
        // A persister may write into its argument; the snapshot is shared.
        .then(() =>
          options.persist(planner.codec.copy(job.document), job.savedAt),
        )
        .then((result) => {
          options.onSaved?.(result, job.savedAt);
          return result;
        })
        .catch((error) => {
          failure = error;
          try {
            options.onError?.(error);
          } catch (reportError) {
            failure = reportError;
          }
        })
        .finally(() => {
          writing = null;
          pump();
        });
    };

    const schedule = () => {
      queued = { document: current, savedAt: clock() };
      failure = null;
      if (scheduled) return;
      scheduled = true;
      Promise.resolve().then(pump);
    };

    const flush = async () => {
      while (scheduled || writing || queued) {
        if (scheduled) await Promise.resolve();
        if (writing) await writing;
        if (!writing && queued) pump();
      }
      if (failure !== null) {
        const error = failure;
        failure = null;
        throw error;
      }
    };

    /**
     * @param {PlanDocument} next
     * @param {{coalesce?: unknown}} [change]
     */
    const replace = (next, change = {}) => {
      if (!isDocument(next))
        throw new TypeError("autosave can replace only a document");
      const snapshot = snapshotOf(next);
      options.history?.record(snapshot, change.coalesce);
      current = snapshot;
      schedule();
      notify();
      return current;
    };

    const undo = () => {
      const snapshot = options.history?.undo();
      if (!snapshot) return null;
      current = freeze(snapshot);
      schedule();
      notify();
      return current;
    };

    const redo = () => {
      const snapshot = options.history?.redo();
      if (!snapshot) return null;
      current = freeze(snapshot);
      schedule();
      notify();
      return current;
    };

    /** @param {PlanDocument} next */
    const restore = (next) => {
      if (!isDocument(next))
        throw new TypeError("autosave can restore only a document");
      const snapshot = snapshotOf(next);
      options.history?.restore(snapshot);
      current = snapshot;
      schedule();
      notify();
      return current;
    };

    const read = () => current;
    const canUndo = () => Boolean(options.history?.canUndo?.());
    const canRedo = () => Boolean(options.history?.canRedo?.());
    /** @param {() => unknown} listener */
    const subscribe = (listener) => {
      if (typeof listener !== "function")
        throw new TypeError("autosave subscriber must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const save = () => {
      schedule();
      return flush();
    };

    return Object.freeze({
      read,
      replace,
      undo,
      redo,
      restore,
      canUndo,
      canRedo,
      subscribe,
      save,
      flush,
    });
  };

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.autosave = Object.freeze({ create });
}
