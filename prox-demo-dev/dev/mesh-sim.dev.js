/**
 * Development-only simulated Mesh nodes, behind the browser's own device API
 * (ADR-0037). The stack receives one of these exactly as it receives a real
 * Web Bluetooth device, and cannot tell the difference.
 *
 * What a node advertises and which GATT services it exposes are derived from
 * its state, never seeded. An unprovisioned node advertises Mesh Provisioning
 * service data because nobody has provisioned it; provisioning one makes it
 * advertise as a proxy, with nothing here edited by hand. That is the whole
 * reason these exist instead of fixtures.
 *
 * Seed data is the flat table below: what a node is made of, and where it
 * starts. Nothing derivable belongs in it.
 *
 * This file may use `PlannerMeshCrypto`, which is primitives pinned by
 * published vectors. It may not name the stack's protocol layers, because two
 * implementations of one protocol that consult each other prove nothing.
 * `tools/check-mesh-seam.js` enforces that.
 */
{
  const PROVISIONING_SERVICE = "00001827-0000-1000-8000-00805f9b34fb";
  const PROXY_SERVICE = "00001828-0000-1000-8000-00805f9b34fb";
  const BATTERY_SERVICE = "0000180f-0000-1000-8000-00805f9b34fb";

  const PROVISION_DATA_IN = "00002adb-0000-1000-8000-00805f9b34fb";
  const PROVISION_DATA_OUT = "00002adc-0000-1000-8000-00805f9b34fb";
  const PROXY_DATA_IN = "00002add-0000-1000-8000-00805f9b34fb";
  const PROXY_DATA_OUT = "00002ade-0000-1000-8000-00805f9b34fb";
  const BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb";

  /**
   * The characteristics each service carries, as a real node exposes them.
   * The same four UUIDs are what the node answers on, so they are named once
   * and the shape is built from the names.
   */
  const SERVICE_SHAPE = {
    [PROVISIONING_SERVICE]: [PROVISION_DATA_IN, PROVISION_DATA_OUT],
    [PROXY_SERVICE]: [PROXY_DATA_IN, PROXY_DATA_OUT],
    [BATTERY_SERVICE]: [BATTERY_LEVEL],
  };

  /**
   * Real company identifiers, from the Bluetooth SIG's assigned numbers by way
   * of Nordic's `bluetooth-numbers-database`. A simulated node carries a real
   * company's number so what it reports looks like what hardware reports.
   */
  const COMPANY = {
    nordic: 0x0059,
    siliconLabs: 0x02ff,
    telink: 0x0211,
    signify: 0x060f,
    espressif: 0x02e5,
  };

  /** Our network, and one that is not ours. */
  const OUR_NET_KEY = "7dd7364cd842ad18c17c2b820c84c3d6";
  /** The Mesh Profile's published sample application key. */
  const OUR_APP_KEY = "63964771734fbd76e3b40519d1d94a48";
  const FOREIGN_NET_KEY = "3216d1509884b533248541792b877f98";

  /** Models by identifier, so an element lists what it actually implements. */
  const MODEL = {
    configurationServer: 0x0000,
    healthServer: 0x0002,
    genericOnOffServer: 0x1000,
    genericLevelServer: 0x1002,
    lightLightnessServer: 0x1300,
    sensorServer: 0x1100,
  };

  /**
   * Seed data. `state` is where a node starts, not what it is: provisioning
   * one moves it, and what it advertises follows from wherever it is now.
   */
  const SEED = [
    {
      id: "sim-luminaire",
      company: COMPANY.nordic,
      product: 0x0001,
      version: 0x0100,
      name: "Unprovisioned Luminaire",
      uuid: "70cf7c9732a345b691494810d2e9cbf4",
      oob: 0x0000,
      state: "unprovisioned",
      elements: [
        [MODEL.configurationServer, MODEL.healthServer, MODEL.lightLightnessServer],
      ],
    },
    {
      id: "sim-sensor-oob",
      company: COMPANY.siliconLabs,
      product: 0x0021,
      version: 0x0003,
      name: "Unprovisioned Sensor",
      uuid: "b6a1d95c4e7f48a2bd3319c6f0e27a58",
      // Output OOB, so provisioning it has to ask a human for a number.
      oob: 0x0008,
      // The number it displays. A device's own, not something the exchange
      // invents — which is why a test can ask what it is without reading it
      // out of the middle of the protocol.
      oobNumber: 4219,
      state: "unprovisioned",
      elements: [[MODEL.configurationServer, MODEL.sensorServer]],
    },
    {
      id: "sim-node-lamp",
      hops: 1,
      company: COMPANY.signify,
      product: 0x0447,
      version: 0x0201,
      name: "Ceiling Lamp 1",
      uuid: "1f0c4d8e9a2b4c5d8e7f0a1b2c3d4e5f",
      state: "provisioned",
      netKey: OUR_NET_KEY,
      devKey: "9d6dd0e96eb25dc19a40ed9914f8f03f",
      address: 0x0001,
      // The switchable model sits on the second element, as it does on real
      // multi-channel hardware. A client that addresses the node rather than
      // the element reaches nothing here, which is the point of putting it
      // there: on element zero that mistake is invisible.
      elements: [
        [
          MODEL.configurationServer,
          MODEL.healthServer,
          MODEL.lightLightnessServer,
        ],
        [MODEL.genericLevelServer, MODEL.genericOnOffServer],
      ],
    },
    {
      id: "sim-node-nokey",
      hops: 2,
      company: COMPANY.nordic,
      product: 0x0002,
      version: 0x0100,
      name: "Ceiling Lamp 2",
      uuid: "2f0c4d8e9a2b4c5d8e7f0a1b2c3d4e60",
      state: "provisioned",
      netKey: OUR_NET_KEY,
      // It has a device key, as every node does. What is held back is our
      // copy of it: `keys()` does not publish this one, so this is the node
      // whose description stays shut.
      devKey: "4f1b2c3d5e6f708192a3b4c5d6e7f809",
      withheld: true,
      address: 0x0005,
      elements: [[MODEL.configurationServer, MODEL.genericOnOffServer]],
    },
    {
      id: "sim-node-foreign",
      company: COMPANY.telink,
      product: 0x0011,
      version: 0x0007,
      name: "Neighbour Node",
      uuid: "3f0c4d8e9a2b4c5d8e7f0a1b2c3d4e61",
      state: "provisioned",
      netKey: FOREIGN_NET_KEY,
      devKey: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      address: 0x0009,
      elements: [[MODEL.configurationServer]],
    },
    {
      id: "sim-node-wide",
      hops: 3,
      hopSpread: 1,
      company: COMPANY.espressif,
      product: 0x00c3,
      version: 0x0405,
      name: "Nine-Element Driver",
      uuid: "4f0c4d8e9a2b4c5d8e7f0a1b2c3d4e62",
      state: "provisioned",
      netKey: OUR_NET_KEY,
      devKey: "c3f1a7e0b4926d58af03e21c7b6d4950",
      address: 0x000d,
      // Enough elements that its own description cannot fit one message.
      elements: [
        [MODEL.configurationServer, MODEL.healthServer, MODEL.genericOnOffServer],
        ...Array.from({ length: 8 }, () => [MODEL.genericOnOffServer]),
      ],
    },
    {
      id: "sim-node-mute",
      hops: 2,
      company: COMPANY.nordic,
      product: 0x0003,
      version: 0x0100,
      name: "Unresponsive Node",
      uuid: "5f0c4d8e9a2b4c5d8e7f0a1b2c3d4e63",
      state: "provisioned",
      netKey: OUR_NET_KEY,
      devKey: "7e1d0c9b8a7968574635241302f1e0d9",
      address: 0x0011,
      // Advertises, connects, and answers nothing. The timeout path.
      answers: false,
      elements: [[MODEL.configurationServer]],
    },
    {
      id: "sim-thermostat",
      name: "Generic Thermostat",
      state: "absent",
      elements: [],
    },
    {
      id: "sim-silent",
      name: "Silent Device",
      state: "silent",
      elements: [],
    },
  ];

  /** @param {string} text */
  const bytes = (text) => window.PlannerMeshCrypto.bytesFromHex(text);

  /** @param {Uint8Array} data */
  const view = (data) => new DataView(data.buffer, data.byteOffset, data.length);

  /**
   * What a node advertises, worked out from where it is now.
   * @param {any} node
   */
  const advertisementOf = async (node) => {
    if (node.state === "silent") return null;
    if (node.state === "absent")
      return new Map([[BATTERY_SERVICE, view(Uint8Array.of(0x64))]]);
    if (node.state === "unprovisioned") {
      const data = new Uint8Array(18);
      data.set(bytes(node.uuid));
      data[16] = (node.oob >>> 8) & 0xff;
      data[17] = node.oob & 0xff;
      return new Map([[PROVISIONING_SERVICE, view(data)]]);
    }
    // A proxy advertises the identifier its network key derives, which is why
    // provisioning a node changes what it says without anything being edited.
    const networkId = await window.PlannerMeshCrypto.k3(bytes(node.netKey));
    return new Map([
      [PROXY_SERVICE, view(window.PlannerMeshCrypto.join(Uint8Array.of(0), networkId))],
    ]);
  };

  /** Which services a node exposes follows from the same state. @param {any} node */
  const servicesOf = (node) =>
    node.state === "unprovisioned"
      ? [PROVISIONING_SERVICE]
      : node.state === "provisioned"
        ? [PROXY_SERVICE]
        : [BATTERY_SERVICE];


  /* ---- The node side of the protocol ------------------------------------ */

  /**
   * Deliberately its own implementation of the network and transport layers.
   * The stack has one too, and the two never consult each other: two
   * implementations that agree are evidence, one implementation talking to
   * itself is not (ADR-0037).
   */


  /** @param {number} value @param {number} size */
  const be = (value, size) => {
    const out = new Uint8Array(size);
    for (let at = 0; at < size; at += 1)
      out[size - 1 - at] = (value >>> (8 * at)) & 0xff;
    return out;
  };

  /** @param {number} value */
  const le16 = (value) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);

  /**
   * A proxy configuration message is sealed under a nonce of its own: type
   * three, and no CTL and TTL octet. A node that used a network nonce here
   * would decrypt what the stack sent to nothing, which is the mistake this
   * separate implementation exists to catch.
   * @param {any} of
   */
  const networkNonce = (of) =>
    window.PlannerMeshCrypto.join(
      of.proxy
        ? Uint8Array.of(0x03, 0x00)
        : Uint8Array.of(0x00, ((of.ctl & 1) << 7) | (of.ttl & 0x7f)),
      be(of.seq, 3),
      be(of.src, 2),
      Uint8Array.of(0, 0),
      be(of.ivIndex, 4),
    );

  /** @param {any} of */
  const applicationNonce = (of) =>
    window.PlannerMeshCrypto.join(
      Uint8Array.of(of.application ? 0x01 : 0x02, 0x00),
      be(of.seq, 3),
      be(of.src, 2),
      be(of.dst, 2),
      be(of.ivIndex, 4),
    );

  /** @param {Uint8Array} privacyKey @param {number} ivIndex @param {Uint8Array} sealed @param {Uint8Array} header */
  const privacy = async (privacyKey, ivIndex, sealed, header) => {
    const pecb = await window.PlannerMeshCrypto.e(
      privacyKey,
      window.PlannerMeshCrypto.join(
        new Uint8Array(5),
        be(ivIndex, 4),
        sealed.slice(0, 7),
      ),
    );
    return window.PlannerMeshCrypto.xor(header, pecb.slice(0, 6));
  };

  /** The credentials a node's own network key derives. @param {any} node */
  const credentialsOf = async (node) => {
    if (!node.credentials)
      node.credentials = await window.PlannerMeshCrypto.k2(
        bytes(node.netKey),
        Uint8Array.of(0x00),
      );
    return node.credentials;
  };

  /**
   * Page 0 of this node's own description, assembled from its seed. Every
   * number in it is a real assigned number.
   * @param {any} node
   */
  const compositionOf = (node) => {
    const head = window.PlannerMeshCrypto.join(
      le16(node.company),
      le16(node.product),
      le16(node.version),
      le16(0x000a),
      // Relay and proxy, which is what a mains-powered node reports.
      le16(0x0003),
    );
    const elements = node.elements.map((/** @type {number[]} */ models) =>
      window.PlannerMeshCrypto.join(
        le16(0x0000),
        Uint8Array.of(models.length, 0),
        ...models.map(le16),
      ),
    );
    return window.PlannerMeshCrypto.join(head, ...elements);
  };

  /**
   * The node side of the twelve-bit key index packing: two indexes to three
   * octets, the first in bits 0-11 and the second in bits 12-23. Deliberately
   * its own implementation, as the network layer is — a reader and a writer
   * that agree are evidence only when they were written apart (ADR-0037).
   * @param {number[]} indexes
   */
  const packKeyIndexes = (indexes) => {
    /** @type {number[]} */
    const out = [];
    for (let at = 0; at < indexes.length; at += 2) {
      const first = indexes[at] & 0x0fff;
      if (at + 1 === indexes.length) {
        out.push(first & 0xff, first >>> 8);
        break;
      }
      const second = indexes[at + 1] & 0x0fff;
      out.push(
        first & 0xff,
        (first >>> 8) | ((second & 0x0f) << 4),
        second >>> 4,
      );
    }
    return Uint8Array.from(out);
  };

  /**
   * Which application keys a model is bound to. A foundation model is reached
   * with the device key and is bound to none; a model that does something for
   * an application is bound to this network's application key. Null when the
   * node has no such model on that element, which is a refusal rather than an
   * empty list.
   * @param {any} node @param {number} elementAddress @param {number} modelId
   */
  const boundKeys = (node, elementAddress, modelId) => {
    const models = node.elements[elementAddress - node.address];
    if (!models || !models.includes(modelId)) return null;
    return modelId >= 0x1000 ? [0] : [];
  };

  /**
   * How a simulated network is wired. A model that does something for an
   * application publishes to a group and listens on two, which is how one
   * switch reaches a room: nothing names the lamps, they are all subscribed to
   * the same address. Group addresses are the real range, 0xc000 upwards.
   * @param {number} elementIndex @param {number} modelId
   */
  const groupsOf = (elementIndex, modelId) =>
    modelId >= 0x1000
      ? { publish: 0xc000, subscribe: [0xc000, 0xc001 + elementIndex] }
      : { publish: 0x0000, subscribe: [] };

  /**
   * What this node answers, by opcode. An opcode it does not implement is
   * recorded and ignored, which is what a real node does.
   * @param {any} node @param {number} opcode
   */
  /**
   * Which models this node will accept a message for under which kind of key.
   * Only the Configuration Server may be addressed with a device key; every
   * other model is bound to an application key and ignores anything else.
   *
   * A simulator that answered whichever key was used would let the panel talk
   * to a Health Server with a device key forever, and the first real node
   * would silently drop all three of those messages.
   * @param {number} opcode
   */
  const needsApplicationKey = (opcode) =>
    // Health Attention Get and Set, Health Fault Get, and the Generic models.
    opcode === 0x8004 || opcode === 0x8005 || opcode === 0x8031 || opcode >= 0x8200;

  /** @param {any} node @param {number} opcode @param {boolean} application */
  const keyFits = (node, opcode, application) =>
    needsApplicationKey(opcode) === application;

