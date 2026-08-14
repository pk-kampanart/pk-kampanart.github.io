/**
 * Development-only Mesh protocol layers: the network layer, the transport
 * layers, the access layer, and the Configuration Client built on them. It
 * uses `PlannerMeshCrypto` for primitives and knows nothing about where its
 * bytes come from — a real adapter and a simulated node are the same thing
 * from here (ADR-0037).
 *
 * Loaded only by the development server and development build (ADR-0013).
 *
 * Every constant below is from a published source, named at its table. The
 * ones that are not are marked, because a wrong opcode works perfectly against
 * a simulated node and fails against every real one.
 */
{
  const crypto = () => window.PlannerMeshCrypto;

  /**
   * Opcodes, from the Bluetooth SIG's own published assigned numbers
   * (`assigned_numbers/mesh/mesh_opcodes.yaml`). Not from memory.
   */
  const OPCODE = {
    compositionDataGet: 0x8008,
    compositionDataStatus: 0x02,
    defaultTtlGet: 0x800c,
    defaultTtlStatus: 0x800e,
    relayGet: 0x8026,
    relayStatus: 0x8028,
    networkTransmitGet: 0x8023,
    networkTransmitStatus: 0x8025,
    appKeyGet: 0x8001,
    appKeyList: 0x8002,
    modelAppBind: 0x803d,
    modelAppStatus: 0x803e,
    sigModelAppGet: 0x804b,
    sigModelAppList: 0x804c,
    modelPublicationGet: 0x8018,
    modelPublicationStatus: 0x8019,
    sigModelSubscriptionGet: 0x8029,
    sigModelSubscriptionList: 0x802a,
    healthFaultGet: 0x8031,
    healthFaultStatus: 0x05,
    attentionGet: 0x8004,
    attentionSet: 0x8005,
    attentionStatus: 0x8007,
    heartbeatSubscriptionGet: 0x803a,
    heartbeatSubscriptionSet: 0x803b,
    heartbeatSubscriptionStatus: 0x803c,
    heartbeatPublicationSet: 0x8039,
    // Generic OnOff, confirmed against two independent stacks.
    genericOnOffGet: 0x8201,
    genericOnOffSet: 0x8202,
    genericOnOffStatus: 0x8204,
  };

  /** The name to show for an opcode, so an unexpected one is still readable. */
  const OPCODE_NAME = new Map(
    Object.entries(OPCODE).map(([name, value]) => [value, name]),
  );

  /**
   * Foundation model identifiers are from the SIG's
   * `assigned_numbers/mesh/mesh_model_uuids.yaml`. The Generic range is from
   * the Mesh Model specification, which the SIG does not publish as data. An
   * identifier missing from this table is shown as its number, never guessed
   * at, and one whose name could not be corroborated against a published table
   * says so where it is shown rather than reading as settled.
   */
  const MODEL_NAME = new Map([
    [0x0000, "Configuration Server"],
    [0x0001, "Configuration Client"],
    [0x0002, "Health Server"],
    [0x0003, "Health Client"],
    [0x0004, "Remote Provisioning Server"],
    [0x0005, "Remote Provisioning Client"],
    [0x0006, "Directed Forwarding Configuration Server"],
    [0x0008, "Bridge Configuration Server"],
    [0x000a, "Mesh Private Beacon Server"],
    [0x000e, "SAR Configuration Server"],
    [0x0010, "Opcodes Aggregator Server"],
    [0x0012, "Large Composition Data Server"],
    [0x1000, "Generic OnOff Server"],
    [0x1001, "Generic OnOff Client"],
    [0x1002, "Generic Level Server"],
    [0x1003, "Generic Level Client"],
    [0x1006, "Generic Power OnOff Server"],
    [0x1007, "Generic Power OnOff Setup Server"],
    [0x1100, "Sensor Server"],
    [0x1101, "Sensor Setup Server"],
    [0x1102, "Sensor Client"],
    [0x1300, "Light Lightness Server"],
    [0x1301, "Light Lightness Setup Server"],
    [0x1302, "Light Lightness Client"],
    [0x1303, "Light CTL Server"],
    [0x1312, "IEC 62386-104 Model"],
  ]);

  /**
   * TEMPORARY — names taken from vendor tables rather than a published SIG
   * one. Only the displayed name is affected; nothing is decoded from these.
   * Confirming them against the Mesh Model specification removes an entry.
   */
  const MODEL_NAME_PROVISIONAL = new Set([
    0x1100, 0x1101, 0x1102, 0x1300, 0x1301, 0x1302, 0x1303, 0x1312,
  ]);

  /** The four roles a node can play, from its composition data features. */
  const FEATURE = [
    [0x0001, "Relay"],
    [0x0002, "Proxy"],
    [0x0004, "Friend"],
    [0x0008, "Low power"],
  ];

  /** Proxy PDU types (Mesh Profile 6.3.1). */
  const PROXY_TYPE = { network: 0x00, beacon: 0x01, configuration: 0x02, provisioning: 0x03 };

  /**
   * Where a proxy PDU sits in its message, in the top two bits of the first
   * octet (Mesh Profile 6.3.1).
   */
  const PROXY_SAR = { complete: 0x00, first: 0x01, continuation: 0x02, last: 0x03 };

  /**
   * How much of a proxy PDU one notification carries, after its own octet.
   *
   * Mesh Proxy Data In is write-without-response, and ATT cannot fragment one
   * of those: a Write Command carries ATT_MTU minus three. Web Bluetooth does
   * not expose the negotiated MTU, so this is the smallest an MTU can be —
   * correct on every link, and only wasteful on a generous one.
   */
  const PROXY_PAYLOAD = 23 - 3 - 1;

  /**
   * A Proxy Configuration message (Mesh Profile 6.5). The one message the
   * client has to send before anything comes back: a proxy server starts with
   * an empty accept list, so until our own unicast address is on it, every
   * answer addressed to us is dropped before it reaches the link.
   *
   * Addresses in these messages are big-endian — the one exception to the rule
   * that access payload fields are little-endian.
   */
  const PROXY_CONFIG = {
    setFilterType: 0x00,
    addAddresses: 0x01,
    removeAddresses: 0x02,
    filterStatus: 0x03,
  };

  /** The two kinds of proxy filter. */
  const PROXY_FILTER = { accept: 0x00, reject: 0x01 };

  /**
   * One proxy PDU, split across as many notifications as the link needs.
   * @param {number} type @param {Uint8Array} pdu
   */
  const splitProxy = (type, pdu) => {
    if (pdu.length <= PROXY_PAYLOAD)
      return [crypto().join(Uint8Array.of((PROXY_SAR.complete << 6) | type), pdu)];
    const segments = [];
    for (let at = 0; at < pdu.length; at += PROXY_PAYLOAD) {
      const last = at + PROXY_PAYLOAD >= pdu.length;
      const sar = at === 0
        ? PROXY_SAR.first
        : last
          ? PROXY_SAR.last
          : PROXY_SAR.continuation;
      segments.push(
        crypto().join(
          Uint8Array.of((sar << 6) | type),
          pdu.slice(at, at + PROXY_PAYLOAD),
        ),
      );
    }
    return segments;
  };

  /**
   * The other direction. Returns a whole proxy PDU, or null while one is still
   * arriving. A segment of a different type than the message in progress
   * abandons it, which is what the specification requires and what a node
   * interleaving a beacon with an answer actually does.
   */
  const makeProxyReassembly = () => {
    /** @type {{type: number, parts: Uint8Array[]} | null} */
    let pending = null;
    return {
      /** @param {Uint8Array} frame @returns {{type: number, body: Uint8Array} | null} */
      add(frame) {
        if (frame.length < 1) return null;
        const sar = (frame[0] & 0xc0) >>> 6;
        const type = frame[0] & 0x3f;
        const body = frame.slice(1);
        if (sar === PROXY_SAR.complete) {
          pending = null;
          return { type, body };
        }
        if (sar === PROXY_SAR.first) {
          pending = { type, parts: [body] };
          return null;
        }
        if (!pending || pending.type !== type) {
          pending = null;
          return null;
        }
        pending.parts.push(body);
        if (sar === PROXY_SAR.continuation) return null;
        const whole = { type, body: crypto().join(...pending.parts) };
        pending = null;
        return whole;
      },
      /** Whether a message is half-arrived, so a caller can say so. */
      pending: () => pending !== null,
    };
  };

  /** @param {number} value @param {number} size */
  const beBytes = (value, size) => {
    const out = new Uint8Array(size);
    for (let at = 0; at < size; at += 1)
      out[size - 1 - at] = (value >>> (8 * at)) & 0xff;
    return out;
  };

  /* ---- Network layer ---------------------------------------------------- */

  /** Nonce types (Mesh Profile 3.8.5). */
  const NONCE = { network: 0x00, application: 0x01, device: 0x02, proxy: 0x03 };

  /**
   * The nonce a network PDU is sealed under (Mesh Profile 3.8.5.1), or a proxy
   * configuration PDU (3.8.5.4). They differ in two octets and nothing else:
   * the type, and whether CTL and TTL are carried. A proxy message sealed
   * under a network nonce decrypts to nothing at the other end, with no clue
   * as to why.
   * @param {{ctl: number, ttl: number, seq: number, src: number,
   *   ivIndex: number, nonceType?: number}} of
   */
  const networkNonce = (of) => {
    const type = of.nonceType ?? NONCE.network;
    return crypto().join(
      Uint8Array.of(
        type,
        type === NONCE.proxy ? 0x00 : ((of.ctl & 1) << 7) | (of.ttl & 0x7f),
      ),
      beBytes(of.seq, 3),
      beBytes(of.src, 2),
      Uint8Array.of(0x00, 0x00),
      beBytes(of.ivIndex, 4),
    );
  };

  /**
   * The six obfuscated header octets, which are their own XOR inverse.
   * @param {Uint8Array} privacyKey @param {number} ivIndex
   * @param {Uint8Array} sealed @param {Uint8Array} header
   */
  const obfuscate = async (privacyKey, ivIndex, sealed, header) => {
    const input = crypto().join(
      new Uint8Array(5),
      beBytes(ivIndex, 4),
      sealed.slice(0, 7),
    );
    const pecb = await crypto().e(privacyKey, input);
    return crypto().xor(header, pecb.slice(0, 6));
  };

  /**
   * @param {{encryptionKey: Uint8Array, privacyKey: Uint8Array, nid: number,
   *   ivIndex: number, ctl: number, ttl: number, seq: number, src: number,
   *   dst: number, transport: Uint8Array, nonceType?: number}} message
   */
  const encodeNetwork = async (message) => {
    const sealed = await crypto().ccmEncrypt(
      message.encryptionKey,
      networkNonce(message),
      crypto().join(beBytes(message.dst, 2), message.transport),
      { micBytes: message.ctl ? 8 : 4 },
    );
    const header = crypto().join(
      Uint8Array.of(((message.ctl & 1) << 7) | (message.ttl & 0x7f)),
      beBytes(message.seq, 3),
      beBytes(message.src, 2),
    );
    const hidden = await obfuscate(
      message.privacyKey,
      message.ivIndex,
      sealed,
      header,
    );
    return crypto().join(
      Uint8Array.of(((message.ivIndex & 1) << 7) | (message.nid & 0x7f)),
      hidden,
      sealed,
    );
  };

  /**
   * Returns null when the network key does not open it, which is what a PDU
   * from another network looks like from here.
   * @param {{encryptionKey: Uint8Array, privacyKey: Uint8Array,
   *   ivIndex: number, pdu: Uint8Array, nonceType?: number}} message
   */
  const decodeNetwork = async (message) => {
    const { pdu } = message;
    if (pdu.length < 14) return null;
    const sealed = pdu.slice(7);
    const header = await obfuscate(
      message.privacyKey,
      message.ivIndex,
      sealed,
      pdu.slice(1, 7),
    );
    const ctl = (header[0] & 0x80) >>> 7;
    const opened = await crypto().ccmDecrypt(
      message.encryptionKey,
      networkNonce({
        ctl,
        ttl: header[0] & 0x7f,
        seq: (header[1] << 16) | (header[2] << 8) | header[3],
        src: (header[4] << 8) | header[5],
        ivIndex: message.ivIndex,
        nonceType: message.nonceType,
      }),
      sealed,
      { micBytes: ctl ? 8 : 4 },
    );
    if (!opened) return null;
    return {
      nid: pdu[0] & 0x7f,
      ctl,
      ttl: header[0] & 0x7f,
      seq: (header[1] << 16) | (header[2] << 8) | header[3],
      src: (header[4] << 8) | header[5],
      dst: (opened[0] << 8) | opened[1],
      transport: opened.slice(2),
    };
  };

  /* ---- Transport layers -------------------------------------------------- */

  /** The most an unsegmented access message carries (Mesh Profile 3.7.3). */
  const UNSEGMENTED_MAX = 15;
  /** Each segment of a segmented access message. */
  const SEGMENT_SIZE = 12;

  /**
   * The nonce an access message is sealed under. Type 1 is an application key
   * and type 2 a device key (Mesh Profile 3.8.5.2 and 3.8.5.3).
   * @param {{device: boolean, szmic: number, seq: number, src: number,
   *   dst: number, ivIndex: number}} of
   */
  const accessNonce = (of) =>
    crypto().join(
      Uint8Array.of(of.device ? 0x02 : 0x01, (of.szmic & 1) << 7),
      beBytes(of.seq, 3),
      beBytes(of.src, 2),
      beBytes(of.dst, 2),
      beBytes(of.ivIndex, 4),
    );

  /**
   * @param {{key: Uint8Array, device: boolean, aid: number, szmic?: number,
   *   seq: number, src: number, dst: number, ivIndex: number,
   *   access: Uint8Array, label?: Uint8Array}} message
   */
  const sealAccess = async (message) => {
    const szmic = message.szmic ?? 0;
    const upper = await crypto().ccmEncrypt(
      message.key,
      accessNonce({ ...message, szmic }),
      message.access,
      { micBytes: szmic ? 8 : 4, adata: message.label },
    );
    const header = Uint8Array.of(
      (message.device ? 0 : 0x40) | (message.aid & 0x3f),
    );
    if (upper.length <= UNSEGMENTED_MAX)
      return [crypto().join(header, upper)];
    const total = Math.ceil(upper.length / SEGMENT_SIZE);
    const seqZero = message.seq & 0x1fff;
    return Array.from({ length: total }, (_, index) =>
      crypto().join(
        Uint8Array.of(
          0x80 | (message.device ? 0 : 0x40) | (message.aid & 0x3f),
          ((szmic & 1) << 7) | ((seqZero >>> 6) & 0x7f),
          ((seqZero & 0x3f) << 2) | ((index >>> 3) & 0x03),
          ((index & 0x07) << 5) | ((total - 1) & 0x1f),
        ),
        upper.slice(index * SEGMENT_SIZE, (index + 1) * SEGMENT_SIZE),
      ),
    );
  };

  /**
   * Reads a lower transport PDU far enough to know what it is. A segmented one
   * carries the fields reassembly needs; an unsegmented one carries its whole
   * upper transport PDU.
   * @param {Uint8Array} pdu
   */
  const readLowerTransport = (pdu) => {
    const segmented = (pdu[0] & 0x80) !== 0;
    const base = {
      segmented,
      device: (pdu[0] & 0x40) === 0,
      aid: pdu[0] & 0x3f,
    };
    if (!segmented) return { ...base, upper: pdu.slice(1) };
    return {
      ...base,
      szmic: (pdu[1] & 0x80) >>> 7,
      seqZero: ((pdu[1] & 0x7f) << 6) | ((pdu[2] & 0xfc) >>> 2),
      segmentIndex: ((pdu[2] & 0x03) << 3) | ((pdu[3] & 0xe0) >>> 5),
      lastSegment: pdu[3] & 0x1f,
      upper: pdu.slice(4),
    };
  };

  /**
   * Collects segments until every one has arrived. A node that stops halfway
   * leaves an entry here and never completes, which is what a timeout is for.
   */
  const makeReassembly = () => {
    /** @type {Map<string, {parts: Uint8Array[], have: number, want: number}>} */
    const pending = new Map();
    return {
      /** @param {number} src @param {any} part @returns {Uint8Array | null} */
      add(src, part) {
        const key = `${src}:${part.seqZero}`;
        const entry = pending.get(key) ?? {
          parts: Array.from({ length: part.lastSegment + 1 }),
          have: 0,
          want: part.lastSegment + 1,
        };
        if (!entry.parts[part.segmentIndex]) entry.have += 1;
        entry.parts[part.segmentIndex] = part.upper;
        pending.set(key, entry);
        if (entry.have < entry.want) return null;
        pending.delete(key);
        return crypto().join(...entry.parts);
      },
      clear: () => pending.clear(),
    };
  };

  /**
   * A Segment Acknowledgment: the control message a sender of a segmented
   * message is waiting for, naming which segments arrived (Mesh Profile
   * 3.5.3.3). A sender that never gets one retransmits, and then gives up.
   *
   * Seven octets: the control opcode, then a 13-bit SeqZero shifted up two
   * places with the on-behalf-of flag above it, then a bit per segment. Both
   * fields are big-endian, as everything in a transport header is.
   * Corroborated against Zephyr's `send_ack`.
   * @param {{seqZero: number, blockAck: number, obo?: boolean}} of
   */
  const writeSegmentAck = (of) =>
    crypto().join(
      Uint8Array.of(SEGMENT_ACK_OPCODE),
      beBytes(((of.seqZero << 2) & 0x7ffc) | (of.obo ? 0x8000 : 0), 2),
      beBytes(of.blockAck >>> 0, 4),
    );

  /** The control opcode a Segment Acknowledgment carries. */
  const SEGMENT_ACK_OPCODE = 0x00;

  /**
   * @param {{key: Uint8Array, device: boolean, szmic: number, seq: number,
   *   src: number, dst: number, ivIndex: number, upper: Uint8Array,
   *   label?: Uint8Array}} message
   */
  const openAccess = (message) =>
    crypto().ccmDecrypt(
      message.key,
      accessNonce(message),
      message.upper,
      { micBytes: message.szmic ? 8 : 4, adata: message.label },
    );

  /* ---- Access layer ------------------------------------------------------ */

  /** @param {Uint8Array} access @returns {{opcode: number, parameters: Uint8Array}} */
  const readAccess = (access) => {
    if (access.length === 0) return { opcode: -1, parameters: access };
    if ((access[0] & 0x80) === 0)
      return { opcode: access[0], parameters: access.slice(1) };
    if ((access[0] & 0xc0) === 0x80)
      return {
        opcode: (access[0] << 8) | access[1],
        parameters: access.slice(2),
      };
    return {
      opcode: (access[0] << 16) | (access[1] << 8) | access[2],
      parameters: access.slice(3),
    };
  };

  /** @param {number} opcode @param {Uint8Array} [parameters] */
  const writeAccess = (opcode, parameters = new Uint8Array(0)) =>
    crypto().join(
      opcode <= 0xff
        ? Uint8Array.of(opcode)
        : opcode <= 0xffff
          ? beBytes(opcode, 2)
          : beBytes(opcode, 3),
      parameters,
    );

  /* ---- Composition data -------------------------------------------------- */

  /**
   * Page 0 of a node's own description (Mesh Profile 4.2.1). Anything this
   * cannot account for is returned rather than dropped, so an unexpected node
   * is reported instead of silently rendered as if it were understood.
   * @param {Uint8Array} data
   */
  const readCompositionPage0 = (data) => {
    if (data.length < 11)
      return { complete: false, reason: "shorter than one page 0 header" };
    const view = new DataView(data.buffer, data.byteOffset, data.length);
    const features = view.getUint16(8, true);
    /** @type {any[]} */
    const elements = [];
    let at = 10;
    while (at + 4 <= data.length) {
      const sigCount = view.getUint8(at + 2);
      const vendorCount = view.getUint8(at + 3);
      const end = at + 4 + sigCount * 2 + vendorCount * 4;
      if (end > data.length) break;
      const models = [];
      for (let m = 0; m < sigCount; m += 1) {
        const id = view.getUint16(at + 4 + m * 2, true);
        models.push({
          id,
          vendor: false,
          name: MODEL_NAME.get(id) || "",
          provisionalName: MODEL_NAME_PROVISIONAL.has(id),
        });
      }
      for (let m = 0; m < vendorCount; m += 1) {
        const base = at + 4 + sigCount * 2 + m * 4;
        models.push({
          id: view.getUint16(base + 2, true),
          company: view.getUint16(base, true),
          vendor: true,
          name: "",
        });
      }
      elements.push({ location: view.getUint16(at, true), models });
      at = end;
    }
    return {
      complete: at === data.length,
      // Bytes this reader could not account for. Never dropped quietly.
      trailing: data.slice(at),
      company: view.getUint16(0, true),
      product: view.getUint16(2, true),
      version: view.getUint16(4, true),
      replayListSize: view.getUint16(6, true),
      features: FEATURE.filter(([bit]) => features & bit).map(([, name]) => name),
      featureBits: features,
      elements,
    };
  };

  /* ---- Configuration state ------------------------------------------------ */

  /**
   * Why a Configuration Server refused, or success. Every status message in
   * this section starts with one of these, and a refusal that is read as a
   * reading is worse than no reading: it looks like a node that answered.
   *
   * From the Mesh Profile's status code table, corroborated against Zephyr's
   * `subsys/bluetooth/mesh/foundation.h`.
   */
  const CONFIG_STATUS = new Map([
    [0x00, "Success"],
    [0x01, "Invalid address"],
    [0x02, "Invalid model"],
    [0x03, "Invalid application key index"],
    [0x04, "Invalid network key index"],
    [0x05, "Insufficient resources"],
    [0x06, "Key index already stored"],
    [0x07, "Invalid publish parameters"],
    [0x08, "Not a subscribe model"],
    [0x09, "Storage failure"],
    [0x0a, "Feature not supported"],
    [0x0b, "Cannot update"],
    [0x0c, "Cannot remove"],
    [0x0d, "Cannot bind"],
    [0x0e, "Temporarily unable to change state"],
    [0x0f, "Cannot set"],
    [0x10, "Unspecified error"],
    [0x11, "Invalid binding"],
  ]);

  /** A status code a node reported, named if this table knows it. */
  const statusName = (/** @type {number} */ code) =>
    CONFIG_STATUS.get(code) ??
    `Unknown status 0x${code.toString(16).padStart(2, "0")}`;

  /**
   * One step of a publish period, by the resolution in the top two bits of
   * the period octet (Mesh Profile 4.2.2.2). Corroborated against Zephyr's
   * `bt_mesh_model_pub_period_get`.
   */
  const PUBLISH_STEP_MS = [100, 1000, 10000, 600000];

  /**
   * Key indexes are twelve bits wide, and a list of them is packed two to
   * three octets: the first in bits 0-11 and the second in bits 12-23, little
   * endian throughout (Mesh Profile 4.3.1.1). An odd count leaves the last one
   * alone in two octets.
   *
   * Four of the reads in this panel carry a list in this shape, and reading it
   * as plain 16-bit words gives plausible wrong indexes rather than an obvious
   * failure — so it is decoded in one place, pinned by a test.
   *
   * Corroborated against Zephyr's `key_idx_unpack_pair`.
   * @param {Uint8Array} data
   */
  const readKeyIndexes = (data) => {
    /** @type {number[]} */
    const indexes = [];
    let at = 0;
    for (; at + 3 <= data.length; at += 3)
      indexes.push(
        (data[at] | (data[at + 1] << 8)) & 0x0fff,
        (data[at + 1] | (data[at + 2] << 8)) >>> 4,
      );
    if (at + 2 <= data.length)
      indexes.push((data[at] | (data[at + 1] << 8)) & 0x0fff);
    return indexes;
  };

  /**
   * Readings a plan depends on. Each is the parameters of one status message,
   * named by the state it reports rather than by its opcode.
   */
  const CONFIG = {
    /** @param {Uint8Array} p */
    defaultTtl: (p) => ({ ttl: p[0] }),
    /**
     * Count and interval are packed into one octet, and the interval is a
     * number of ten-millisecond steps above one (Mesh Profile 4.2.19).
     * @param {Uint8Array} p
     */
    networkTransmit: (p) => ({
      count: (p[0] & 0x07) + 1,
      intervalMs: (((p[0] & 0xf8) >>> 3) + 1) * 10,
    }),
    /** @param {Uint8Array} p */
    relay: (p) => ({
      relay: ["Disabled", "Enabled", "Not supported"][p[0]] ?? `Unknown (${p[0]})`,
      count: (p[1] & 0x07) + 1,
      intervalMs: (((p[1] & 0xf8) >>> 3) + 1) * 10,
    }),
    /** @param {Uint8Array} p */
    attention: (p) => ({ seconds: p[0] }),
    /**
     * What a heartbeat subscription has actually heard: how far away the node
     * is, at least and at most. This is the only measurement in Mesh of what a
     * network does rather than what it was configured to do.
     *
     * The addresses are little-endian, as every field in an access payload is.
     * The network header above it is big-endian, which is where the mistake
     * goes: a flipped address is still a valid address, so nothing rejects it.
     * @param {Uint8Array} p
     */
    heartbeatSubscription: (p) => ({
      status: statusName(p[0]),
      ok: p[0] === 0x00,
      source: p[1] | (p[2] << 8),
      destination: p[3] | (p[4] << 8),
      minHops: p[7],
      maxHops: p[8],
    }),
    /**
     * Present state, and where it is heading if a transition is running.
     * @param {Uint8Array} p
     */
    genericOnOff: (p) => ({
      on: p[0] === 1,
      target: p.length > 1 ? p[1] === 1 : undefined,
    }),
    /**
     * Which application keys a node holds, and under which network key. A node
     * that refused says why rather than reporting an empty list, because
     * "holds no keys" and "would not say" are different facts about a network.
     * @param {Uint8Array} p
     */
    appKeyList: (p) => ({
      status: statusName(p[0]),
      ok: p[0] === 0x00,
      netKeyIndex: readKeyIndexes(p.slice(1, 3))[0],
      appKeyIndexes: readKeyIndexes(p.slice(3)),
    }),
    /**
     * Which application keys one model on one element is bound to. A model
     * bound to none receives nothing an application sends, which is the
     * commonest reason a correctly provisioned node does nothing.
     * @param {Uint8Array} p
     */
    modelAppList: (p) => ({
      status: statusName(p[0]),
      ok: p[0] === 0x00,
      element: p[1] | (p[2] << 8),
      model: p[3] | (p[4] << 8),
      appKeyIndexes: readKeyIndexes(p.slice(5)),
    }),
    /**
     * Where a model sends what it has to say, and how often. The address is
     * usually a group, which is how one switch reaches a room: nothing in the
     * network names the lamps, they are all subscribed to the same address.
     *
     * The publish period is a count of steps and a resolution for the step,
     * packed into one octet; the retransmit octet counts in fifties of a
     * millisecond rather than the tens the network transmit octet uses.
     * Corroborated against Zephyr's BT_MESH_PUB_TRANSMIT_INT.
     * @param {Uint8Array} p
     */
    modelPublication: (p) => ({
      status: statusName(p[0]),
      ok: p[0] === 0x00,
      element: p[1] | (p[2] << 8),
      address: p[3] | (p[4] << 8),
      appKeyIndex: (p[5] | (p[6] << 8)) & 0x0fff,
      friendshipCredentials: (((p[5] | (p[6] << 8)) >>> 12) & 0x01) === 1,
      ttl: p[7],
      periodMs: (p[8] & 0x3f) * PUBLISH_STEP_MS[(p[8] >>> 6) & 0x03],
      count: (p[9] & 0x07) + 1,
      intervalMs: (((p[9] & 0xf8) >>> 3) + 1) * 50,
      model: p[10] | (p[11] << 8),
    }),
    /**
     * Which addresses a model listens on. Plain 16-bit addresses rather than
     * packed key indexes: only key indexes are twelve bits.
     * @param {Uint8Array} p
     */
    modelSubscriptionList: (p) => ({
      status: statusName(p[0]),
      ok: p[0] === 0x00,
      element: p[1] | (p[2] << 8),
      model: p[3] | (p[4] << 8),
      addresses: Array.from(
        { length: (p.length - 5) >> 1 },
        (_, at) => p[5 + at * 2] | (p[6 + at * 2] << 8),
      ),
    }),
    /**
     * What a proxy server made of our filter request: which kind of list it
     * now holds and how many addresses are on it (Mesh Profile 6.5.2). The
     * count is what settles whether our own address got on, and the addresses
     * here are big-endian like the ones that were sent.
     * @param {Uint8Array} p
     */
    proxyFilterStatus: (p) => ({
      filter: p[0] === PROXY_FILTER.accept ? "accept" : "reject",
      accepts: p[0] === PROXY_FILTER.accept,
      size: (p[1] << 8) | p[2],
    }),
    /**
     * A fault list is a test identifier, the company that defines the codes,
     * and the codes themselves. The codes are that company's to define, so
     * they are reported as numbers.
     * @param {Uint8Array} p
     */
    healthFaults: (p) => ({
      testId: p[0],
      company: (p[2] << 8) | p[1],
      faults: Array.from(p.slice(3)),
    }),
  };

  /* ---- Provisioning ------------------------------------------------------ */

  /** Provisioning PDU types (Mesh Profile 5.4.1). */
  const PROVISION = {
    invite: 0x00,
    capabilities: 0x01,
    start: 0x02,
    publicKey: 0x03,
    inputComplete: 0x04,
    confirmation: 0x05,
    random: 0x06,
    data: 0x07,
    complete: 0x08,
    failed: 0x09,
  };

  /** How a device proves it is the one in front of you. */
  const AUTH = { none: 0x00, static: 0x01, output: 0x02, input: 0x03 };

  /** @param {Uint8Array} data */
  const readCapabilities = (data) => ({
    elements: data[0],
    algorithms: (data[1] << 8) | data[2],
    publicKeyType: data[3],
    staticOob: data[4],
    outputOobSize: data[5],
    outputOobAction: (data[6] << 8) | data[7],
    inputOobSize: data[8],
    inputOobAction: (data[9] << 8) | data[10],
  });

  /**
   * A P-256 pair, and the shared secret it makes with the device's. Web
   * Crypto gives a raw public key with a leading tag octet; provisioning
   * carries the two coordinates alone.
   */
  const makeProvisionerKeys = async () => {
    const pair = await globalThis.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const raw = new Uint8Array(
      await globalThis.crypto.subtle.exportKey("raw", pair.publicKey),
    );
    return { pair, publicKey: raw.slice(1) };
  };

  /** @param {CryptoKey} privateKey @param {Uint8Array} peer */
  const sharedSecret = async (privateKey, peer) => {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      crypto().join(Uint8Array.of(0x04), peer),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    return new Uint8Array(
      await globalThis.crypto.subtle.deriveBits(
        { name: "ECDH", public: key },
        privateKey,
        256,
      ),
    );
  };

  /** @param {string} text */
  const ascii = (text) =>
    Uint8Array.from(text, (character) => character.charCodeAt(0));

  /**
   * Every key provisioning needs, from the shared secret and the exchange so
   * far (Mesh Profile 5.4.2.4).
   * @param {Uint8Array} secret @param {Uint8Array} inputs
   */
  const provisioningKeys = async (secret, inputs) => {
    const confirmationSalt = await crypto().s1(inputs);
    return {
      confirmationSalt,
      confirmationKey: await crypto().k1(secret, confirmationSalt, ascii("prck")),
    };
  };

  /**
   * @param {Uint8Array} secret @param {Uint8Array} confirmationSalt
   * @param {Uint8Array} ours @param {Uint8Array} theirs
   */
  const sessionKeys = async (secret, confirmationSalt, ours, theirs) => {
    const salt = await crypto().s1(crypto().join(confirmationSalt, ours, theirs));
    const nonce = await crypto().k1(secret, salt, ascii("prsn"));
    return {
      provisioningSalt: salt,
      sessionKey: await crypto().k1(secret, salt, ascii("prsk")),
      // The nonce is the last thirteen octets of the derivation.
      sessionNonce: nonce.slice(3),
      deviceKey: await crypto().k1(secret, salt, ascii("prdk")),
    };
  };

  window.PlannerMeshStack = {
    CONFIG,
    PROVISION,
    AUTH,
    provisioning: {
      readCapabilities,
      makeProvisionerKeys,
      sharedSecret,
      provisioningKeys,
      sessionKeys,
    },
    OPCODE,
    OPCODE_NAME,
    MODEL_NAME,
    MODEL_NAME_PROVISIONAL,
    PROXY_TYPE,
    PROXY_CONFIG,
    PROXY_FILTER,
    NONCE,
    proxy: {
      split: splitProxy,
      reassembly: makeProxyReassembly,
      SAR: PROXY_SAR,
      PAYLOAD: PROXY_PAYLOAD,
    },
    network: { encode: encodeNetwork, decode: decodeNetwork, nonce: networkNonce },
    transport: {
      seal: sealAccess,
      open: openAccess,
      read: readLowerTransport,
      reassembly: makeReassembly,
      ack: writeSegmentAck,
      ACK_OPCODE: SEGMENT_ACK_OPCODE,
      UNSEGMENTED_MAX,
      SEGMENT_SIZE,
    },
    access: { read: readAccess, write: writeAccess },
    composition: { readPage0: readCompositionPage0 },
    keyIndexes: readKeyIndexes,
    statusName,
  };
}
