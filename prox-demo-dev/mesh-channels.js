/**
 * Reads a node's composition, vendor-neutral, so any engine behind the pane
 * yields the same answers: its channels (decision 25), which element each of a
 * channel's controls drives, and how Models names each model and its keys. Names nothing and
 * stores nothing: "Ch n" is the channel's position.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const LIGHTNESS_SERVER = "1300";
  const CONFIG_SERVER = "0000";
  const ONOFF_SERVER = "1000";
  const ONOFF_CLIENT = "1001";
  const CTL_SERVER = "1303";
  const CTL_CLIENT = "1305";
  const CTL_TEMPERATURE_SERVER = "1306";
  // ponytail: names the models PROX firmware carries and their clients; any
  // other shows its id.
  /** @type {Record<string, string>} */
  const MODELS = {
    [CONFIG_SERVER]: "Config Server",
    "0001": "Config Client",
    "0002": "Health Server",
    "0003": "Health Client",
    [ONOFF_SERVER]: "OnOff Server",
    [ONOFF_CLIENT]: "OnOff Client",
    1002: "Level Server",
    1003: "Level Client",
    1004: "Default Transition Time Server",
    1006: "Power OnOff Server",
    1007: "Power OnOff Setup Server",
    1100: "Sensor Server",
    1101: "Sensor Setup Server",
    [LIGHTNESS_SERVER]: "Lightness Server",
    1301: "Lightness Setup Server",
    1302: "Lightness Client",
    [CTL_SERVER]: "CTL Server",
    1304: "CTL Setup Server",
    [CTL_CLIENT]: "CTL Client",
    [CTL_TEMPERATURE_SERVER]: "CTL Temperature Server",
    "130F": "LC Server",
    1310: "LC Setup Server",
    1311: "LC Client",
  };

  /** @param {MeshElement} element @param {string} id */
  const has = (element, id) => element.models.some((model) => model.id === id);

  /** @param {MeshNode} node @returns {MeshChannel[]} */
  const of = (node) => {
    // A lamp's Light LC element carries its own OnOff Server, so where a
    // Lightness Server exists it alone starts an output channel.
    const output = node.elements.some((element) =>
      has(element, LIGHTNESS_SERVER),
    )
      ? LIGHTNESS_SERVER
      : ONOFF_SERVER;
    /** @type {MeshChannel[]} */
    const channels = [];
    for (const element of node.elements) {
      /** @type {MeshChannel["role"] | ""} */
      const role = has(element, output)
        ? "output"
        : has(element, ONOFF_CLIENT)
          ? "input"
          : "";
      if (role)
        channels.push({
          number: channels.length + 1,
          role,
          elements: [element.address],
        });
      else channels.at(-1)?.elements.push(element.address);
    }
    return channels;
  };

  /** An input channel drives nothing: only the device is pressed or turned.
   * Lightness goes through the CTL Server, the model Add binds (decision 43).
   * @param {MeshNode} node @param {MeshChannel} channel @returns {MeshDrives} */
  const drives = (node, channel) => {
    if (channel.role !== "output") return {};
    const elements = node.elements.filter((element) =>
      channel.elements.includes(element.address),
    );
    /** @param {string} id */
    const at = (id) => elements.find((element) => has(element, id))?.address;
    /** @type {MeshDrives} */
    const found = {
      onoff: at(ONOFF_SERVER),
      lightness: at(CTL_SERVER),
      temperature: at(CTL_TEMPERATURE_SERVER),
    };
    return Object.fromEntries(
      Object.entries(found).filter(([, address]) => address),
    );
  };

  /** What Blink's On/Off fallback toggles. @param {MeshNode} node @returns {string[]} */
  const onOffs = (node) =>
    of(node).flatMap((channel) => drives(node, channel).onoff || []);

  /** @param {string} id */
  const modelName = (id) =>
    MODELS[id] || (id.length > 4 ? `Vendor model ${id}` : `Model ${id}`);

  /** A model's name, keys and group addresses: the three columns Models lists.
   * @param {MeshModel} model @param {Record<number, string>} [keyNames] application name by key index
   * @returns {[string, string, string]} */
  const modelCells = ({ id, keys, publish, subscribe = [] }, keyNames = {}) => {
    // The Config Server answers only to the device key; key 0 is the setup key.
    const held =
      id === CONFIG_SERVER
        ? "device key"
        : keys
            .map((index) =>
              index === 0 ? "setup" : keyNames[index] || `key ${index}`,
            )
            .join(", ") || "no key";
    const routes = [
      publish && `pub ${publish}`,
      subscribe.length > 0 && `sub ${subscribe.join(", ")}`,
    ]
      .filter(Boolean)
      .join(" · ");
    return [modelName(id), held, routes];
  };

  // Decision 42: a Link is these two [client, server] pairs per channel. The
  // encoder's press and turn need no third.
  const pairs = /** @type {readonly (readonly [string, string])[]} */ (
    Object.freeze([
      Object.freeze([ONOFF_CLIENT, ONOFF_SERVER]),
      Object.freeze([CTL_CLIENT, CTL_SERVER]),
    ])
  );

  // Decision 43: Add binds the setup key to Health, OnOff, CTL and CTL
  // Temperature Servers only.
  const setup = Object.freeze([
    "0002",
    ONOFF_SERVER,
    CTL_SERVER,
    CTL_TEMPERATURE_SERVER,
  ]);

  planner.meshChannels = Object.freeze({
    of,
    drives,
    onOffs,
    modelName,
    modelCells,
    pairs,
    setup,
  });
}
