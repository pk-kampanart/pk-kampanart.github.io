/**
 * Development-only Mesh cryptography: AES-CMAC, the salt and key derivations
 * the Mesh profile defines on top of it, and AES-CCM, which the browser does
 * not supply.
 *
 * It is loaded only by the development server and development build
 * (ADR-0013), so the production selector and subtree rules do not apply.
 *
 * Both the stack and the simulated nodes use this file, and that is not the
 * coupling ADR-0037 forbids. These are primitives, and published vectors pin
 * them from outside, so the two sides cannot agree here while both being
 * wrong. Their protocol layers stay apart, which is what the seam check
 * guards.
 */
{
  const BLOCK = 16;
  const ZERO_KEY = new Uint8Array(BLOCK);

  const subtle = () => globalThis.crypto.subtle;

  /** The labels below are ASCII literals, so this needs no encoder.
   * @param {string} text */
  const ascii = (text) =>
    Uint8Array.from(text, (character) => character.charCodeAt(0));

  /** @param {...Uint8Array} parts */
  const join = (...parts) => {
    const out = new Uint8Array(parts.reduce((total, p) => total + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };

  /** Same-length XOR. @param {Uint8Array} a @param {Uint8Array} b */
  const xor = (a, b) => a.map((byte, at) => byte ^ b[at]);

  /** One left shift across the whole block. @param {Uint8Array} block */
  const shiftLeft = (block) => {
    const out = new Uint8Array(block.length);
    let carry = 0;
    for (let at = block.length - 1; at >= 0; at -= 1) {
      out[at] = ((block[at] << 1) | carry) & 0xff;
      carry = block[at] & 0x80 ? 1 : 0;
    }
    return out;
  };

  /**
   * AES-CBC with a zero IV, with the padding block the Web Crypto API adds
   * dropped again. Chained this way it is also CBC-MAC: the last block out is
   * the MAC over everything in.
   * @param {Uint8Array} key @param {Uint8Array} data
   */
  const cbc = async (key, data) => {
    const material = await subtle().importKey("raw", key, "AES-CBC", false, [
      "encrypt",
    ]);
    const out = new Uint8Array(
      await subtle().encrypt(
        { name: "AES-CBC", iv: new Uint8Array(BLOCK) },
        material,
        data,
      ),
    );
    return out.subarray(0, data.length);
  };

  /** The last block of a CBC chain over `data`. @param {Uint8Array} key @param {Uint8Array} data */
  const cbcMac = async (key, data) =>
    (await cbc(key, data)).slice(-BLOCK);

  /** One AES block, which the obfuscation step needs on its own. */
  /** @param {Uint8Array} key @param {Uint8Array} block */
  const e = (key, block) => cbcMac(key, block);

  /** RFC 4493 subkey generation. @param {Uint8Array} block */
  const subkey = (block) => {
    const shifted = shiftLeft(block);
    if (block[0] & 0x80) shifted[BLOCK - 1] ^= 0x87;
    return shifted;
  };

  /**
   * AES-CMAC (RFC 4493).
   * @param {Uint8Array} key @param {Uint8Array} message
   */
  const cmac = async (key, message) => {
    const l = await cbcMac(key, ZERO_KEY);
    const sub1 = subkey(l);
    const sub2 = subkey(sub1);
    const whole = message.length > 0 && message.length % BLOCK === 0;
    const count = whole ? message.length / BLOCK : (message.length / BLOCK | 0) + 1;
    const padded = new Uint8Array(count * BLOCK);
    padded.set(message);
    if (!whole) padded[message.length] = 0x80;
    const at = (count - 1) * BLOCK;
    padded.set(xor(padded.slice(at), whole ? sub1 : sub2), at);
    return cbcMac(key, padded);
  };

  /**
   * k1, which provisioning derives its confirmation, session and device keys
   * with. It is CMAC over CMAC, so the vectors that pin CMAC reach it; no
   * separate published vector is used here.
   * @param {Uint8Array} n @param {Uint8Array} salt @param {Uint8Array} p
   */
  const k1 = async (n, salt, p) => cmac(await cmac(salt, n), p);

  /** s1, the salt every derivation below starts from. @param {Uint8Array | string} m */
  const s1 = (m) => cmac(ZERO_KEY, typeof m === "string" ? ascii(m) : m);

  /**
   * Network key derivation: the identifier the network is recognised by, and
   * the two keys its traffic is encrypted and obfuscated with.
   * @param {Uint8Array} n @param {Uint8Array} p
   */
  const k2 = async (n, p) => {
    const t = await cmac(await s1("smk2"), n);
    const t1 = await cmac(t, join(p, Uint8Array.of(1)));
    const t2 = await cmac(t, join(t1, p, Uint8Array.of(2)));
    const t3 = await cmac(t, join(t2, p, Uint8Array.of(3)));
    return { nid: t1[BLOCK - 1] & 0x7f, encryptionKey: t2, privacyKey: t3 };
  };

  /** The eight-byte network identifier a proxy advertises. @param {Uint8Array} n */
  const k3 = async (n) => {
    const t = await cmac(await s1("smk3"), n);
    return (await cmac(t, join(ascii("id64"), Uint8Array.of(1)))).slice(-8);
  };

  /** The six-bit application key identifier. @param {Uint8Array} n */
  const k4 = async (n) => {
    const t = await cmac(await s1("smk4"), n);
    return (await cmac(t, join(ascii("id6"), Uint8Array.of(1))))[BLOCK - 1] & 0x3f;
  };

  /**
   * The counter blocks and the authentication blocks CCM is built from.
   * @param {Uint8Array} nonce @param {number} micBytes @param {number} length
   * @param {number} adataLength
   */
  const ccmBlocks = (nonce, micBytes, length, adataLength) => {
    const sizeBytes = 15 - nonce.length;
    const b0 = new Uint8Array(BLOCK);
    b0[0] =
      (adataLength ? 0x40 : 0) |
      (((micBytes - 2) / 2) << 3) |
      (sizeBytes - 1);
    b0.set(nonce, 1);
    for (let at = 0; at < sizeBytes; at += 1)
      b0[BLOCK - 1 - at] = (length >>> (8 * at)) & 0xff;
    const counter = new Uint8Array(BLOCK);
    counter[0] = sizeBytes - 1;
    counter.set(nonce, 1);
    return { b0, counter, sizeBytes };
  };

  /** Rounds up to a whole number of blocks. @param {Uint8Array} data */
  const blockAligned = (data) => {
    if (data.length === 0) return data;
    const out = new Uint8Array(Math.ceil(data.length / BLOCK) * BLOCK);
    out.set(data);
    return out;
  };

  /**
   * @param {Uint8Array} key @param {Uint8Array} nonce @param {Uint8Array} text
   * @param {Uint8Array} adata @param {number} micBytes
   */
  const ccmMac = async (key, nonce, text, adata, micBytes) => {
    const { b0 } = ccmBlocks(nonce, micBytes, text.length, adata.length);
    // Associated data is carried with its own length, in its own blocks.
    const header =
      adata.length === 0
        ? new Uint8Array(0)
        : blockAligned(
            join(
              Uint8Array.of((adata.length >>> 8) & 0xff, adata.length & 0xff),
              adata,
            ),
          );
    return cbcMac(key, join(b0, header, blockAligned(text)));
  };

  /**
   * @param {Uint8Array} key @param {Uint8Array} counter @param {Uint8Array} data
   */
  const ccmStream = async (key, counter, data) => {
    const material = await subtle().importKey("raw", key, "AES-CTR", false, [
      "encrypt",
    ]);
    // A mesh message is far shorter than the counter field, so 16 bits of
    // counter cannot run into the nonce above it.
    return new Uint8Array(
      await subtle().encrypt(
        { name: "AES-CTR", counter, length: 16 },
        material,
        data,
      ),
    );
  };

  /**
   * AES-CCM. The message integrity check is four or eight bytes, as the layer
   * asking for it decides.
   * @param {Uint8Array} key @param {Uint8Array} nonce @param {Uint8Array} plaintext
   * @param {{ adata?: Uint8Array, micBytes?: number }} [options]
   */
  const ccmEncrypt = async (key, nonce, plaintext, options = {}) => {
    const adata = options.adata ?? new Uint8Array(0);
    const micBytes = options.micBytes ?? 4;
    const { counter } = ccmBlocks(nonce, micBytes, plaintext.length, adata.length);
    const tag = await ccmMac(key, nonce, plaintext, adata, micBytes);
    const s0 = await ccmStream(key, counter, new Uint8Array(BLOCK));
    const first = new Uint8Array(counter);
    first[BLOCK - 1] = 1;
    const ciphertext = await ccmStream(key, first, plaintext);
    return join(ciphertext, xor(tag.slice(0, micBytes), s0.slice(0, micBytes)));
  };

  /**
   * Returns null when the integrity check does not hold, which is what a wrong
   * key looks like from here. Callers report that as a wrong key, never as a
   * malformed message.
   * @param {Uint8Array} key @param {Uint8Array} nonce @param {Uint8Array} sealed
   * @param {{ adata?: Uint8Array, micBytes?: number }} [options]
   */
  const ccmDecrypt = async (key, nonce, sealed, options = {}) => {
    const adata = options.adata ?? new Uint8Array(0);
    const micBytes = options.micBytes ?? 4;
    if (sealed.length < micBytes) return null;
    const ciphertext = sealed.slice(0, sealed.length - micBytes);
    const mic = sealed.slice(sealed.length - micBytes);
    const { counter } = ccmBlocks(nonce, micBytes, ciphertext.length, adata.length);
    const first = new Uint8Array(counter);
    first[BLOCK - 1] = 1;
    const plaintext = await ccmStream(key, first, ciphertext);
    const tag = await ccmMac(key, nonce, plaintext, adata, micBytes);
    const s0 = await ccmStream(key, counter, new Uint8Array(BLOCK));
    const expected = xor(tag.slice(0, micBytes), s0.slice(0, micBytes));
    let same = 0;
    for (let at = 0; at < micBytes; at += 1) same |= expected[at] ^ mic[at];
    return same === 0 ? plaintext : null;
  };

  /** @param {string} text */
  const bytesFromHex = (text) =>
    Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));

  /** @param {Uint8Array} bytes */
  const hexFromBytes = (bytes) =>
    [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  window.PlannerMeshCrypto = {
    e,
    cmac,
    s1,
    k1,
    k2,
    k3,
    k4,
    ccmEncrypt,
    ccmDecrypt,
    bytesFromHex,
    hexFromBytes,
    join,
    xor,
  };
}
