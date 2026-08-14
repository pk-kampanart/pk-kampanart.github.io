/**
 * Owns browser-local project records and the last-open pointer.
 * Contributes db to Planner; plan validation and document ownership belong to
 * the codec and store rails.
 * Channels: none; callers decide when to open, save, or delete a project.
 */
{
  const DB_NAME = "mesh-planner";
  const DB_VERSION = 1;
  const PROJECTS = "projects";
  const LAST_PROJECT_KEY = "mesh-planner:last-project-id";

  /** @type {IDBDatabase | null} */
  let database = null;
  /** @type {Promise<IDBDatabase> | null} */
  let databasePromise = null;

  /** @param {unknown} error @returns {Error} */
  const asError = (error) =>
    error instanceof Error ? error : new Error(String(error));

  /** @returns {Promise<IDBDatabase>} */
  const openDatabase = () => {
    if (database) return Promise.resolve(database);
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(asError(error));
        return;
      }

      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(PROJECTS, {
          keyPath: "id",
        });
        store.createIndex("updatedAt", "updatedAt");
      };
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => database?.close();
        resolve(database);
      };
      request.onerror = () =>
        reject(
          asError(request.error || new Error("cannot open project database")),
        );
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });

    return databasePromise;
  };

  /**
   * @param {IDBTransactionMode} mode
   * @param {(store: IDBObjectStore) => unknown} operation
   * @returns {Promise<unknown>}
   */
  const transact = (mode, operation) =>
    openDatabase().then(
      (db) =>
        new Promise((resolve, reject) => {
          let transaction;
          let result;
          try {
            transaction = db.transaction(PROJECTS, mode);
            result = operation(transaction.objectStore(PROJECTS));
          } catch (error) {
            reject(asError(error));
            return;
          }
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () =>
            reject(
              asError(
                transaction.error || new Error("project transaction failed"),
              ),
            );
          transaction.onabort = () =>
            reject(
              asError(
                transaction.error || new Error("project transaction aborted"),
              ),
            );
        }),
    );

  /** @param {IDBRequest} request @returns {Promise<unknown>} */
  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(asError(request.error || new Error("project request failed")));
    });

  /** @param {unknown} record @returns {Record<string, unknown>} */
  const checkedRecord = (record) => {
    if (!record || typeof record !== "object" || Array.isArray(record))
      throw new TypeError("project record must be an object");
    const value = /** @type {Record<string, unknown>} */ (record);
    if (typeof value.id !== "string" || value.id.length === 0)
      throw new TypeError("project record requires a non-empty id");
    return value;
  };

  /** @returns {string} */
  const createId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  /** @param {Record<string, unknown>} record @returns {Promise<Record<string, unknown>>} */
  const putProject = (record) => {
    try {
      checkedRecord(record);
    } catch (error) {
      return Promise.reject(asError(error));
    }
    return /** @type {Promise<Record<string, unknown>>} */ (
      transact("readwrite", (store) => {
        store.put(record);
        return record;
      })
    );
  };

  /** @param {string} id @returns {Promise<Record<string, unknown> | null>} */
  const getProject = (id) =>
    /** @type {Promise<Record<string, unknown> | null>} */ (
      transact("readonly", (store) => requestResult(store.get(id)))
    ).then((record) => record || null);

  /** @param {string} id @returns {Promise<void>} */
  const deleteProject = (id) =>
    transact("readwrite", (store) => {
      store.delete(id);
    }).then(() => undefined);

  /** @returns {Promise<Record<string, unknown>[]>} */
  const getAllProjects = () =>
    /** @type {Promise<Record<string, unknown>[]>} */ (
      transact("readonly", (store) => requestResult(store.getAll()))
    ).then((projects) =>
      projects.sort(
        (a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) ||
          String(b.id).localeCompare(String(a.id)),
      ),
    );

  /** @param {string | Record<string, unknown>} nameOrRecord @param {unknown} [payload] */
  const createProject = (nameOrRecord, payload) => {
    const input = /** @type {Record<string, any> | null} */ (
      typeof nameOrRecord === "string"
        ? { name: nameOrRecord, payload }
        : nameOrRecord
    );
    if (!input || typeof input.name !== "string" || input.name.trim() === "")
      return Promise.reject(new TypeError("project requires a non-empty name"));
    const now = new Date().toISOString();
    const record = {
      ...input,
      id: input.id || createId(),
      name: input.name,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
      formatVersion:
        input.formatVersion ||
        (input.payload && typeof input.payload === "object"
          ? input.payload.formatVersion
          : null) ||
        null,
      payload: Object.hasOwn(input, "payload") ? input.payload : null,
    };
    return putProject(record).then(() => record);
  };

  /** @returns {Promise<string>} */
  const defaultProjectName = () =>
    getAllProjects().then((projects) => {
      const names = new Set(projects.map((project) => project.name));
      let name = "Untitled Project";
      let suffix = 2;
      while (names.has(name)) {
        name = `Untitled Project ${suffix}`;
        suffix += 1;
      }
      return name;
    });

  /** @param {string} key @returns {string | null} */
  const readLocal = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  /** @param {string} key @param {string} value */
  const writeLocal = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Browser storage can be unavailable; the pointer is best-effort.
    }
  };

  const db = {
    createId,
    putProject,
    getProject,
    getAllProjects,
    deleteProject,
    createProject,
    defaultProjectName,
    getLastProjectId: () => readLocal(LAST_PROJECT_KEY),
    /** @param {string} id */
    setLastProjectId: (id) => writeLocal(LAST_PROJECT_KEY, id),
    clearLastProjectId: () => writeLocal(LAST_PROJECT_KEY, ""),
  };

  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.db = Object.freeze(db);
}