/**
   * Which model each of these opcodes is for. Anything not named here is the
   * Configuration Server's, which sits on a node's first element and nowhere
   * else — so a configuration message addressed to any other element reaches
   * nothing, exactly as a model message addressed to the wrong element does.
   */
  const MODEL_FOR_OPCODE = new Map([
    [0x8201, MODEL.genericOnOffServer],
    [0x8202, MODEL.genericOnOffServer],
    [0x8004, MODEL.healthServer],
    [0x8005, MODEL.healthServer],
    [0x8031, MODEL.healthServer],
  ]);

  /** @param {any} node @param {number} opcode @param {number} dst */
  const elementHasModel = (node, opcode, dst) =>
    boundKeys(
      node,
      dst,
      MODEL_FOR_OPCODE.get(opcode) ?? MODEL.configurationServer,
    ) !== null;

  /**
   * Whether a message addressed here is for this node at all: one of its
   * element addresses, all-nodes, or a group one of its models listens on.
   *
   * A node that answers whatever it can decrypt answers messages meant for its
   * neighbours, and a client addressing the wrong one of them never finds out.
   * @param {any} node @param {number} dst
   */
  const addressedToUs = (node, dst) => {
    if (dst === 0xffff) return true;
    const element = dst - node.address;
    if (element >= 0 && element < node.elements.length) return true;
    return node.elements.some((/** @type {number[]} */ models, /** @type {number} */ index) =>
      models.some((id) => groupsOf(index, id).subscribe.includes(dst)),
    );
  };

  /**
   * How many parameter octets each message must carry. A node ignores one that
   * is too short rather than reading past the end of it — and a client that
   * built a message wrongly needs silence here, not an answer assembled out of
   * whatever happened to follow in memory.
   */
  const REQUIRED_PARAMS = new Map([
    [0x8008, 1], // Composition Data Get: the page
    [0x8005, 1], // Health Attention Set: the seconds
    [0x8031, 2], // Health Fault Get: the company
    [0x8001, 2], // Config AppKey Get: the network key index
    [0x803b, 5], // Heartbeat Subscription Set: source, destination, period
    [0x804b, 4], // Config SIG Model App Get: element and model
    [0x8018, 4], // Config Model Publication Get: element and model
    [0x8029, 4], // Config SIG Model Subscription Get: element and model
    [0x8202, 2], // Generic OnOff Set: the state and its transaction
  ]);

  /** A unicast address, which is what a heartbeat source has to be. */
  const isUnicast = (/** @type {number} */ address) =>
    address > 0x0000 && address < 0x8000;

  const answerFor = (node, opcode, parameters) => {
    const needs = REQUIRED_PARAMS.get(opcode) ?? 0;
    if (parameters.length < needs) {
      node.malformed.push(opcode);
      return null;
    }
    // Health Attention Set carries the seconds to attend for.
    if (opcode === 0x8005) {
      node.attention = parameters[0];
      node.attentionCalls += 1;
      return Uint8Array.of(0x80, 0x07, node.attention);
    }
    // Config Composition Data Get, from the SIG's assigned numbers.
    if (opcode === 0x8008)
      return window.PlannerMeshCrypto.join(
        Uint8Array.of(0x02, 0x00),
        compositionOf(node),
      );
    // Config Default TTL Get.
    if (opcode === 0x800c) return Uint8Array.of(0x80, 0x0e, node.defaultTtl);
    // Config Network Transmit Get: count in the low three bits, interval
    // steps in the rest.
    if (opcode === 0x8023) return Uint8Array.of(0x80, 0x25, 0x15);
    // Config Relay Get: relay state, then its retransmit octet.
    if (opcode === 0x8026) return Uint8Array.of(0x80, 0x28, 0x01, 0x15);
    // Config AppKey Get: which application keys this node holds under the
    // network key the request names. Status, that network key index, then the
    // application key indexes, packed.
    if (opcode === 0x8001) {
      // The index is twelve bits; the top four are reserved and not part of it.
      const asked = (parameters[0] | (parameters[1] << 8)) & 0x0fff;
      const held = node.netKeyIndex ?? 0;
      // A node asked about a network key it does not have says so, rather than
      // answering about the one it does have.
      if (asked !== held)
        return window.PlannerMeshCrypto.join(
          Uint8Array.of(0x80, 0x02, 0x04),
          packKeyIndexes([asked]),
        );
      return window.PlannerMeshCrypto.join(
        Uint8Array.of(0x80, 0x02, 0x00),
        packKeyIndexes([held]),
        packKeyIndexes(node.appKeyIndexes ?? [0]),
      );
    }
    // Config SIG Model App Get: which of them one model on one element is
    // bound to. A model this node does not have is an invalid model, not an
    // empty answer.
    if (opcode === 0x804b) {
      const element = parameters[0] | (parameters[1] << 8);
      const model = parameters[2] | (parameters[3] << 8);
      const bound = boundKeys(node, element, model);
      return window.PlannerMeshCrypto.join(
        Uint8Array.of(0x80, 0x4c, bound ? 0x00 : 0x02),
        le16(element),
        le16(model),
        bound ? packKeyIndexes(bound) : new Uint8Array(0),
      );
    }
    // Config Model Publication Get: where one model sends what it has to say,
    // under which application key, how far and how often.
    if (opcode === 0x8018) {
      const element = parameters[0] | (parameters[1] << 8);
      const model = parameters[2] | (parameters[3] << 8);
      const bound = boundKeys(node, element, model);
      const groups = groupsOf(element - node.address, model);
      return window.PlannerMeshCrypto.join(
        Uint8Array.of(0x80, 0x19, bound ? 0x00 : 0x02),
        le16(element),
        le16(bound && bound.length > 0 ? groups.publish : 0x0000),
        // Application key index 0, no friendship credentials.
        le16(0x0000),
        // TTL 7, one step of one second, no retransmissions.
        Uint8Array.of(0x07, 0x41, 0x00),
        le16(model),
      );
    }
    // Config SIG Model Subscription Get: which addresses a model listens on.
    if (opcode === 0x8029) {
      const element = parameters[0] | (parameters[1] << 8);
      const model = parameters[2] | (parameters[3] << 8);
      const known = boundKeys(node, element, model) !== null;
      return window.PlannerMeshCrypto.join(
        Uint8Array.of(0x80, 0x2a, known ? 0x00 : 0x02),
        le16(element),
        le16(model),
        ...(known ? groupsOf(element - node.address, model).subscribe : []).map(
          le16,
        ),
      );
    }
    // Health Fault Get: a test identifier, the company, then its fault codes.
    if (opcode === 0x8031)
      return window.PlannerMeshCrypto.join(
        Uint8Array.of(0x05, 0x00),
        le16(node.company),
        Uint8Array.from(node.faults ?? []),
      );
    // Health Attention Get and Set. Setting it is how a device is identified.
    if (opcode === 0x8004) return Uint8Array.of(0x80, 0x07, node.attention);
    // Heartbeat subscription. How many hops away this node is depends on
    // where it physically sits, which is seed data like its elements are.
    if (opcode === 0x803a || opcode === 0x803b) {
      // A Set says which source, addressed to which destination, this node is
      // to count heartbeats from, little-endian as every access payload field
      // is. Reading them rather than ignoring them is what stops a flipped
      // address looking exactly like a working one.
      if (opcode === 0x803b) {
        const source = parameters[0] | (parameters[1] << 8);
        const destination = parameters[2] | (parameters[3] << 8);
        // A source is a unicast address or nothing; a destination is a unicast
        // or a group. Anything else is an address this node cannot subscribe
        // to, and it says which of its answers is a refusal.
        const validSource = source === 0x0000 || isUnicast(source);
        const validDestination =
          destination === 0x0000 || isUnicast(destination) || destination >= 0xc000;
        if (!validSource || !validDestination)
          return window.PlannerMeshCrypto.join(
            Uint8Array.of(0x80, 0x3c, 0x01),
            le16(source),
            le16(destination),
            Uint8Array.of(0x00, 0x00, 0x00, 0x00),
          );
        // A period log above 0x11 is prohibited, and a prohibited value is not
        // a value: the message is ignored rather than answered.
        if (parameters[4] > 0x11) {
          node.malformed.push(opcode);
          return null;
        }
        node.heartbeatSource = source;
        node.heartbeatDestination = destination;
      }
      const hops = node.hops ?? 1;
      return window.PlannerMeshCrypto.join(
        Uint8Array.of(0x80, 0x3c, 0x00),
        le16(node.heartbeatSource ?? 0x0000),
        le16(node.heartbeatDestination ?? 0x0000),
        Uint8Array.of(0x02, 0x03, hops, hops + (node.hopSpread ?? 0)),
      );
    }
    // Generic OnOff, which is a server model rather than configuration: it
    // holds state somebody can see from across the room.
    if (opcode === 0x8201)
      return Uint8Array.of(0x82, 0x04, node.onOff ? 1 : 0);
    if (opcode === 0x8202) {
      node.onOff = parameters[0] === 1;
      return Uint8Array.of(0x82, 0x04, node.onOff ? 1 : 0);
    }
    node.unhandled.push(opcode);
    return null;
  };

  /**
   * Receives one access message and produces this node's reply, sealed all the
   * way back down to a network PDU.
   * @param {any} node @param {any} incoming
   */
  const replyTo = async (node, incoming) => {
    // A message under the wrong kind of key never reaches the model, so the
    // node says nothing at all — which is what the panel has to be able to
    // tell apart from a model that is not there.
    if (!keyFits(node, incoming.opcode, incoming.application)) {
      node.wrongKey.push(incoming.opcode);
      return null;
    }
    if (!elementHasModel(node, incoming.opcode, incoming.dst)) {
      node.wrongElement.push(incoming.opcode);
      return null;
    }
    const access = answerFor(node, incoming.opcode, incoming.parameters);
    if (!access) return null;
    const { encryptionKey, privacyKey, nid } = await credentialsOf(node);
    node.seq += 1;
    const seq = node.seq;
    // A model answers from the element it sits on, not from the node's first
    // one. A client that addressed an element and is handed an answer from a
    // different address has no way to tell it is the answer it asked for.
    const elementIndex = incoming.dst - node.address;
    const src =
      elementIndex >= 0 && elementIndex < node.elements.length
        ? incoming.dst
        : node.address;
    const dst = incoming.src;
    const upper = await window.PlannerMeshCrypto.ccmEncrypt(
      bytes(incoming.application ? node.appKey : node.devKey),
      applicationNonce({
        application: incoming.application,
        seq,
        src,
        dst,
        ivIndex: node.ivIndex,
      }),
      access,
      { micBytes: 4 },
    );
    // One unsegmented message holds fifteen octets; anything longer is
    // segmented, which is why the node with many elements exists.
    const total = Math.ceil(upper.length / 12);
    const segments =
      upper.length <= 15
        ? [window.PlannerMeshCrypto.join(Uint8Array.of(0x00), upper)]
        : Array.from({ length: total }, (_, index) =>
            window.PlannerMeshCrypto.join(
              Uint8Array.of(
                0x80,
                (seq >>> 6) & 0x7f,
                ((seq & 0x3f) << 2) | ((index >>> 3) & 0x03),
                ((index & 0x07) << 5) | ((total - 1) & 0x1f),
              ),
              upper.slice(index * 12, (index + 1) * 12),
            ),
          );
    const pdus = [];
    for (const [index, transport] of segments.entries()) {
      const at = seq + index;
      const sealed = await window.PlannerMeshCrypto.ccmEncrypt(
        encryptionKey,
        networkNonce({ ctl: 0, ttl: 4, seq: at, src, ivIndex: node.ivIndex }),
        window.PlannerMeshCrypto.join(be(dst, 2), transport),
        { micBytes: 4 },
      );
      const header = window.PlannerMeshCrypto.join(
        Uint8Array.of(0x04),
        be(at, 3),
        be(src, 2),
      );
      pdus.push(
        window.PlannerMeshCrypto.join(
          Uint8Array.of(((node.ivIndex & 1) << 7) | (nid & 0x7f)),
          await privacy(privacyKey, node.ivIndex, sealed, header),
          sealed,
        ),
      );
    }
    node.seq += segments.length;
    return pdus;
  };

  /**
   * A control message sealed under the proxy nonce, which is what a Filter
   * Status is: no access layer above it, a longer MIC, and a nonce of its own.
   * @param {any} node @param {Uint8Array} body @param {number} dst
   */
  const sealControl = async (node, body, dst) => {
    const { encryptionKey, privacyKey, nid } = await credentialsOf(node);
    node.seq += 1;
    const seq = node.seq;
    const src = node.address;
    const sealed = await window.PlannerMeshCrypto.ccmEncrypt(
      encryptionKey,
      networkNonce({ ctl: 1, ttl: 0, seq, src, ivIndex: node.ivIndex, proxy: true }),
      window.PlannerMeshCrypto.join(be(dst, 2), body),
      { micBytes: 8 },
    );
    // Control message, so the top bit is set and the TTL is nothing: this
    // goes to the other end of the link and no further.
    const header = window.PlannerMeshCrypto.join(
      Uint8Array.of(0x80),
      be(seq, 3),
      be(src, 2),
    );
    return window.PlannerMeshCrypto.join(
      Uint8Array.of(((node.ivIndex & 1) << 7) | (nid & 0x7f)),
      await privacy(privacyKey, node.ivIndex, sealed, header),
      sealed,
    );
  };

  /**
   * Opens an incoming network PDU. A PDU this node's key does not open is not
   * for it, which is exactly what a node in another network sees.
   * @param {any} node @param {Uint8Array} pdu @param {{proxy?: boolean}} [options]
   */
  const receive = async (node, pdu, options = {}) => {
    if (pdu.length < 14) return null;
    const { encryptionKey, privacyKey } = await credentialsOf(node);
    const sealed = pdu.slice(7);
    const header = await privacy(
      privacyKey,
      node.ivIndex,
      sealed,
      pdu.slice(1, 7),
    );
    const seq = (header[1] << 16) | (header[2] << 8) | header[3];
    const src = (header[4] << 8) | header[5];
    const ctl = (header[0] & 0x80) >>> 7;
    const opened = await window.PlannerMeshCrypto.ccmDecrypt(
      encryptionKey,
      networkNonce({
        ctl,
        ttl: header[0] & 0x7f,
        seq,
        src,
        ivIndex: node.ivIndex,
        proxy: Boolean(options.proxy),
      }),
      sealed,
      // A control message carries a longer MIC than an access message does.
      { micBytes: ctl ? 8 : 4 },
    );
    if (!opened) return null;

    // Replay protection. A node keeps the highest sequence number it has seen
    // from each source and discards anything not above it, which is what makes
    // a captured message useless to replay. It also means a client whose
    // messages do not climb is talking to a node that answers none of them —
    // and the symptom is silence, which looks like everything else that goes
    // wrong here. A simulator without this cannot show that.
    const seen = node.replay.get(src);
    if (seen !== undefined && seq <= seen) {
      node.replayed.push(seq);
      return null;
    }
    node.replay.set(src, seq);

    const dst = (opened[0] << 8) | opened[1];
    const transport = opened.slice(2);
    // A proxy configuration message is not sealed again under a key of the
    // access layer: what the network layer hands up is the message itself.
    // It is addressed to 0x0000 and is for whoever is on the other end of the
    // link, so it is not checked against this node's addresses.
    if (options.proxy) return { raw: transport, src, dst, seq };
    // Everything else has to be for this node. A network key opens every
    // message in the network, including the ones meant for its neighbours.
    if (!addressedToUs(node, dst)) {
      node.notOurs.push(dst);
      return null;
    }
    // Only unsegmented access messages reach this node; a configuration
    // request is far shorter than one segment.
    if ((transport[0] & 0x80) !== 0) return null;
    // A control message carries no application layer at all. The one this
    // node cares about is the acknowledgment of segments it has sent.
    if (ctl === 1) {
      if ((transport[0] & 0x7f) === 0x00) return { ack: true, src, dst, seq };
      return null;
    }
    // A device key secures configuration; an application key secures the
    // messages that change what a device does.
    const application = (transport[0] & 0x40) !== 0;
    const access = await window.PlannerMeshCrypto.ccmDecrypt(
      bytes(application ? node.appKey : node.devKey),
      applicationNonce({
        application,
        seq,
        src,
        // The address the message was actually sent to, which is the element's
        // and not always the node's first. Using the node's here decrypts only
        // what was addressed to element zero, and everything else reads as a
        // node that said nothing.
        dst,
        ivIndex: node.ivIndex,
      }),
      transport.slice(1),
      { micBytes: 4 },
    );
    if (!access) return null;
    const opcode =
      (access[0] & 0x80) === 0
        ? access[0]
        : (access[0] << 8) | access[1];
    return {
      opcode,
      parameters: access.slice((access[0] & 0x80) === 0 ? 1 : 2),
      application,
      aid: transport[0] & 0x3f,
      src,
      dst,
      seq,
    };
  };


  /** @param {any} seed */
  const makeDevice = (seed) => {
    const node = {
      ...seed,
      answers: seed.answers !== false,
      ivIndex: 0x12345678,
      seq: 0x000100,
      /** Opcodes this node was sent and does not implement. */
      unhandled: [],
      /** Opcodes this node was sent under a key the model does not hold. */
      wrongKey: [],
      /** Opcodes addressed to an element that does not carry their model. */
      wrongElement: [],
      /** Destinations this node was sent that are not its own. */
      notOurs: [],
      /** Opcodes whose parameters this node could not make sense of. */
      malformed: [],
      /** Destinations it had to say a segmented answer to again. */
      retransmitted: [],
      /** Destinations that never acknowledged one at all. */
      unacknowledged: [],
      /** The highest sequence number seen from each source address. */
      replay: new Map(),
      /** Sequence numbers this node discarded as already seen. */
      replayed: [],
      defaultTtl: 0x07,
      attention: 0,
      attentionCalls: 0,
      appKey: OUR_APP_KEY,
      onOff: false,
      credentials: null,
    };
    /** @type {Set<(event: any) => void>} */
    const listeners = new Set();
    /** Whoever wants to know when this device's link goes away. */
    /** @type {Set<(event: any) => void>} */
    const dropped = new Set();
    let watching = false;

    const emit = async () => {
      if (!watching) return;
      const serviceData = await advertisementOf(node);
      if (!serviceData) return;
      for (const listener of listeners)
        listener({ device, serviceData, name: node.name, rssi: -55 });
    };

    /**
     * The device side of provisioning. It is its own implementation, as the
     * network layer is: the provisioner has one too and they never consult
     * each other.
     */
    const provisioning = {
      /** @type {any} */ keys: null,
      /** @type {Uint8Array | null} */ inputs: null,
      /** @type {Uint8Array | null} */ random: null,
      /** @type {Uint8Array | null} */ secret: null,
      /** @type {Uint8Array | null} */ confirmation: null,
      /** @type {Uint8Array} */ auth: new Uint8Array(16),
      /** The one PDU type this device will accept next, or null for none. */
      /** @type {number | null} */ expecting: 0x00,
      /** @type {Uint8Array | null} */ confirmationKey: null,
      /** Whether this exchange has already been refused. */ failed: false,
    };

    /** What this device tells a provisioner it can do. */
    const capabilities = () =>
      Uint8Array.of(
        node.elements.length,
        0x00, 0x01, // the one algorithm every device supports
        0x00, // no out-of-band public key
        0x00, // no static out-of-band value
        node.oob === 0x0008 ? 0x04 : 0x00, // digits it can display
        0x00, node.oob === 0x0008 ? 0x08 : 0x00,
        0x00,
        0x00, 0x00,
      );

    /** Listeners on the provisioning bearer's outbound characteristic. */
    const provisionListeners = new Set();
    /** @param {Uint8Array} value */
    const notifyProvision = (value) => {
      const event = {
        target: {
          value: new DataView(value.buffer, value.byteOffset, value.length),
        },
      };
      // On its own turn, as the proxy characteristic already does and as a
      // radio does. Answering inside the write lets a client that assumes a
      // synchronous reply work here and fail on hardware.
      const listeners = [...provisionListeners];
      setTimeout(() => {
        for (const listener of listeners) listener(event);
      }, 0);
    };

    /** @param {BufferSource} value */
    const writeProvision = async (value) => {
      const meshCrypto = window.PlannerMeshCrypto;
      const frame = ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value);
      // Proxy PDU type 3 carries provisioning, and it segments like any other:
      // a public key is sixty-four octets, which no link carries in one write.
      const arrived = readProvisionSar(frame);
      if (!arrived || arrived.type !== 0x03) return;
      const pdu = arrived.body;
      const type = pdu[0];
      const body = pdu.slice(1);
      /** @param {number} kind @param {Uint8Array} payload */
      const answer = (kind, payload) =>
        emitProvision(0x03, meshCrypto.join(Uint8Array.of(kind), payload));
      /** @param {number} code */
      const refuse = (code) => {
        provisioning.expecting = null;
        return answer(0x09, Uint8Array.of(code));
      };

      // Provisioning is a sequence, not a set of independent messages. A
      // device that answers whichever PDU arrives can be walked straight past
      // the step that proves who is talking to it, so it says what it is
      // waiting for and refuses anything else with Unexpected PDU.
      if (provisioning.expecting === null) return;
      if (type !== provisioning.expecting) return void refuse(0x03);

      if (type === 0x00) {
        // Invite. Everything said from here on is confirmed at the end.
        provisioning.inputs = meshCrypto.join(body, capabilities());
        provisioning.expecting = 0x02;
        return answer(0x01, capabilities());
      }
      if (type === 0x02) {
        // Start. Its parameters join the confirmation inputs, and its
        // authentication method decides what this device has to prove.
        // One algorithm, and no out-of-band public key. A device asked for
        // something it does not do says the message was the wrong shape.
        if (body[0] !== 0x00 || body[1] !== 0x00) return void refuse(0x02);
        // It can only prove itself the ways its capabilities said it could.
        const canOutput = node.oob === 0x0008;
        if (body[2] !== 0x00 && !(body[2] === 0x02 && canOutput))
          return void refuse(0x02);
        provisioning.inputs = meshCrypto.join(provisioning.inputs, body);
        provisioning.expecting = 0x03;
        if (body[2] === 0x02) {
          // Output out-of-band: the number this device displays.
          provisioning.auth = new Uint8Array(16);
          new DataView(provisioning.auth.buffer).setUint32(12, node.oobNumber);
        }
        return;
      }
      if (type === 0x03) {
        // Public keys. Ours is generated here and never leaves except as its
        // two coordinates.
        const pair = await globalThis.crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          true,
          ["deriveBits"],
        );
        const raw = new Uint8Array(
          await globalThis.crypto.subtle.exportKey("raw", pair.publicKey),
        );
        const ours = raw.slice(1);
        provisioning.keys = pair;
        provisioning.inputs = meshCrypto.join(provisioning.inputs, body, ours);
        const peer = await globalThis.crypto.subtle.importKey(
          "raw",
          meshCrypto.join(Uint8Array.of(0x04), body),
          { name: "ECDH", namedCurve: "P-256" },
          false,
          [],
        );
        provisioning.secret = new Uint8Array(
          await globalThis.crypto.subtle.deriveBits(
            { name: "ECDH", public: peer },
            pair.privateKey,
            256,
          ),
        );
        provisioning.expecting = 0x05;
        return answer(0x03, ours);
      }
      if (type === 0x05) {
        // Their confirmation. Ours commits to a random we have not sent yet.
        provisioning.confirmation = body;
        provisioning.random = globalThis.crypto.getRandomValues(
          new Uint8Array(16),
        );
        const salt = await meshCrypto.s1(provisioning.inputs);
        provisioning.salt = salt;
        const key = await meshCrypto.k1(
          provisioning.secret,
          salt,
          Uint8Array.from("prck", (c) => c.charCodeAt(0)),
        );
        provisioning.confirmationKey = key;
        provisioning.expecting = 0x06;
        return answer(
          0x05,
          await meshCrypto.cmac(
            key,
            meshCrypto.join(provisioning.random, provisioning.auth),
          ),
        );
      }
      if (type === 0x06) {
        // Their random, which is what their confirmation committed to.
        //
        // Checking it here is the whole point of the exchange: the out-of-band
        // number is in the authentication value, and this is the one moment a
        // device can tell whether the other end knew it. A device that skips
        // this provisions for anybody in range who can reach it, and there is
        // nothing later that catches it — the session key is derived from the
        // shared secret and the two randoms, none of which the number touches.
        provisioning.peerRandom = body;
        const expected = await meshCrypto.cmac(
          provisioning.confirmationKey,
          meshCrypto.join(body, provisioning.auth),
        );
        if (
          meshCrypto.hexFromBytes(expected) !==
          meshCrypto.hexFromBytes(provisioning.confirmation)
        ) {
          // Confirmation Failed (Mesh Profile 5.4.4, error code 0x04).
          provisioning.failed = true;
          return void refuse(0x04);
        }
        provisioning.expecting = 0x07;
        return answer(0x06, provisioning.random);
      }
      if (type === 0x07) {
        // The network they are putting this device into, sealed under a key
        // both sides derived and neither sent.
        const salt = await meshCrypto.s1(
          meshCrypto.join(
            provisioning.salt,
            provisioning.peerRandom,
            provisioning.random,
          ),
        );
        const sessionKey = await meshCrypto.k1(
          provisioning.secret,
          salt,
          Uint8Array.from("prsk", (c) => c.charCodeAt(0)),
        );
        const sessionNonce = (
          await meshCrypto.k1(
            provisioning.secret,
            salt,
            Uint8Array.from("prsn", (c) => c.charCodeAt(0)),
          )
        ).slice(3);
        const opened = await meshCrypto.ccmDecrypt(
          sessionKey,
          sessionNonce,
          body,
          { micBytes: 8 },
        );
        if (!opened) return void refuse(0x06);
        provisioning.expecting = null;
        node.netKey = meshCrypto.hexFromBytes(opened.slice(0, 16));
        // Network key 0-15, key index 16-17, flags 18, IV index 19-22, then
        // the address this device is being given.
        node.address = (opened[23] << 8) | opened[24];
        node.devKey = meshCrypto.hexFromBytes(
          await meshCrypto.k1(
            provisioning.secret,
            salt,
            Uint8Array.from("prdk", (c) => c.charCodeAt(0)),
          ),
        );
        node.state = "provisioned";
        node.credentials = null;
        answer(0x08, new Uint8Array(0));
        // What it advertises follows from where it now is.
        return void emit();
      }
    };

    /** Listeners on the proxy's outbound characteristic. */
    const notified = new Set();
    /** @param {Uint8Array} value */
    /**
     * A radio delivers each notification on its own turn, after the write that
     * provoked it has already resolved. Delivering them synchronously inside
     * the write would let a reader that stops at the first frame appear to
     * work, and a segmented answer is several frames — so the simulator is
     * asynchronous here on purpose, to keep that mistake visible (ADR-0037).
     * @param {Uint8Array} value
     */
    const notify = (value) => {
      const event = {
        target: {
          value: new DataView(value.buffer, value.byteOffset, value.length),
        },
      };
      const listeners = [...notified];
      setTimeout(() => {
        for (const listener of listeners) listener(event);
      }, 0);
    };

    /**
     * This connection's proxy filter. Every real proxy server starts with an
     * accept list that is empty, and forwards to the link only what is
     * addressed to something on it or to all-nodes — so a client that never
     * sets it gets nothing back, however correct the rest of its traffic is.
     *
     * This is seeded here rather than assumed away: a simulator that forwards
     * to whoever wrote to it lets a client that never sets a filter look
     * perfect right up until it meets hardware (ADR-0037).
     */
    const filter = { accepts: true, addresses: new Set() };

    /** @param {number} dst */
    const forwards = (dst) =>
      dst === 0xffff ||
      (filter.accepts ? filter.addresses.has(dst) : !filter.addresses.has(dst));

    /**
     * One PDU out, split across as many notifications as a link with the
     * smallest allowed MTU would need. Both Mesh Proxy Data Out and Mesh
     * Provisioning Data Out are notifications, which ATT will not fragment —
     * and a provisioning public key is sixty-four octets on its own.
     *
     * The size is worked out here rather than taken from the stack: this is a
     * property of the link that both ends have to agree on, and two sides that
     * consult each other about it prove nothing (ADR-0037).
     * @param {(value: Uint8Array) => void} out @param {number} type
     * @param {Uint8Array} pdu
     */
    const emitSar = (out, type, pdu) => {
      const payload = 23 - 3 - 1;
      if (pdu.length <= payload) {
        out(window.PlannerMeshCrypto.join(Uint8Array.of(type), pdu));
        return;
      }
      for (let at = 0; at < pdu.length; at += payload) {
        const sar = at === 0 ? 1 : at + payload >= pdu.length ? 3 : 2;
        out(
          window.PlannerMeshCrypto.join(
            Uint8Array.of((sar << 6) | type),
            pdu.slice(at, at + payload),
          ),
        );
      }
    };

    /** @param {number} type @param {Uint8Array} pdu */
    const emitProxy = (type, pdu) => emitSar(notify, type, pdu);
    /** @param {number} type @param {Uint8Array} pdu */
    const emitProvision = (type, pdu) => emitSar(notifyProvision, type, pdu);

    /**
     * A PDU arriving in pieces, one accumulator per characteristic. Returns a
     * whole PDU or null while one is still on its way.
     */
    const sarReader = () => {
      /** @type {{type: number, parts: Uint8Array[]} | null} */
      let arriving = null;
      /** @param {Uint8Array} data */
      return (data) => {
        if (data.length < 1) return null;
        const sar = (data[0] & 0xc0) >>> 6;
        const type = data[0] & 0x3f;
        const part = data.slice(1);
        if (sar === 0) {
          arriving = null;
          return { type, body: part };
        }
        if (sar === 1) {
          arriving = { type, parts: [part] };
          return null;
        }
        if (!arriving || arriving.type !== type) {
          arriving = null;
          return null;
        }
        arriving.parts.push(part);
        if (sar === 2) return null;
        const whole = {
          type,
          body: window.PlannerMeshCrypto.join(...arriving.parts),
        };
        arriving = null;
        return whole;
      };
    };

    const readProxySar = sarReader();
    const readProvisionSar = sarReader();

    /** A segmented answer this node has sent and not been told arrived. */
    /** @type {{pdus: Uint8Array[], to: number, left: number, timer: any} | null} */
    let unacknowledged = null;

    /**
     * How long this node waits to be told its segments arrived, and how many
     * times it says them again before giving up. Short here because a test
     * should not have to wait out a radio's patience; a real node's window is
     * longer and its symptom is the same.
     */
    const ACK_WAIT_MS = 150;
    const ACK_ATTEMPTS = 2;

    /** @param {Uint8Array[]} pdus @param {number} to */
    const awaitAck = (pdus, to) => {
      if (unacknowledged) clearTimeout(unacknowledged.timer);
      const again = () => {
        if (!unacknowledged) return;
        if (unacknowledged.left <= 0) {
          node.unacknowledged.push(to);
          unacknowledged = null;
          return;
        }
        unacknowledged.left -= 1;
        node.retransmitted.push(to);
        for (const pdu of unacknowledged.pdus) emitProxy(0x00, pdu);
        unacknowledged.timer = setTimeout(again, ACK_WAIT_MS);
      };
      unacknowledged = {
        pdus,
        to,
        left: ACK_ATTEMPTS,
        timer: setTimeout(again, ACK_WAIT_MS),
      };
    };

    /**
     * A Proxy Configuration message: set the filter type, or add and remove
     * addresses from it. Addresses here are big-endian, unlike every access
     * payload field. Answers with a Filter Status.
     * @param {Uint8Array} body
     */
    const configureProxy = async (body) => {
      const opened = await receive(node, body, { proxy: true });
      if (!opened) return;
      const message = opened.raw;
      if (message[0] === 0x00) {
        filter.accepts = message[1] === 0x00;
        filter.addresses.clear();
      } else if (message[0] === 0x01 || message[0] === 0x02) {
        for (let at = 1; at + 1 < message.length; at += 2) {
          const address = (message[at] << 8) | message[at + 1];
          if (address === 0x0000) continue;
          if (message[0] === 0x01) filter.addresses.add(address);
          else filter.addresses.delete(address);
        }
      } else return;
      const status = window.PlannerMeshCrypto.join(
        Uint8Array.of(0x03, filter.accepts ? 0x00 : 0x01),
        be(filter.addresses.size, 2),
      );
      const pdu = await sealControl(node, status, opened.src);
      if (pdu) emitProxy(0x02, pdu);
    };

    /**
     * One proxy PDU in. A node that does not answer takes the message and
     * says nothing, which is the timeout path rather than a failure.
     * @param {BufferSource} value
     */
    const writeProxy = async (value) => {
      // A view and a buffer both arrive here, and either may come from
      // another realm, so the check cannot be an instanceof.
      const data = ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value);
      // Two bits of segmentation, six of type. A message arriving in pieces is
      // put back together here rather than being dropped, because a client
      // whose PDU does not fit one write has no other way across.
      const arrived = readProxySar(data);
      if (!arrived) return;
      const { type, body: whole } = arrived;

      // A node that answers nothing answers nothing. The filter is a message
      // like any other, and a client that gets a Filter Status back from an
      // unresponsive node has been told something untrue about it.
      if (!node.answers) return;
      if (type === 0x02) return void configureProxy(whole);
      if (type !== 0x00) return;
      const incoming = await receive(node, whole);
      if (!incoming) return;
      // Told its segments arrived, this node stops saying them.
      if (incoming.ack) {
        if (unacknowledged) clearTimeout(unacknowledged.timer);
        unacknowledged = null;
        return;
      }
      if (!node.answers) return;
      const pdus = await replyTo(node, incoming);
      if (!pdus) return;
      // The filter is applied to what leaves, exactly as a real proxy applies
      // it: an answer addressed to a client that never listed itself is
      // dropped here, and the client sees silence.
      if (!forwards(incoming.src)) return;
      for (const pdu of pdus) emitProxy(0x00, pdu);
      // A segmented answer is not finished when it has been sent. The sender
      // waits to be told which segments arrived and retransmits until it is,
      // so a client that only listens is one this node keeps talking to.
      if (pdus.length > 1) awaitAck(pdus, incoming.src);
    };

    /** @param {string} uuid */
    const characteristic = (uuid) => ({
      uuid,
      /** @param {BufferSource} value */
      writeValue: (value) => {
        // Writing into a link that has gone is an error, not a no-op. A page
        // that treats it as one goes on talking to a device that left.
        if (!gatt.connected)
          return Promise.reject(notFound("The GATT link"));
        return uuid === PROXY_DATA_IN
          ? writeProxy(value)
          : uuid === PROVISION_DATA_IN
            ? writeProvision(value)
            : Promise.resolve();
      },
      writeValueWithoutResponse(/** @type {BufferSource} */ value) {
        return this.writeValue(value);
      },
      async startNotifications() {
        return characteristic(uuid);
      },
      /** @param {string} type @param {(event: any) => void} listener */
      addEventListener(type, listener) {
        if (type !== "characteristicvaluechanged") return;
        if (uuid === PROXY_DATA_OUT) notified.add(listener);
        if (uuid === PROVISION_DATA_OUT) provisionListeners.add(listener);
      },
      /** @param {string} type @param {(event: any) => void} listener */
      removeEventListener(type, listener) {
        notified.delete(listener);
        provisionListeners.delete(listener);
      },
    });

    /**
     * What the browser throws when something is not there. A device that hands
     * back whatever was asked for lets a page reach a service the device does
     * not have — and the first real one answers with this instead.
     * @param {string} what
     */
    const notFound = (what) => {
      const error = new Error(`${what} is not on this device.`);
      error.name = "NotFoundError";
      return error;
    };

    /** @param {string} uuid */
    const serviceOf = (uuid) => {
      if (!servicesOf(node).includes(uuid)) throw notFound(uuid);
      return {
        uuid,
        async getCharacteristics() {
          if (!gatt.connected) throw notFound("The GATT link");
          return SERVICE_SHAPE[uuid].map(characteristic);
        },
        /** @param {string} id */
        async getCharacteristic(id) {
          if (!gatt.connected) throw notFound("The GATT link");
          // A service carries the characteristics it carries. Handing back one
          // it does not have is how a page ends up writing into nothing.
          if (!SERVICE_SHAPE[uuid].includes(id)) throw notFound(id);
          return characteristic(id);
        },
      };
    };

    const gatt = {
      connected: false,
      async connect() {
        gatt.connected = true;
        return {
          async getPrimaryServices() {
            if (!gatt.connected) throw notFound("The GATT link");
            return servicesOf(node).map(serviceOf);
          },
          /** @param {string} uuid */
          async getPrimaryService(uuid) {
            if (!gatt.connected) throw notFound("The GATT link");
            return serviceOf(uuid);
          },
        };
      },
      disconnect() {
        if (!gatt.connected) return;
        gatt.connected = false;
        notified.clear();
        // A real device tells the page its link went away, and does it on its
        // own turn rather than inside the call that ended it.
        const listeners = [...dropped];
        setTimeout(() => {
          for (const listener of listeners) listener({ target: device });
        }, 0);
      },
    };

    const device = {
      id: node.id,
      name: node.name,
      /** Not real hardware, and every surface that shows it says so. */
      simulated: true,
      gatt,
      /** @param {string} type @param {(event: any) => void} listener @param {any} [options] */
      addEventListener(type, listener, options) {
        if (type === "advertisementreceived") listeners.add(listener);
        if (type === "gattserverdisconnected") dropped.add(listener);
        options?.signal?.addEventListener("abort", () => {
          listeners.delete(listener);
          dropped.delete(listener);
        });
      },
      /** @param {string} type @param {(event: any) => void} listener */
      removeEventListener(type, listener) {
        if (type === "advertisementreceived") listeners.delete(listener);
        if (type === "gattserverdisconnected") dropped.delete(listener);
      },
      /** @param {{ signal?: AbortSignal }} [options] */
      async watchAdvertisements(options = {}) {
        watching = true;
        options.signal?.addEventListener("abort", () => {
          watching = false;
        });
        // A real radio reports after the call returns, never during it.
        setTimeout(() => void emit(), 0);
      },
      /** The node behind the device, for tests and for provisioning. */
      node,
      /**
       * Provisioning moves the node, and what it advertises follows. Nothing
       * about its advertisement or its services is written here.
       * @param {{ netKey: string, devKey: string, address: number }} into
       */
      provision(into) {
        node.state = "provisioned";
        node.netKey = into.netKey;
        node.devKey = into.devKey;
        node.address = into.address;
        return emit();
      },
    };
    return device;
  };

  /** @param {number} address */
  const addressHex = (address) => `0x${address.toString(16).padStart(4, "0")}`;

  window.PlannerMeshSim = {
    /**
     * The key material this simulated network runs on. Published so nobody has
     * to transcribe it out of the seed table, and so it cannot be transcribed
     * wrongly: there is one copy and this is it.
     */
    keys: () => ({
      netKey: OUR_NET_KEY,
      netKeyIndex: 0,
      ivIndex: "12345678",
      address: "0x07ff",
      sequence: 1,
      appKeys: { "0": OUR_APP_KEY },
      devKeys: Object.fromEntries(
        SEED.filter(
          (seed) => seed.netKey === OUR_NET_KEY && seed.devKey && !seed.withheld,
        ).map((seed) => [addressHex(seed.address), seed.devKey]),
      ),
    }),
    /** A Bluetooth adapter's worth of simulated nodes. */
    create() {
      const devices = SEED.map(makeDevice);
      return {
        bluetooth: {
          async getDevices() {
            return devices;
          },
        },
        devices,
      };
    },
    seedCount: SEED.length,
    /**
     * The number a device displays when it is asked to prove itself. Published
     * so nobody has to transcribe it out of the seed table, and so it cannot
     * be transcribed wrongly.
     * @param {string} id
     */
    oobNumberOf: (id) => SEED.find((seed) => seed.id === id)?.oobNumber ?? 0,
  };
}
