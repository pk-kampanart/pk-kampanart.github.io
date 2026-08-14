/**
 * Owns the current plan snapshot and its queued persistence.
 * Contributes autosave to Planner; callers supply the storage boundary.
 * Channels: command -> document -> persistence.
 */
{
  /**
   * @typedef {{
   *   initial: Record<string, any>,
   *   persist: (document: Record<string, any>, savedAt: number) => unknown,
   *   clock?: () => number,
   *   onSaved?: (result: unknown, savedAt: number) => void,
   *   onError?: (error: unknown) => void,
   *   history?: {
   *     record: (document: Record<string, any>, tag?: unknown) => unknown,
   *     undo: () => Record<string, any> | null,
   *     redo: () => Record<string, any> | null,
   *     restore: (document: Record<string, any>) => unknown,
   *     canUndo?: () => boolean,
   *     canRedo?: () => boolean,
   *   },
   * }} AutosaveOptions
   */

  /** @param {unknown} value */
  const clone = (value) => JSON.parse(JSON.stringify(value));

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

    let current = clone(options.initial);
    /** @type {{document: Record<string, any>, savedAt: number} | null} */
    let queued = null;
    /** @type {Promise<unknown> | null} */
    let writing = null;
    let scheduled = false;
    /** @type {unknown} */
    let failure = null;
    const listeners = new Set();

    const notify = () => {
      for (const listener of listeners) listener(read());
    };

    const pump = () => {
      scheduled = false;
      if (writing || !queued) return;

      const job = queued;
      queued = null;
      writing = Promise.resolve()
        .then(() => options.persist(clone(job.document), job.savedAt))
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
      queued = { document: clone(current), savedAt: clock() };
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
     * @param {Record<string, any>} next
     * @param {{coalesce?: unknown}} [change]
     */
    const replace = (next, change = {}) => {
      if (!isDocument(next))
        throw new TypeError("autosave can replace only a document");
      const snapshot = clone(next);
      options.history?.record(snapshot, change.coalesce);
      current = snapshot;
      schedule();
      notify();
      return clone(current);
    };

    const undo = () => {
      const snapshot = options.history?.undo();
      if (!snapshot) return null;
      current = clone(snapshot);
      schedule();
      notify();
      return clone(current);
    };

    const redo = () => {
      const snapshot = options.history?.redo();
      if (!snapshot) return null;
      current = clone(snapshot);
      schedule();
      notify();
      return clone(current);
    };

    /** @param {Record<string, any>} next */
    const restore = (next) => {
      if (!isDocument(next))
        throw new TypeError("autosave can restore only a document");
      const snapshot = clone(next);
      options.history?.restore(snapshot);
      current = snapshot;
      schedule();
      notify();
      return clone(current);
    };

    const read = () => clone(current);
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

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.autosave = Object.freeze({ create });
}
