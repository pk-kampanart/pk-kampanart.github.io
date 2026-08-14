/**
 * Reads and decodes files embedded by the production build, including image URLs.
 * It does not fetch resources or interpret their contents.
 * Channels: reads embedded-file script blocks; exports bytes, text and URLs.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @param {string} path */
  const find = (path) =>
    /** @type {HTMLScriptElement | null} */ (
      [
        ...document.querySelectorAll(
          'script[data-part="embedded-file"][data-path]',
        ),
      ]
        .map((element) => /** @type {HTMLScriptElement} */ (element))
        .find((element) => element.dataset.path === path) || null
    );
  /** @type {Map<string, Promise<Uint8Array>>} */
  const decoded = new Map();
  /** @type {Map<string, string>} */
  const urls = new Map();
  /** @param {Uint8Array} bytes */
  const base64 = (bytes) => {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  };
  /** @param {HTMLScriptElement} element @returns {Promise<Uint8Array>} */
  const decode = async (element) => {
    const content = element.textContent || "";
    const encoding = element.dataset.encoding;
    if (encoding === "text") return new TextEncoder().encode(content);
    if (encoding !== "base64" && encoding !== "gzip-base64")
      throw new Error("unsupported embedded file encoding");
    const binary = atob(content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (encoding === "base64") return bytes;
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  /** @param {string} path */
  const bytes = (path) => {
    const element = find(path);
    if (!element) return null;
    if (!decoded.has(path)) decoded.set(path, decode(element));
    return decoded.get(path) || null;
  };
  /** @param {string} path */
  const url = (path) => {
    if (urls.has(path)) return urls.get(path) || null;
    const element = find(path);
    const mime = element?.dataset.type;
    if (!element || !mime) return null;
    const encoding = element.dataset.encoding;
    const content = element.textContent || "";
    let payload;
    if (encoding === "base64") payload = content.replace(/\s/g, "");
    else if (encoding === "text")
      payload = base64(new TextEncoder().encode(content));
    else return null;
    const result = `data:${mime};base64,${payload}`;
    urls.set(path, result);
    return result;
  };
  planner.embeddedFiles = {
    has: (path) => Boolean(find(path)),
    text: (path) => {
      const element = find(path);
      return element?.dataset.encoding === "text"
        ? element.textContent || ""
        : null;
    },
    bytes,
    url,
  };
}
