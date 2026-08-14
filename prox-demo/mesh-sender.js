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

  // Network PDU of one unsegmented access message sealed with an AppKey.
  /** @param {MeshAccessPduOptions} options @returns {Promise<Uint8Array>} */
  async function accessPdu(options) {
    const { netKey, key, ivIndex, src, seq, dst, access } = options;
    const C = planner.meshCrypto;
    const upper = await C.sealAccess(key, { device: false, seq, src, dst, ivIndex }, access);
    if (upper.length > 15) throw new Error("access message too long for one segment");
    const transport = C.cat([0x40 | (await C.k4(key))], upper); // SEG 0, AKF, AID
    return C.sealNetwork(await C.k2(netKey), { ivIndex, ttl: TTL, seq, src, dst, transport });
  }

  // Opens one unsegmented access message sealed with its AppKey, or null.
  // net = k2(NetKey).
  /** @param {MeshOpenAccessPduOptions} options @returns {Promise<(MeshNetworkFields & {access: Uint8Array}) | null>} */
  async function openAccessPdu(options) {
    const { net, key, ivIndex, pdu } = options;
    const C = planner.meshCrypto;
    const n = await C.openNetwork(net, ivIndex, pdu);
    if (!n || n.ctl || n.transport[0] !== (0x40 | (await C.k4(key)))) return null; // SEG 0, AKF, AID
    const access = await C.openAccess(key, { device: false, seq: n.seq, src: n.src, dst: n.dst, ivIndex: n.ivIndex }, n.transport.subarray(1));
    return access && { ...n, access };
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
  });
}
