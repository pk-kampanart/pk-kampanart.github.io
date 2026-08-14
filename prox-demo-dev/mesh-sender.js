// Production mesh packet helpers: reserved sequence numbers, access and
// network PDUs, and dongle frames.
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  const BLOCK = 64;
  const validRecord = (value) =>
    value && Number.isInteger(value.src) && value.src >= 0x7ff0 && value.src <= 0x7fff &&
    Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 0x1000000;
  const recordOf = (raw) => {
    try {
      const value = raw === null ? null : JSON.parse(raw);
      return validRecord(value) ? value : null;
    } catch {
      return null;
    }
  };
  const markerOf = (raw, saved) => {
    if (raw === null) return null;
    const marker = Number(raw);
    return Number.isInteger(marker) && marker >= 0x7fef && marker <= 0x7ffe &&
      (!saved || marker < saved.src) ? marker : null;
  };

  // Sequence numbers for our reserved source address. The end of the current
  // block is written before any number in it is used; a reload starts at that
  // end, so no number ever repeats. storage is localStorage or alike.
  // Past seq 0xFFFFFF the source moves down one address, from 0x7FFF to 0x7FF0.
  /** @param {MeshSequenceStorage} storage @param {string} key @param {number} [first] @param {number} [block] @returns {MeshSequenceStore} */
  function seqStore(storage, key, first = 0x7fff, block = BLOCK) {
    const saved = JSON.parse(storage.getItem(key) || "null");
    const state = saved ? { src: saved.src, next: saved.limit, limit: saved.limit } : { src: first, next: 0, limit: 0 };
    const save = (limit) => { storage.setItem(key, JSON.stringify({ src: state.src, limit })); state.limit = limit; };
    return {
      reserve() {
        if (state.next >= state.limit) {
          if (state.next + block > 0x1000000) {
            if (state.src <= 0x7ff0) throw new Error("sequence numbers of 7FF0–7FFF used up; no reserved address left");
            state.src -= 1;
            state.next = 0;
          }
          save(state.next + block);
        }
        return { src: state.src, seq: state.next++ };
      },
      peek: () => ({ src: state.src, seq: state.next }),
      // For a fresh origin whose source address a node already heard from: never lowers.
      raise(floor) {
        if (!(floor > state.next && floor <= 0x1000000)) return;
        state.next = floor;
        if (floor > state.limit) save(floor);
      },
    };
  }

  // One durable claim per packet. The browser lock keeps tabs from reading
  // the same limit; the next-source marker is written before the sequence
  // record, so losing that record never reuses an address.
  /** @param {MeshSequenceStorage} storage @param {MeshSequenceLocks | undefined} locks @param {string} key @param {boolean} hasNodes @returns {Promise<MeshSequenceReservation>} */
  async function reserve(storage, locks, key, hasNodes) {
    if (!locks?.request) throw new Error("browser locks unavailable; cannot send mesh packets safely");
    return locks.request(key, () => {
      const markerKey = `${key}:next-src`;
      const raw = storage.getItem(key);
      const saved = recordOf(raw);
      if (raw !== null && !saved) throw new Error("mesh sender record is invalid; restore a network backup");
      const markerRaw = storage.getItem(markerKey);
      const marker = markerOf(markerRaw, saved);
      if (markerRaw !== null && marker === null)
        throw new Error("mesh sender address record is invalid; restore a network backup");
      if (raw === null && marker === null && hasNodes)
        throw new Error("mesh sender records lost; restore a network backup");
      const first = raw === null ? marker ?? 0x7fff : 0x7fff;
      if (first < 0x7ff0) throw new Error("no reserved mesh sender address left");
      const tracked = {
        getItem: (/** @type {string} */ item) => storage.getItem(item),
        setItem: (/** @type {string} */ item, /** @type {string} */ value) => {
          const next = JSON.parse(value).src - 1;
          storage.setItem(markerKey, String(Math.min(marker ?? next, next)));
          storage.setItem(item, value);
        },
      };
      return seqStore(tracked, key, first, 1).reserve();
    });
  }

  /** @param {MeshSequenceStorage} storage @param {MeshSequenceLocks | undefined} locks @param {string} key @param {{record: string | null, marker: string | null}} saved */
  async function adopt(storage, locks, key, saved) {
    if (!locks?.request) throw new Error("browser locks unavailable; cannot send mesh packets safely");
    const request = /** @type {(name: string, callback: () => void) => Promise<void>} */ (
      /** @type {unknown} */ (locks.request)
    );
    await request.call(locks, key, () => {
      const markerKey = `${key}:next-src`;
      const currentRaw = storage.getItem(key);
      const currentRecord = recordOf(currentRaw);
      const savedRecord = recordOf(saved.record);
      const currentMarker = markerOf(storage.getItem(markerKey), currentRecord);
      const savedMarker = markerOf(saved.marker, savedRecord);
      /** @type {{src: number, limit: number, raw?: string}[]} */
      const candidates = [];
      if (currentRecord && currentRaw !== null)
        candidates.push({ src: currentRecord.src, limit: currentRecord.limit, raw: currentRaw });
      if (savedRecord && saved.record !== null)
        candidates.push({ src: savedRecord.src, limit: savedRecord.limit, raw: saved.record });
      if (currentMarker !== null) candidates.push({ src: currentMarker, limit: 0 });
      if (savedMarker !== null) candidates.push({ src: savedMarker, limit: 0 });
      /** @type {{src: number, limit: number, raw?: string} | null} */
      let picked = null;
      for (const candidate of candidates)
        if (
          !picked ||
          candidate.src < picked.src ||
          (candidate.src === picked.src && candidate.limit > picked.limit)
        )
          picked = candidate;
      if (!picked) return;
      if (picked.limit === 0) {
        /** @type {{removeItem(key: string): void}} */ (
          /** @type {unknown} */ (storage)
        ).removeItem(key);
        storage.setItem(markerKey, String(picked.src));
        return;
      }
      storage.setItem(key, /** @type {string} */ (picked.raw));
      const below = /** @type {number[]} */ (
        [currentMarker, savedMarker].filter(
          (marker) => marker !== null && marker < picked.src,
        )
      );
      storage.setItem(markerKey, String(below.length ? Math.min(...below) : picked.src - 1));
    });
  }

  const TTL = 3; // what the wasm uses for its own messages

  // Network PDU of one unsegmented access message. key is the AppKey, or the
  // node's DevKey when device is true (configuration messages).
  /** @param {MeshAccessPduOptions} options @returns {Promise<Uint8Array>} */
  async function accessPdu(options) {
    const { netKey, key, device = false, ivIndex, src, seq, dst, access } = options;
    const C = planner.meshCrypto;
    const upper = await C.sealAccess(key, { device, seq, src, dst, ivIndex }, access);
    if (upper.length > 15) throw new Error("access message too long for one segment");
    const transport = C.cat([device ? 0x00 : 0x40 | (await C.k4(key))], upper); // SEG 0, AKF, AID
    return C.sealNetwork(await C.k2(netKey), { ivIndex, ttl: TTL, seq, src, dst, transport });
  }

  // Light CTL Set and Light CTL Temperature Set, acknowledged (Mesh Model
  // 6.3.2.2, 6.3.2.5), without transition fields. Fields are little-endian;
  // deltaUv is signed.
  /** @param {number} value */
  const u16 = (value) => [value & 0xff, (value >> 8) & 0xff];
  /** @param {{lightness: number, temperature: number, deltaUv: number, tid: number}} fields */
  const lightCtlSet = ({ lightness, temperature, deltaUv, tid }) =>
    Uint8Array.from([0x82, 0x5e, ...u16(lightness), ...u16(temperature), ...u16(deltaUv), tid & 0xff]);
  /** @param {{temperature: number, deltaUv: number, tid: number}} fields */
  const lightCtlTemperatureSet = ({ temperature, deltaUv, tid }) =>
    Uint8Array.from([0x82, 0x64, ...u16(temperature), ...u16(deltaUv), tid & 0xff]);

  /** @param {{element: number, address: number, keyIndex: number, ttl: number, model: number}} fields */
  const configModelPublicationSet = ({ element, address, keyIndex, ttl, model }) => {
    if (model > 0xffff) throw new Error("vendor models cannot be linked");
    return Uint8Array.from([
      0x03,
      ...u16(element),
      ...u16(address),
      ...u16(keyIndex & 0x0fff),
      ttl,
      0,
      0,
      ...u16(model),
    ]);
  };

  /** @param {{add: boolean, element: number, address: number, model: number}} fields */
  const configModelSubscription = ({ add, element, address, model }) => {
    if (model > 0xffff) throw new Error("vendor models cannot be linked");
    return Uint8Array.from([
      0x80,
      add ? 0x1b : 0x1c,
      ...u16(element),
      ...u16(address),
      ...u16(model),
    ]);
  };

  // Opens one unsegmented access message with its AppKey or DevKey, or null.
  // net = k2(NetKey).
  /** @param {MeshOpenAccessPduOptions} options @returns {Promise<(MeshNetworkFields & {access: Uint8Array}) | null>} */
  async function openAccessPdu(options) {
    const { net, key, device = false, ivIndex, pdu } = options;
    const C = planner.meshCrypto;
    const n = await C.openNetwork(net, ivIndex, pdu);
    if (!n || n.ctl || n.transport[0] !== (device ? 0x00 : 0x40 | (await C.k4(key)))) return null; // SEG 0, AKF, AID
    const access = await C.openAccess(key, { device, seq: n.seq, src: n.src, dst: n.dst, ivIndex: n.ivIndex }, n.transport.subarray(1));
    return access && { ...n, access };
  }

  // Segmented access messages (3.5.3). SeqZero is the low 13 bits of SeqAuth,
  // the sequence number of the first segment's first transmission; every
  // other transmission, resends included, takes its own sequence number.
  const SEGMENT = 12; // access payload bytes per segment
  const ROUNDS = 4; // resends before giving up

  // Lower transport PDUs of one access message in segments: the upper
  // transport PDU with a 4-byte TransMIC (SZMIC 0), split in 12-byte pieces.
  // seq is SeqAuth.
  /** @param {Omit<MeshAccessPduOptions, "netKey">} options @returns {Promise<Uint8Array[]>} */
  async function accessSegments(options) {
    const { key, device = false, ivIndex, src, seq, dst, access } = options;
    const C = planner.meshCrypto;
    const upper = await C.sealAccess(key, { device, seq, src, dst, ivIndex }, access);
    const last = Math.ceil(upper.length / SEGMENT) - 1;
    if (last > 31) throw new Error("access message too long for 32 segments");
    const head = 0x80 | (device ? 0 : 0x40 | (await C.k4(key))); // SEG 1, AKF, AID
    const zero = seq & 0x1fff;
    return Array.from({ length: last + 1 }, (_, o) =>
      C.cat([head, zero >> 6, ((zero & 0x3f) << 2) | (o >> 3), ((o & 7) << 5) | last], upper.subarray(o * SEGMENT, (o + 1) * SEGMENT)),
    );
  }

  // Network PDU of one lower transport PDU: a segment, or with ctl 1 a
  // Segment Acknowledgment.
  /** @param {MeshLowerPduOptions} options @returns {Promise<Uint8Array>} */
  async function lowerPdu(options) {
    const { netKey, ctl = 0, ttl = TTL, ...fields } = options;
    const C = planner.meshCrypto;
    return C.sealNetwork(await C.k2(netKey), { ...fields, ctl, ttl });
  }

  // Segment Acknowledgment (3.5.2.3.1), OBO 0: bit n of block acknowledges segment n.
  /** @param {number} seqZero @param {number} block @returns {Uint8Array} */
  const segmentAck = (seqZero, block) =>
    Uint8Array.from([0x00, (seqZero >> 6) & 0x7f, (seqZero & 0x3f) << 2, block >>> 24, (block >> 16) & 0xff, (block >> 8) & 0xff, block & 0xff]);

  /** @param {{net: MeshNetworkKeys, ivIndex: number, pdu: Uint8Array}} options @returns {Promise<MeshSegmentAck | null>} */
  async function openSegmentAck({ net, ivIndex, pdu }) {
    const n = await planner.meshCrypto.openNetwork(net, ivIndex, pdu);
    if (!n?.ctl || n.transport.length !== 7 || n.transport[0] !== 0x00) return null;
    const t = n.transport;
    return { src: n.src, dst: n.dst, seqZero: ((t[1] & 0x7f) << 6) | (t[2] >> 2), block: ((t[3] << 24) | (t[4] << 16) | (t[5] << 8) | t[6]) >>> 0 };
  }

  // Resend rounds of one message of count segments, all sent once already.
  // Each call takes the BlockAck of a Segment Acknowledgment for it, or null
  // when none came in time, and returns the segments to send again, [] once
  // every one arrived.
  /** @param {number} count @returns {(block: number | null) => number[]} */
  function resend(count) {
    let acked = 0;
    let rounds = 0;
    return (block) => {
      if (block === 0) throw new Error("the node refused the message");
      acked = (acked | (block ?? 0)) >>> 0;
      const missing = Array.from({ length: count }, (_, o) => o).filter((o) => !((acked >>> o) & 1));
      if (missing.length && ++rounds > ROUNDS)
        throw new Error(`the node did not acknowledge the whole message after ${ROUNDS} resends`);
      return missing;
    };
  }

  // Reassembles segmented access messages sealed with key, one in progress per
  // source (3.5.3.3). add() resolves null for any other PDU, else the Segment
  // Acknowledgment to answer with and, once, the opened message. A repeated
  // segment, or one of a finished message, is acknowledged again.
  /** @param {{net: MeshNetworkKeys, key: Uint8Array, device?: boolean}} options @returns {MeshReassembly} */
  function reassembly({ net, key, device = false }) {
    const C = planner.meshCrypto;
    /** @type {Map<number, {seqAuth: number, last: number, parts: Uint8Array[], block: number, done: boolean}>} */
    const open = new Map();
    return {
      async add(ivIndex, pdu) {
        const n = await C.openNetwork(net, ivIndex, pdu);
        const t = n?.transport;
        if (!n || n.ctl || !t || t.length < 5 || (t[0] & 0x7f) !== (device ? 0 : 0x40 | (await C.k4(key)))) return null;
        if (!(t[0] & 0x80)) return null; // unsegmented: openAccessPdu
        const seqZero = ((t[1] & 0x7f) << 6) | (t[2] >> 2);
        const o = ((t[2] & 3) << 3) | (t[3] >> 5), last = t[3] & 0x1f;
        const seqAuth = n.seq - ((n.seq - seqZero) & 0x1fff);
        if (o > last || seqAuth < 0) return null;
        let entry = open.get(n.src);
        if (entry && seqAuth < entry.seqAuth) return null;
        if (!entry || seqAuth > entry.seqAuth) open.set(n.src, (entry = { seqAuth, last, parts: [], block: 0, done: false }));
        if (last !== entry.last) return null;
        const ack = { src: n.src, dst: n.dst, seqZero, block: 0 };
        if (entry.done) return { ...ack, block: entry.block };
        entry.parts[o] = t.subarray(4);
        entry.block = (entry.block | (1 << o)) >>> 0;
        if (entry.parts.filter(Boolean).length <= last) return { ...ack, block: entry.block };
        entry.done = true;
        const access = await C.openAccess(
          key,
          { device, szmic: t[1] >> 7, seq: seqAuth, src: n.src, dst: n.dst, ivIndex: n.ivIndex },
          C.cat(...entry.parts),
        );
        return { ...ack, block: entry.block, ...(access && { message: { ...n, seq: seqAuth, access } }) };
      },
    };
  }

  // Proxy PDU (type 0x02) of Proxy Configuration Add Addresses (opcode 0x01).
  /** @param {MeshProxyAddAddressesOptions} options @returns {Promise<Uint8Array>} */
  async function proxyAddAddressesPdu(options) {
    const { netKey, ivIndex, src, seq, addresses } = options;
    const C = planner.meshCrypto;
    const transport = Uint8Array.from([0x01, ...addresses.flatMap((a) => [a >> 8, a & 0xff])]);
    return C.cat([0x02], await C.sealNetwork(await C.k2(netKey), { ivIndex, ctl: 1, ttl: 0, seq, src, dst: 0, transport, proxy: true }));
  }

  // Network PDUs inside one recorded frame. GATT: a whole proxy PDU, type 0x00
  // carries one. Dongle RX, read off real captures: 00, frame length, 6 unknown
  // bytes, AD type 0x2A, PDU, 5 trailing bytes. Dongle TX: every Mesh Message AD
  // structure (len, 0x2A, PDU).
  /** @param {Uint8Array} frame @param {boolean} gatt @returns {Uint8Array[]} */
  function networkPdus(frame, gatt) {
    if (gatt) return frame[0] === 0x00 ? [frame.subarray(1)] : [];
    if (frame[0] === 0x00 && frame[1] === frame.length && frame[8] === 0x2a) return [frame.subarray(9, -5)];
    const out = [];
    for (let i = 0; i + 1 < frame.length; i++) {
      const len = frame[i];
      if (frame[i + 1] === 0x2a && len >= 15 && i + 1 + len <= frame.length) out.push(frame.subarray(i + 2, i + 1 + len));
    }
    return out;
  }

  // The Mesh Message AD structure. This is what send_adv_packet takes.
  /** @param {Uint8Array} pdu @returns {Uint8Array} */
  const advData = (pdu) => planner.meshCrypto.cat([pdu.length + 1, 0x2a], pdu);

  // CRC-16/ISO-IEC-14443-3-A, little-endian.
  /** @param {Uint8Array} bytes @returns {number[]} */
  function crc(bytes) {
    let c = 0x6363;
    for (const b of bytes) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0x8408 : c >>> 1;
    }
    return [c & 0xff, c >> 8];
  }

  // Dongle advertising frame: FD 20 <length> 05 28 <AD> <CRC>. Byte-identical
  // to what send_adv_packet hands to the serial TX callback (probed in
  // headless Chromium); 05 and 28 are the repeat count and window it uses.
  /** @param {Uint8Array} ad @returns {Uint8Array} */
  function dongleFrame(ad) {
    const C = planner.meshCrypto;
    const body = C.cat([0xfd, 0x20, ad.length + 4, 0x05, 0x28], ad);
    return C.cat(body, crc(body));
  }

  planner.meshSender = Object.freeze({
    seqStore, reserve, adopt, accessPdu, openAccessPdu, proxyAddAddressesPdu, networkPdus, advData, dongleFrame,
    lightCtlSet, lightCtlTemperatureSet, configModelPublicationSet,
    configModelSubscription, accessSegments, lowerPdu, segmentAck,
    openSegmentAck, resend, reassembly, TTL,
  });
}
