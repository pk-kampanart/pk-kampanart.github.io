/**
 * Simulates Mesh devices for locally seeded projects, without reaching hardware.
 * It may fetch catalog and presets, persist fake state, and simulate Mesh behavior.
 * Ships as Demo mode under ADR-0013; this fake is unavailable for real projects.
 * ?mesh-pace speeds delays, ?mesh-capabilities narrows capabilities, and
 * ?mesh-restore=refuse rejects network restores.
 * Channels: serves the mesh sandbox factory and events to the Mesh pane.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const meshSig = planner.meshSig;
  if (!meshSig) throw new Error("Sandbox SIG rules are unavailable");
  const params = new URLSearchParams(location.search);
  const PACE = Number(params.get("mesh-pace")) || 1;
  const STEP_MS = 600 / PACE;
  const SCAN_MS = 5000 / PACE;
  const ATTENTION_MS = 5000 / PACE;
  const FAIL_FLASH_MS = 1500 / PACE;
  const BLINK_MS = 400 / PACE;
  const PRESETS = "dev/sandbox-presets/";
  const NODES_KEY = "mesh-planner:fake-nodes";
  const RECORD_KEY = "mesh-planner:fake-record";
  const BACKUP_KEY = "mesh-planner:fake-backup";
  const SANDBOX_KEY = "mesh-planner:sandbox";
  const MIGRATION_KEY = "mesh-planner:fake-area-storage";
  const STEPS = ["provision", "read", "appkey", "bind"];
  const ADD_STEPS = new Set(STEPS);

  /** @param {string} key @param {string} project @param {string} [area] */
  const networkKey = (key, project, area) =>
    `${key}:${JSON.stringify(area === undefined ? [project] : [project, area])}`;
  /** @param {Storage} storage @param {(key: string) => boolean} remove */
  const removeFakeStorage = (storage, remove) => {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key !== null && remove(key)) storage.removeItem(key);
    }
  };
  /** @param {string} project @param {string} [area] */
  const removeNetworkStorage = (project, area) => {
    const prefixes = area
      ? [
          networkKey(NODES_KEY, project, area),
          networkKey(RECORD_KEY, project, area),
          networkKey(SANDBOX_KEY, project, area),
        ]
      : [NODES_KEY, RECORD_KEY, SANDBOX_KEY].map(
          (key) => `${key}:["${project}",`,
        );
    for (const storage of [localStorage, sessionStorage])
      removeFakeStorage(storage, (key) =>
        prefixes.some((prefix) => key.startsWith(prefix)),
      );
  };
  /** @param {string} project */
  const removeLegacyProjectStorage = (project) => {
    const keys = new Set([
      `${SANDBOX_KEY}:${project}`,
      `${NODES_KEY}:${project}`,
      `${RECORD_KEY}:${project}`,
      `${BACKUP_KEY}:${project}`,
      `${MIGRATION_KEY}:${project}`,
    ]);
    for (const storage of [localStorage, sessionStorage])
      removeFakeStorage(storage, (key) => keys.has(key));
  };
  /** @param {number} ms */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** @param {number} value */
  const hex4 = (value) => value.toString(16).toUpperCase().padStart(4, "0");
  // Bytes are already MSB-first; never reverse the generated MAC.
  const randomBytes = (count) =>
    Array.from(crypto.getRandomValues(new Uint8Array(count)), (byte) =>
      byte.toString(16).padStart(2, "0").toUpperCase(),
    );
  const randomHex = () => randomBytes(16).join("");

  /** @typedef {{companyId?: string, productId?: string, versionId?: string | null, features: string, crpl?: string, elements: {models: {id: string}[]}[]}} Composition */
  /** @typedef {{id: string, sku?: string, composition?: Composition, mac: string, name: string, scan?: number[], reset?: boolean, unreachable?: boolean, attention?: boolean, failStep?: MeshAddStep, failWrites?: string[]}} SandboxDevice */
  // reset means unprovisioned and beaconing; Factory reset and Remove set it.
  /** @typedef {{version: 1, preset?: string, loaded?: string, devices: SandboxDevice[], rssi: Record<string, {avg: number, min: number, max: number, secondsSinceLastTx?: number} | {status: Exclude<MeshRssiStatus, "success">}>, vary?: boolean}} SandboxState */
  // preset names what was last loaded; loaded is its devices and RSSI as
  // loaded, so the page can tell an edited sandbox from the preset.
  /** @typedef {{sku: string, family: string, elements: string[], companyId: string, productId: string, versionId: string, features: string, crpl: string, temperatureRange?: {min: number, max: number}}} CatalogProduct */
  /** @typedef {{name: string, role: string, shopUrl: string, image: string}} CatalogFamily */
  /** @type {Promise<{products: CatalogProduct[], families: Record<string, CatalogFamily>, elementTemplates: Record<string, {models: string[]}>, sig: {models: Record<string, {states?: Record<string, {min: number, max: number}>}>}}> | null} */
  let catalogFile = null;
  /** @type {CatalogProduct[] | null} */
  let catalogProducts = null;
  /** @type {Record<string, {models: string[]}> | null} */
  let catalogTemplates = null;
  const catalog = () =>
    (catalogFile ??= (async () => {
      const embedded = planner.embeddedFiles?.text("dev/catalog/catalog.json");
      const file =
        embedded === null || embedded === undefined
          ? await fetch("dev/catalog/catalog.json").then((response) => {
              if (!response.ok)
                throw new Error("Device catalog is unavailable");
              return response.json();
            })
          : JSON.parse(embedded);
      catalogProducts = file.products;
      catalogTemplates = file.elementTemplates;
      return file;
    })().catch((error) => {
      catalogFile = null;
      catalogProducts = null;
      catalogTemplates = null;
      throw error;
    }));

  const presetFile = async (file) => {
    const path = `${PRESETS}${file}`;
    const embedded = planner.embeddedFiles?.text(path);
    if (embedded !== null && embedded !== undefined)
      return JSON.parse(embedded);
    const response = await fetch(path);
    if (!response.ok) throw new Error("Sandbox preset is unavailable");
    return response.json();
  };

  const plain = (entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry);
  /** @type {Exclude<MeshRssiStatus, "success">[]} */
  const RSSI_STATUSES = planner.meshRssi.statuses.filter(
    (status) => status !== "success",
  );
  const rssiPair = (pair, ids) => {
    const match = /^([0-9a-f]{32})>([0-9a-f]{32})$/i.exec(pair);
    if (
      !match ||
      !ids.has(match[1].toUpperCase()) ||
      !ids.has(match[2].toUpperCase())
    )
      throw new Error("RSSI needs two device IDs from this sandbox");
    return `${match[1].toUpperCase()}>${match[2].toUpperCase()}`;
  };
  const validRssiEntry = (pair, entry, ids) => {
    const key = rssiPair(pair, ids);
    if (
      !plain(entry) ||
      !("status" in entry
        ? RSSI_STATUSES.includes(entry.status)
        : [entry.avg, entry.min, entry.max].every(Number.isFinite) &&
          (entry.secondsSinceLastTx === undefined ||
            Number.isFinite(entry.secondsSinceLastTx)))
    )
      throw new Error("RSSI needs a valid status or numeric avg, min and max");
    return { key, entry: { ...entry } };
  };

  /** @param {unknown} value */
  const validPreset = (value) => {
    const object = /** @type {any} */ (value);
    if (
      !plain(object) ||
      typeof object.preset !== "string" ||
      !object.preset.trim()
    )
      throw new Error("Preset needs a name");
    if (!Array.isArray(object.devices))
      throw new Error("Preset needs a devices list");
    const ids = new Set();
    const macs = new Set();
    for (const device of object.devices) {
      if (
        !plain(device) ||
        typeof device.id !== "string" ||
        !/^[0-9a-f]{32}$/i.test(device.id)
      )
        throw new Error("Each device needs a unique 32-digit hex id");
      device.id = device.id.toUpperCase();
      if (ids.has(device.id))
        throw new Error("Each device needs a unique 32-digit hex id");
      ids.add(device.id);
      if (
        typeof device.mac !== "string" ||
        !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(device.mac)
      )
        throw new Error(
          "Each device needs a unique MAC like AA:BB:CC:DD:EE:FF",
        );
      device.mac = device.mac.toUpperCase();
      if (macs.has(device.mac))
        throw new Error(
          "Each device needs a unique MAC like AA:BB:CC:DD:EE:FF",
        );
      macs.add(device.mac);
      if (typeof device.name !== "string")
        throw new Error("Each device needs a name");
      if (device.reset !== undefined && typeof device.reset !== "boolean")
        throw new Error("Device reset must be a boolean");
      if (
        device.unreachable !== undefined &&
        typeof device.unreachable !== "boolean"
      )
        throw new Error("Device unreachable must be a boolean");
      if (
        device.attention !== undefined &&
        typeof device.attention !== "boolean"
      )
        throw new Error("Device attention must be a boolean");
      if (device.failStep !== undefined && !ADD_STEPS.has(device.failStep))
        throw new Error(
          "Device failStep must be provision, read, appkey or bind",
        );
      if (
        device.failWrites !== undefined &&
        (!Array.isArray(device.failWrites) ||
          !device.failWrites.every(
            (entry) =>
              typeof entry === "string" &&
              /^(0|[1-9][0-9]*)\/([0-9a-f]{4}([0-9a-f]{4})?)$/i.test(entry),
          ))
      )
        throw new Error(
          "Device failWrites entries must be <elementIndex>/<MODELID>",
        );
      if (device.failWrites !== undefined) {
        const skuProduct = device.sku
          ? catalogProducts?.find((product) => product.sku === device.sku)
          : undefined;
        const composition =
          device.composition ||
          (skuProduct &&
            catalogTemplates &&
            meshSig.composition(skuProduct, catalogTemplates));
        for (const entry of device.failWrites) {
          const [index, model] = entry.split("/");
          if (!Number.isSafeInteger(Number(index)))
            throw new Error(
              "Device failWrites element index must be a safe integer",
            );
          if (
            composition &&
            !composition.elements[Number(index)]?.models.some(
              (candidate) => candidate.id.toUpperCase() === model.toUpperCase(),
            )
          )
            throw new Error(
              "Device failWrites must name a model on its element",
            );
        }
        device.failWrites = device.failWrites.map((entry) => {
          const [index, model] = entry.split("/");
          return `${index}/${model.toUpperCase()}`;
        });
      }
      if (
        device.sku !== undefined &&
        (typeof device.sku !== "string" || !device.sku)
      )
        throw new Error("Device SKU must be a name");
      if (device.composition !== undefined) {
        const composition = device.composition;
        if (
          !plain(composition) ||
          !/^[0-9a-f]{4}$/i.test(composition.features) ||
          !Array.isArray(composition.elements) ||
          !composition.elements.length ||
          !composition.elements.every(
            (element) =>
              plain(element) &&
              Array.isArray(element.models) &&
              element.models.every(
                (model) =>
                  plain(model) &&
                  typeof model.id === "string" &&
                  /^[0-9a-f]{4}([0-9a-f]{4})?$/i.test(model.id),
              ),
          )
        )
          throw new Error("Device composition needs elements with model ids");
        for (const element of composition.elements)
          for (const model of element.models) model.id = model.id.toUpperCase();
        if (
          ["companyId", "productId"].some(
            (field) =>
              composition[field] !== undefined &&
              !/^[0-9a-f]{4}$/i.test(composition[field]),
          ) ||
          (composition.versionId != null &&
            !/^[0-9a-f]{4}$/i.test(composition.versionId)) ||
          (composition.crpl != null && !/^[0-9a-f]{4}$/i.test(composition.crpl))
        )
          throw new Error("Device composition has invalid product ids");
      }
      if (!device.sku && !device.composition)
        throw new Error("Each device needs a SKU or composition");
      if (
        device.scan !== undefined &&
        (!Array.isArray(device.scan) ||
          !device.scan.length ||
          !device.scan.every(Number.isFinite))
      )
        throw new Error("Scan signals must be a list of numbers");
    }
    if (!plain(object.rssi)) throw new Error("Preset needs RSSI records");
    const rssi = {};
    for (const [pair, entry] of Object.entries(object.rssi)) {
      const normalized = validRssiEntry(pair, entry, ids);
      if (Object.hasOwn(rssi, normalized.key))
        throw new Error("RSSI records need unique device pairs");
      rssi[normalized.key] = normalized.entry;
    }
    object.rssi = rssi;
    if (object.vary !== undefined && typeof object.vary !== "boolean")
      throw new Error("Preset vary must be a boolean");
    return /** @type {{preset: string, devices: SandboxDevice[], rssi: SandboxState["rssi"], vary?: boolean}} */ (
      object
    );
  };
  /** @param {string} json */
  const parsePreset = (json) => {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("Preset is not valid JSON");
    }
    return validPreset(parsed);
  };
  /** JSON with sorted keys, so equal values compare equal. @param {unknown} value @returns {string} */
  const canonical = (value) =>
    JSON.stringify(value, (_, entry) =>
      plain(entry)
        ? Object.fromEntries(
            Object.keys(entry)
              .sort()
              .map((key) => [key, entry[key]]),
          )
        : entry,
    );
  /** What a preset load fixes and an edit changes: not the reset a
   * provision or Factory reset sets, and an unset switch equals false.
   * @param {{devices: SandboxDevice[], rssi: SandboxState["rssi"], vary?: boolean}} value */
  const fingerprint = ({ devices, rssi, vary }) =>
    canonical({
      devices: devices.map((device) =>
        Object.fromEntries(
          Object.entries(device)
            .filter(([key, entry]) => key !== "reset" && entry !== false)
            .map(([key, entry]) => [
              key,
              key === "failWrites" ? [...entry].sort() : entry,
            ]),
        ),
      ),
      rssi,
      vary: Boolean(vary),
    });
  /** @param {{preset: string, devices: SandboxDevice[], rssi: SandboxState["rssi"], vary?: boolean}} preset @returns {SandboxState} */
  const loadedState = (preset) => {
    /** @type {SandboxState} */
    const next = JSON.parse(
      JSON.stringify({
        version: 1,
        preset: preset.preset,
        devices: preset.devices,
        rssi: preset.rssi,
        ...(preset.vary === undefined ? {} : { vary: preset.vary }),
      }),
    );
    next.loaded = fingerprint(next);
    return next;
  };
  // Every dev page may check a preset, with or without the sandbox engine.
  planner.meshSandboxPreset = Object.freeze({
    /** @param {string} json */
    check: async (json) => {
      await catalog();
      parsePreset(json);
    },
  });

  /** @param {string} project @param {string} area @returns {number} */
  const networkNodes = (project, area) =>
    JSON.parse(
      sessionStorage.getItem(networkKey(NODES_KEY, project, area)) || "[]",
    ).length;
  /** Deletes one Area's simulated network. @param {string} project @param {string} area */
  const forgetArea = (project, area) => removeNetworkStorage(project, area);
  /** Deletes every Area network and legacy project-keyed fake state.
   * @param {string} project */
  const forgetProject = (project) => {
    removeNetworkStorage(project);
    removeLegacyProjectStorage(project);
  };
  /** @param {{project: () => string, area: () => string, areas: () => {id: string, name: string}[], areaIds?: AreaIdRegistry}} options */
  const create = (options) => {
    const clearLegacyProjectStorage = (project) => {
      const migrated = `${MIGRATION_KEY}:${project}`;
      if (localStorage.getItem(migrated) === "1") return;
      removeLegacyProjectStorage(project);
      localStorage.setItem(migrated, "1");
    };
    clearLegacyProjectStorage(options.project());
    const areaIds =
      options.areaIds ||
      window.Planner.areaIds.create({ storage: localStorage });
    areaIds.rememberArea(options.project(), options.area());
    const events = new EventTarget();
    /** @param {string} type @param {unknown} [detail] */
    const emit = (type, detail) =>
      events.dispatchEvent(new CustomEvent(type, { detail }));
    /** @param {string} text */
    const log = (text) => emit("log", { text });

    /** @type {ReturnType<typeof setInterval> | undefined} */
    let scanning;
    let scanGeneration = 0;
    let tick = 0;
    /** @type {{id: string, index: number, unicast: string} | null} */
    let current = null;
    let adding = false;
    let connected = false;
    /** @type {MeshTransport} */
    let connectedOver = "gatt";
    const CLIENT_UNICAST = "0001";
    /** @type {{type: "accept" | "reject", addresses: string[]}} */
    let proxyFilter = { type: "accept", addresses: [] };
    /** @param {{address: string, [key: string]: unknown}} detail */
    const emitState = (detail) => {
      if (
        !meshSig.proxyAllows(
          proxyFilter.type,
          proxyFilter.addresses,
          CLIENT_UNICAST,
        )
      )
        return false;
      emit("state", detail);
      return true;
    };
    const boundStates = new Map();
    const temperatures = new Map();
    const reportBoundState = (address, change, reported = {}) => {
      const next = meshSig.bindState(
        boundStates.get(address) || { lightness: 0, last: 0xffff },
        change,
      );
      if (
        emitState({
          address,
          on: next.on,
          lightness: Math.round((next.lightness * 100) / 0xffff),
          ...reported,
        })
      ) {
        boundStates.set(address, next);
        const node = stored().find((entry) =>
          entry.elements.some((element) => element.address === address),
        );
        if (node) emitDeviceStatus(node.id);
      }
    };
    const stateKey = () =>
      networkKey(SANDBOX_KEY, options.project(), options.area());
    const sessionKey = (key, area = options.area()) =>
      networkKey(key, options.project(), area);
    const projectSessionKey = (key) => `${key}:${options.project()}`;
    /** @param {string} [area] @returns {MeshNode[]} */
    const stored = (area = options.area()) =>
      JSON.parse(sessionStorage.getItem(sessionKey(NODES_KEY, area)) || "[]");
    const sandboxEvents = new EventTarget();
    const publish = () => sandboxEvents.dispatchEvent(new Event("change"));
    /** @param {string} address */
    const proxyAddress = (address) => {
      if (typeof address !== "string" || !/^[0-9a-f]{4}$/i.test(address))
        throw new Error(
          "Proxy addresses must be four-digit hexadecimal values",
        );
      return address.toUpperCase();
    };
    /** @type {SandboxState | null} */
    let stateCache = null;
    let cacheKey = "";
    /** @type {Promise<void> | null} */
    let loadingPreset = null;
    const state = () => {
      const key = stateKey();
      const saved = localStorage.getItem(key);
      if (key !== cacheKey || (saved === null && loadingPreset === null)) {
        const switched = cacheKey !== "" && key !== cacheKey;
        if (switched) clearLedTimers();
        cacheKey = key;
        stateCache = { version: 1, devices: [], rssi: {} };
        if (saved !== null) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed?.version !== 1)
              throw new Error("Saved sandbox state has an unsupported version");
            const preset = validPreset({ ...parsed, preset: "saved" });
            stateCache = {
              version: 1,
              ...(typeof parsed.preset === "string"
                ? { preset: parsed.preset }
                : {}),
              ...(typeof parsed.loaded === "string"
                ? { loaded: parsed.loaded }
                : {}),
              devices: preset.devices,
              rssi: preset.rssi,
              ...(preset.vary === undefined ? {} : { vary: preset.vary }),
            };
          } catch (error) {
            console.error(
              "Saved sandbox state could not load; reseeding from the test rig",
              error,
            );
            localStorage.removeItem(key);
          }
        }
        loadingPreset =
          localStorage.getItem(key) !== null
            ? null
            : presetFile("test-rig.json")
                .then((file) => {
                  if (cacheKey !== key || localStorage.getItem(key) !== null)
                    return;
                  stateCache = loadedState(validPreset(file));
                  localStorage.setItem(key, JSON.stringify(stateCache));
                  publish();
                })
                .catch((error) => {
                  console.error("Sandbox preset could not load", error);
                  if (cacheKey === key) loadingPreset = null;
                });
        // Any caller may be first to see the new project; listeners redraw.
        if (switched) publish();
      }
      return /** @type {SandboxState} */ (stateCache);
    };
    const ready = async () => {
      const key = stateKey();
      state();
      await loadingPreset;
      if (key !== stateKey()) await ready();
    };
    const persist = () => {
      localStorage.setItem(stateKey(), JSON.stringify(state()));
      publish();
    };
    const heard = (device) =>
      emit("nearby", {
        id: device.id,
        name: device.name,
        rssi: device.scan ? device.scan[tick % device.scan.length] : -60,
      });
    /** @type {Map<string, {led: string, timer: ReturnType<typeof setTimeout>}>} */
    const ledTimers = new Map();
    const clearLedTimers = () => {
      for (const { timer } of ledTimers.values()) clearTimeout(timer);
      ledTimers.clear();
    };
    const deviceForNode = (node) =>
      state().devices.find(
        (device) =>
          device.id === node.id ||
          device.mac.replaceAll(":", "").toUpperCase() ===
            node.mac?.toUpperCase(),
      );
    const emitDeviceStatus = (id) =>
      sandboxEvents.dispatchEvent(
        new CustomEvent("device-status", { detail: { id } }),
      );
    const baseLed = (id) => {
      const device = state().devices.find((entry) => entry.id === id);
      const node = stored().find((entry) => entry.id === id);
      if (device?.unreachable) return "off";
      if (adding && current?.id === id) return "red-blink";
      if (device?.reset) return "red";
      return node ? "blue" : "red";
    };
    const setLed = (id, led, duration) => {
      const old = ledTimers.get(id);
      if (old) clearTimeout(old.timer);
      const timer = setTimeout(() => {
        ledTimers.delete(id);
        emitDeviceStatus(id);
      }, duration);
      ledTimers.set(id, { led, timer });
      emitDeviceStatus(id);
    };
    const status = (id) => {
      const device = state().devices.find((entry) => entry.id === id);
      if (!device) throw new Error(`no device has id ${id}`);
      const node = stored().find((entry) => entry.id === id);
      const led = device.unreachable
        ? "off"
        : ledTimers.get(id)?.led || baseLed(id);
      return {
        lifecycle: device.unreachable
          ? "unreachable"
          : adding && current?.id === id
            ? "provisioning"
            : device.reset
              ? "unprovisioned"
              : node
                ? "provisioned"
                : "unprovisioned",
        unicast: device.reset ? null : node?.unicast || null,
        led,
        models:
          node && !device.reset
            ? node.elements.map((element, index) => {
                const modelState = boundStates.get(element.address);
                const temperature = temperatures.get(element.address);
                return {
                  element: index,
                  ...(modelState
                    ? {
                        on: modelState.on,
                        lightness: Math.round(
                          (modelState.lightness * 100) / 0xffff,
                        ),
                      }
                    : {}),
                  ...(temperature === undefined ? {} : { temperature }),
                };
              })
            : [],
      };
    };
    const failDevice = (id) => setLed(id, "red-flash", FAIL_FLASH_MS);
    const timeoutResult = () => ({
      status: "timeout",
      avg: null,
      min: null,
      max: null,
      secondsSinceLastTx: null,
      deviceCount: null,
    });
    /** Whether a write to one of these models on this element is armed to fail.
     * @param {MeshNode} node @param {string} address @param {string[]} models */
    const failWrite = (node, address, ...models) => {
      const device = deviceForNode(node);
      if (!device?.failWrites?.length) return false;
      const element = node.elements.findIndex(
        (entry) => entry.address === address,
      );
      if (
        !models.some((model) =>
          device.failWrites.includes(`${element}/${model}`),
        )
      )
        return false;
      failDevice(device.id);
      return true;
    };
    const products = async () => {
      await catalog();
      return catalogProducts;
    };
    /** @type {{press(deviceId: string, channel: number): boolean, turn(deviceId: string, channel: number, steps: number): Promise<boolean>} | null} */
    let inputActions = null;
    const sandbox = Object.freeze({
      state: () => {
        const copy = JSON.parse(JSON.stringify(state()));
        delete copy.loaded;
        return copy;
      },
      // An unknown load counts as edited: nothing says what it was.
      edited: () => {
        const now = state();
        return now.loaded === undefined || fingerprint(now) !== now.loaded;
      },
      nodes: () => stored(),
      forgetting: () => {
        const count = stored().length;
        return count
          ? ` and forget ${count} node${count === 1 ? "" : "s"}`
          : "";
      },
      deviceStatus: status,
      families: async () => ({ ...(await catalog()).families }),
      setVary: (on) => {
        if (typeof on !== "boolean") throw new Error("Vary must be a boolean");
        state().vary = on;
        persist();
      },
      setDevice: (id, patch) => {
        const device = state().devices.find((entry) => entry.id === id);
        if (!device) throw new Error(`no device has id ${id}`);
        if (!plain(patch)) throw new Error("Device patch must be an object");
        const allowed = new Set([
          "unreachable",
          "attention",
          "failStep",
          "failWrites",
        ]);
        if (Object.keys(patch).some((key) => !allowed.has(key)))
          throw new Error("Device patch contains an unsupported field");
        const candidate = { ...device };
        for (const [key, value] of Object.entries(patch)) {
          if (key === "failStep" && value === null) delete candidate.failStep;
          else if (
            key === "failWrites" &&
            Array.isArray(value) &&
            value.length === 0
          )
            delete candidate.failWrites;
          else candidate[key] = value;
        }
        validPreset({ preset: "patch", devices: [candidate], rssi: {} });
        const wasUnreachable = Boolean(device.unreachable);
        Object.assign(device, candidate);
        if (patch.failStep === null) delete device.failStep;
        if (Array.isArray(patch.failWrites) && patch.failWrites.length === 0)
          delete device.failWrites;
        persist();
        if (scanning && !wasUnreachable && device.unreachable)
          emit("nearby-lost", { id });
        else if (
          scanning &&
          wasUnreachable &&
          !device.unreachable &&
          (!stored().some((node) => node.id === id) || device.reset) &&
          current?.id !== id
        )
          heard(device);
        emitDeviceStatus(id);
      },
      factoryReset: (id) => {
        const device = state().devices.find((entry) => entry.id === id);
        if (!device) throw new Error(`no device has id ${id}`);
        device.reset = true;
        persist();
        if (scanning && !device.unreachable) heard(device);
        emitDeviceStatus(id);
      },
      catalog: products,
      addDevice: (sku) => {
        if (!catalogProducts?.some((entry) => entry.sku === sku))
          throw new Error("Choose a device from the loaded catalog");
        const currentState = state();
        let id;
        let mac;
        do {
          id = randomHex();
        } while (currentState.devices.some((entry) => entry.id === id));
        do {
          mac = randomBytes(6).join(":");
        } while (currentState.devices.some((entry) => entry.mac === mac));
        const names = new Set(currentState.devices.map((entry) => entry.name));
        let name = sku;
        for (let repeat = 2; names.has(name); repeat += 1)
          name = `${sku} #${repeat}`;
        const device = { id, sku, mac, name };
        currentState.devices.push(device);
        persist();
        if (scanning && !stored().some((node) => node.id === id)) heard(device);
        return { ...device };
      },
      removeDevice: (id) => {
        const currentState = state();
        const next = currentState.devices.filter((entry) => entry.id !== id);
        if (next.length === currentState.devices.length) return;
        currentState.devices = next;
        for (const pair of Object.keys(currentState.rssi))
          if (pair.startsWith(`${id}>`) || pair.endsWith(`>${id}`))
            delete currentState.rssi[pair];
        persist();
        if (scanning) emit("nearby-lost", { id });
      },
      setRssi: (fromId, toId, value) => {
        const currentState = state();
        const ids = new Set(
          currentState.devices.map((device) => device.id.toUpperCase()),
        );
        const pair = `${fromId}>${toId}`;
        if (value === null) delete currentState.rssi[rssiPair(pair, ids)];
        else {
          const normalized = validRssiEntry(pair, value, ids);
          currentState.rssi[normalized.key] = normalized.entry;
        }
        persist();
      },
      exportPreset: (name) => {
        const { devices, rssi, vary } = state();
        return JSON.stringify(
          {
            preset: name,
            devices,
            rssi,
            ...(vary === undefined ? {} : { vary }),
          },
          null,
          2,
        );
      },
      // A preset is the whole sandbox network: devices, RSSI, Vary, and no
      // node or network record left behind from the one it replaces.
      importPreset: (json) => {
        const preset = parsePreset(json);
        const oldIds = state().devices.map((entry) => entry.id);
        clearLedTimers();
        current = null;
        adding = false;
        sessionStorage.removeItem(sessionKey(NODES_KEY));
        sessionStorage.removeItem(sessionKey(RECORD_KEY));
        boundStates.clear();
        temperatures.clear();
        stateCache = loadedState(preset);
        persist();
        emit("nodes-changed");
        if (scanning) {
          for (const id of oldIds) emit("nearby-lost", { id });
          hear();
        }
      },
      setProxyFilter: (type, addresses) => {
        if (type !== "accept" && type !== "reject")
          throw new Error("Proxy filter type must be accept or reject");
        if (!Array.isArray(addresses))
          throw new Error("Proxy filter addresses must be a list");
        proxyFilter = {
          type,
          addresses: [...new Set(addresses.map(proxyAddress))],
        };
      },
      receiveProxyMessage: (destination, message) => {
        const address = proxyAddress(destination);
        if (
          !meshSig.proxyAllows(proxyFilter.type, proxyFilter.addresses, address)
        )
          return false;
        sandboxEvents.dispatchEvent(
          new CustomEvent("proxy-message", {
            detail: { destination: address, message },
          }),
        );
        return true;
      },
      presets: () => presetFile("index.json"),
      loadPreset: async (file) => {
        const available = await presetFile("index.json");
        if (!available.some((entry) => entry.file === file))
          throw new Error("Choose a listed preset");
        const preset = await presetFile(file);
        sandbox.importPreset(JSON.stringify(preset));
      },
      press: (deviceId, channel) => {
        if (!inputActions) throw new Error("Sandbox engine is not ready");
        return inputActions.press(deviceId, channel);
      },
      turn: (deviceId, channel, steps) => {
        if (!inputActions) throw new Error("Sandbox engine is not ready");
        return inputActions.turn(deviceId, channel, steps);
      },
      events: sandboxEvents,
    });
    planner.meshSandbox = sandbox;
    void ready().catch((error) =>
      console.error("Sandbox preset could not load", error),
    );

    /** @param {MeshNode[]} nodes */
    const save = (nodes, area = options.area()) =>
      sessionStorage.setItem(
        sessionKey(NODES_KEY, area),
        JSON.stringify(nodes),
      );

    /** @returns {MeshRecord} */
    const record = (area = options.area()) =>
      JSON.parse(
        sessionStorage.getItem(sessionKey(RECORD_KEY, area)) ||
          '{"groups": {}, "keys": {}}',
      );
    /** @param {MeshRecord} value @param {string} [area] */
    const keep = (value, area = options.area()) =>
      sessionStorage.setItem(
        sessionKey(RECORD_KEY, area),
        JSON.stringify(value),
      );
    const backupMarker = () => {
      try {
        const marker = JSON.parse(
          sessionStorage.getItem(projectSessionKey(BACKUP_KEY)) || "null",
        );
        if (
          marker &&
          (marker.at === null || Number.isFinite(marker.at)) &&
          typeof marker.changed === "boolean"
        )
          return marker;
      } catch {
        // A broken marker is the same as no backup.
      }
      return { at: null, changed: false };
    };
    const markChanged = () =>
      sessionStorage.setItem(
        projectSessionKey(BACKUP_KEY),
        JSON.stringify({ at: backupMarker().at, changed: true }),
      );
    const capabilities = new Set(
      (
        params.get("mesh-capabilities") ??
        "onoff,lightness,ctl,blink,pubsub,rssi,reset"
      ).split(","),
    );
    /** @type {Promise<void>} */
    let rssiQueue = Promise.resolve();
    /** @template T @param {() => Promise<T>} request @returns {Promise<T>} */
    const queueRssi = (request) => {
      const result = rssiQueue.then(request, request);
      rssiQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const normalizeRssiMac = (value) => {
      const mac = String(value || "")
        .replace(/[^0-9a-f]/gi, "")
        .toUpperCase();
      if (mac.length !== 12)
        throw new Error("MAC must contain 12 hexadecimal digits");
      return mac;
    };
    const rssiNode = (unicast) => {
      if (!connected) throw new Error("not connected");
      const value = parseInt(unicast, 16);
      const node = stored().find((entry) => {
        const start = parseInt(entry.unicast, 16);
        return value >= start && value < start + entry.elements.length;
      });
      if (!node) throw new Error(`no node has element ${unicast}`);
      return node;
    };

    const hear = () => {
      const known = new Set(stored().map((node) => node.id));
      for (const device of state().devices)
        if (
          !device.unreachable &&
          (!known.has(device.id) || device.reset) &&
          device.id !== current?.id
        )
          heard(device);
      tick += 1;
    };

    /** The first address after every node's last element and the high-water mark. */
    const nextUnicast = () =>
      hex4(
        Math.max(
          1,
          record().unicastHighWater || 1,
          ...stored().map(
            (node) => parseInt(node.unicast, 16) + node.elements.length - 1,
          ),
        ) + 1,
      );

    /** @param {NonNullable<typeof current>} job @returns {Promise<MeshNode>} */
    const run = async (job) => {
      const device = state().devices.find((entry) => entry.id === job.id);
      if (!device) throw new Error("device is not nearby");
      let composition = device.composition;
      if (!composition && device.sku) {
        const file = await catalog();
        const product = file.products.find((entry) => entry.sku === device.sku);
        if (!product) throw new Error("device is not in the catalog");
        composition = meshSig.composition(product, file.elementTemplates);
      }
      if (!composition) throw new Error("device has no composition");
      for (; job.index < STEPS.length; job.index += 1) {
        const step = STEPS[job.index];
        adding = true;
        emitDeviceStatus(job.id);
        emit("step", { step, status: "running", unicast: job.unicast });
        await wait(STEP_MS);
        if (current !== job) throw new Error("Add was abandoned");
        if (device.unreachable || device.failStep === step) {
          adding = false;
          emit("step", { step, status: "failed", message: "timed out" });
          log(`# ${step} failed: timed out`);
          failDevice(device.id);
          emitDeviceStatus(device.id);
          throw new Error("timed out");
        }
        if (step === "provision") {
          job.unicast = nextUnicast();
          const kept = record();
          keep({
            ...kept,
            unicastHighWater: Math.max(
              kept.unicastHighWater || 1,
              parseInt(job.unicast, 16) + composition.elements.length - 1,
            ),
          });
          markChanged();
          if (device.reset) {
            delete device.reset;
            persist();
          }
        }
        emit("step", { step, status: "done", unicast: job.unicast });
        log(`# ${step} done for ${job.unicast}`);
      }
      const base = parseInt(job.unicast, 16);
      /** @type {MeshNode} */
      const node = {
        id: device.id,
        unicast: job.unicast,
        name: device.name,
        mac: connectedOver === "dongle" ? device.mac.replaceAll(":", "") : "",
        ...(device.attention === undefined
          ? {}
          : { attention: device.attention }),
        features: planner.meshChannels.features(
          parseInt(composition.features, 16),
        ),
        elements: composition.elements.map((element, index) => ({
          address: hex4(base + index),
          models: element.models.map(({ id }) => ({
            id,
            keys: planner.meshChannels.setup.includes(id) ? [0] : [],
          })),
        })),
      };
      const nodes = stored();
      const duplicate =
        node.id && !/^0+$/.test(node.id)
          ? nodes.find(
              (cached) =>
                cached.id === node.id && cached.unicast !== node.unicast,
            )
          : null;
      if (duplicate) duplicate.id = randomHex();
      save([...nodes, node]);
      markChanged();
      current = null;
      adding = false;
      emit("nearby-lost", { id: device.id });
      emit("nodes-changed");
      emitDeviceStatus(device.id);
      return node;
    };

    /** @param {boolean} forgotten @returns {(id: string) => Promise<void>} */
    const mark = (forgotten) => async (id) => {
      const nodes = stored();
      const target = nodes.find((node) => node.id === id);
      if (!target) throw new Error(`no node has id ${id}`);
      save(
        nodes.map((node) => {
          if (node.unicast !== target.unicast) return node;
          if (forgotten) return { ...node, forgotten: true };
          const unforgotten = { ...node };
          delete unforgotten.forgotten;
          return unforgotten;
        }),
      );
      markChanged();
      emit("nodes-changed");
    };

    /** @type {MeshEngine} */
    const engine = {
      events,
      capabilities,
      connect: async (transport) => {
        connectedOver = transport;
        await ready();
        connected = true;
        proxyFilter = { type: "accept", addresses: [CLIENT_UNICAST] };
        log(`# fake engine connected over ${transport}`);
      },
      disconnect: async () => {
        connected = false;
        proxyFilter = { type: "accept", addresses: [] };
        scanGeneration += 1;
        clearInterval(scanning);
        scanning = undefined;
        current = null;
        log("# fake engine disconnected");
      },
      scan: async (on) => {
        const generation = ++scanGeneration;
        clearInterval(scanning);
        scanning = undefined;
        if (on) {
          await ready();
          if (generation !== scanGeneration) return false;
          scanning = setInterval(hear, SCAN_MS);
          hear();
        }
        return on;
      },
      // The chooser's pick: no signal to show.
      pick: async () => {
        await ready();
        const known = new Set(stored().map((node) => node.id));
        const device = state().devices.find(
          (entry) =>
            !entry.unreachable && (!known.has(entry.id) || entry.reset),
        );
        if (!device) throw new Error("no device to pick");
        emit("nearby", { id: device.id, name: device.name, rssi: null });
        return device.id;
      },
      add: (nearbyId) => {
        current = { id: nearbyId, index: 0, unicast: "" };
        adding = true;
        emitDeviceStatus(nearbyId);
        return run(current).catch((error) => {
          adding = false;
          emitDeviceStatus(nearbyId);
          throw error;
        });
      },
      retry: () => {
        if (!current) return Promise.reject(new Error("nothing to retry"));
        const job = current;
        const id = job.id;
        return run(job).catch((error) => {
          adding = false;
          emitDeviceStatus(id);
          throw error;
        });
      },
      nodes: async () => stored(),
      forgetNode: mark(true),
      unforgetNode: mark(false),
      removeNode: async (id) => {
        if (!capabilities.has("reset"))
          throw new Error(
            "Remove from network is not built for real devices yet",
          );
        if (!connected) throw new Error("not connected");
        const nodes = stored();
        const target = nodes.find((node) => node.id === id);
        if (!target) throw new Error(`no node has id ${id}`);
        const mac = target.mac?.toUpperCase();
        const device = state().devices.find(
          (entry) =>
            entry.id === id ||
            (mac && entry.mac.replaceAll(":", "").toUpperCase() === mac),
        );
        const replied = Boolean(device && !device.reset);
        const kept = record();
        keep({
          ...kept,
          unicastHighWater: Math.max(
            kept.unicastHighWater || 1,
            parseInt(target.unicast, 16) + target.elements.length - 1,
          ),
        });
        if (device) {
          device.reset = true;
          persist();
        }
        save(nodes.filter((node) => node.unicast !== target.unicast));
        markChanged();
        emit("nodes-changed");
        if (device && scanning && !device.unreachable) heard(device);
        if (device) emitDeviceStatus(device.id);
        return { replied };
      },
      // Each set is heard back with its bound OnOff, Level, and Lightness states.
      onOff: async (address, on) => {
        const node = stored().find((entry) =>
          entry.elements.some((element) => element.address === address),
        );
        if (!node || deviceForNode(node)?.unreachable) {
          if (node) failDevice(node.id);
          throw new Error("timed out");
        }
        if (failWrite(node, address, "1000")) throw new Error("timed out");
        reportBoundState(address, { on });
      },
      lightness: async (address, lightness) => {
        const node = stored().find((entry) =>
          entry.elements.some((element) => element.address === address),
        );
        if (!node || deviceForNode(node)?.unreachable) {
          if (node) failDevice(node.id);
          throw new Error("timed out");
        }
        if (!Number.isFinite(lightness))
          throw new Error("Lightness level must be finite");
        // The pane sets lightness through the CTL Server where one exists.
        if (failWrite(node, address, "1300", "1303"))
          throw new Error("timed out");
        const percent = Math.max(0, Math.min(100, lightness));
        reportBoundState(address, {
          lightness: Math.round((percent * 0xffff) / 100),
        });
      },
      temperature: async (address, temperature) => {
        const node = stored().find((entry) =>
          entry.elements.some((element) => element.address === address),
        );
        if (!node || deviceForNode(node)?.unreachable) {
          if (node) failDevice(node.id);
          throw new Error("timed out");
        }
        if (failWrite(node, address, "1306")) throw new Error("timed out");
        if (!Number.isFinite(temperature))
          throw new Error("Temperature must be finite");
        const range = await engine.temperatureRange(address);
        const value = range
          ? Math.max(range.min, Math.min(range.max, temperature))
          : temperature;
        if (emitState({ address, temperature: value })) {
          temperatures.set(address, value);
          emitDeviceStatus(node.id);
        }
      },
      temperatureRange: async (address) => {
        const node = stored().find((entry) =>
          entry.elements.some((element) => element.address === address),
        );
        const sku = state().devices.find(
          (device) => device.id === node?.id,
        )?.sku;
        if (!sku) return null;
        const file = await catalog();
        const range = file.products.find(
          (product) => product.sku === sku,
        )?.temperatureRange;
        if (!range) return null;
        if (!meshSig.withinRange(range, meshSig.ctlLimits(file)))
          throw new Error(
            "Device catalog temperature range is outside the SIG model range",
          );
        return { ...range };
      },
      ...(capabilities.has("rssi")
        ? {
            rssi: (unicast, mac) =>
              queueRssi(async () => {
                await wait(STEP_MS);
                const target = normalizeRssiMac(mac);
                const from = rssiNode(unicast);
                const fromDevice = deviceForNode(from);
                if (fromDevice?.unreachable) return timeoutResult();
                const to = state().devices.find(
                  (device) =>
                    device.mac.replaceAll(":", "").toUpperCase() === target,
                );
                if (to?.unreachable) return timeoutResult();
                const entry = to
                  ? state().rssi[`${from.id}>${to.id}`]
                  : undefined;
                if (!entry || "status" in entry)
                  return {
                    status:
                      entry && "status" in entry ? entry.status : "no-record",
                    avg: null,
                    min: null,
                    max: null,
                    secondsSinceLastTx: null,
                    deviceCount: null,
                  };
                const deviceCount = Object.entries(state().rssi).filter(
                  ([key, value]) =>
                    key.startsWith(`${from.id}>`) && !("status" in value),
                ).length;
                const avg = state().vary
                  ? Math.floor(Math.random() * (entry.max - entry.min + 1)) +
                    entry.min
                  : entry.avg;
                return {
                  status: "success",
                  avg,
                  min: entry.min,
                  max: entry.max,
                  secondsSinceLastTx: entry.secondsSinceLastTx ?? null,
                  deviceCount,
                };
              }),
            clearRssi: (unicast, mac) =>
              queueRssi(async () => {
                await wait(STEP_MS);
                const target =
                  mac === undefined ? undefined : normalizeRssiMac(mac);
                const from = rssiNode(unicast);
                if (deviceForNode(from)?.unreachable)
                  throw new Error("RSSI clear failed: timeout");
                const records = state().rssi;
                if (mac === undefined) {
                  for (const key of Object.keys(records))
                    if (key.startsWith(`${from.id}>`)) delete records[key];
                } else {
                  const to = state().devices.find(
                    (device) =>
                      device.mac.replaceAll(":", "").toUpperCase() === target,
                  );
                  const key = to ? `${from.id}>${to.id}` : "";
                  const entry = records[key];
                  if (!entry || "status" in entry)
                    throw new Error(
                      `RSSI clear failed: ${entry?.status || "no-record"}`,
                    );
                  delete records[key];
                }
                persist();
              }),
          }
        : {}),
      blink: async (unicast) => {
        log(`# fake blink ${unicast}`);
        const value = parseInt(unicast, 16);
        const node = stored().find((entry) => {
          const start = parseInt(entry.unicast, 16);
          return value >= start && value < start + entry.elements.length;
        });
        if (!node) throw new Error(`${unicast} is not in the engine's network`);
        const device = deviceForNode(node);
        if (device?.unreachable) throw new Error("timed out");
        if (device?.attention || node.attention) {
          // Attention is a Health Server write on the primary element.
          if (failWrite(node, node.elements[0].address, "0002"))
            throw new Error("timed out");
          setLed(node.id, "blue-blink", ATTENTION_MS);
          await wait(ATTENTION_MS);
          return;
        }
        const outputs = planner.meshChannels.onOffs(node);
        if (!outputs.length)
          throw new Error(`${unicast} has neither Attention nor On/Off`);
        const initial = outputs.map(
          (address) => boundStates.get(address)?.on ?? false,
        );
        try {
          for (let toggle = 1; toggle <= 6; toggle += 1) {
            for (const [index, address] of outputs.entries())
              await engine.onOff(
                address,
                toggle % 2 ? !initial[index] : initial[index],
              );
            await wait(BLINK_MS);
          }
        } catch (error) {
          await Promise.allSettled(
            outputs.map((address, index) =>
              engine.onOff(address, initial[index]),
            ),
          );
          throw error;
        }
      },
      record: async () => record(),
      link: async (change) => {
        await wait(STEP_MS);
        const node = stored().find((entry) =>
          entry.elements.some((element) => element.address === change.element),
        );
        if (!node) throw new Error(`no node has element ${change.element}`);
        const device = deviceForNode(node);
        // A Link is a Config Server write that configures the named model.
        if (
          device?.unreachable ||
          failWrite(node, change.element, change.model) ||
          failWrite(node, node.elements[0].address, "0000")
        )
          throw new Error("timed out");
        const kept = record();
        let address = kept.groups[change.group];
        if (!address && !change.on) return "";
        if (!address) {
          const taken = new Set(Object.values(kept.groups));
          let next = 0xc000;
          while (taken.has(hex4(next))) next += 1;
          address = kept.groups[change.group] = hex4(next);
        }
        const nodes = stored();
        const model = nodes
          .flatMap((node) => node.elements)
          .find((element) => element.address === change.element)
          ?.models.find((entry) => entry.id === change.model);
        if (!model) throw new Error(`no model ${change.model}`);
        if (change.on) {
          kept.keys[change.application] ??=
            Math.max(0, ...Object.values(kept.keys)) + 1;
          const key = kept.keys[change.application];
          if (!model.keys.includes(key)) model.keys.push(key);
          if (change.role === "publish") model.publish = address;
          else
            model.subscribe = [
              ...new Set([...(model.subscribe || []), address]),
            ];
        } else if (change.role === "publish") {
          if (model.publish === address) delete model.publish;
        } else
          model.subscribe = (model.subscribe || []).filter(
            (entry) => entry !== address,
          );
        keep(kept);
        save(nodes);
        markChanged();
        log(
          `# ${change.element} ${change.model} ${change.on ? "" : "un"}${change.role} ${address}`,
        );
        emit("nodes-changed");
        return address;
      },
      free: async (group) => {
        const kept = record();
        delete kept.groups[group];
        keep(kept);
        markChanged();
      },
      backup: async () => {
        await ready();
        const exported = Date.now();
        const areas = options.areas().map(({ id, name }) => ({
          area: id,
          name,
          nodes: stored(id),
          sender: { record: null, marker: null },
          record: record(id),
          database: null,
        }));
        const value = {
          format: "mesh-planner-fake-network",
          version: 2,
          exported,
          project: options.project(),
          areas,
        };
        sessionStorage.setItem(
          projectSessionKey(BACKUP_KEY),
          JSON.stringify({ at: exported, changed: false }),
        );
        return new TextEncoder().encode(JSON.stringify(value));
      },
      backedUp: async () => backupMarker(),
      restore: async (bytes) => {
        await wait(STEP_MS);
        if (params.get("mesh-restore") === "refuse")
          throw new Error("fake engine: backup refused");
        let file;
        try {
          file = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new Error(
            "This file is not a ZeMesh network backup. The network in this browser was kept.",
          );
        }
        if (
          file?.format !== "mesh-planner-fake-network" ||
          !Number.isFinite(file.exported)
        )
          throw new Error(
            "This file is not a ZeMesh network backup. The network in this browser was kept.",
          );
        const refused = (message) =>
          new Error(`${message} The network in this browser was kept.`);
        if (file.version !== 2)
          throw refused(
            "This network backup version is not supported. Version 2 is required.",
          );
        if (file.project !== options.project())
          throw refused("This backup belongs to a different project.");
        if (!Array.isArray(file.areas))
          throw new Error(
            "This file is not a ZeMesh network backup. The network in this browser was kept.",
          );
        const knownAreas = new Map(
          options.areas().map((area) => [area.id, area]),
        );
        const restored = [];
        const seen = new Set();
        for (const entry of file.areas) {
          if (
            !entry ||
            typeof entry.area !== "string" ||
            !knownAreas.has(entry.area)
          )
            throw refused(
              "This backup includes an Area that is not in this project.",
            );
          if (
            seen.has(entry.area) ||
            typeof entry.name !== "string" ||
            !Array.isArray(entry.nodes) ||
            !entry.record ||
            typeof entry.record !== "object" ||
            Array.isArray(entry.record) ||
            (entry.record.unicastHighWater !== undefined &&
              (!Number.isInteger(entry.record.unicastHighWater) ||
                entry.record.unicastHighWater < 1 ||
                entry.record.unicastHighWater > 0x7fff))
          )
            throw new Error(
              "This file is not a ZeMesh network backup. The network in this browser was kept.",
            );
          seen.add(entry.area);
          restored.push(entry);
        }
        for (const entry of restored) {
          save(entry.nodes, entry.area);
          const highWater = Math.max(
            record(entry.area).unicastHighWater || 0,
            entry.record.unicastHighWater || 0,
          );
          keep(
            {
              ...entry.record,
              ...(highWater ? { unicastHighWater: highWater } : {}),
            },
            entry.area,
          );
        }
        clearLedTimers();
        boundStates.clear();
        temperatures.clear();
        sessionStorage.setItem(
          projectSessionKey(BACKUP_KEY),
          JSON.stringify({ at: file.exported, changed: false }),
        );
        emit("nodes-changed");
      },
      areaChanged: async () => {
        const oldIds = stateCache?.devices.map((device) => device.id) || [];
        clearLedTimers();
        boundStates.clear();
        temperatures.clear();
        current = null;
        adding = false;
        await ready();
        tick = 0;
        publish();
        emit("nodes-changed");
        if (scanning) {
          for (const id of oldIds) emit("nearby-lost", { id });
          hear();
        }
      },
    };
    const inputRoute = (deviceId, number, serverModel) => {
      if (!Number.isSafeInteger(number) || number < 1)
        throw new Error("Sandbox input channel must be a positive integer");
      const node = stored().find((entry) => entry.id === deviceId);
      const channel =
        node &&
        planner.meshChannels
          .of(node)
          .find((entry) => entry.number === number && entry.role === "input");
      // Keep the Lightness encoder route inside the sandbox.
      const clientModel =
        serverModel === "1300"
          ? "1302"
          : planner.meshChannels.pairs.find(
              ([, server]) => server === serverModel,
            )?.[0];
      if (!node || !channel || !clientModel) return null;
      const model = node.elements
        .filter((element) => channel.elements.includes(element.address))
        .flatMap((element) => element.models)
        .find((entry) => entry.id === clientModel && entry.publish);
      if (!model?.publish) return null;
      const targets = stored().flatMap((target) =>
        target.elements.flatMap((element) =>
          element.models.some(
            (entry) =>
              entry.id === serverModel &&
              entry.subscribe?.includes(model.publish),
          )
            ? [{ address: element.address }]
            : [],
        ),
      );
      return targets.length
        ? { clientModel, destination: model.publish, targets }
        : null;
    };
    inputActions = {
      press: (deviceId, channel) => {
        const route = inputRoute(deviceId, channel, "1000");
        if (!route) return false;
        const on = !(boundStates.get(route.targets[0].address)?.on ?? false);
        sandboxEvents.dispatchEvent(
          new CustomEvent("publish", {
            detail: {
              model: route.clientModel,
              destination: route.destination,
              method: "Generic OnOff Set",
              on,
            },
          }),
        );
        for (const target of route.targets)
          reportBoundState(target.address, { on });
        return true;
      },
      turn: async (deviceId, channel, steps) => {
        if (!Number.isSafeInteger(steps))
          throw new Error("Encoder steps must be an integer");
        if (!steps) return false;
        const ctl = inputRoute(deviceId, channel, "1303");
        const lightness = ctl ? null : inputRoute(deviceId, channel, "1300");
        const route = ctl || lightness;
        if (!route) return false;
        if (ctl) {
          const file = await catalog();
          const limits = meshSig.ctlLimits(file);
          if (!limits)
            throw new Error("Device catalog has no Light CTL limits");
          const nodes = stored();
          const targets = route.targets.map((target) => {
            const node = nodes.find((entry) =>
              entry.elements.some(
                (element) => element.address === target.address,
              ),
            );
            const channel =
              node &&
              planner.meshChannels
                .of(node)
                .find((entry) => entry.elements.includes(target.address));
            return {
              ...target,
              temperatureAddress:
                (node &&
                  channel &&
                  planner.meshChannels.drives(node, channel).temperature) ||
                target.address,
            };
          });
          const ranges = await Promise.all(
            targets.map((target) =>
              engine.temperatureRange(target.temperatureAddress),
            ),
          );
          const first = targets[0];
          const firstRange = ranges[0] || limits;
          const temperature = meshSig.stepTemperature(
            temperatures.get(first.temperatureAddress) ?? firstRange.min,
            firstRange,
            steps,
          );
          const actual = boundStates.get(first.address)?.lightness ?? 0;
          sandboxEvents.dispatchEvent(
            new CustomEvent("publish", {
              detail: {
                model: route.clientModel,
                destination: route.destination,
                method: "Light CTL Set",
                lightness: actual,
                temperature,
              },
            }),
          );
          for (const [index, target] of targets.entries()) {
            const range = ranges[index] || limits;
            const value = Math.max(range.min, Math.min(range.max, temperature));
            reportBoundState(target.address, { lightness: actual });
            if (
              emitState({
                address: target.temperatureAddress,
                temperature: value,
              })
            )
              temperatures.set(target.temperatureAddress, value);
          }
        } else {
          const first = route.targets[0].address;
          const actual = meshSig.stepLightness(
            boundStates.get(first)?.lightness ?? 0,
            steps,
          );
          sandboxEvents.dispatchEvent(
            new CustomEvent("publish", {
              detail: {
                model: route.clientModel,
                destination: route.destination,
                method: "Light Lightness Set",
                lightness: actual,
              },
            }),
          );
          for (const target of route.targets)
            reportBoundState(target.address, { lightness: actual });
        }
        return true;
      },
    };
    return Object.freeze(engine);
  };

  planner.meshSandboxEngine = Object.freeze({
    create,
    forgetArea,
    forgetProject,
    networkNodes,
  });
}
