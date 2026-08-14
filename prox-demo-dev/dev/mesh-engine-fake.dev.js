/**
 * Development-only MeshEngine that replays the committed fixtures in
 * dev/mesh-fixtures, so the Mesh pane runs with no hardware. This file may
 * fetch, keep mutable state and use session storage because it is never
 * included in production output.
 *
 * URL knobs: ?mesh-pace=N runs every delay N times faster,
 * ?mesh-fail=<step> fails that Add step once, ?mesh-fail-model=<id> fails
 * every Apply write to that model, and ?mesh-capabilities=onoff,… narrows
 * what it can drive, as hardware does. ?mesh-restore=refuse rejects every
 * restore. ?mesh-engine=wasm leaves the real engine in place, for the dongle.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const params = new URLSearchParams(location.search);
  const PACE = Number(params.get("mesh-pace")) || 1;
  const STEP_MS = 600 / PACE;
  // The captured scan heard the lamp every five seconds.
  const SCAN_MS = 5000 / PACE;
  const FIXTURES = "dev/mesh-fixtures/";
  const NODES_KEY = "mesh-planner:fake-nodes";
  const RECORD_KEY = "mesh-planner:fake-record";
  const BACKUP_KEY = "mesh-planner:fake-backup";
  const FAIL_MODEL = params.get("mesh-fail-model") || "";
  /** @type {MeshAddStep[]} */
  const STEPS = ["provision", "read", "appkey", "bind"];
  /** Composition feature bits, lowest first. */
  const FEATURES = ["relay", "proxy", "friend", "lowPower"];

  /** @param {number} ms */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** @param {number} value */
  const hex4 = (value) => value.toString(16).toUpperCase().padStart(4, "0");
  const randomHex = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    )
      .join("")
      .toUpperCase();

  /** @typedef {{unprovisioned: {uuid: string}, composition: {features: string, elements: {models: {id: string}[]}[]} | null, log: {text: string}[]}} Fixture */

  /** @param {string} name @returns {Promise<Fixture>} */
  const fixture = async (name) => {
    const response = await fetch(`${FIXTURES}${name}.json`);
    if (!response.ok) throw new Error(`fixture ${name} is missing`);
    return response.json();
  };

  /** @param {Fixture} capture */
  const advertisedName = (capture) =>
    capture.log
      .map((line) => /# GATT proxy (.+?) connected/.exec(line.text)?.[1])
      .find(Boolean) || "";

  /** @param {{ project: () => string }} options */
  const create = (options) => {
    const events = new EventTarget();
    /** @param {string} type @param {unknown} [detail] */
    const emit = (type, detail) =>
      events.dispatchEvent(new CustomEvent(type, { detail }));
    /** @param {string} text */
    const log = (text) => emit("log", { text });

    /** @type {{id: string, name: string, rssi: number[], capture: Fixture}[]} */
    let devices = [];
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let scanning;
    let tick = 0;
    let failOnce = params.get("mesh-fail") || "";
    /** @type {{id: string, index: number, unicast: string} | null} */
    let current = null;

    /** @returns {MeshNode[]} */
    const stored = () => JSON.parse(sessionStorage.getItem(NODES_KEY) || "[]");
    /** @param {MeshNode[]} nodes */
    const save = (nodes) =>
      sessionStorage.setItem(NODES_KEY, JSON.stringify(nodes));

    /** @returns {MeshRecord} */
    const record = () =>
      JSON.parse(
        sessionStorage.getItem(RECORD_KEY) || '{"groups": {}, "keys": {}}',
      );
    /** @param {MeshRecord} value */
    const keep = (value) =>
      sessionStorage.setItem(RECORD_KEY, JSON.stringify(value));
    const backupMarker = () => {
      try {
        const marker = JSON.parse(sessionStorage.getItem(BACKUP_KEY) || "null");
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
        BACKUP_KEY,
        JSON.stringify({ at: backupMarker().at, changed: true }),
      );

    const hear = () => {
      const known = new Set(stored().map((node) => node.id));
      for (const device of devices)
        if (!known.has(device.id) && device.id !== current?.id)
          emit("nearby", {
            id: device.id,
            name: device.name,
            rssi: device.rssi[tick % device.rssi.length],
          });
      tick += 1;
    };

    /** The first address after every node's last element. */
    const nextUnicast = () =>
      hex4(
        Math.max(
          2,
          ...stored().map(
            (node) => parseInt(node.unicast, 16) + node.elements.length,
          ),
        ),
      );

    /** @param {NonNullable<typeof current>} job @returns {Promise<MeshNode>} */
    const run = async (job) => {
      const device = devices.find((entry) => entry.id === job.id);
      if (!device?.capture.composition) throw new Error("device is not nearby");
      const { composition } = device.capture;
      for (; job.index < STEPS.length; job.index += 1) {
        const step = STEPS[job.index];
        emit("step", { step, status: "running", unicast: job.unicast });
        await wait(STEP_MS);
        if (current !== job) throw new Error("Add was abandoned");
        if (failOnce === step) {
          failOnce = "";
          emit("step", { step, status: "failed", message: "timed out" });
          log(`# ${step} failed: timed out`);
          throw new Error("timed out");
        }
        if (step === "provision") job.unicast = nextUnicast();
        emit("step", { step, status: "done", unicast: job.unicast });
        log(`# ${step} done for ${job.unicast}`);
      }
      const base = parseInt(job.unicast, 16);
      /** @type {MeshNode} */
      const node = {
        id: device.id,
        unicast: job.unicast,
        name: device.name,
        features: /** @type {MeshNode["features"]} */ (
          FEATURES.filter(
            (_, bit) => parseInt(composition.features, 16) & (1 << bit),
          )
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
      const duplicate = node.id && !/^0+$/.test(node.id)
        ? nodes.find(
            (cached) => cached.id === node.id && cached.unicast !== node.unicast,
          )
        : null;
      if (duplicate) duplicate.id = randomHex();
      save([...nodes, node]);
      markChanged();
      current = null;
      emit("nearby-lost", { id: device.id });
      emit("nodes-changed");
      return node;
    };

    /** @type {MeshEngine} */
    const engine = {
      events,
      capabilities: new Set(
        (params.get("mesh-capabilities") ?? "onoff,lightness,ctl,blink,pubsub").split(
          ",",
        ),
      ),
      connect: async (transport) => {
        const [server, client, reset] = await Promise.all(
          ["phone-gatt-server", "phone-gatt-client", "server-after-reset"].map(
            fixture,
          ),
        );
        const heard = reset.log
          .map((line) => Number(/rssi=(-?\d+)/.exec(line.text)?.[1]))
          .filter((value) => !Number.isNaN(value));
        devices = [
          {
            id: server.unprovisioned.uuid,
            name: advertisedName(server),
            rssi: heard,
            capture: server,
          },
          // The encoder's capture never scanned, so its signal is stubbed.
          {
            id: client.unprovisioned.uuid,
            name: advertisedName(client),
            rssi: [-67],
            capture: client,
          },
        ];
        log(`# fake engine connected over ${transport}`);
      },
      disconnect: async () => {
        clearInterval(scanning);
        scanning = undefined;
        current = null;
        log("# fake engine disconnected");
      },
      scan: async (on) => {
        clearInterval(scanning);
        scanning = on ? setInterval(hear, SCAN_MS) : undefined;
        if (on) hear();
        return on;
      },
      // The chooser's pick: no signal to show.
      pick: async () => {
        const known = new Set(stored().map((node) => node.id));
        const device = devices.find((entry) => !known.has(entry.id));
        if (!device) throw new Error("no device to pick");
        emit("nearby", { id: device.id, name: device.name, rssi: null });
        return device.id;
      },
      add: (nearbyId) => {
        // A new Add abandons a failed one.
        current = { id: nearbyId, index: 0, unicast: "" };
        return run(current);
      },
      retry: () =>
        current ? run(current) : Promise.reject(new Error("nothing to retry")),
      nodes: async () => stored(),
      // Each set is heard straight back, as a node's status would be.
      onOff: async (address, on) => emit("state", { address, on }),
      lightness: async (address, lightness) =>
        emit("state", { address, lightness }),
      temperature: async (address, temperature) =>
        emit("state", { address, temperature }),
      blink: async (unicast) => log(`# fake blink ${unicast}`),
      record: async () => record(),
      link: async (change) => {
        await wait(STEP_MS);
        if (change.model === FAIL_MODEL) throw new Error("timed out");
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
        const exported = Date.now();
        const value = {
          format: "mesh-planner-fake-network",
          exported,
          nodes: stored(),
          record: record(),
        };
        sessionStorage.setItem(
          BACKUP_KEY,
          JSON.stringify({ at: exported, changed: false }),
        );
        return new TextEncoder().encode(JSON.stringify(value));
      },
      backedUp: async () => backupMarker(),
      restore: async (bytes) => {
        if (params.get("mesh-restore") === "refuse")
          throw new Error("fake engine: backup refused");
        let file;
        try {
          file = JSON.parse(new TextDecoder().decode(bytes));
          if (
            file.format !== "mesh-planner-fake-network" ||
            !Number.isFinite(file.exported) ||
            !Array.isArray(file.nodes) ||
            !file.record ||
            typeof file.record !== "object" ||
            Array.isArray(file.record)
          )
            throw new Error("invalid backup");
        } catch {
          throw new Error(
            "This file is not a Mesh Planner network backup. The network in this browser was kept.",
          );
        }
        save(file.nodes);
        keep(file.record);
        sessionStorage.setItem(
          BACKUP_KEY,
          JSON.stringify({ at: file.exported, changed: false }),
        );
        emit("nodes-changed");
      },
      networkNodes: async (project) =>
        project === options.project() ? stored().length : 0,
      forgetNetwork: async (project) => {
        if (project !== options.project()) return;
        sessionStorage.removeItem(NODES_KEY);
        sessionStorage.removeItem(RECORD_KEY);
        sessionStorage.removeItem(BACKUP_KEY);
        emit("nodes-changed");
      },
    };
    return Object.freeze(engine);
  };

  if (params.get("mesh-engine") !== "wasm")
    planner.meshEngine = Object.freeze({ create });
}
