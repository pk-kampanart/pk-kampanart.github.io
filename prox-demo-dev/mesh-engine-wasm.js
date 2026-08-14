/**
 * The MeshEngine over the vendor wasm (ADR-0042), reached through the USB
 * dongle or over Bluetooth GATT. The only file that knows the wasm's C names, pointers and heap; the
 * pane sees MeshEngine and nothing else. The wasm loads on first Connect,
 * backup or restore, never at page load. Each project has a separate copy in
 * this browser's storage. Connect swaps it into the wasm's database first.
 * Until then nodes() answers from the list the project's last session saw.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  // Relative, so the dev server's vendor mount and dist/vendor/ both answer.
  const GLUE = "vendor/mesh-wasm/mesh_wasm.js";
  const WASM = "vendor/mesh-wasm/mesh_wasm.wasm";
  // The wasm's OPFS database directory has a fixed name.
  const WORKING = "mesh_wasm";
  // OPFS: one directory per project id, holding its copy of WORKING's files.
  const COPIES = "mesh-planner-networks";
  // localStorage, per project: our own packets' source address and sequence
// number (ADR-0042). Not OPFS: each number is written before it is used.
  const OWN_SEQ_PREFIX = "mesh-planner:mesh-own-seq:";
  const BACKUP_PREFIX = "mesh-planner:mesh-backup:";
  const RECORD_PREFIX = "mesh-planner:mesh-record:";
  const DATABASE_HEADER = "SQLite format 3\0";
  const MAX_DATABASE_BYTES = 64 * 1024 * 1024;
  // The project whose network WORKING holds.
  const NETWORK_KEY = "mesh-planner:mesh-network";
  // NETWORK_KEY's value while WORKING is being replaced.
  const SWAPPING = "swapping";
  const NODES_PREFIX = "mesh-planner:mesh-nodes:";
  const LEGACY_NODES_KEY = "mesh-planner:mesh-nodes";
  const LOCAL = 0x0001;
  // 7FF0–7FFF are the addresses our own packets are sent from.
  const OWN = 0x7ff0;
  const NET_KEY_INDEX = 0;
  const SETUP_KEY = 0;
  // A node restarts as a proxy after its provisioning; this is how long a
  // proxy is sought before the pane says none is in reach.
  const PROXY_RETRY_MS = 30000;
  // A proxy that does not answer the filter in this time gets it once more.
  const FILTER_WAIT_MS = 3000;
  // How long a reply to our own packet is awaited.
  const OWN_REPLY_MS = 4000;
  // What the encoder probe published with (ticket 21).
  const PUBLISH_TTL = 5;
  // Blink (decision 24): Health Attention for ATTENTION_S seconds, else each
  // output channel toggled BLINKS times, each state held BLINK_MS. Tuned on
  // PK's strips; the acknowledged Set adds its own round trip.
  const ATTENTION_S = 5;
  const BLINKS = 3;
  const BLINK_MS = 400;
  // Access opcodes of Health Server and Generic OnOff Server.
  const ATTENTION_GET = [0x80, 0x04];
  const ATTENTION_SET_UNACKNOWLEDGED = [0x80, 0x06];
  const ATTENTION_STATUS = [0x80, 0x07];
  const ONOFF_GET = [0x82, 0x01];
  const ONOFF_STATUS = [0x82, 0x04];
  // Light CTL Server and Light CTL Temperature Server. The wasm sends Light
  // CTL Set; the Get is our own.
  const CTL_SERVER = "1303";
  const CTL_TEMPERATURE_SERVER = "1306";
  const CTL_GET = [0x82, 0x5d];
  const CTL_STATUS = [0x82, 0x60];
  const CTL_TEMPERATURE_RANGE_GET = [0x82, 0x62];
  const CTL_TEMPERATURE_RANGE_STATUS = [0x82, 0x63];
  // What a device picked in the chooser without a live scan is provisioned
  // with: its Device UUID is unknown (decision 28).
  const ZERO_UUID = "00".repeat(16);
  /** An id the wasm or the cache stores for "none". @param {string} [id] */
  const unknownId = (id) => /^0*$/.test(id || "");
  /** @type {MeshAddStep[]} */
  const STEPS = ["provision", "read", "appkey", "bind"];
  /** Composition feature bits, lowest first. */
  const FEATURES = /** @type {MeshNode["features"]} */ ([
    "relay",
    "proxy",
    "friend",
    "lowPower",
  ]);

  /** @param {ArrayLike<number>} bytes */
  const hex = (bytes) =>
    Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  /** @param {number} value */
  const hex4 = (value) => value.toString(16).toUpperCase().padStart(4, "0");
  /** SIG model ids are 4 hex digits, vendor ones 8. @param {number} id */
  const modelHex = (id) =>
    id > 0xffff
      ? (id >>> 0).toString(16).toUpperCase().padStart(8, "0")
      : hex4(id);
  /** The composition gives hex strings, the project state numbers. @param {number | string} value */
  const num = (value) =>
    typeof value === "number" ? value : parseInt(value, 16);
  /** @param {string} text */
  const bytesOf = (text) =>
    Uint8Array.from(text.match(/../g) || [], (pair) => parseInt(pair, 16));
  const plainObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
  // What a backup file may carry into the node cache and the record.
  /** @param {unknown} value */
  const isHex4 = (value) => typeof value === "string" && /^[0-9A-F]{4}$/i.test(value);
  /** @param {unknown} value */
  const groupAddress = (value) =>
    isHex4(value) && parseInt(String(value), 16) >= 0xc000 &&
    parseInt(String(value), 16) <= 0xfeff;
  /** @param {unknown} value */
  const keyIndex = (value) =>
    Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xfff;
  /** @param {any} model */
  const validModel = (model) =>
    plainObject(model) &&
    typeof model.id === "string" && /^([0-9A-F]{4}|[0-9A-F]{8})$/i.test(model.id) &&
    Array.isArray(model.keys) && model.keys.every(keyIndex) &&
    (model.publish === undefined || groupAddress(model.publish)) &&
    (model.subscribe === undefined ||
      (Array.isArray(model.subscribe) && model.subscribe.every(groupAddress)));
  /** @param {any} node */
  const validNode = (node) =>
    plainObject(node) &&
    typeof node.id === "string" &&
    isHex4(node.unicast) &&
    typeof node.name === "string" &&
    Array.isArray(node.features) &&
    Array.isArray(node.elements) &&
    node.elements.every(
      (/** @type {any} */ element) =>
        plainObject(element) &&
        isHex4(element.address) &&
        Array.isArray(element.models) &&
        element.models.every(validModel),
    );
  /** @param {number} ms */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomHex = () => hex(crypto.getRandomValues(new Uint8Array(16)));
  /** @param {{status: number}} event */
  const statusText = ({ status }) =>
    `status 0x${status.toString(16).padStart(2, "0").toUpperCase()}`;
  // The wasm gives a Config request about a second. A timeout reports 0xFF,
  // or 0x00 on a failed phase; the node may still have acted on it.
  /** @param {Error} error */
  const timedOut = (error) => /status 0x(ff|00)$/i.test(error.message);
  // The wasm's log is the pane's Log, which a user copies into a bug report.
  /** @param {string} text */
  const redact = (text) => text.replace(/[0-9a-f]{32}/gi, "[key]");

  /** @param {string} key @returns {MeshNode[]} */
  const stored = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      return [];
    }
  };
  /** @param {MeshNode[]} nodes @param {string} key */
  const store = (nodes, key) => {
    try {
      localStorage.setItem(key, JSON.stringify(nodes));
    } catch {
      // Without storage the list is lost at reload; the wasm still has it.
    }
  };

  /** HEAD, so the 6 MB engine is never fetched to learn it is there. */
  const installed = async () => {
    const response = await fetch(WASM, {
      method: "HEAD",
      cache: "no-store",
    }).catch(() => null);
    return Boolean(response?.ok);
  };

  /** @returns {Promise<any>} the glue's module factory */
  const glue = () =>
    new Promise((resolve, reject) => {
      const found = /** @type {any} */ (window).MeshWasm;
      if (found) return resolve(found);
      const script = document.createElement("script");
      script.src = GLUE;
      script.addEventListener("load", () =>
        resolve(/** @type {any} */ (window).MeshWasm),
      );
      script.addEventListener("error", () =>
        reject(new Error("the mesh engine did not load")),
      );
      document.head.append(script);
    });

  /** @param {FileSystemDirectoryHandle} target @param {FileSystemDirectoryHandle} source */
  const replaceDirectory = async (target, source) => {
    /** @type {string[]} */
    const names = [];
    for await (const name of /** @type {any} */ (target).keys())
      names.push(name);
    for (const name of names) await target.removeEntry(name);
    for await (const [name, entry] of /** @type {any} */ (source).entries()) {
      if (entry.kind !== "file") continue;
      const handle = await target.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(await entry.getFile());
      await writable.close();
    }
  };

  /** @param {{ project: () => string }} options */
  const create = (options) => {
    const reload = /** @type {{ reload?: () => void }} */ (
      /** @type {unknown} */ (options)
    ).reload ?? (() => location.reload());
    /** @type {string} */
    let network = "";
    const nodesKey = () => `${NODES_PREFIX}${network || options.project()}`;
    const sequenceKey = () => `${OWN_SEQ_PREFIX}${network || options.project()}`;
    const backupKey = () => `${BACKUP_PREFIX}${network || options.project()}`;
    const recordKey = () => `${RECORD_PREFIX}${network || options.project()}`;
    const emptyRecord = () => ({ groups: {}, keys: {} });
    /** @returns {MeshRecord} */
    const readRecord = () => {
      try {
        const value = JSON.parse(localStorage.getItem(recordKey()) || "null");
        return plainObject(value?.groups) && plainObject(value?.keys)
          ? value
          : emptyRecord();
      } catch {
        return emptyRecord();
      }
    };
    /** @param {MeshRecord} value */
    const saveRecord = (value) =>
      localStorage.setItem(recordKey(), JSON.stringify(value));
    const backupMarker = () => {
      try {
        const marker = JSON.parse(localStorage.getItem(backupKey()) || "null");
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
    const setBackupMarker = (at, changed) =>
      localStorage.setItem(backupKey(), JSON.stringify({ at, changed }));
    const markBackupChanged = () => {
      const marker = backupMarker();
      setBackupMarker(marker.at, true);
    };
    /** @param {string} project */
    const prepareNetwork = async (project) => {
      // Best effort: an evicted OPFS takes every project's network with it.
      void navigator.storage.persist?.().catch(() => {});
      const root = await navigator.storage.getDirectory();
      const working = await root.getDirectoryHandle(WORKING, { create: true });
      const copies = await root.getDirectoryHandle(COPIES, { create: true });
      /** @param {string} id */
      const copyOf = (id) => copies.getDirectoryHandle(id, { create: true });
      const owner = localStorage.getItem(NETWORK_KEY);
      if (owner === project) return;
      if (!owner) {
        // The first project adopts a network left by earlier versions.
        const first = await /** @type {any} */ (working).keys().next();
        if (!first.done) {
          const legacy = localStorage.getItem(LEGACY_NODES_KEY);
          if (legacy !== null) {
            localStorage.setItem(`${NODES_PREFIX}${project}`, legacy);
            localStorage.removeItem(LEGACY_NODES_KEY);
          }
          localStorage.setItem(NETWORK_KEY, project);
          return;
        }
      } else if (owner !== SWAPPING)
        // A closed tab may leave newer files in WORKING without saving its copy.
        await replaceDirectory(await copyOf(owner), working);
      // Mark WORKING unowned during the swap so a failure cannot overwrite a
      // saved network on the next Connect.
      localStorage.setItem(NETWORK_KEY, SWAPPING);
      await replaceDirectory(working, await copyOf(project));
      localStorage.setItem(NETWORK_KEY, project);
    };
    const saveNetwork = async () => {
      if (localStorage.getItem(NETWORK_KEY) !== network) return;
      const root = await navigator.storage.getDirectory();
      const working = await root.getDirectoryHandle(WORKING, { create: true });
      const copies = await root.getDirectoryHandle(COPIES, { create: true });
      const saved = await copies.getDirectoryHandle(network, { create: true });
      await replaceDirectory(saved, working);
    };
    const events = new EventTarget();
    /** @param {string} type @param {unknown} [detail] */
    const emit = (type, detail) =>
      events.dispatchEvent(new CustomEvent(type, { detail }));
    /** @param {string} text */
    const log = (text) => emit("log", { text: redact(text) });

    /** @type {any} */
    let M = null;
    /** @type {Record<string, (...args: any[]) => any>} */
    let A = {};
    let h = 0;
    /** @type {Promise<void> | null} */
    let loading = null;
    /** Rejects the load when the wasm fails to instantiate, which the glue never reports. */
    let failed = (/** @type {Error} */ _error) => {};
    /** @type {"" | MeshTransport} */
    let via = "";
    /** The dongle's port. @type {MeshPort | null} */
    let port = null;
    // Over GATT: the live scan's start and stop, devices by Device UUID, the
    // three links, and the device a proxy was last sought on.
    const gatt = {
      /** @type {Promise<(() => void) | null> | null} */
      scanning: null,
      /** @type {(() => void) | null} */
      stop: null,
      /** Heard by the live scan. @type {Map<string, {device: any, name: string}>} */
      found: new Map(),
      /** Picked in the chooser. @type {Map<string, any>} */
      picked: new Map(),
      /** @type {MeshPort | null} */
      provisioning: null,
      /** @type {MeshPort | null} */
      proxy: null,
      /** A proxy until it answers the filter. @type {MeshPort | null} */
      opening: null,
      filtered: () => {},
      /** @type {any} */
      last: null,
      target: 0,
      /** @type {Promise<void> | null} */
      reaching: null,
      // No proxy answered; the next Connect opens the chooser.
      unreached: false,
    };
    /** @type {any} */
    let project = null;
    // Set by a restore until its reload: the wasm still holds the old project.
    /** @type {MeshNode[] | null} */
    let restored = null;
    let scanning = false;
    let link = 0xff;
    // Asyncify's suspension: set while the wasm waits on a promise, and an
    // async export's whole run.
    let suspended = false;
    let asyncActive = false;
    /** @type {Promise<unknown>} */
    let queue = Promise.resolve();
    /** @type {Set<(event: any) => void>} */
    const waiters = new Set();
    /** @typedef {{id: string, step: number, device?: Promise<any>, keys?: {net: string, app: string, iv: number}, unicast?: number, elements?: number, devKey?: string, composition?: any}} Job */
    /** @type {Job | null} */
    let pending = null;

    // Nothing may enter the wasm while it is suspended.
    const idle = async () => {
      while (suspended) await sleep(5);
    };
    // Plain calls once the wasm is idle. The check and the calls share a turn:
    // a queued call resumed in between would suspend the wasm again.
    /** @template T @param {() => T} calls @returns {Promise<T>} */
    const whenIdle = async (calls) => {
      do await idle();
      while (suspended);
      return calls();
    };

    // SQLite's OPFS I/O suspends the wasm inside a queued call. Entering it
    // while suspended aborts it, so plain calls wait while it is suspended.
    // Its mesh timers queue through runMeshTimer; an emscripten_async_call
    // timer it may still make waits for the queue. An import that returns in
    // asyncify state 1
    // (unwinding) began a suspension; one entered in state 2 (rewinding) that
    // returns in 0 ended it.
    /** @param {Record<string, Record<string, unknown>>} imports @param {() => number} state */
    const gate = (imports, state) => {
      /** @param {Function} fn */
      const wrap =
        (fn) =>
        (/** @type {unknown[]} */ ...args) => {
          const before = state();
          const result = fn(...args);
          const after = state();
          if (before === 0 && after === 1) suspended = true;
          else if (before === 2 && after === 0) suspended = false;
          return result;
        };
      // The glue schedules through the global setTimeout while this import runs.
      /** @param {Function} fn */
      const timer =
        (fn) =>
        (/** @type {unknown[]} */ ...args) => {
          const plain = globalThis.setTimeout;
          globalThis.setTimeout = /** @type {any} */ (
            (/** @type {Function} */ callback, /** @type {number} */ ms) =>
              plain(function gated() {
                if (suspended || asyncActive) plain(gated, 5);
                else callback();
              }, ms)
          );
          try {
            return fn(...args);
          } finally {
            globalThis.setTimeout = plain;
          }
        };
      return Object.fromEntries(
        Object.entries(imports).map(([space, fns]) => [
          space,
          Object.fromEntries(
            Object.entries(fns).map(([name, fn]) => [
              name,
              typeof fn !== "function"
                ? fn
                : name === "emscripten_async_call"
                  ? timer(wrap(fn))
                  : wrap(fn),
            ]),
          ),
        ]),
      );
    };

    /** @param {any} imports @param {(instance: WebAssembly.Instance) => void} done */
    const instantiate = (imports, done) => {
      let state = () => 0;
      WebAssembly.instantiateStreaming(
        fetch(WASM),
        /** @type {WebAssembly.Imports} */ (gate(imports, () => state())),
      ).then(
        ({ instance }) => {
          state = /** @type {() => number} */ (
            instance.exports.asyncify_get_state
          );
          done(instance);
        },
        (error) => failed(error),
      );
      return {};
    };

    /** @param {number} count */
    const numbers = (count) => Array(count).fill("number");
    // A plain call cannot wait, so it refuses a suspended wasm rather than abort it.
    /** @param {string} name @param {string | null} returns @param {number} count */
    const plain = (name, returns, count) => {
      const call = M.cwrap(`mesh_wasm_dongle_${name}`, returns, numbers(count));
      return (/** @type {number[]} */ ...args) => {
        if (suspended) throw new Error(`mesh engine busy, ${name} not called`);
        return call(...args);
      };
    };
    // Asyncify allows one suspended call at a time, so every async export
    // queues. Byte arguments are copied onto the wasm heap for the call.
    /** @param {string} name @param {number} count @param {string | null} [returns] @param {string} [prefix] */
    const queued =
      (name, count, returns = null, prefix = "mesh_wasm_dongle_") =>
      (/** @type {(number | Uint8Array)[]} */ ...args) => {
        const run = async () => {
          await idle();
          asyncActive = true;
          /** @type {number[]} */
          const pointers = [];
          try {
            const values = args.map((arg) => {
              if (typeof arg === "number") return arg;
              const pointer = M._malloc(arg.length);
              M.HEAPU8.set(arg, pointer);
              pointers.push(pointer);
              return pointer;
            });
            return await M.ccall(
              `${prefix}${name}`,
              returns,
              numbers(count),
              values,
              { async: true },
            );
          } finally {
            pointers.forEach((pointer) => M._free(pointer));
            asyncActive = false;
          }
        };
        const result = queue.then(run, run);
        queue = result.catch(() => {});
        return result;
      };

    /** @param {any} event */
    const heard = (event) => {
      for (const waiter of waiters) waiter(event);
    };

    const register = () => {
      /** @param {number} pointer @param {number} length */
      const heap = (pointer, length) =>
        M.HEAPU8.slice(pointer, pointer + length);
      /** @param {string} name @param {Function} callback @param {string} signature */
      const set = (name, callback, signature) =>
        plain(name, null, 3)(h, M.addFunction(callback, signature), 0);
      set(
        "set_serial_tx_callback",
        (/** @type {number} */ pointer, /** @type {number} */ length) => {
          const bytes = heap(pointer, length);
          port
            ?.write(bytes)
            .catch((error) => log(`# serial write failed: ${error.message}`));
        },
        "viii",
      );
      // Over GATT the serial callback still gets the dongle's commands, which
      // go nowhere since there is no port.
      /** @param {() => MeshPort | null} link */
      const gattTx =
        (link) =>
        (/** @type {number} */ pointer, /** @type {number} */ length) => {
          const bytes = heap(pointer, length);
          link()
            ?.write(bytes)
            .catch((error) => log(`# GATT write failed: ${error.message}`));
        };
      set(
        "set_gatt_tx_callback",
        gattTx(() => gatt.proxy || gatt.opening),
        "viii",
      );
      set(
        "set_gatt_provisioning_tx_callback",
        gattTx(() => gatt.provisioning),
        "viii",
      );
      set(
        "set_raw_frame_callback",
        (/** @type {number} */ pointer, /** @type {number} */ length) => {
          const bytes = heap(pointer, length);
          if (bytes[0] === 0xfe)
            log(new TextDecoder().decode(bytes.subarray(1)));
          else ownHeard(bytes, false);
        },
        "viii",
      );
      set(
        "set_scan_state_callback",
        (/** @type {number} */ on) => {
          scanning = Boolean(on);
        },
        "vii",
      );
      set(
        "set_scan_device_callback",
        (
          /** @type {number} */ uuid,
          /** @type {number} */ _mac,
          /** @type {number} */ rssi,
        ) => {
          const id = hex(heap(uuid, 16));
          // The dongle hears no advertised name.
          if (id !== pending?.id) emit("nearby", { id, name: "", rssi });
        },
        "viiiiiii",
      );
      set(
        "set_provisioning_event_callback",
        (
          /** @type {number[]} */ ...[
            eventType,
            linkId,
            flags,
            unicast,
            numElements,
            devKey,
            caps,
            hasCaps,
          ]
        ) =>
          heard({
            kind: "provisioning",
            eventType,
            linkId,
            flags,
            unicast,
            numElements,
            devKey: heap(devKey, 16),
            caps: hasCaps ? heap(caps, 11) : null,
          }),
        "viiiiiiiiiii",
      );
      // The event's modelId is always 0, so a bind result cannot be matched
      // by model: bind() sends one at a time.
      set(
        "set_config_event_callback",
        (
          /** @type {number[]} */ ...[
            eventType,
            phase,
            status,
            unicast,
            elementAddr,
            modelId,
          ]
        ) =>
          heard({
            kind: "config",
            eventType,
            phase,
            status,
            unicast,
            elementAddr,
            modelId,
          }),
        "viiiiiiiiii",
      );
      set(
        "set_generic_event_callback",
        (
          /** @type {number[]} */ ...[eventType, phase, status, src, , present, target]
        ) =>
          heard({
            kind: "generic",
            eventType,
            phase,
            status,
            src,
            present,
            target,
          }),
        "viiiiiiiii",
      );
    };

    // Config events may arrive in this queue instead of the callback.
    const poll = () => {
      if (asyncActive || suspended) return;
      const pointer = M._malloc(12);
      try {
        while (A.popConfigEvent(h, pointer, pointer + 4, pointer + 8)) {
          const [eventType, phase, status] = M.HEAPU32.slice(
            pointer >> 2,
            (pointer >> 2) + 3,
          );
          heard({ kind: "config", eventType, phase, status });
        }
      } finally {
        M._free(pointer);
      }
    };

    /** @param {(handle: number, pointer: number, length: number) => number} get */
    const readJson = (get) =>
      whenIdle(() => {
        const length = get(h, 0, 0);
        if (length <= 1) return null;
        const pointer = M._malloc(length);
        try {
          get(h, pointer, length);
          const bytes = M.HEAPU8.slice(pointer, pointer + length);
          const end = bytes.indexOf(0);
          return JSON.parse(
            new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end)),
          );
        } finally {
          M._free(pointer);
        }
      });

    const refresh = async () => {
      project = await readJson(A.getProjectStateJson);
    };

    const load = async () => {
      network = options.project();
      await prepareNetwork(network);
      const factory = await glue();
      M = await Promise.race([
        factory({
          instantiateWasm: instantiate,
          // The wasm's mesh timers enter it through here, so they queue
          // with every other call instead of entering a suspended wasm.
          runMeshTimer: (
            /** @type {number} */ callback,
            /** @type {number} */ context,
          ) =>
            A.runTimer(callback, context).catch(
              (/** @type {Error} */ error) =>
                log(`# wasm timer failed: ${error.message}`),
            ),
        }),
        new Promise((_, reject) => {
          failed = reject;
        }),
      ]);
      A = {
        runTimer: queued("run_timer", 2, null, "mesh_wasm_"),
        destroy: queued("destroy", 1),
        exportDatabase: queued("export_database", 3, "number"),
        importDatabase: queued("import_database", 3, "number"),
        popConfigEvent: plain("pop_config_event", "number", 4),
        getNodeCompositionJson: plain("get_node_composition_json", "number", 3),
        getProjectStateJson: plain("get_project_state_json", "number", 3),
        receiveSerial: queued("receive_serial", 3),
        startScan: plain("start_scan", null, 1),
        stopScan: plain("stop_scan", null, 1),
        clearScanDevices: plain("clear_scan_devices", null, 1),
        // (handle, uuid, netKey, netKeyIndex, 0, ivIndex): the 0 is not the
        // Invite's attention, whatever it looks like.
        startProvisioning: queued("start_provisioning", 6),
        continueProvisioning: queued("continue_provisioning", 3),
        stopProvisioning: plain("stop_provisioning", null, 1),
        configureMesh: queued("configure_mesh", 10),
        // (handle, uuid, mac, name): names the node configure_mesh last
        // pointed at; name is a C string.
        setNodeIdentity: queued("set_node_identity", 4),
        compositionGet: queued("composition_get", 2),
        retryCompositionGet: queued("retry_composition_get", 2),
        appKeyAdd: queued("app_key_add", 3),
        verifyAppKeyAdd: queued("verify_app_key_add", 1),
        // (handle, element, model, AppKey index): the model comes first.
        modelAppBind: queued("model_app_bind", 4),
        // (handle, operation, element, model, address, AppKey index, TTL,
        // period, retransmit); 0 when the wasm refuses it.
        configureModel: queued("configure_model", 9, "number"),
        genericOnOffSet: queued("generic_onoff_set", 4),
        // (handle, element, AppKey index, lightness, temperature, CTL): 1
        // when sent, a negative refusal otherwise.
        lightingSet: queued("lighting_set", 6, "number"),
        receiveGattProxy: queued("receive_gatt_proxy", 3),
        receiveGattProvisioning: queued("receive_gatt_provisioning", 3),
        // A plain call aborts: the wasm runs it asynchronously.
        setGattMode: queued("set_gatt_mode", 2),
        // Sends the proxy filter (accept LOCAL and the target); returns how
        // many Filter Status replies it expects.
        gattProxyFilter: queued("gatt_proxy_filter", 1, "number"),
        // start_provisioning's arguments, over PB-GATT.
        startGattProvisioning: queued("start_gatt_provisioning", 6),
        // (handle, local, target, netKeyIndex, netKey, ivIndex)
        configureGattProxy: queued("configure_gatt_proxy", 6),
      };
      h = await M.ccall("mesh_wasm_dongle_create", "number", [], [], {
        async: true,
      });
      register();
      await refresh();
      // Nodes added before the wasm kept ids take their cached one, once.
      const unnamed = (project?.nodes || []).filter(
        (/** @type {any} */ raw) => unknownId(raw.deviceUUID),
      );
      for (const raw of unnamed) {
        const unicast = hex4(raw.unicast);
        try {
          await identify(
            owner(unicast),
            stored(nodesKey()).find((node) => node.unicast === unicast)?.id ||
              randomHex(),
          );
        } catch (error) {
          log(`# ${unicast} id not written: ${/** @type {Error} */ (error).message}`);
        }
      }
      if (unnamed.length) await refresh();
      setInterval(poll, 100);
      // This async call closes the database, which suspends the wasm.
      addEventListener("pagehide", () => void A.destroy(h));
      log(`# mesh engine ready, ${project?.nodes?.length || 0} nodes`);
    };

    /** match(event) is true when done, an Error when failed, undefined when not ours.
     * @param {(event: any) => true | Error | undefined} match @param {number} ms @param {() => unknown} call */
    const request = (match, ms, call) => {
      /** @type {(event: any) => void} */
      let waiter = () => {};
      const done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`no reply in ${ms / 1000} s`));
        }, ms);
        waiter = (event) => {
          const result =
            event.kind === "lost" ? new Error(event.message) : match(event);
          if (result === undefined) return;
          clearTimeout(timer);
          waiters.delete(waiter);
          if (result === true) resolve(event);
          else reject(result);
        };
        waiters.add(waiter);
      });
      return Promise.resolve()
        .then(call)
        .then(
          () => done,
          (error) => {
            waiters.delete(waiter);
            done.catch(() => {});
            throw error;
          },
        );
    };

    /** @param {"config" | "generic"} kind @param {number} type */
    const result = (kind, type) => (/** @type {any} */ event) => {
      if (event.kind !== kind || event.eventType !== type) return undefined;
      if (event.phase === 2)
        return event.status === 0 || new Error(statusText(event));
      if (event.phase === 3) return new Error(statusText(event));
      return undefined;
    };
    /** @param {number} type */
    const configResult = (type) => result("config", type);
    /** @param {number} type */
    const genericResult = (type) => result("generic", type);

    // Provisioning and later configuration must use the same fresh keys.
    const fresh = { net: randomHex(), app: randomHex() };
    /** Application keys added this session, before the wasm's project state lists them. @type {Map<number, string>} */
    const freshApplicationKeys = new Map();
    // Every configure_mesh overwrites the stored keys and IV index, so keys
    // the nodes never got would silence the whole network: new keys only for
    // a network without nodes.
    const keys = () => {
      const net = project?.netKeys?.[0]?.netKey;
      const app =
        project?.appKeys?.find(
          (/** @type {any} */ entry) =>
            (entry.appKeyIndex ?? SETUP_KEY) === SETUP_KEY,
        )?.key || project?.appKeys?.[0]?.key;
      if (!project || ((!net || !app) && project.nodes?.length))
        throw new Error("the network's keys cannot be read; reconnect");
      return {
        net: net || fresh.net,
        app: app || fresh.app,
        iv: project.ivIndex ?? 0,
      };
    };

    /** @param {number} index @returns {string | null} */
    const appKeyOf = (index) => {
      const key = project?.appKeys?.find(
        (/** @type {any} */ entry) =>
          (entry.appKeyIndex ?? SETUP_KEY) === index,
      )?.key;
      return typeof key === "string" ? key : null;
    };

    // Allocate after the highest address occupied by a node's elements.
    const nextUnicast = () =>
      Math.max(
        LOCAL,
        project?.localNode?.primary || 0,
        ...(project?.nodes || []).map(
          (/** @type {any} */ node) =>
            node.unicast + Math.max(1, node.numElements || 1) - 1,
        ),
      ) + 1;

    /**
     * Points the wasm's Config Client at one node, and over GATT reaches a
     * proxy unless `reach` is false. An Add's steps reuse the keys its
     * provision took.
     * @param {{unicast: number, elements: number, devKey: string, keys?: {net: string, app: string, iv: number}, keyIndex?: number, appKey?: string}} node
     */
    const configure = async (
      { unicast, elements, devKey, keys: taken, keyIndex, appKey },
      reach = true,
    ) => {
      const { net, app, iv } = taken || keys();
      await A.configureMesh(
        h,
        LOCAL,
        unicast,
        elements,
        bytesOf(devKey),
        NET_KEY_INDEX,
        bytesOf(net),
        keyIndex ?? SETUP_KEY,
        bytesOf(appKey ?? app),
        iv,
      );
      if (reach && via === "gatt") await proxy(unicast, taken);
    };

    /** Writes a node's id into the wasm's record of it. @param {Parameters<typeof configure>[0]} node @param {string} id */
    const identify = async (node, id) => {
      await configure(node, false);
      await A.setNodeIdentity(h, bytesOf(id), new Uint8Array(6), new Uint8Array(1));
    };

    /** @param {any} device @returns {Promise<MeshPort>} one that answered the filter */
    const openProxy = async (device) => {
      /** @type {MeshPort | null} */
      let opened = null;
      opened = await planner.meshTransportGatt.open(device, "proxy", {
        receive: (bytes) => {
          // From a node to us, a proxy configuration PDU is a Filter Status.
          if (bytes[0] === 0x02) gatt.filtered();
          ownHeard(bytes, true);
          void A.receiveGattProxy(h, bytes, bytes.length).catch(
            (/** @type {Error} */ error) =>
              log(`# GATT receive failed: ${error.message}`),
          );
        },
        lost: () => {
          if (!opened || gatt.proxy !== opened) return;
          gatt.proxy = null;
          void A.setGattMode(h, 0).catch(() => {});
          heard({ kind: "lost", message: "the proxy disconnected" });
          log("# proxy disconnected; seeking another");
          void proxy(gatt.target).catch(() => {});
        },
      });
      gatt.opening = opened;
      try {
        await A.setGattMode(h, 1);
        for (let sent = 1; ; sent += 1) {
          const answered = new Promise((resolve) => {
            gatt.filtered = () => resolve(true);
          });
          await A.gattProxyFilter(h);
          if (await Promise.race([answered, sleep(FILTER_WAIT_MS)])) break;
          if (sent === 2)
            throw new Error("the proxy did not answer its filter");
          log("# no Filter Status; proxy filter sent again");
        }
        // The wasm's filter passes only its own address and the target's.
        // Without ours, replies to our own packets are not heard.
        await ownFilter(opened).catch((/** @type {Error} */ error) =>
          log(`# own address not added to the proxy filter: ${error.message}`),
        );
      } catch (error) {
        void A.setGattMode(h, 0).catch(() => {});
        await opened.close();
        throw error;
      } finally {
        gatt.opening = null;
        gatt.filtered = () => {};
      }
      return opened;
    };

    // Any open proxy relays to every node. Else the device last sought on,
    // which after an Add is the new node restarting as a proxy, then every
    // device this origin may reach, until PROXY_RETRY_MS. None answering
    // ends the connection: the chooser needs a press, and Reconnect is one.
    /** @param {number} unicast @param {{net: string, iv: number}} [taken] */
    const proxy = (unicast, taken) =>
      (gatt.reaching ??= (async () => {
        gatt.target = unicast;
        if (gatt.proxy) return;
        const { net, iv } = taken || keys();
        await A.configureGattProxy(
          h,
          LOCAL,
          unicast,
          NET_KEY_INDEX,
          bytesOf(net),
          iv,
        );
        for (const end = Date.now() + PROXY_RETRY_MS; via === "gatt";) {
          const devices = [
            gatt.last,
            ...(await planner.meshTransportGatt.permitted()),
          ]
            .filter(Boolean)
            .filter(
              (device, index, all) =>
                all.findIndex((other) => other.id === device.id) === index,
            );
          for (const device of devices) {
            if (via !== "gatt") break;
            try {
              const opened = await openProxy(device);
              if (via !== "gatt") {
                await opened.close();
                break;
              }
              gatt.proxy = opened;
              gatt.last = device;
              log(`# proxy ${device.name || device.id} connected`);
              return;
            } catch (error) {
              log(
                `# proxy ${device.name || device.id} not reached: ${/** @type {Error} */ (error).message}`,
              );
            }
          }
          if (Date.now() > end) break;
          await sleep(1500);
        }
        if (via !== "gatt") throw new Error("not connected");
        gatt.unreached = true;
        lost("no node in reach");
        throw new Error("no node in reach");
      })().finally(() => {
        gatt.reaching = null;
      }));

    /** @param {any[]} elements composition or project state elements @param {MeshNode["elements"]} [known] */
    const elementsOf = (elements, known = []) =>
      elements.map((element) => {
        const address = hex4(num(element.address ?? element.unicast));
        const saved = known.find((entry) => entry.address === address);
        return {
          address,
          models: (element.models || []).map((/** @type {any} */ model) => {
            const id = modelHex(num(model.id ?? model.modelId));
            const previous = saved?.models.find((entry) => entry.id === id);
            return {
              id,
              keys: [...new Set([
                ...(previous?.keys || []),
                ...(model.boundAppKeys || []).map(Number),
              ])].sort((a, b) => a - b),
              ...(previous?.publish === undefined
                ? {}
                : { publish: previous.publish }),
              ...(previous?.subscribe === undefined
                ? {}
                : { subscribe: [...previous.subscribe] }),
            };
          }),
        };
      });

    /** @param {any} raw @param {MeshNode} [known] what was listed last @returns {MeshNode} */
    const nodeOf = (raw, known) => {
      /** @param {string} [id] */
      const real = (id) => (unknownId(id) ? "" : id);
      /** @type {MeshNode} */
      const node = {
        // The cached id stands only until load writes it into the wasm.
        id: real(raw.deviceUUID) || real(known?.id) || randomHex(),
        unicast: hex4(raw.unicast),
        name: raw.name || known?.name || "",
        features: FEATURES.filter((_, bit) => (raw.features || 0) & (1 << bit)),
        elements: elementsOf(raw.elements || [], known?.elements),
        ...(known?.attention === undefined
          ? {}
          : { attention: known.attention }),
      };
      if (node.elements.length) return node;
      // The wasm forgets a node's composition when it configures it (seen on
      // hardware after an On/Off), so the last listed one stands.
      if (known?.elements.some((element) => element.models.length))
        return { ...node, features: known.features, elements: known.elements };
      return {
        ...node,
        elements: Array.from({ length: raw.numElements || 1 }, (_, index) => ({
          address: hex4(raw.unicast + index),
          models: [],
        })),
      };
    };

    /** @param {MeshNode} [added] a node Add just made, whose composition the wasm may not list yet */
    const nodes = async (added) => {
      if (restored) return restored;
      if (!M) return stored(nodesKey());
      await refresh();
      const cached = stored(nodesKey());
      const known = new Map(
        [...cached, ...(added ? [added] : [])].map((node) => [
          node.unicast,
          node,
        ]),
      );
      const list = [...(project?.nodes || [])]
        .sort((a, b) => a.unicast - b.unicast)
        .map((raw) => nodeOf(raw, known.get(hex4(raw.unicast))));
      store(list, nodesKey());
      return list;
    };

    /** "0015/1306 CTL Temperature Server" @param {string} element @param {string} id @param {any} [composition] */
    const label = (element, id, composition) => {
      const named = (composition?.elements || [])
        .find(
          (/** @type {any} */ entry) => hex4(num(entry.address)) === element,
        )
        ?.models?.find(
          (/** @type {any} */ model) => modelHex(num(model.id)) === id,
        )?.name;
      return `${element}/${id} ${named || planner.meshChannels.modelName(id)}`;
    };

    /** @param {number} index */
    const keyAdd = async (index) => {
      const verify = setTimeout(
        () => void A.verifyAppKeyAdd(h).catch(() => {}),
        3500,
      );
      try {
        await request(configResult(2), 10000, () =>
          A.appKeyAdd(h, NET_KEY_INDEX, index),
        );
      } finally {
        clearTimeout(verify);
      }
    };

    // A Set is repeated on a timeout: the wasm waits about a second and a
    // node may answer later, and a repeated Set changes nothing.
    /** @param {(event: any) => true | Error | undefined} match @param {() => unknown} call @param {string} what */
    const settle = async (match, call, what) => {
      for (let stalled = 0; ; stalled += 1) {
        try {
          return await request(match, 20000, call);
        } catch (error) {
          const failure = /** @type {Error} */ (error);
          if (!timedOut(failure) || stalled === 2) throw failure;
          log(`# ${what} retry ${stalled + 1}/2 after ${failure.message}`);
        }
      }
    };

    /** @param {number} element @param {number} id @param {number} index @param {string} name */
    const bindOne = async (element, id, index, name) => {
      try {
        await settle(
          configResult(3),
          () => A.modelAppBind(h, element, id, index),
          `bind ${name}`,
        );
      } catch (error) {
        throw new Error(`${name}: ${/** @type {Error} */ (error).message}`);
      }
      log(`# bound ${name}`);
    };

    /** @type {Record<MeshAddStep, (job: Job) => Promise<void>>} */
    const ADD = {
      async provision(job) {
        job.keys ??= keys();
        const { net, iv } = job.keys;
        const unicast = nextUnicast();
        /** @param {number} count */
        const fits = (count) => unicast + count - 1 < OWN;
        if (!fits(1))
          throw new Error(`no unicast address is left below ${hex4(OWN)}`);
        const device = via === "gatt" ? await job.device : null;
        await whenIdle(() => {
          A.stopScan(h);
          if (link !== 0xff) A.stopProvisioning(h);
        });
        link = 0xff;
        try {
          if (device)
            gatt.provisioning = await planner.meshTransportGatt
              .open(device, "provisioning", {
                receive: (bytes) =>
                  void A.receiveGattProvisioning(h, bytes, bytes.length).catch(
                    (/** @type {Error} */ error) =>
                      log(`# PB-GATT receive failed: ${error.message}`),
                  ),
                lost: () =>
                  heard({ kind: "lost", message: "the device disconnected" }),
              })
              .catch((error) => {
                // The browser may refuse a handle it granted ("GATT operation
                // not authorized"); Retry picks the device again.
                job.device = undefined;
                gatt.picked.delete(job.id);
                throw error;
              });
          const event = await request(
            (event) => {
              if (event.kind !== "provisioning") return undefined;
              if (event.eventType === 1) link = event.linkId;
              if (event.eventType === 2) {
                link = event.linkId;
                const count = event.caps?.[0] || 1;
                if (!fits(count))
                  return new Error(
                    `${count} elements from ${hex4(unicast)} reach ${hex4(OWN)}`,
                  );
                A.continueProvisioning(h, event.linkId, unicast).catch(
                  (/** @type {Error} */ error) =>
                    log(`# provisioning did not continue: ${error.message}`),
                );
              }
              if (event.eventType === 3)
                return (
                  (event.flags & 0x04) !== 0 ||
                  new Error(
                    `completed with flags 0x${event.flags.toString(16)}`,
                  )
                );
              if (event.eventType === 6)
                return new Error(`error flags 0x${event.flags.toString(16)}`);
              return undefined;
            },
            60000,
            () =>
              (device ? A.startGattProvisioning : A.startProvisioning)(
                h,
                bytesOf(job.id),
                bytesOf(net),
                NET_KEY_INDEX,
                0,
                iv,
              ),
          );
          job.unicast = event.unicast;
          job.elements = event.numElements;
          job.devKey = hex(event.devKey);
          // It restarts as a proxy, which the next step reaches.
          if (device) gatt.last = device;
        } catch (error) {
          await whenIdle(() => A.stopProvisioning(h));
          throw error;
        } finally {
          link = 0xff;
          const closing = gatt.provisioning;
          gatt.provisioning = null;
          await closing?.close();
        }
        // Decision 36: the wasm keeps each node's id, the Device UUID or a
        // minted one. An older record of the same device gets a minted one.
        for (const raw of project?.nodes || [])
          if (raw.deviceUUID === job.id && raw.unicast !== job.unicast)
            await identify(owner(hex4(raw.unicast)), randomHex());
        // A failed reach here would repeat the provision on Retry.
        await identify(
          /** @type {any} */ (job),
          unknownId(job.id) ? randomHex() : job.id,
        );
        await refresh();
      },

      async read(job) {
        await configure(/** @type {any} */ (job));
        let retries = 0;
        const watchdog = setInterval(() => {
          if (retries >= 2) return;
          retries += 1;
          log(`# composition retry ${retries}/2`);
          A.retryCompositionGet(h, 0).catch(() => {});
        }, 9000);
        try {
          await request(
            (event) =>
              // A timeout does not end the request while the watchdog has retries left.
              event.kind === "config" &&
              event.eventType === 1 &&
              event.phase === 3 &&
              event.status === 0xff &&
              retries < 2
                ? undefined
                : configResult(1)(event),
            45000,
            () => A.compositionGet(h, 0),
          );
        } finally {
          clearInterval(watchdog);
        }
        job.composition = await readJson(A.getNodeCompositionJson);
        if (!job.composition) throw new Error("the engine read no composition");
      },

      async appkey(job) {
        await configure(/** @type {any} */ (job));
        await keyAdd(SETUP_KEY);
      },

      // Decision 43: the setup key goes to the setup models only, one Model App
      // Bind each. A bind names element and model id, so a model listed twice in
      // one element is one target, and any bound copy counts.
      async bind(job) {
        await configure(/** @type {any} */ (job));
        const targets = () => {
          /** @type {Map<string, boolean>} */
          const bound = new Map();
          for (const element of job.composition?.elements || [])
            for (const model of element.models || []) {
              const id = modelHex(num(model.id));
              if (!planner.meshChannels.setup.includes(id)) continue;
              const key = `${hex4(num(element.address))}/${id}`;
              bound.set(
                key,
                bound.get(key) ||
                  (model.boundAppKeys || []).map(Number).includes(SETUP_KEY),
              );
            }
          return bound;
        };
        const unbound = () =>
          [...targets()].filter(([, bound]) => !bound).map(([key]) => key);
        for (const key of unbound()) {
          const [element, id] = key.split("/");
          const name = label(element, id, job.composition);
          await bindOne(
            parseInt(element, 16),
            parseInt(id, 16),
            SETUP_KEY,
            name,
          );
        }
        job.composition =
          (await readJson(A.getNodeCompositionJson)) || job.composition;
        const missing = unbound();
        if (missing.length)
          throw new Error(
            `setup key not bound: ${missing
              .map((key) => {
                const [element, id] = key.split("/");
                return label(element, id, job.composition);
              })
              .join(", ")}`,
          );
      },
    };

    /** @param {Job} job @returns {Promise<MeshNode>} */
    const run = async (job) => {
      if (!via) throw new Error("not connected");
      const resume = scanning;
      try {
        for (; job.step < STEPS.length; job.step += 1) {
          const step = STEPS[job.step];
          const unicast = job.unicast ? hex4(job.unicast) : undefined;
          emit("step", { step, status: "running", unicast });
          try {
            await ADD[step](job);
          } catch (error) {
            const message = /** @type {Error} */ (error).message;
            emit("step", { step, status: "failed", message });
            log(`# ${step} failed: ${message}`);
            throw error;
          }
          if (pending !== job) throw new Error("Add was abandoned");
          emit("step", {
            step,
            status: "done",
            unicast: hex4(/** @type {number} */ (job.unicast)),
          });
        }
      } finally {
        if (resume && port) {
          await whenIdle(() => A.startScan(h));
        }
      }
      pending = null;
      gatt.picked.delete(job.id);
      const unicast = hex4(/** @type {number} */ (job.unicast));
      const node = (
        await nodes({
          id: job.id,
          unicast,
          name: "",
          features: FEATURES.filter(
            (_, bit) => num(job.composition?.features || 0) & (1 << bit),
          ),
          elements: elementsOf(job.composition?.elements || []),
        })
      ).find((entry) => entry.unicast === unicast);
      if (!node) throw new Error(`${unicast} is not in the engine's network`);
      markBackupChanged();
      emit("nearby-lost", { id: job.id });
      emit("nodes-changed");
      // Not awaited: a node that never answers would hold Add up.
      void ask(unicast).catch((/** @type {Error} */ error) =>
        log(`# Attention Get to ${unicast} failed: ${error.message}`),
      );
      return node;
    };

    /** The node an element address belongs to, as configure takes it. @param {string} address */
    const owner = (address) => {
      const value = parseInt(address, 16);
      const raw = (project?.nodes || []).find(
        (/** @type {any} */ node) =>
          value >= node.unicast &&
          value < node.unicast + Math.max(1, node.numElements || 1),
      );
      if (!raw) throw new Error(`no node has element ${address}`);
      return {
        unicast: raw.unicast,
        elements: raw.numElements || 1,
        devKey: raw.devKey,
      };
    };

    /** @param {{device: any, id: string, name: string, rssi: number}} heard */
    const hear = ({ device, id, name, rssi }) => {
      gatt.found.set(id, { device, name });
      if (gatt.stop && id !== pending?.id) emit("nearby", { id, name, rssi });
    };

    /** Closes the GATT links and stops the live scan. */
    const closeGatt = async () => {
      void gatt.scanning?.then((stop) => stop?.());
      gatt.scanning = null;
      gatt.stop?.();
      gatt.stop = null;
      const links = [gatt.provisioning, gatt.opening, gatt.proxy];
      if (gatt.proxy && M) void A.setGattMode(h, 0).catch(() => {});
      gatt.provisioning = gatt.opening = gatt.proxy = null;
      await Promise.all(links.map((open) => open?.close()));
    };

    /** @param {string} text */
    const lost = (text) => {
      via = "";
      port = null;
      void closeGatt();
      scanning = false;
      heard({ kind: "lost", message: text });
      log(`# ${text}`);
      emit("unplugged");
    };

    // A scanned device gives no GATT access until it is picked in the chooser,
    // which opens here, before any wait, for the press's user activation. A
    // cancelled chooser opens again on Retry.
    /** @param {Job} job */
    const chosen = (job) => {
      if (via !== "gatt" || job.device) return job;
      const picked = gatt.picked.get(job.id);
      job.device = picked
        ? Promise.resolve(picked)
        : planner.meshTransportGatt.choose(
            // A picked device's id is unknown, so it is picked unfiltered.
            job.id === ZERO_UUID
              ? {}
              : { id: job.id, name: gatt.found.get(job.id)?.name },
          );
      job.device.then(
        (device) => gatt.picked.set(job.id, device),
        () => {
          job.device = undefined;
        },
      );
      return job;
    };

    // Our own packets (decision 17): sent from a reserved address with our
    // own sequence number, so they never meet the wasm's replay state.
    // A send advances the sequence number, so the backup file falls behind:
    // restored, it would start below the nodes' replay cache.
    const sequence = async () => {
      markBackupChanged();
      const key = sequenceKey();
      return planner.meshSender.reserve(
        localStorage,
        navigator.locks,
        key,
        (await nodes()).length > 0,
      );
    };

    /** @param {MeshPort} opened */
    const ownFilter = async (opened) => {
      const { net, iv } = keys();
      const { src, seq } = await sequence();
      await opened.write(
        await planner.meshSender.proxyAddAddressesPdu({
          netKey: bytesOf(net),
          ivIndex: iv,
          src,
          seq,
          addresses: [src],
        }),
      );
    };

    /** Heard network PDUs, while a reply to our own packet is awaited. @type {Set<(pdu: Uint8Array) => void>} */
    const ownWaiters = new Set();
    /** @param {Uint8Array} frame @param {boolean} overGatt */
    const ownHeard = (frame, overGatt) => {
      if (!ownWaiters.size) return;
      for (const pdu of planner.meshSender.networkPdus(frame, overGatt))
        for (const waiter of ownWaiters) waiter(pdu);
    };

    // A node's message is heard once per transmission and relay; this is the
    // sequence number of the last reply taken from each node, so a repeat of
    // one reply never answers the next message.
    /** @type {Map<number, number>} */
    const replied = new Map();
    /**
     * Sends one unsegmented access message with the setup key to dst from our
     * own address and, given a reply opcode, resolves the reply's parameters,
     * or null when none comes.
     * @param {number} dst @param {number[]} access @param {number[]} [reply]
     * @returns {Promise<Uint8Array | null>}
     */
    const own = async (dst, access, reply) => {
      if (!via) throw new Error("not connected");
      if (via === "gatt") await proxy(owner(hex4(dst)).unicast);
      const { net, app, iv } = keys();
      const netKey = bytesOf(net);
      const key = bytesOf(app);
      const networkKeys = await planner.meshCrypto.k2(netKey);
      const { src, seq } = await sequence();
      const pdu = await planner.meshSender.accessPdu({
        netKey,
        key,
        ivIndex: iv,
        src,
        seq,
        dst,
        access: Uint8Array.from(access),
      });
      /** @type {(status: Uint8Array | null) => void} */
      let resolveReply = () => {};
      /** @type {Promise<Uint8Array | null>} */
      const heard = reply
        ? new Promise((resolve) => {
            resolveReply = resolve;
          })
        : Promise.resolve(null);
      /** @param {Uint8Array} heardPdu */
      const receive = async (heardPdu) => {
        const message = await planner.meshSender.openAccessPdu({
          net: networkKeys,
          key,
          ivIndex: iv,
          pdu: heardPdu,
        });
        if (
          reply &&
          message?.src === dst &&
          message.dst === src &&
          replied.get(dst) !== message.seq &&
          reply.every((byte, at) => message.access[at] === byte)
        ) {
          replied.set(dst, message.seq);
          resolveReply(message.access.subarray(reply.length));
        }
      };
      /** @type {(pdu: Uint8Array) => void} */
      let waiter = () => {};
      /** @type {Promise<void>} */
      let incoming = Promise.resolve();
      if (reply) {
        waiter = (heardPdu) => {
          incoming = incoming.then(() => receive(heardPdu)).catch(() => {});
        };
        ownWaiters.add(waiter);
      }
      try {
        if (via === "gatt") {
          if (!gatt.proxy) throw new Error("no proxy connected");
          await gatt.proxy.write(planner.meshCrypto.cat([0x00], pdu));
        } else {
          if (!port) throw new Error("not connected");
          await port.write(
            planner.meshSender.dongleFrame(planner.meshSender.advData(pdu)),
          );
        }
        return await Promise.race([heard, sleep(OWN_REPLY_MS).then(() => null)]);
      } finally {
        ownWaiters.delete(waiter);
      }
    };

    /** @param {MeshLinkChange} change @returns {Promise<string>} */
    const linkChange = async (change) => {
      if (!via) throw new Error("not connected");
      const kept = readRecord();
      let address = kept.groups[change.group];
      if (!address && !change.on) return "";
      if (!address) {
        const taken = new Set(Object.values(kept.groups));
        let next = 0xc000;
        while (taken.has(hex4(next))) next += 1;
        address = kept.groups[change.group] = hex4(next);
        saveRecord(kept);
        markBackupChanged();
      }

      let listed = await nodes();
      let node = listed.find((entry) =>
        entry.elements.some((element) => element.address === change.element),
      );
      let model = node?.elements
        .find((element) => element.address === change.element)
        ?.models.find((entry) => entry.id === change.model);
      if (!model) throw new Error(`no model ${change.model}`);
      const target = owner(change.element);
      let index = kept.keys[change.application] ?? 0;
      let appKey = "";
      let configured = false;

      if (change.on) {
        // A new application takes an index no record entry and no engine key
        // holds: a key left over from a lost record is not reused.
        index = kept.keys[change.application] ??=
          Math.max(
            SETUP_KEY,
            ...Object.values(kept.keys),
            ...(project?.appKeys || []).map(
              (/** @type {any} */ entry) => entry.appKeyIndex ?? SETUP_KEY,
            ),
          ) + 1;
        if (index > 0xfff) throw new Error("no application key index left");
        saveRecord(kept);
        markBackupChanged();
        appKey = appKeyOf(index) || freshApplicationKeys.get(index) || "";
        if (!appKey) {
          appKey = randomHex();
          freshApplicationKeys.set(index, appKey);
        }
        const hasKey = node?.elements.some((element) =>
          element.models.some((entry) => entry.keys.includes(index)),
        );
        if (!hasKey) {
          await configure({ ...target, keyIndex: index, appKey });
          configured = true;
          await keyAdd(index);
          await refresh();
          listed = await nodes();
          node = listed.find((entry) =>
            entry.elements.some((element) => element.address === change.element),
          );
          model = node?.elements
            .find((element) => element.address === change.element)
            ?.models.find((entry) => entry.id === change.model);
        }
        if (!model?.keys.includes(index)) {
          if (!configured)
            await configure({ ...target, keyIndex: index, appKey });
          configured = true;
          await bindOne(
            parseInt(change.element, 16),
            parseInt(change.model, 16),
            index,
            label(change.element, change.model),
          );
        }
      }

      const element = parseInt(change.element, 16);
      const modelId = parseInt(change.model, 16);
      const sentAddress =
        change.role === "publish" && !change.on ? 0 : parseInt(address, 16);
      // configure_model's operations: Publication Set, Subscription Add and
      // Subscription Delete.
      const operation =
        change.role === "publish" ? 7 : change.on ? 5 : 6;
      if (!configured) await configure(target);
      try {
        await settle(
          configResult(operation),
          async () => {
            const accepted = await A.configureModel(
              h,
              operation,
              element,
              modelId,
              sentAddress,
              change.role !== "publish"
                ? 0
                : change.on
                  ? index
                  : (kept.keys[change.application] ?? 0),
              change.role === "publish" ? PUBLISH_TTL : 0,
              0,
              0,
            );
            if (!accepted) throw new Error("the mesh engine refused it");
          },
          `${change.role} ${label(change.element, change.model)}`,
        );
      } catch (error) {
        const failure = /** @type {Error} */ (error);
        if (timedOut(failure))
          throw new Error(`no reply from ${hex4(target.unicast)}`);
        if (failure.message.startsWith("status "))
          throw new Error(`the node refused it (${failure.message})`);
        throw failure;
      }

      const cached = stored(nodesKey());
      for (const entry of cached) {
        const targetElement = entry.elements.find(
          (candidate) => candidate.address === change.element,
        );
        const cachedModel = targetElement?.models.find(
          (candidate) => candidate.id === change.model,
        );
        if (!cachedModel) continue;
        if (change.on)
          cachedModel.keys = [...new Set([...(cachedModel.keys || []), index])]
            .sort((a, b) => a - b);
        if (change.role === "publish") {
          if (change.on) cachedModel.publish = address;
          else if (cachedModel.publish === address) delete cachedModel.publish;
        } else if (change.on) {
          cachedModel.subscribe = [
            ...new Set([...(cachedModel.subscribe || []), address]),
          ];
        } else {
          cachedModel.subscribe = (cachedModel.subscribe || []).filter(
            (entryAddress) => entryAddress !== address,
          );
        }
      }
      store(cached, nodesKey());
      markBackupChanged();
      emit("nodes-changed");
      log(`# ${change.element} ${change.model} ${change.on ? "" : "un"}${change.role} ${address}`);
      return address;
    };

    /** @param {string} unicast @param {boolean} attention */
    const remember = (unicast, attention) => {
      store(
        stored(nodesKey()).map((node) =>
          node.unicast === unicast ? { ...node, attention } : node,
        ),
        nodesKey(),
      );
      if (attention) emit("nodes-changed");
    };

    // Asked once per node (decision 24): after its Add, or at the first Blink
    // of a node added before.
    // ponytail: one lost reply records no Attention for good; forgetting the
    // node and adding it again asks again.
    /** @type {Map<string, Promise<boolean>>} */
    const asking = new Map();
    /** @param {string} unicast @returns {Promise<boolean>} */
    const ask = (unicast) => {
      const known = stored(nodesKey()).find(
        (node) => node.unicast === unicast,
      )?.attention;
      if (known !== undefined) return Promise.resolve(known);
      const running =
        asking.get(unicast) ||
        own(parseInt(unicast, 16), ATTENTION_GET, ATTENTION_STATUS)
          .then((status) => {
            // A disconnect is no answer.
            if (!status && !via) throw new Error("not connected");
            remember(unicast, Boolean(status));
            log(`# ${unicast} ${status ? "has" : "has no"} Health Attention`);
            return Boolean(status);
          })
          .finally(() => asking.delete(unicast));
      asking.set(unicast, running);
      return running;
    };

    /** An output's On/Off state, read from our own address. @param {string} address */
    const onOffState = async (address) => {
      const status = await own(parseInt(address, 16), ONOFF_GET, ONOFF_STATUS);
      if (!status) throw new Error(`${address} did not report On/Off`);
      return Boolean(status[0]);
    };

    /** @param {string} unicast */
    const blink = async (unicast) => {
      const node = (await nodes()).find((entry) => entry.unicast === unicast);
      if (!node) throw new Error(`${unicast} is not in the engine's network`);
      if (await ask(unicast)) {
        await own(parseInt(unicast, 16), [
          ...ATTENTION_SET_UNACKNOWLEDGED,
          ATTENTION_S,
        ]);
        return;
      }
      const outputs = planner.meshChannels.onOffs(node);
      if (!outputs.length)
        throw new Error(`${unicast} has neither Attention nor On/Off`);
      /** @type {boolean[]} */
      const start = [];
      for (const address of outputs) start.push(await onOffState(address));
      try {
        // An even number of toggles ends each output as it began.
        for (let toggle = 1; toggle <= 2 * BLINKS; toggle += 1) {
          for (const [index, address] of outputs.entries())
            await engine.onOff(address, toggle % 2 ? !start[index] : start[index]);
          await sleep(BLINK_MS);
        }
      } catch (error) {
        await Promise.allSettled(
          outputs.map((address, index) => engine.onOff(address, start[index])),
        );
        throw error;
      }
    };
    /** A Light CTL Status's parameters. @param {string} address */
    const ctlState = async (address) => {
      const status = await own(parseInt(address, 16), CTL_GET, CTL_STATUS);
      if (!status || status.length < 4)
        throw new Error(`${address} did not report its Light CTL state`);
      return status;
    };
    // lighting_set's refusals.
    /** @type {Record<number, string>} */
    const LIGHTING_REFUSED = {
      [-1]: "the mesh engine is not configured",
      [-2]: "the temperature is outside 800–20000 K",
      [-3]: "the setup key is not bound to its Light CTL Server",
      [-4]: "the mesh engine does not hold the setup key",
      [-5]: "another request to it is still running",
    };
    /**
     * The CTL Server for a CTL Server or CTL Temperature Server element: a
     * CTL Temperature Server sits on the element after its CTL Server.
     * @param {string} address
     */
    const ctlServer = async (address) => {
      const elements = (await nodes()).flatMap((node) => node.elements);
      /** @param {string} at @param {string} id */
      const has = (at, id) =>
        elements.some(
          (element) =>
            element.address === at &&
            element.models.some((model) => model.id === id),
        );
      const before = hex4(parseInt(address, 16) - 1);
      const server = has(address, CTL_SERVER)
        ? address
        : has(address, CTL_TEMPERATURE_SERVER) && has(before, CTL_SERVER)
          ? before
          : "";
      if (!server) throw new Error(`${address} has no Light CTL Server`);
      return server;
    };
    /**
     * Sets Light CTL through the wasm, which sends only Light CTL Set, to the
     * CTL Server: the value not changed is the one it reports.
     * @param {string} address a CTL Server or CTL Temperature Server element
     * @param {{lightness?: number, temperature?: number}} change
     */
    const sendCtl = async (address, change) => {
      if (!via) throw new Error("not connected");
      const server = await ctlServer(address);
      const now = await ctlState(server);
      const lightness = change.lightness ?? (now[0] | (now[1] << 8));
      const kelvin = change.temperature ?? (now[2] | (now[3] << 8));
      await configure(owner(server));
      return settle(
        genericResult(3),
        async () => {
          const accepted = await A.lightingSet(
            h,
            parseInt(server, 16),
            SETUP_KEY,
            lightness,
            kelvin,
            1,
          );
          if (accepted !== 1)
            throw new Error(
              `${server}: ${LIGHTING_REFUSED[accepted] || "the mesh engine refused it"}`,
            );
        },
        `Light CTL ${server}`,
      );
    };
    // One Light CTL Set at a time: each reads the value it keeps, and the
    // wasm refuses a second while one runs.
    /** @type {Promise<unknown>} */
    let lighting = Promise.resolve();
    /** @param {string} address @param {{lightness?: number, temperature?: number}} change */
    const setCtl = (address, change) => {
      const running = lighting.then(() => sendCtl(address, change));
      lighting = running.catch(() => {});
      return running;
    };
    /** @param {string} address @param {number} percent */
    const lightness = async (address, percent) => {
      const event = await setCtl(address, {
        lightness: Math.round((percent * 0xffff) / 100),
      });
      emit("state", {
        address,
        lightness: Math.round((event.present * 100) / 0xffff),
      });
    };
    /**
     * The Light CTL Temperature Range its server reports, or null when it
     * reports none or one outside 800–20000 K.
     * @param {string} address a CTL Server or CTL Temperature Server element
     */
    const temperatureRange = (address) => {
      const running = lighting.then(async () => {
        if (!via) throw new Error("not connected");
        const server = await ctlServer(address);
        const status = await own(
          parseInt(server, 16),
          CTL_TEMPERATURE_RANGE_GET,
          CTL_TEMPERATURE_RANGE_STATUS,
        );
        if (!status || status.length < 5) return null;
        const min = status[1] | (status[2] << 8);
        const max = status[3] | (status[4] << 8);
        return min >= 800 && max <= 20000 && min < max ? { min, max } : null;
      });
      lighting = running.catch(() => {});
      return running;
    };
    /** @param {string} address @param {number} kelvin */
    const temperature = async (address, kelvin) => {
      const event = await setCtl(address, { temperature: Math.round(kelvin) });
      emit("state", { address, temperature: event.target });
    };
    // One link at a time: the wasm's Config Client holds one key index.
    /** @type {Promise<unknown>} */
    let linking = Promise.resolve();
    /** One Blink per node at a time. @type {Map<string, Promise<void>>} */
    const blinking = new Map();
    const ensureLoaded = async () => {
      if (M) return;
      emit("loading");
      loading ??= load();
      try {
        await loading;
      } catch (error) {
        loading = null;
        throw error;
      }
    };
    const backup = async () => {
      await ensureLoaded();
      const size = await A.exportDatabase(h, 0, 0);
      if (!Number.isInteger(size) || size <= 0 || size > MAX_DATABASE_BYTES)
        throw new Error("The network could not be read from this browser's storage.");
      let pointer = 0;
      try {
        pointer = M._malloc(size);
        if (!pointer)
          throw new Error("The network could not be read from this browser's storage.");
        const copied = await A.exportDatabase(h, pointer, size);
        if (copied !== size)
          throw new Error("The network could not be read from this browser's storage.");
        const database = M.HEAPU8.slice(pointer, pointer + size);
        let binary = "";
        for (let offset = 0; offset < database.length; offset += 0x8000)
          binary += String.fromCharCode(
            ...database.subarray(offset, offset + 0x8000),
          );
        const exported = Date.now();
        const bytes = new TextEncoder().encode(
          JSON.stringify({
            format: "mesh-planner-network",
            version: 1,
            exported,
            nodes: await nodes(),
            sender: {
              record: localStorage.getItem(sequenceKey()),
              marker: localStorage.getItem(`${sequenceKey()}:next-src`),
            },
            record: readRecord(),
            database: btoa(binary),
          }),
        );
        setBackupMarker(exported, false);
        return bytes;
      } finally {
        if (pointer) M._free(pointer);
      }
    };
    const restore = async (bytes) => {
      /** @type {any} */
      let file;
      /** @type {Uint8Array} */
      let database;
      /** @type {MeshRecord} */
      let record;
      try {
        file = JSON.parse(new TextDecoder().decode(bytes));
        const hasRecord = Object.prototype.hasOwnProperty.call(file, "record");
        record = hasRecord ? file.record : emptyRecord();
        if (
          file.format !== "mesh-planner-network" ||
          file.version !== 1 ||
          !Number.isFinite(file.exported) ||
          !Array.isArray(file.nodes) ||
          !file.nodes.every(validNode) ||
          !file.sender ||
          !(file.sender.record === null || typeof file.sender.record === "string") ||
          !(file.sender.marker === null || typeof file.sender.marker === "string") ||
          typeof file.database !== "string" ||
          file.database.length > Math.ceil(MAX_DATABASE_BYTES / 3) * 4 ||
          (hasRecord &&
            (!plainObject(record) ||
              !plainObject(record.groups) ||
              !plainObject(record.keys) ||
              !Object.values(record.groups).every(groupAddress) ||
              !Object.values(record.keys).every(keyIndex)))
        )
          throw new Error("invalid backup");
        database = Uint8Array.from(atob(file.database), (byte) =>
          byte.charCodeAt(0),
        );
        if (
          database.length > MAX_DATABASE_BYTES ||
          new TextDecoder().decode(
            database.subarray(0, DATABASE_HEADER.length),
          ) !== DATABASE_HEADER
        )
          throw new Error("invalid backup");
      } catch {
        throw new Error(
          "This file is not a Mesh Planner network backup. The network in this browser was kept.",
        );
      }
      if (via) await engine.disconnect();
      await ensureLoaded();
      let pointer = 0;
      /** @type {number} */
      let result;
      try {
        pointer = M._malloc(database.length);
        if (!pointer) throw new Error("not enough wasm memory for network backup");
        M.HEAPU8.set(database, pointer);
        result = await A.importDatabase(h, pointer, database.length);
      } finally {
        if (pointer) M._free(pointer);
      }
      if (result !== 1) {
        const messages = new Map([
          [-1, "This browser's storage for the network is unavailable. The network in this browser was kept."],
          [-2, "The mesh engine cannot read this backup's database. The network in this browser was kept."],
          [-3, "This backup is older than the network already in this project: its message counter is behind, so the nodes would ignore this browser. Import the newest backup, or import this one into a new project. The network in this browser was kept."],
          [-4, "The browser could not replace the network. The network in this browser was kept."],
        ]);
        throw new Error(
          messages.get(result) ||
            `The import failed (code ${result}). The network in this browser was kept.`,
        );
      }
      restored = file.nodes;
      store(file.nodes, nodesKey());
      saveRecord(record);
      await planner.meshSender.adopt(
        localStorage,
        navigator.locks,
        sequenceKey(),
        file.sender,
      );
      setBackupMarker(file.exported, false);
      await queue;
      await idle();
      await saveNetwork();
      reload();
    };
    const forgetNetwork = async (project) => {
      const key = `${OWN_SEQ_PREFIX}${project}`;
      for (const item of [
        `${NODES_PREFIX}${project}`,
        `${RECORD_PREFIX}${project}`,
        key,
        `${key}:next-src`,
        `${BACKUP_PREFIX}${project}`,
      ])
        localStorage.removeItem(item);
      if (localStorage.getItem(NETWORK_KEY) === project)
        localStorage.setItem(NETWORK_KEY, SWAPPING);
      const root = await navigator.storage.getDirectory();
      try {
        const copies = await root.getDirectoryHandle(COPIES);
        await copies.removeEntry(project, { recursive: true });
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "NotFoundError")
          throw error;
      }
    };

    /** @type {MeshEngine} */
    const engine = {
      events,
      capabilities: new Set(["onoff", "lightness", "ctl", "blink", "pubsub"]),
      installed,
      connect: async (transport) => {
        if (via) return;
        // Choosers open before the engine loads: they need the click's user
        // activation, which the 6 MB load would outlast.
        /** @type {MeshPort | null} */
        let opened = null;
        if (transport === "dongle")
          opened = await planner.meshTransportDongle.open({
            receive: (/** @type {Uint8Array} */ bytes) => {
              // create() sets h; bytes received before then have no reader.
              if (h) void A.receiveSerial(h, bytes, bytes.length);
            },
            lost: () => lost("dongle disconnected"),
          });
        // A network with nodes needs a proxy; without a device to seek one
        // on, the user picks it. Cancelling leaves Add working.
        else if (
          stored(nodesKey()).length &&
          (gatt.unreached ||
            !(await planner.meshTransportGatt.permitted()).length)
        )
          gatt.last = await planner.meshTransportGatt
            .choose({ proxy: true })
            .catch(() => gatt.last);
        // The scan's permission prompt needs the click's activation too. After
        // a chooser it may be spent; the pane then offers Pick device.
        if (transport === "gatt")
          gatt.scanning = planner.meshTransportGatt.scan(hear);
        try {
        if (!M) {
          emit("loading");
          loading ??= load();
          await loading;
        }
        if (!(await nodes()).length) await sequence();
      } catch (error) {
          loading = null;
          await opened?.close();
          await closeGatt();
          throw error;
        }
        via = transport;
        port = opened;
        gatt.unreached = false;
        log(`# ${transport === "dongle" ? "dongle" : "Bluetooth"} connected`);
        // The pane's list is cached from the last session; the engine has current state.
        emit("nodes-changed");
        for (const node of await nodes())
          if (node.attention === undefined)
            void ask(node.unicast).catch((/** @type {Error} */ error) =>
              log(`# Attention Get to ${node.unicast} failed: ${error.message}`),
            );
      },
      disconnect: async () => {
        const closing = port;
        const was = via;
        port = null;
        via = "";
        pending = null;
        if (M) {
          await whenIdle(() => {
            A.stopScan(h);
            A.stopProvisioning(h);
          });
        }
        scanning = false;
        heard({ kind: "lost", message: "disconnected" });
        await closing?.close();
        await closeGatt();
        if (M) {
          // Calls queued before the port closed may still write the database.
          await queue;
          await idle();
          await saveNetwork();
        }
        log(`# ${was === "gatt" ? "Bluetooth" : "dongle"} disconnected`);
      },
      projectChanged: async () => {
        if (!loading) {
          emit("nodes-changed");
          return;
        }
        // A pending Connect may already have swapped in the previous project.
        await loading.catch(() => {});
        if (!M || options.project() === network) return;
        await engine.disconnect();
        location.reload();
      },
      scan: async (on) => {
        if (!via) throw new Error("not connected");
        if (via === "gatt") {
          gatt.stop?.();
          gatt.stop = null;
          const starting =
            gatt.scanning ?? (on ? planner.meshTransportGatt.scan(hear) : null);
          gatt.scanning = null;
          const stop = await starting;
          if (on) gatt.stop = stop;
          else stop?.();
          return Boolean(gatt.stop);
        }
        await whenIdle(() => {
          if (on) {
            A.clearScanDevices(h);
            A.startScan(h);
          } else A.stopScan(h);
        });
        return on;
      },
      pick: async () => {
        if (via !== "gatt") throw new Error("not connected over Bluetooth");
        const device = /** @type {any} */ (
          await planner.meshTransportGatt.choose()
        );
        const id =
          [...gatt.found].find(
            ([, heard]) => heard.device?.id === device.id,
          )?.[0] || ZERO_UUID;
        gatt.picked.set(id, device);
        emit("nearby", { id, name: device.name || "", rssi: null });
        return id;
      },
      add: (nearbyId) => {
        // A new Add abandons a failed one.
        pending = { id: nearbyId, step: 0 };
        return run(chosen(pending));
      },
      retry: () =>
        pending
          ? run(chosen(pending))
          : Promise.reject(new Error("nothing to retry")),
      nodes: () => nodes(),
      onOff: async (address, on) => {
        if (!via) throw new Error("not connected");
        await configure(owner(address));
        const event = await request(
          genericResult(1),
          12000,
          () =>
            A.genericOnOffSet(h, parseInt(address, 16), SETUP_KEY, on ? 1 : 0),
        );
        emit("state", { address: hex4(event.src), on: Boolean(event.present) });
      },
      lightness,
      temperature,
      temperatureRange,
      blink: (unicast) => {
        if (!via) return Promise.reject(new Error("not connected"));
        const running =
          blinking.get(unicast) ||
          blink(unicast).finally(() => blinking.delete(unicast));
        blinking.set(unicast, running);
        return running;
      },
      record: async () => readRecord(),
      link: (change) => {
        const running = linking.then(() => linkChange(change));
        linking = running.catch(() => {});
        return running;
      },
      free: async (group) => {
        const kept = readRecord();
        delete kept.groups[group];
        saveRecord(kept);
        markBackupChanged();
      },
      backup,
      restore,
      backedUp: async () => backupMarker(),
      networkNodes: async (project) => stored(`${NODES_PREFIX}${project}`).length,
      forgetNetwork,
    };
    return Object.freeze(engine);
  };

  planner.meshEngine = Object.freeze({ create });
}
