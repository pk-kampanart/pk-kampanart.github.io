// Bluetooth Mesh Profile 1.0.1 crypto: AES-CMAC, AES-CCM, s1, k2, k4 (3.8.2),
// network PDU seal/open with obfuscation (3.8.7), upper transport seal/open
// (3.8.6). WebCrypto only (AES-CBC and AES-CTR carry ECB, CMAC and CCM), so
// the same file runs in a browser and under Node. Bytes are Uint8Array; every
// function is async.
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const subtle = globalThis.crypto.subtle;

  /** @param {...ArrayLike<number>} parts @returns {Uint8Array} */
  const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  /** @param {Uint8Array} a @param {Uint8Array} b @returns {Uint8Array} */
  const xor = (a, b) => a.map((v, i) => v ^ b[i]);
  /** @param {number} n @param {number} len @returns {Uint8Array} */
  const be = (n, len) => Uint8Array.from({ length: len }, (_, i) => (n >>> (8 * (len - 1 - i))) & 0xff);
  /** @param {Uint8Array} b @returns {number} */
  const int = (b) => b.reduce((n, v) => n * 256 + v, 0);

  const copy = (bytes) => {
    const out = new Uint8Array(bytes.length);
    out.set(bytes);
    return out;
  };
  const importKey = (key, name) => subtle.importKey("raw", copy(key), name, false, ["encrypt"]);

  // CBC with a zero IV; WebCrypto appends a PKCS#7 block, which is cut off.
  /** @param {Uint8Array} key @param {Uint8Array} data @returns {Promise<Uint8Array>} */
  async function cbc(key, data) {
    const out = await subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, await importKey(key, "AES-CBC"), copy(data));
    return new Uint8Array(out, 0, data.length);
  }

  // One-block AES-128 (ECB), the spec's e().
  /** @param {Uint8Array} key @param {Uint8Array} block @returns {Promise<Uint8Array>} */
  const aes = (key, block) => cbc(key, block);

  /** @param {Uint8Array} key @param {Uint8Array} counter @param {Uint8Array} data @returns {Promise<Uint8Array>} */
  async function ctr(key, counter, data) {
    return new Uint8Array(await subtle.encrypt({ name: "AES-CTR", counter: copy(counter), length: 16 }, await importKey(key, "AES-CTR"), copy(data)));
  }

  // RFC 4493.
  /** @param {Uint8Array} key @param {Uint8Array} msg @returns {Promise<Uint8Array>} */
  async function cmac(key, msg) {
    const dbl = (b) => {
      const o = b.map((v, i) => ((v << 1) | ((b[i + 1] ?? 0) >> 7)) & 0xff);
      if (b[0] & 0x80) o[15] ^= 0x87;
      return o;
    };
    const k1 = dbl(await aes(key, new Uint8Array(16)));
    const n = Math.max(1, Math.ceil(msg.length / 16));
    const whole = msg.length > 0 && msg.length % 16 === 0;
    const m = new Uint8Array(n * 16);
    m.set(msg);
    if (!whole) m[msg.length] = 0x80;
    m.set(xor(m.subarray(16 * (n - 1)), whole ? k1 : dbl(k1)), 16 * (n - 1));
    return (await cbc(key, m)).slice(16 * (n - 1));
  }

  // AES-CCM (RFC 3610) with a 13-byte nonce (L = 2) and no associated data,
  // which is all mesh uses outside virtual addresses.
  /** @param {Uint8Array} key @param {Uint8Array} nonce @param {Uint8Array} plain @param {number} micLen @returns {Promise<Uint8Array>} */
  async function ccmTag(key, nonce, plain, micLen) {
    const b0 = cat([((micLen - 2) / 2) << 3 | 1], nonce, be(plain.length, 2));
    const padded = new Uint8Array(16 + Math.ceil(plain.length / 16) * 16);
    padded.set(b0);
    padded.set(plain, 16);
    return (await cbc(key, padded)).slice(-16).subarray(0, micLen);
  }
  /** @param {Uint8Array} nonce @returns {Uint8Array} */
  const a0 = (nonce) => cat([1], nonce, [0, 0]);

  /** @param {Uint8Array} key @param {Uint8Array} nonce @param {Uint8Array} plain @param {number} micLen @returns {Promise<Uint8Array>} */
  async function ccmSeal(key, nonce, plain, micLen) {
    const tag = await ccmTag(key, nonce, plain, micLen);
    const out = await ctr(key, a0(nonce), cat(tag, new Uint8Array(16 - micLen), plain));
    return cat(out.subarray(16), out.subarray(0, micLen));
  }

  // Returns the plaintext, or null when the MIC does not match.
  /** @param {Uint8Array} key @param {Uint8Array} nonce @param {Uint8Array} sealed @param {number} micLen @returns {Promise<Uint8Array | null>} */
  async function ccmOpen(key, nonce, sealed, micLen) {
    if (sealed.length < micLen) return null;
    const cut = sealed.length - micLen;
    const out = await ctr(key, a0(nonce), cat(sealed.subarray(cut), new Uint8Array(16 - micLen), sealed.subarray(0, cut)));
    const plain = out.slice(16);
    const tag = await ccmTag(key, nonce, plain, micLen);
    return tag.every((v, i) => v === out[i]) ? plain : null;
  }

  /** @param {string} s @returns {Uint8Array} */
  const text = (s) =>
    globalThis.TextEncoder
      ? new TextEncoder().encode(s)
      : Uint8Array.from(
          encodeURIComponent(s).replace(/%([0-9a-f]{2})/gi, (_, byte) => String.fromCharCode(parseInt(byte, 16))),
          (char) => char.charCodeAt(0),
        );
  /** @param {Uint8Array | string} m @returns {Promise<Uint8Array>} */
  const s1 = (m) => cmac(new Uint8Array(16), typeof m === "string" ? text(m) : m);

  // Network keys from a NetKey (managed flooding: P = 0x00).
  /** @param {Uint8Array} n @param {Uint8Array} [p] @returns {Promise<MeshNetworkKeys>} */
  async function k2(n, p = Uint8Array.of(0)) {
    const t = await cmac(await s1("smk2"), n);
    const t1 = await cmac(t, cat(p, [1]));
    const t2 = await cmac(t, cat(t1, p, [2]));
    const t3 = await cmac(t, cat(t2, p, [3]));
    return { nid: t1[15] & 0x7f, encryptionKey: t2, privacyKey: t3 };
  }

  // AID of an AppKey.
  /** @param {Uint8Array} n @returns {Promise<number>} */
  async function k4(n) {
    const t = await cmac(await s1("smk4"), n);
    return (await cmac(t, cat(text("id6"), [1])))[15] & 0x3f;
  }

  // proxy: the proxy nonce (3.8.5.4) of Proxy Configuration messages.
  /** @param {number} ctl @param {number} ttl @param {number} seq @param {number} src @param {number} ivIndex @param {boolean} proxy @returns {Uint8Array} */
  const networkNonce = (ctl, ttl, seq, src, ivIndex, proxy) =>
    cat(proxy ? [3, 0] : [0, (ctl << 7) | ttl], be(seq, 3), be(src, 2), [0, 0], be(ivIndex, 4));

  /** @param {MeshNetworkKeys} keys @param {number} ivIndex @param {Uint8Array} sealed @returns {Promise<Uint8Array>} */
  const pecb = (keys, ivIndex, sealed) =>
    aes(keys.privacyKey, cat(new Uint8Array(5), be(ivIndex, 4), sealed.subarray(0, 7)));

  // keys = k2(NetKey). transport = the lower transport PDU.
  /** @param {MeshNetworkKeys} keys @param {MeshNetworkSealOptions} options @returns {Promise<Uint8Array>} */
  async function sealNetwork(keys, options) {
    const { ivIndex, ctl = 0, ttl, seq, src, dst, transport, proxy = false } = options;
    const sealed = await ccmSeal(keys.encryptionKey, networkNonce(ctl, ttl, seq, src, ivIndex, proxy), cat(be(dst, 2), transport), ctl ? 8 : 4);
    const header = cat([(ctl << 7) | ttl], be(seq, 3), be(src, 2));
    return cat([((ivIndex & 1) << 7) | keys.nid], xor(header, await pecb(keys, ivIndex, sealed)), sealed);
  }

  // Returns the decoded fields, or null when the NID or NetMIC does not match.
  // ivIndex is the current one; an IVI bit that differs selects ivIndex - 1.
  // proxy: true opens a Proxy Configuration message.
  /** @param {MeshNetworkKeys} keys @param {number} ivIndex @param {Uint8Array} pdu @param {boolean} [proxy] @returns {Promise<MeshNetworkFields | null>} */
  async function openNetwork(keys, ivIndex, pdu, proxy = false) {
    if (pdu.length < 14 || (pdu[0] & 0x7f) !== keys.nid) return null;
    const iv = (pdu[0] >> 7) === (ivIndex & 1) ? ivIndex : ivIndex - 1;
    const sealed = pdu.subarray(7);
    const header = xor(pdu.subarray(1, 7), await pecb(keys, iv, sealed));
    const ctl = header[0] >> 7, ttl = header[0] & 0x7f, seq = int(header.subarray(1, 4)), src = int(header.subarray(4, 6));
    const plain = await ccmOpen(keys.encryptionKey, networkNonce(ctl, ttl, seq, src, iv, proxy), sealed, ctl ? 8 : 4);
    if (!plain) return null;
    return { ivIndex: iv, ctl, ttl, seq, src, dst: int(plain.subarray(0, 2)), transport: plain.subarray(2) };
  }

  // Upper transport access payload. device: true uses the device nonce (DevKey),
  // else the application nonce (AppKey). seq is SeqAuth's low 24 bits.
  /** @param {MeshAccessHeader} header @returns {Uint8Array} */
  const accessNonce = ({ device, szmic = 0, seq, src, dst, ivIndex }) =>
    cat([device ? 2 : 1, szmic << 7], be(seq, 3), be(src, 2), be(dst, 2), be(ivIndex, 4));

  /** @param {Uint8Array} key @param {MeshAccessHeader} header @param {Uint8Array} access @returns {Promise<Uint8Array>} */
  const sealAccess = (key, header, access) => ccmSeal(key, accessNonce(header), access, header.szmic ? 8 : 4);
  /** @param {Uint8Array} key @param {MeshAccessHeader} header @param {Uint8Array} sealed @returns {Promise<Uint8Array | null>} */
  const openAccess = (key, header, sealed) => ccmOpen(key, accessNonce(header), sealed, header.szmic ? 8 : 4);

  planner.meshCrypto = Object.freeze({
    cat, aes, cmac, ccmSeal, ccmOpen, s1, k2, k4, sealNetwork, openNetwork, sealAccess, openAccess,
  });
}
