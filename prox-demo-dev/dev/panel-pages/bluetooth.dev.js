/**
 * Development-only Web Bluetooth discovery page. It reads browser Bluetooth
 * capability and session data and never writes Plan state, so it may hold
 * external session state in its mount closure (ADR-0033).
 */
{
  const panel = window.PlannerDevPanel;
  if (!panel?.register) throw new Error("Developer panel host is unavailable");

  /** Capability state and the one recovery step that clears it. */
  const RECOVERY = {
    insecure:
      "Web Bluetooth needs a secure page. Open the planner on localhost or HTTPS, then reload this page.",
    unsupported:
      "Web Bluetooth is not available in this browser. Use Chrome or Edge, open chrome://flags/#enable-experimental-web-platform-features (or edge://flags/...), set Experimental Web Platform features to Enabled, relaunch the browser, then reload this page.",
    unavailable:
      "Bluetooth is unavailable. Turn on the computer's Bluetooth adapter, allow this browser to use Bluetooth, and put the device in advertising mode. Then click Add device again.",
    ready: "Ready. Choose a device to start a discovery session.",
  };

  /**
   * Real-session outcomes. A cancelled chooser returns to RECOVERY.ready; the
   * rest name the next user step without claiming anything about hardware.
   */
  const SESSION = {
    choosing: "Waiting for the browser device chooser.",
    permission:
      "The browser blocked Bluetooth access for this page. Allow Bluetooth for this page, then choose a device again.",
    connected: "Connected. The GATT tab shows the services the browser permitted.",
    failed:
      "GATT connection failed. The device root stays in the GATT tab so you can retry.",
    limited:
      "Browser permission limits this result to the services the chooser granted. This is not evidence that the device has no other services.",
    disconnected:
      "Disconnected. The device root stays in the GATT tab so you can reconnect.",
    authorized:
      "Devices this page is already allowed to use are listed without the chooser. Connect one to see its services.",
  };

  /** A device the browser already permits, which nothing has connected to. */
  const AUTHORIZED_STATE = "Authorized, not connected";

  /**
   * The scope mark on every line this panel writes to the console, so a
   * console full of a host page's own noise can be filtered down to this
   * feature. Development only: production ships none of this file (ADR-0013).
   */
  const LOG_SCOPE = "bluetooth-dev";

  /**
   * Where a line came from. Filtering on one area is how somebody watching a
   * read that produced nothing finds the step it stopped at.
   */
  const LOG_AREA = {
    gatt: "gatt",
    mesh: "mesh",
    relay: "relay",
    keys: "keys",
    /**
     * The session event log, which is a record the page shows rather than a
     * diagnostic. Kept in its own area so a diagnostic added to the GATT trail
     * cannot be mistaken for one — a reader filtering for events would
     * otherwise count them, and so would a test.
     */
    event: "event",
  };

  /**
   * One line, scoped. Key material never reaches here: a key is reported by
   * its presence, its index or the identifier derived from it, never by its
   * bytes, because a console log outlives the session that made it.
   * @param {string} area @param {string} name @param {unknown} [detail]
   */
  const logEvent = (area, name, detail) => {
    const text = detail === undefined ? "" : `: ${detail}`;
    // eslint-disable-next-line no-console
    console.log(`[${LOG_SCOPE}/${area}] ${name}${text}`);
  };

  /**
   * The session event vocabulary. One record per occurrence, one log line at
   * creation; the demo fixtures and a real session say the same things.
   */
  const EVENT = {
    chosen: "Chooser returned the device",
    connected: "GATT connected",
    failed: "GATT connection failed",
    disconnected: "Device disconnected",
    removed: "Removed from the session",
  };
  /** @param {number} count */
  const discoveredEvent = (count) => `Discovered ${count} services`;

  /** The one metadata label each selectable row kind carries. */
  const LABEL = {
    "bluetooth-device": "Browser device ID",
    "bluetooth-device-events": "Browser device ID",
    "bluetooth-service": "Service UUID",
    "bluetooth-characteristic": "Characteristic UUID",
  };

  /** The two Mesh services, named once so the catalog and the filters agree. */
  const MESH_PROVISIONING = "00001827-0000-1000-8000-00805f9b34fb";
  const MESH_PROXY = "00001828-0000-1000-8000-00805f9b34fb";

  /**
   * How long one request waits for its answer. A segmented answer stops the
   * wait as soon as it reassembles, so this bounds only the silent case.
   *
   * Zephyr's Configuration Client waits five seconds, and a node that answers
   * in three is a node that answers. This was two seconds only because a wrong
   * device key also reads as silence and first contact used to try every key
   * the session held; a proxy now says which node it is, so nothing is guessed
   * and the wait costs once rather than once per key.
   */
  const ANSWER_TIMEOUT = 5000;

  /**
   * A device's provisioning state, read from what it advertises. A silent
   * device has a known identity and an unknown state; saying so is the point.
   */
  const MESH_STATE = {
    unprovisioned: "Unprovisioned",
    provisioned: "Provisioned",
    silent: "No advertisement seen",
    absent: "Not a Mesh device",
  };

  /**
   * Why a node reads or does not. "Provisioned" alone says nothing about
   * whether we can do anything with it, and the four reasons are different
   * problems with different answers.
   */
  const MESH_CONDITION = {
    unknownNetwork: {
      label: "Network not known",
      why: "This node advertises a network identifier, and no keys have been entered to compare it against. Enter the network's keys to find out whether it is one of ours.",
    },
    otherNetwork: {
      label: "Another network",
      why: "The network identifier it advertises is not the one our network key derives, so it belongs to a different network. It cannot be read with the keys we hold, and nothing we send reaches it.",
    },
    queued: {
      label: "Waiting to be read",
      why: "Nodes are read one at a time, because each is a conversation with a device rather than a lookup. This one has not started yet.",
    },
    asking: {
      label: "Reading…",
      why: "A request is with the node now. A description longer than one message arrives in segments, so a node with many elements takes longer than one with few.",
    },
    unopened: {
      label: "No key opened it",
      why: "It is in our network and nothing this session holds opened it. Its last attempt says which: a node that said which address it is and has no device key here, or a node that answered nothing at all — and from outside, silence and a key that does not belong are the same thing.",
    },
    read: {
      label: "In this network",
      why: "It answered under a device key this session holds. Its unicast address is shown in front of its name because that address is something it told us, not something known before it answered.",
    },
  };

  /** The two branches of the Mesh tree, and what an empty one means. */
  const MESH_BRANCH = [
    {
      id: "unprovisioned",
      name: "Unprovisioned",
      empty: "No authorized device is advertising that it can be provisioned.",
    },
    {
      id: "nodes",
      name: "Nodes",
      empty:
        "No authorized device is advertising as a proxy. Reading a node's own description takes that network's key material.",
    },
    {
      id: "unknown",
      name: "Awaiting an advertisement",
      empty:
        "Every authorized device has advertised. A device listed here is authorized but silent, so its Mesh identity is unknown.",
    },
  ];

  /**
   * Which branch a record belongs under, or none. A device heard advertising
   * without either Mesh service is known not to be a Mesh device and leaves
   * this tab for the GATT tab; a device never heard from is only unknown.
   * @param {string} state
   */
  const meshBranchOf = (state) =>
    state === MESH_STATE.unprovisioned
      ? "unprovisioned"
      : state === MESH_STATE.provisioned
        ? "nodes"
        : state === MESH_STATE.absent
          ? ""
          : "unknown";

  /** Browser capabilities the Mesh tab needs, and the flag each one sits behind. */
  const MESH_CAPABILITY = {
    getDevices:
      "This browser does not return previously authorized devices. Enable chrome://flags/#enable-web-bluetooth-new-permissions-backend (or edge://flags/...), relaunch the browser, then reload this page. Without it, every device is chosen through the chooser again after a reload.",
    watchAdvertisements:
      "This browser does not watch advertisements. Enable chrome://flags/#enable-experimental-web-platform-features (or edge://flags/...), relaunch the browser, then reload this page. Without it, a device's Mesh identity and provisioning state stay unknown.",
  };

  /** The relay link's states, as one sentence each. */
  const LINK = {
    idle: "No relay. This page reaches only its own Bluetooth adapter.",
    connecting: "Joining the relay.",
    waiting: "Joined. Waiting for the other end.",
    joined: "Joined. The other end is attached.",
    refused:
      "The relay refused this room. Check the relay address and the room token.",
    lost: "The relay link dropped. It rejoins by itself.",
  };

  /** The frame vocabulary the relay carries. It reads none of it. */
  const FRAME = {
    list: "mesh:list",
    state: "mesh:state",
    reload: "reload",
    ask: "chooser:ask",
    act: "mesh:act",
    acted: "mesh:acted",
  };

  /**
   * How long a Console waits for a Bridge to finish an action. Reading one
   * node is several exchanges in series, each with its own timeout, so this
   * is much longer than any single one of them.
   */
  const ACTION_TIMEOUT = 30000;

  /** What each end says while a device is being asked for from elsewhere. */
  const ASK = {
    unattached:
      "No Bridge is attached, so there is no adapter to open a chooser on.",
    sent: "Asked the Bridge for a device. Someone there has to accept it.",
    offered:
      "The Console is asking for a device. The browser opens its chooser only for someone here.",
  };

  /** Said wherever a number came out of a decryption this page performed. */
  const EXPERIMENTAL =
    "Experimental — decrypted here. Verify against the Connector before trusting it.";

  /** The state shown on a row: the condition when one is known. @param {any} record */
  const rowState = (record) =>
    record.condition
      ? MESH_CONDITION[/** @type {keyof typeof MESH_CONDITION} */ (record.condition)]
          .label
      : record.state;

  /** @param {number} address */
  const addressLabel = (address) =>
    `0x${address.toString(16).padStart(4, "0")}`;

  /**
   * An opcode is one, two or three octets, so padding it to an address's four
   * digits would print a one-octet opcode as if it were an address.
   * @param {number} opcode
   */
  const opcodeLabel = (opcode) =>
    `0x${opcode.toString(16).padStart(opcode > 0xffff ? 6 : opcode > 0xff ? 4 : 2, "0")}`;

  /**
   * A 16-bit access message parameter. Everything in an access payload is
   * little-endian; the network header above it is not, which is why writing
   * one by hand is where the mistake goes.
   * @param {number} value
   */
  const le16 = (value) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);

  /** The number a model is known by, vendor models included. @param {any} model */
  const modelKey = (model) =>
    model.vendor
      ? `${addressLabel(model.company)}:${addressLabel(model.id)}`
      : addressLabel(model.id);

  /**
   * A model's name, and whether that name is settled. A number this page has
   * no name for keeps its number; a name taken from a vendor table rather than
   * a published one says so, because a confident wrong name is worse than an
   * honest uncertain one when the device on the other end is real.
   * @param {any} model
   */
  const modelLabel = (model) =>
    model.name
      ? model.name + (model.provisionalName ? " (name unconfirmed)" : "")
      : model.vendor
        ? "Vendor model"
        : "Model this page has no name for";

  /** @param {DataView} data @param {number} start @param {number} end */
  const hex = (data, start, end) => {
    let out = "";
    for (let at = start; at < end; at += 1)
      out += data.getUint8(at).toString(16).padStart(2, "0");
    return out;
  };

  /**
   * Reads provisioning state out of one advertisement. Mesh Provisioning
   * service data carries the Device UUID and OOB information; Mesh Proxy
   * service data carries a Network ID or a Node Identity, neither of which
   * names the node to anyone without that network's keys.
   *
   * @param {Map<string, DataView>} serviceData
   */
  const meshIdentity = (serviceData) => {
    const provisioning = serviceData.get(MESH_PROVISIONING);
    if (provisioning && provisioning.byteLength >= 18)
      return {
        state: MESH_STATE.unprovisioned,
        uuid: hex(provisioning, 0, 16),
        oob: provisioning.getUint16(16),
        identity: "",
      };
    const proxy = serviceData.get(MESH_PROXY);
    if (proxy && proxy.byteLength >= 1) {
      const kind = proxy.getUint8(0);
      return {
        state: MESH_STATE.provisioned,
        uuid: "",
        oob: null,
        identity:
          kind === 0
            ? `Network ID ${hex(proxy, 1, Math.min(9, proxy.byteLength))}`
            : `Node Identity ${hex(proxy, 1, proxy.byteLength)}`,
      };
    }
    return null;
  };

  /** @param {number} oob */
  const oobLabel = (oob) =>
    `0x${oob.toString(16).padStart(4, "0")}${oob === 0 ? " (none advertised)" : ""}`;

  /** A Device UUID reads as a UUID, not as 32 undifferentiated hex digits. */
  const uuidLabel = (/** @type {string} */ raw) =>
    raw.length === 32
      ? `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
      : raw;

  /**
   * The approved service catalog (spec: Page behavior), as the 128-bit uuids
   * the browser reports back. Every chooser path requests exactly these.
   */
  const SERVICE_CATALOG = new Map([
    [MESH_PROVISIONING, "Mesh Provisioning"],
    [MESH_PROXY, "Mesh Proxy"],
    ["0000180a-0000-1000-8000-00805f9b34fb", "Device Information"],
    ["0000180f-0000-1000-8000-00805f9b34fb", "Battery Service"],
  ]);

  /** @param {string} uuid */
  const serviceLabel = (uuid) => {
    const known = SERVICE_CATALOG.get(uuid);
    return known ? `${known} (${uuid})` : uuid;
  };

  /** @param {string} markup @returns {HTMLTemplateElement} */
  const makeTemplate = (markup) => {
    const template = document.createElement("template");
    template.innerHTML = markup;
    return template;
  };

  const TEMPLATES = {
    page: makeTemplate(`
      <section data-part="bluetooth-page" aria-label="Bluetooth discovery">
        <h3 data-part="bluetooth-heading">Bluetooth</h3>
        <p data-part="bluetooth-status" role="status">Checking Bluetooth readiness.</p>
        <div data-part="bluetooth-actions">
          <button type="button" data-part="bluetooth-add-mesh">Add Mesh device</button>
          <button type="button" data-part="bluetooth-add-any">Add any device</button>
          <button type="button" data-part="bluetooth-load-demo">Load demo devices</button>
        </div>
        <div role="tablist" aria-label="Bluetooth views" data-part="bluetooth-tablist">
          <button type="button" role="tab" data-part="bluetooth-tab" data-key="mesh"
            id="bluetooth-tab-mesh" aria-controls="bluetooth-panel-mesh"
            aria-selected="true">Mesh</button>
          <button type="button" role="tab" data-part="bluetooth-tab" data-key="gatt"
            id="bluetooth-tab-gatt" aria-controls="bluetooth-panel-gatt"
            aria-selected="false" tabindex="-1">GATT</button>
          <button type="button" role="tab" data-part="bluetooth-tab" data-key="events"
            id="bluetooth-tab-events" aria-controls="bluetooth-panel-events"
            aria-selected="false" tabindex="-1">Events</button>
        </div>
        <div role="tabpanel" data-part="bluetooth-panel" data-key="mesh"
          id="bluetooth-panel-mesh" aria-labelledby="bluetooth-tab-mesh" tabindex="0">
          <fieldset data-part="mesh-role">
            <legend>Role</legend>
            <label data-part="mesh-role-choice">
              <input type="radio" name="mesh-role" data-part="mesh-role-input" value="" />
              <span data-part="mesh-role-name">This machine only</span>
              <span data-part="mesh-role-note">Uses this computer's Bluetooth adapter. No relay.</span>
            </label>
            <label data-part="mesh-role-choice">
              <input type="radio" name="mesh-role" data-part="mesh-role-input" value="bridge" />
              <span data-part="mesh-role-name">Bridge — share this machine's Bluetooth</span>
              <span data-part="mesh-role-note">Someone elsewhere drives the devices you see here.</span>
            </label>
            <label data-part="mesh-role-choice">
              <input type="radio" name="mesh-role" data-part="mesh-role-input" value="console" />
              <span data-part="mesh-role-name">Console — drive another machine</span>
              <span data-part="mesh-role-note">No Bluetooth here. Every action runs on the Bridge.</span>
            </label>
            <div data-part="mesh-link-controls">
              <label data-part="mesh-field">Relay
                <input type="url" data-part="mesh-relay" placeholder="https://example.fly.dev" />
              </label>
              <label data-part="mesh-field">Room
                <input type="text" data-part="mesh-room" />
              </label>
              <label data-part="mesh-arm">
                <input type="checkbox" data-part="mesh-arm-writes" />
                <span>Allow writes to real hardware</span>
              </label>
              <button type="button" data-part="mesh-keys-open">Network keys…</button>
              <button type="button" data-part="mesh-reload-peer" hidden>Reload bridge</button>
            </div>
            <p data-part="mesh-link-state" role="status"></p>
          </fieldset>
          <p data-part="mesh-capability" data-state="action" hidden></p>
          <div data-part="mesh-chooser-ask" role="status" hidden>
            <span data-part="mesh-chooser-ask-text"></span>
            <button type="button" data-part="mesh-chooser-accept" hidden>Open chooser</button>
          </div>
          <div data-part="mesh-session">
            <nav data-part="bluetooth-tree" aria-label="Mesh network"></nav>
          </div>
          <dialog data-part="mesh-keys-dialog" aria-label="Network key material">
            <h4 data-part="mesh-keys-title">Network key material</h4>
            <p data-part="mesh-keys-note">
              Experimental. Held for this browser tab only and cleared when it
              closes. Stored where any script on this origin can read it. Keys
              stay on the page that holds the adapter and never cross the
              relay. Use a lab network's keys, never a working building's.
            </p>
            <details data-part="mesh-keys-help">
              <summary>What these keys are, and where to get them</summary>
              <dl data-part="mesh-keys-fields">
                <dt>netKey</dt>
                <dd>
                  The network key. One per network, and it unlocks every node's
                  traffic at once. From whoever provisioned the network — for
                  the office, that is the C++ Connector.
                </dd>
                <dt>netKeyIndex</dt>
                <dd>Which network key it is. Zero unless the network has more than one.</dd>
                <dt>ivIndex</dt>
                <dd>
                  The network's IV index, eight hex digits. A wrong one makes
                  every message we send look like a replay, and nodes drop it.
                </dd>
                <dt>address</dt>
                <dd>
                  The unicast address this page sends from. It must be one no
                  other provisioner uses, or nodes drop our traffic as a replay
                  and the symptom looks exactly like broken cryptography.
                </dd>
                <dt>sequence</dt>
                <dd>
                  The next sequence number to send with. Start above anything
                  already used. The page reserves a block of them at a time and
                  writes the end of the block down before using any of it, so
                  this number jumps ahead of what was sent and a reload never
                  replays one.
                </dd>
                <dt>devKeys</dt>
                <dd>
                  One device key per node, by unicast address. A node's own
                  description opens only with its own key, so a node with no
                  key here stays visible and unreadable.
                </dd>
                <dt>appKeys</dt>
                <dd>
                  By key index. Needed to switch a device, to identify one, and
                  to read its health: only a Configuration Server is reached
                  with a device key, and every other model — the Health Server
                  included — is bound to an application key. Without them a
                  model still shows which key index it is bound to.
                </dd>
                <dt>labels</dt>
                <dd>
                  Optional. Label UUIDs, which name the virtual addresses a
                  node subscribes to. The address is a one-way hash, so an
                  unsupplied label cannot be worked out.
                </dd>
              </dl>
              <p>
                For the simulated network, press "Use the simulated network's
                keys" below: nothing here has to be typed.
              </p>
            </details>
            <label data-part="mesh-field">Paste the network's keys
              <textarea data-part="mesh-keys-input" rows="10" spellcheck="false"></textarea>
            </label>
            <p data-part="mesh-keys-problem" role="status" hidden></p>
            <div data-part="mesh-keys-actions">
              <button type="button" data-part="mesh-keys-demo">Use the simulated network's keys</button>
              <button type="button" data-part="mesh-keys-clear">Clear keys</button>
              <button type="button" data-part="mesh-keys-cancel">Cancel</button>
              <button type="button" data-part="mesh-keys-save">Load keys</button>
            </div>
          </dialog>
          <dialog data-part="mesh-oob-dialog" aria-label="Provision this device">
            <h4 data-part="mesh-oob-title">Provision this device</h4>
            <p data-part="mesh-oob-why"></p>
            <label data-part="mesh-oob-field" hidden>Number the device is showing
              <input type="number" data-part="mesh-oob-input" min="0" step="1" />
            </label>
            <div data-part="mesh-keys-actions">
              <button type="button" data-part="mesh-oob-cancel">Cancel</button>
              <button type="button" data-part="mesh-oob-accept">Provision</button>
            </div>
          </dialog>
          <div data-part="mesh-inspector" aria-label="Mesh selection" role="dialog" popover="auto">
            <p data-part="mesh-inspector-empty">Select a row to see its details.</p>
          </div>
        </div>
        <div role="tabpanel" data-part="bluetooth-panel" data-key="gatt"
          id="bluetooth-panel-gatt" aria-labelledby="bluetooth-tab-gatt" tabindex="0" hidden>
          <div data-part="bluetooth-session" data-state="">
            <nav data-part="bluetooth-tree" aria-label="Discovered Bluetooth devices"></nav>
          </div>
          <div data-part="bluetooth-inspector" aria-label="Bluetooth selection" role="dialog" popover="auto">
            <p data-part="bluetooth-inspector-empty">Select a row to see its details.</p>
          </div>
        </div>
        <div role="tabpanel" data-part="bluetooth-panel" data-key="events"
          id="bluetooth-panel-events" aria-labelledby="bluetooth-tab-events" tabindex="0" hidden>
          <p data-part="bluetooth-events-empty">No events in this session yet.</p>
          <ol data-part="bluetooth-events" aria-label="Discovery session events"
            aria-live="polite"></ol>
        </div>
      </section>`),
    characteristic: makeTemplate(`
      <div data-anchor="bluetooth-characteristic" data-id="" data-part="tree-line">
        <label data-part="tree-row" tabindex="0">
          <input
            type="radio"
            name="bluetooth-selection"
            data-part="tree-radio"
            tabindex="-1"
          />
          <span data-part="tree-name"></span>
          <span data-part="bluetooth-device-state" hidden></span>
        </label>
      </div>`),
    service: makeTemplate(`
      <details data-anchor="bluetooth-service" data-id="" open>
        <summary data-part="tree-line">
          <span data-part="tree-chevron" aria-hidden="true"></span>
          <label data-part="tree-row" tabindex="0">
            <input
              type="radio"
              name="bluetooth-selection"
              data-part="tree-radio"
              tabindex="-1"
            />
            <span data-part="tree-name"></span>
            <span data-part="bluetooth-device-state" hidden></span>
          </label>
        </summary>
        <div data-part="tree-children"></div>
      </details>`),
    device: makeTemplate(`
      <details data-anchor="bluetooth-device" data-id="">
        <summary data-part="tree-line">
          <span data-part="tree-chevron" aria-hidden="true"></span>
          <label data-part="tree-row" tabindex="0">
            <input
              type="radio"
              name="bluetooth-selection"
              data-part="tree-radio"
              tabindex="-1"
            />
            <span data-part="tree-name"></span>
            <span data-part="bluetooth-device-state" hidden></span>
          </label>
        </summary>
        <div data-part="tree-children">
          <details data-part="bluetooth-section" data-section-kind="services" open>
            <summary data-part="tree-line">
              <span data-part="tree-chevron" aria-hidden="true"></span>
              <span data-part="tree-row">
                <span data-part="tree-name"></span>
              </span>
            </summary>
            <div data-part="tree-children"></div>
          </details>
          <p data-part="bluetooth-device-note" hidden></p>
          <div data-anchor="bluetooth-device-events" data-id="" data-part="tree-line">
            <label data-part="tree-row" tabindex="0">
              <input
                type="radio"
                name="bluetooth-selection"
                data-part="tree-radio"
                tabindex="-1"
              />
              <span data-part="tree-name"></span>
              <span data-part="bluetooth-device-state" hidden></span>
            </label>
          </div>
        </div>
      </details>`),
    event: makeTemplate(
      `<li data-part="bluetooth-event" data-id="" data-device=""></li>`,
    ),
    meshGroup: makeTemplate(`
      <details data-part="mesh-group" data-id="" open>
        <summary data-part="tree-line">
          <span data-part="tree-chevron" aria-hidden="true"></span>
          <span data-part="tree-row">
            <span data-part="tree-name"></span>
            <span data-part="bluetooth-device-state" hidden></span>
          </span>
        </summary>
        <div data-part="tree-children"></div>
        <p data-part="mesh-empty" hidden></p>
      </details>`),
    meshDevice: makeTemplate(`
      <details data-anchor="mesh-device" data-id="">
        <summary data-part="tree-line">
          <span data-part="tree-chevron" aria-hidden="true"></span>
          <label data-part="tree-row" tabindex="0">
            <input
              type="radio"
              name="mesh-selection"
              data-part="tree-radio"
              tabindex="-1"
            />
            <span data-part="mesh-address" hidden></span>
            <span data-part="tree-name"></span>
            <span data-part="bluetooth-device-state" hidden></span>
          </label>
        </summary>
        <div data-part="tree-children"></div>
      </details>`),
    meshSection: makeTemplate(`
      <details data-part="mesh-section" data-section-kind="elements" open>
        <summary data-part="tree-line">
          <span data-part="tree-chevron" aria-hidden="true"></span>
          <span data-part="tree-row">
            <span data-part="tree-name">Elements</span>
          </span>
        </summary>
        <div data-part="tree-children"></div>
      </details>`),
    meshElement: makeTemplate(`
      <details data-anchor="mesh-element" data-id="" open>
        <summary data-part="tree-line">
          <span data-part="tree-chevron" aria-hidden="true"></span>
          <span data-part="tree-row">
            <span data-part="tree-name"></span>
            <span data-part="bluetooth-device-state"></span>
          </span>
        </summary>
        <div data-part="tree-children"></div>
      </details>`),
    meshModel: makeTemplate(`
      <div data-anchor="mesh-model" data-id="" data-part="tree-line">
        <span data-part="tree-row">
          <span data-part="tree-name"></span>
          <span data-part="bluetooth-device-state"></span>
        </span>
      </div>`),
    meshEmpty: makeTemplate(`<p data-part="mesh-empty"></p>`),
    meshInspectorEmpty: makeTemplate(
      `<p data-part="mesh-inspector-empty">Select a row to see its details.</p>`,
    ),
    meshDetail: makeTemplate(`<dl data-part="mesh-detail"></dl>`),
    meshTerm: makeTemplate(`<dt></dt>`),
    meshValue: makeTemplate(`<dd></dd>`),
    deviceEventsEmpty: makeTemplate(
      `<p data-part="bluetooth-device-events-empty">No events for this device yet.</p>`,
    ),
    deviceEvents: makeTemplate(
      `<ol data-part="bluetooth-device-events-list" aria-label="Events for this device" aria-live="polite"></ol>`,
    ),
    deviceEvent: makeTemplate(`<li data-part="bluetooth-device-event"></li>`),
    inspectorEmpty: makeTemplate(
      `<p data-part="bluetooth-inspector-empty">Select a row to see its details.</p>`,
    ),
    inspectorTitle: makeTemplate(
      `<h4 data-part="bluetooth-inspector-title"></h4>`,
    ),
    inspectorPath: makeTemplate(`<p data-part="bluetooth-inspector-path"></p>`),
    inspectorDetails: makeTemplate(
      `<dl><dt></dt><dd data-part="bluetooth-inspector-id"></dd></dl>`,
    ),
    overviewState: makeTemplate(`<p data-part="bluetooth-overview-state"></p>`),
    overviewActions: makeTemplate(
      `<div data-part="bluetooth-overview-actions"></div>`,
    ),
    // Each action says what it does on hover. A label of two words cannot
    // carry which key secures it or whether it changes the device, and those
    // are the two things worth knowing before pressing one.
    "bluetooth-reconnect": makeTemplate(
      `<button type="button" data-part="bluetooth-reconnect"
        title="Open a GATT connection to this device again and read its services.">Reconnect</button>`,
    ),
    "bluetooth-disconnect": makeTemplate(
      `<button type="button" data-part="bluetooth-disconnect"
        title="Close this page's connection. The device stays in the list.">Disconnect</button>`,
    ),
    "mesh-describe": makeTemplate(
      `<button type="button" data-part="mesh-describe"
        title="Ask the node to describe itself — its elements and the models on them. Reads only, under the node's own device key.">Read from node</button>`,
    ),
    "mesh-on": makeTemplate(
      `<button type="button" data-part="mesh-on"
        title="Switch the node's on/off model on, under an application key. Changes the device, so real hardware must be armed.">Turn on</button>`,
    ),
    "mesh-off": makeTemplate(
      `<button type="button" data-part="mesh-off"
        title="Switch the node's on/off model off, under an application key. Changes the device, so real hardware must be armed.">Turn off</button>`,
    ),
    "mesh-hops": makeTemplate(
      `<button type="button" data-part="mesh-hops"
        title="Read hop counts from a heartbeat arrangement. Writes to the node, so real hardware must be armed — and this is not yet the distance to the node.">Measure hops</button>`,
    ),
    "mesh-identify": makeTemplate(
      `<button type="button" data-part="mesh-identify"
        title="Make the node draw attention to itself for ten seconds, so you can see which one it is. Needs no arming.">Identify (10s)</button>`,
    ),
    "mesh-bindings": makeTemplate(
      `<button type="button" data-part="mesh-bindings"
        title="Read which application keys the node holds, and which model is bound to which. Reads only.">Read bindings</button>`,
    ),
    "mesh-provision": makeTemplate(
      `<button type="button" data-part="mesh-provision"
        title="Bring this device into this session's network: it is given an address and a device key. Asks first, and real hardware must be armed.">Provision…</button>`,
    ),
    "mesh-publication": makeTemplate(
      `<button type="button" data-part="mesh-publication"
        title="Read where each model publishes, how often, and to which key. Reads only.">Read publication</button>`,
    ),
    "bluetooth-remove": makeTemplate(
      `<button type="button" data-part="bluetooth-remove"
        title="Drop this device from the session and disconnect it. The browser keeps the permission you granted.">Remove</button>`,
    ),
  };

  /** @param {keyof typeof TEMPLATES} name @returns {Element} */
  const cloneTemplate = (name) => {
    const root = TEMPLATES[name].content.firstElementChild;
    if (!root) throw new Error(`Bluetooth template "${name}" is empty`);
    return /** @type {Element} */ (root.cloneNode(true));
  };

  /** @param {Element} node @param {string} label @param {string} [state] */
  const fillLine = (node, label, state) => {
    const name = node.querySelector('[data-part="tree-name"]');
    if (name) name.textContent = label;
    const radio = node.querySelector('input[name="bluetooth-selection"]');
    if (radio) {
      radio.value =
        node.getAttribute("data-id") ||
        node.closest("[data-anchor]")?.getAttribute("data-id") ||
        "";
      radio.setAttribute("value", radio.value);
    }
    const stateNode = node.querySelector(
      '[data-part="bluetooth-device-state"]',
    );
    if (stateNode) {
      stateNode.textContent = state || "";
      stateNode.hidden = !state;
    }
    return node;
  };

  /** @returns {Promise<keyof RECOVERY>} */
  const detect = async () => {
    if (!window.isSecureContext) return "insecure";
    const bluetooth = navigator.bluetooth;
    if (!bluetooth) return "unsupported";
    try {
      return (await bluetooth.getAvailability()) ? "ready" : "unavailable";
    } catch {
      return "unavailable";
    }
  };

  /** @param {HTMLElement} root */
  const mount = (root) => {
    let live = true;

    const page = cloneTemplate("page");

    const find = (selector) =>
      /** @type {HTMLElement} */ (page.querySelector(selector));
    const status = find('[data-part="bluetooth-status"]');
    const session = find('[data-part="bluetooth-session"]');
    // Both tabs hold a tree, so this one is named by its panel, not by order.
    const tree = find(
      '[data-part="bluetooth-panel"][data-key="gatt"] [data-part="bluetooth-tree"]',
    );
    const inspector = find('[data-part="bluetooth-inspector"]');
    const events = find('[data-part="bluetooth-events"]');
    const eventsEmpty = find('[data-part="bluetooth-events-empty"]');
    const tabs = /** @type {HTMLElement[]} */ ([
      ...page.querySelectorAll('[data-part="bluetooth-tab"]'),
    ]);
    const panels = /** @type {HTMLElement[]} */ ([
      ...page.querySelectorAll('[data-part="bluetooth-panel"]'),
    ]);
    /** @param {string} text @param {boolean} [needsAction] */
    const setStatus = (text, needsAction = false) => {
      status.textContent = text;
      if (needsAction) status.setAttribute("data-state", "action");
      else status.removeAttribute("data-state");
    };

    const style = document.createElement("style");
    style.textContent = `
      [data-part="bluetooth-page"] {
        display: flex;
        min-height: 0;
        block-size: 100%;
        flex-direction: column;
      }
      [data-part="bluetooth-heading"] { margin: 0 0 8px; }
      [data-part="bluetooth-status"] {
        margin: 0 0 12px;
        color: var(--text-muted, #586474);
      }
      /* One notice treatment, wherever a status asks the user to act. */
      [data-part="bluetooth-status"][data-state~="action"],
      [data-part="mesh-capability"][data-state~="action"] {
        padding: var(--space-4);
        border: var(--border-width) solid var(--notice);
        border-radius: var(--radius);
        background: color-mix(in srgb, var(--notice) 12%, white);
      }
      [data-part="bluetooth-actions"] { margin-block-end: 12px; }
      [data-part="bluetooth-tablist"] {
        display: flex;
        gap: 4px;
        margin-block-end: 12px;
        border-block-end: 1px solid var(--border, #d5dae2);
      }
      [data-part="bluetooth-tab"] {
        border: 0;
        border: 1px solid var(--border, #d5dae2);
        /* The tablist's own line is what the selected tab cuts through. */
        border-block-end-color: transparent;
        border-radius: 6px 6px 0 0;
        margin-block-end: -1px;
        background: var(--sunken, #f2f4f7);
        color: var(--muted, #5b6472);
        font-weight: 600;
      }
      [data-part="bluetooth-tab"][aria-selected="true"] {
        border-color: var(--border, #d5dae2);
        border-block-end-color: var(--surface, #ffffff);
        background: var(--surface, #ffffff);
        color: var(--accent-strong, #0f58b5);
      }
      [data-part="bluetooth-panel"] {
        display: grid;
        flex: 1;
        min-height: 0;
        gap: 12px;
      }

      /* An author display rule beats the UA sheet's hidden rule, and this page
         sets display on panels and the shell sets it on every button. Restated
         once for the page, and repeated so it outweighs any two-attribute
         selector that sets display later in this sheet. */
      [data-part="bluetooth-page"] [hidden][hidden] { display: none; }
      [data-part="bluetooth-session"][data-state~="demo"]::before,
      [data-part="mesh-session"][data-state~="demo"]::before {
        content: "Demo session — fixture data, not hardware";
        display: block;
        margin-block-end: 8px;
        padding: 4px 8px;
        border-radius: 4px;
        background: var(--accent-surface, #e8f1ff);
        color: var(--accent-strong, #0f58b5);
        font-weight: 600;
      }
      [data-part="bluetooth-tree"] [data-part="tree-children"] {
        padding-inline-start: 0;
      }
      [data-part="bluetooth-session"],
      [data-part="mesh-session"] {
        min-height: 0;
        overflow: auto;
      }
      [data-part="bluetooth-tree"] [data-part="tree-line"],
      [data-part="bluetooth-tree"] [data-part="tree-row"] {
        background: var(--row-tint, transparent);
      }
      [data-part="bluetooth-tree"] [data-part="tree-line"] {
        display: flex;
        position: relative;
        min-width: 0;
        width: 100%;
        align-items: center;
        gap: var(--space-2, 4px);
        border: 1px solid transparent;
        border-radius: var(--radius-sm, 4px);
      }
      [data-part="bluetooth-tree"] [data-part="tree-row"] {
        display: flex;
        position: relative;
        min-width: 0;
        width: 100%;
        height: var(--row-height, 22px);
        flex: 1 1 auto;
        gap: 8px;
        align-items: center;
        font: inherit;
        cursor: default;
      }
      [data-part="bluetooth-tree"] [data-part="tree-name"] {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      [data-part="bluetooth-tree"] [data-part="bluetooth-device-state"] {
        flex: 0 0 auto;
        margin-inline-start: auto;
      }
      [data-part="bluetooth-tree"] [data-part="tree-line"]:hover,
      [data-part="bluetooth-tree"] [data-part="tree-line"]:has(:focus-visible) {
        --row-tint: var(--row-hover-surface, #f0f3f7);
      }
      [data-part="bluetooth-tree"] [data-part="tree-row"]:focus-visible,
      [data-part="bluetooth-tree"] [data-part="tree-line"]:focus-visible {
        outline: var(--focus-width, 2px) solid var(--focus-color, #1772e8);
        outline-offset: -2px;
        z-index: 999;
      }
      [data-part="bluetooth-tree"]
        [data-part="tree-row"]:has(input[type="radio"])::before {
        content: "";
        position: absolute;
        inset-block: 0;
        inset-inline-end: 100%;
        width: 100%;
      }
      [data-part="bluetooth-tree"]
        [data-part="tree-row"][data-state~="selected"] {
        border-color: var(--accent, #1772e8);
        background-color: var(
          --state-selected-background,
          var(--accent-surface, #e8f1ff)
        );
      }
      [data-part="bluetooth-tree"]
        [data-part="tree-line"]:has(
          ~ [data-part="tree-children"]
            [data-part="tree-row"][data-state~="selected"]
        ) {
        --row-tint: var(--accent-ancestor-surface, #f0f5ff);
      }
      [data-part="bluetooth-tree"] [data-part="tree-chevron"] {
        position: relative;
        z-index: var(--layer-actions, 1);
      }
      [data-part="bluetooth-tree"] [data-part="tree-line"] {
        padding-inline-start: calc(
          var(--tree-indent, 12px) * var(--tree-level, 0)
        );
      }
      [data-part="bluetooth-tree"]
        [data-anchor="bluetooth-device"]
        > summary[data-part="tree-line"] {
        --tree-level: 0;
      }
      [data-part="bluetooth-tree"]
        [data-part="bluetooth-section"]
        > summary[data-part="tree-line"] {
        --tree-level: 1;
      }
      [data-part="bluetooth-tree"]
        [data-anchor="bluetooth-service"]
        > summary[data-part="tree-line"] {
        --tree-level: 2;
      }
      [data-part="bluetooth-tree"]
        [data-anchor="bluetooth-characteristic"][data-part="tree-line"] {
        --tree-level: 3;
      }
      [data-part="bluetooth-tree"]
        [data-anchor="bluetooth-device-events"][data-part="tree-line"] {
        --tree-level: 1;
      }
      [data-part="bluetooth-tree"]
        [data-part="mesh-group"]
        > summary[data-part="tree-line"] {
        --tree-level: 0;
      }
      [data-part="bluetooth-tree"]
        [data-anchor="mesh-device"]
        > summary[data-part="tree-line"] {
        --tree-level: 1;
      }
      [data-part="bluetooth-tree"]
        [data-part="mesh-section"]
        > summary[data-part="tree-line"] {
        --tree-level: 2;
      }
      [data-part="bluetooth-tree"]
        [data-anchor="mesh-element"]
        > summary[data-part="tree-line"] {
        --tree-level: 3;
      }
      [data-part="bluetooth-tree"]
        [data-anchor="mesh-model"][data-part="tree-line"] {
        --tree-level: 4;
      }
      /* A node that has not described itself has nothing to open. */
      [data-anchor="mesh-device"]:not([data-state~="described"])
        > summary [data-part="tree-chevron"] {
        visibility: hidden;
      }
      [data-part="bluetooth-tree"] [data-part="tree-chevron"]::before {
        content: "\\25B8";
        color: var(--text-muted, #586474);
      }
      [data-part="bluetooth-tree"] details[open] > [data-part="tree-line"]
        [data-part="tree-chevron"]::before { content: "\\25BE"; }
      [data-part="bluetooth-device-state"] { color: var(--text-muted, #586474); }
      [data-part="mesh-address"] {
        margin-inline-end: 6px;
        font-family: ui-monospace, monospace;
        color: var(--accent-strong, #0f58b5);
      }
      [data-part="bluetooth-device-note"] {
        margin: 4px 0 4px 22px;
        color: var(--text-muted, #586474);
      }
      /* Selection detail is in the top layer in both tabs, so the tree keeps
         the panel's height and the popover escapes the scrolling session. It
         is placed against the row it describes, in viewport coordinates. */
      [data-part="bluetooth-inspector"],
      [data-part="mesh-inspector"] {
        position: fixed;
        margin: 0;
        max-block-size: 60vh;
        inline-size: min(26rem, calc(100vw - 32px));
        overflow: auto;
        padding: 12px;
        border: 1px solid var(--border, #d5dae2);
        border-radius: 6px;
        background: var(--surface, #ffffff);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
      }
      [data-part="bluetooth-inspector"] dt { font-weight: 600; }
      [data-part="bluetooth-overview-state"] {
        margin: 0 0 8px;
        color: var(--text-muted, #586474);
      }
      /* Six actions do not fit the card's width on one line, and a popover
         that scrolls sideways hides the last of them. */
      [data-part="bluetooth-overview-actions"] {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-block-end: 12px;
      }
      [data-part="bluetooth-inspector"] dd { margin: 0 0 8px; }
      [data-part="bluetooth-events"],
      [data-part="bluetooth-device-events-list"] {
        margin: 0;
        padding-inline-start: 20px;
      }
      [data-part="bluetooth-inspector-path"],
      [data-part="bluetooth-device-events-empty"] {
        margin: 0 0 8px;
        color: var(--text-muted, #586474);
      }
      /* The notices above the tree come and go, and a hidden one is not a grid
         item, so a row template by position would leave the rows its absent
         items would have filled. The tree takes the slack instead, however
         many siblings happen to be showing. */
      [data-part="bluetooth-panel"][data-key="mesh"],
      [data-part="bluetooth-panel"][data-key="gatt"] {
        display: flex;
        flex-direction: column;
        /* Whatever sits above the tree scrolls away with it, rather than the
           tree scrolling inside a window under a fixed header. */
        overflow: auto;
      }
      [data-part="bluetooth-panel"] [data-part="mesh-session"],
      [data-part="bluetooth-panel"] [data-part="bluetooth-session"] {
        /* Fills what is left when the tree is short, grows past it when the
           tree is long, and the panel does the scrolling either way. */
        flex: 1 1 auto;
        min-block-size: 6rem;
        overflow: visible;
      }
      [data-part="mesh-role"] {
        display: grid;
        gap: 6px;
        margin: 0;
        border: 1px solid var(--border, #d5dae2);
        border-radius: 6px;
        padding: 8px 12px 12px;
      }
      [data-part="mesh-role"] legend {
        padding-inline: 4px;
        font-weight: 600;
      }
      [data-part="mesh-role-choice"] {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0 8px;
        align-items: baseline;
      }
      [data-part="mesh-role-name"] { font-weight: 600; }
      [data-part="mesh-role-note"] {
        grid-column: 2;
        color: var(--text-muted, #586474);
      }
      [data-part="mesh-link-controls"] {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: end;
      }
      [data-part="mesh-field"] {
        display: flex;
        flex-direction: column;
        gap: 2px;
        color: var(--text-muted, #586474);
      }
      [data-part="mesh-link-state"] {
        margin: 0 0 8px;
        color: var(--text-muted, #586474);
      }
      [data-part="mesh-capability"] { margin: 0; }
      [data-part="mesh-empty"] {
        margin: 4px 0 4px calc(var(--tree-indent, 12px) + 22px);
        color: var(--text-muted, #586474);
      }
      [data-part="mesh-keys-dialog"] {
        inline-size: min(34rem, calc(100vw - 32px));
        border: 1px solid var(--border, #d5dae2);
        border-radius: 8px;
        padding: 16px;
      }
      [data-part="mesh-keys-title"] { margin: 0 0 8px; }
      [data-part="mesh-keys-note"],
      [data-part="mesh-keys-problem"] {
        margin: 0 0 12px;
        padding: 8px;
        border-radius: 4px;
        background: var(--warning-surface, #fff4e5);
        color: var(--warning-strong, #8a5300);
      }
      [data-part="mesh-keys-help"] {
        margin-block-end: 12px;
        border: 1px solid var(--border, #d5dae2);
        border-radius: 4px;
        padding: 8px 12px;
      }
      [data-part="mesh-keys-help"] summary {
        cursor: pointer;
        font-weight: 600;
      }
      [data-part="mesh-keys-fields"] {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 4px 12px;
        margin: 12px 0 0;
        max-block-size: 40vh;
        overflow: auto;
      }
      [data-part="mesh-keys-fields"] dt {
        font-family: ui-monospace, monospace;
        font-weight: 600;
      }
      [data-part="mesh-keys-fields"] dd {
        margin: 0;
        color: var(--text-muted, #586474);
      }
      [data-part="mesh-keys-input"] {
        inline-size: 100%;
        font-family: ui-monospace, monospace;
      }
      [data-part="mesh-keys-actions"] {
        display: flex;
        gap: 8px;
        justify-content: end;
        margin-block-start: 12px;
      }
      [data-part="bluetooth-overview-state"][data-state~="experimental"] {
        padding: 4px 8px;
        border-radius: 4px;
        background: var(--warning-surface, #fff4e5);
        color: var(--warning-strong, #8a5300);
        font-weight: 600;
      }
      [data-part="mesh-detail"] { margin: 0; }
      [data-part="mesh-detail"] dt { font-weight: 600; }
      [data-part="mesh-detail"] dd { margin: 0 0 8px; }
    `;

    /** @param {string} key */
    const selectTab = (key) => {
      for (const tab of tabs) {
        const active = tab.dataset.key === key;
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.tabIndex = active ? 0 : -1;
      }
      for (const item of panels) item.hidden = item.dataset.key !== key;
    };

    const onTabClick = (/** @type {Event} */ event) => {
      const tab = /** @type {HTMLElement | null} */ (
        /** @type {HTMLElement} */ (event.target).closest(
          '[data-part="bluetooth-tab"]',
        )
      );
      if (tab?.dataset.key) selectTab(tab.dataset.key);
    };

    const onTabKeyDown = (/** @type {KeyboardEvent} */ event) => {
      const current = /** @type {HTMLElement | null} */ (
        /** @type {HTMLElement} */ (event.target).closest(
          '[data-part="bluetooth-tab"]',
        )
      );
      if (!current) return;
      const offset =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!offset) return;
      const next =
        tabs[(tabs.indexOf(current) + offset + tabs.length) % tabs.length];
      event.preventDefault();
      selectTab(next.dataset.key || "");
      next.focus();
    };

    find('[data-part="bluetooth-tablist"]').addEventListener(
      "click",
      onTabClick,
    );
    find('[data-part="bluetooth-tablist"]').addEventListener(
      "keydown",
      onTabKeyDown,
    );

    /** @param {keyof typeof TEMPLATES} part @param {() => void} run */
    const actionButton = (part, run) => {
      const button = cloneTemplate(part);
      button.addEventListener("click", run);
      return button;
    };

    /** @param {Element} node */
    const rowName = (node) =>
      node.querySelector('[data-part="tree-name"]')?.textContent || "";

    /**
     * The device and service a row hangs under, as the tree names them. A
     * device is named by its browser device ID and by nothing else.
     * @param {Element} anchor
     */
    const ancestorPath = (anchor) => {
      const segments = [];
      const device = anchor.closest('[data-anchor="bluetooth-device"]');
      if (device && device !== anchor)
        segments.push(
          `Device ${rowName(device)} (browser device ID ${device.getAttribute("data-id")})`,
        );
      const service = anchor.closest('[data-anchor="bluetooth-service"]');
      if (service && service !== anchor)
        segments.push(`Service ${rowName(service)}`);
      return segments.join(" > ");
    };

    /** Projects the shared records for one browser device ID. @param {string} id */
    const deviceEventsView = (id) => {
      const mine = eventLog.filter((entry) => entry.device === id);
      if (mine.length === 0) return cloneTemplate("deviceEventsEmpty");
      const list = cloneTemplate("deviceEvents");
      list.append(
        ...mine.map((entry) => {
          const item = cloneTemplate("deviceEvent");
          item.textContent = entry.text;
          return item;
        }),
      );
      return list;
    };

    /** @param {Element | null} anchor */
    const showInspector = (anchor) => {
      if (!anchor) {
        inspector.replaceChildren(cloneTemplate("inspectorEmpty"));
        return;
      }
      const kind = anchor.getAttribute("data-anchor") || "";
      const id = anchor.getAttribute("data-id") || "";
      const path = ancestorPath(anchor);
      const title = cloneTemplate("inspectorTitle");
      title.textContent = rowName(anchor);
      const details = cloneTemplate("inspectorDetails");
      details.querySelector("dt").textContent = LABEL[kind] || "Row";
      details.querySelector(
        '[data-part="bluetooth-inspector-id"]',
      ).textContent = id;
      const parts = [title];
      if (path) {
        const pathNode = cloneTemplate("inspectorPath");
        pathNode.textContent = path;
        parts.push(pathNode);
      }
      // Only a real root has a lifecycle; a demo row is a fixture.
      const record = kind === "bluetooth-device" ? roots.get(id) : undefined;
      if (record) {
        const state = cloneTemplate("overviewState");
        state.textContent = record.state;
        const actions = cloneTemplate("overviewActions");
        actions.append(
          actionButton("bluetooth-reconnect", () => connectAndDiscover(record)),
          ...(record.state === "Connected"
            ? [
                actionButton("bluetooth-disconnect", () =>
                  disconnectDevice(record),
                ),
              ]
            : []),
          actionButton("bluetooth-remove", () => removeDevice(record)),
        );
        parts.push(state, actions);
      }
      parts.push(details);
      if (kind === "bluetooth-device-events") parts.push(deviceEventsView(id));
      inspector.replaceChildren(...parts);
    };

    /**
     * Selection detail in the top layer: a card floating beside the row it
     * describes, never a panel the tree makes room for. It overlaps what is
     * under it, as a floating surface does, and light dismiss clears it.
     * @param {HTMLElement} session @param {HTMLElement} card
     * @param {(anchor: Element | null) => void} fill
     */
    const makeDetail = (session, card, fill) => {
      /** @type {Element | null} */
      let describing = null;
      const close = () => {
        describing = null;
        if (card.matches(":popover-open")) card.hidePopover();
      };
      return {
        close,
        /** @param {Element | null} anchor */
        open(anchor) {
          const row = anchor?.querySelector('[data-part="tree-row"]');
          if (!row) return;
          fill(anchor);
          describing = anchor;
          card.showPopover();
          const box = card.getBoundingClientRect();
          const within = session.getBoundingClientRect();
          const at = row.getBoundingClientRect();
          card.style.left = `${Math.max(8, within.right - box.width)}px`;
          card.style.top = `${Math.max(8, Math.min(at.top, window.innerHeight - box.height - 8))}px`;
        },
        /**
         * Arrow keys move focus without selecting, so leaving a row is what
         * stops its detail describing it.
         * @param {FocusEvent} event
         */
        onFocusIn(event) {
          const anchor = /** @type {Element | null} */ (
            event.target
          )?.closest?.("[data-anchor]");
          if (describing && anchor !== describing) close();
        },
      };
    };

    /**
     * One selectable tree: the selection it paints, the floating detail it
     * opens, and the four listeners that drive both. Both tabs hold a tree and
     * the only things that differ are the elements and the radio group's name,
     * so a behaviour added here reaches both — and one that reaches only one
     * of them is a bug rather than a decision.
     *
     * @param {{tree: HTMLElement, session: HTMLElement, card: HTMLElement,
     *   radioName: string, fill: (anchor: Element | null) => void}} parts
     */
    const makeTreeSurface = ({ tree, session, card, radioName, fill }) => {
      const radios = `input[name="${radioName}"]`;
      /** The selected anchor, so a state change can repaint its detail. */
      let selected = /** @type {Element | null} */ (null);

      /** @param {Element | null} anchor */
      const paint = (anchor) => {
        selected = anchor;
        for (const row of tree.querySelectorAll('[data-part="tree-row"]'))
          row.removeAttribute("data-state");
        for (const radio of tree.querySelectorAll(radios)) {
          radio.checked = false;
          radio.removeAttribute("checked");
        }
        if (anchor) {
          view.openAncestors(anchor);
          const row = anchor.querySelector('[data-part="tree-row"]');
          const radio = row?.querySelector(radios);
          row?.setAttribute("data-state", "selected");
          if (radio) {
            radio.checked = true;
            radio.setAttribute("checked", "");
          }
        }
        fill(anchor);
      };

      const view = window.Planner.treeView.create({
        root: tree,
        onSelect: (/** @type {Element} */ anchor) => paint(anchor),
        onClear: () => {
          paint(null);
          return true;
        },
      });

      const detail = makeDetail(session, card, fill);
      /** @param {Element | null} anchor */
      const open = (anchor) => detail.open(anchor);

      // The listeners come off with the surface, so unmounting cannot leave
      // one behind and cannot name a handler that no longer exists.
      const listening = new AbortController();
      const { signal } = listening;

      tree.addEventListener("click", (event) => {
        const target = /** @type {Element | null} */ (event.target);
        const summary = target?.closest?.("summary");
        if (summary && !target?.closest?.('[data-part="tree-chevron"]'))
          event.preventDefault();
        const anchor = target
          ?.closest?.('[data-part="tree-row"]')
          ?.querySelector(radios)
          ?.closest("[data-anchor]");
        if (!anchor) return;
        paint(anchor);
        // A click anywhere on the row that is not one of its own controls is a
        // request to inspect it. Arrow keys only move, so they open nothing.
        // A device row lives inside a summary, so summary cannot be the test.
        if (!target?.closest?.('[data-part="tree-chevron"], button, input'))
          open(anchor);
      }, { signal });
      tree.addEventListener("change", (event) => {
        const target = /** @type {Element | null} */ (event.target);
        if (!target?.matches(radios)) return;
        const anchor = target.closest("[data-anchor]");
        if (anchor) paint(anchor);
      }, { signal });
      tree.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const anchor = /** @type {Element | null} */ (
          event.target
        )?.closest?.("[data-anchor]");
        if (!anchor) return;
        event.preventDefault();
        paint(anchor);
        open(anchor);
      }, { signal });
      tree.addEventListener(
        "focusin",
        (event) => detail.onFocusIn(event),
        { signal },
      );

      return {
        view,
        paint,
        open,
        /** Repaints the detail, dropping a selection the tree no longer holds. */
        refresh() {
          if (selected && !selected.isConnected) selected = null;
          fill(selected);
        },
        disconnect() {
          listening.abort();
          view.disconnect();
        },
      };
    };

    const gattSurface = makeTreeSurface({
      tree,
      session,
      card: inspector,
      radioName: "bluetooth-selection",
      fill: showInspector,
    });
    const treeView = gattSurface.view;
    const paintSelection = gattSurface.paint;

    /**
     * A tree record is `{id, label}` for a leaf and carries `services`,
     * `state` and `note` at the device root. Demo fixtures and real devices
     * both become records, so one set of builders renders both.
     * @param {Element} node
     */
    const dataId = (node) => node.getAttribute("data-id") || "";
    /** @param {{id: string}} record */
    const recordId = (record) => record.id;
    /** @param {Element} node @param {string} selector @param {string} text */
    const setText = (node, selector, text) => {
      const target = node.querySelector(selector);
      if (target) target.textContent = text;
    };

    /** @param {{id: string, label: string}} characteristic */
    const characteristicNode = (characteristic) => {
      const node = cloneTemplate("characteristic");
      node.setAttribute("data-id", characteristic.id);
      return fillLine(node, characteristic.label);
    };

    /** @param {any} service */
    const serviceNode = (service) => {
      const node = cloneTemplate("service");
      node.setAttribute("data-id", service.id);
      fillLine(
        /** @type {Element} */ (node.querySelector(":scope > summary")),
        service.label,
      );
      /** @type {Element} */ (
        node.querySelector(':scope > [data-part="tree-children"]')
      ).append(...service.characteristics.map(characteristicNode));
      return node;
    };

    /** @param {Element} node @param {any} service */
    const updateService = (node, service) => {
      setText(node, ':scope > summary [data-part="tree-name"]', service.label);
      treeView.reconcile(
        /** @type {Element} */ (
          node.querySelector(':scope > [data-part="tree-children"]')
        ),
        service.characteristics,
        {
          nodeKey: dataId,
          recordKey: recordId,
          createNode: characteristicNode,
          updateNode: (child, record) =>
            setText(child, '[data-part="tree-name"]', record.label),
        },
      );
    };

    /** @param {any} device */
    const deviceNode = (device) => {
      const node = cloneTemplate("device");
      node.setAttribute("data-id", device.id);
      fillLine(
        /** @type {Element} */ (node.querySelector(":scope > summary")),
        device.name,
        device.state,
      );
      const section = /** @type {Element} */ (
        node.querySelector('[data-section-kind="services"]')
      );
      fillLine(
        /** @type {Element} */ (section.querySelector(":scope > summary")),
        "Services",
      );
      /** @type {Element} */ (
        section.querySelector(':scope > [data-part="tree-children"]')
      ).append(...device.services.map(serviceNode));
      const events = /** @type {Element} */ (
        node.querySelector('[data-anchor="bluetooth-device-events"]')
      );
      events.setAttribute("data-id", device.id);
      fillLine(events, "Events");
      return node;
    };

    /** @param {Element} node @param {any} device */
    const updateDevice = (node, device) => {
      setText(node, ':scope > summary [data-part="tree-name"]', device.name);
      setText(
        node,
        ':scope > summary [data-part="bluetooth-device-state"]',
        device.state,
      );
      treeView.reconcile(
        /** @type {Element} */ (
          node.querySelector(
            '[data-section-kind="services"] > [data-part="tree-children"]',
          )
        ),
        device.services,
        {
          nodeKey: dataId,
          recordKey: recordId,
          createNode: serviceNode,
          updateNode: updateService,
        },
      );
      const note = /** @type {HTMLElement} */ (
        node.querySelector('[data-part="bluetooth-device-note"]')
      );
      note.textContent = device.note;
      note.hidden = !device.note;
    };

    /** The real discovery session: one record per browser device ID. */
    /** @type {Map<string, any>} */
    const roots = new Map();

    const renderRoots = () =>
      treeView.reconcile(tree, [...roots.values()], {
        nodeKey: dataId,
        recordKey: recordId,
        createNode: deviceNode,
        updateNode: updateDevice,
      });

    /** Renders the tree and the overview of whatever is still selected. */
    const refresh = () => {
      renderRoots();
      gattSurface.refresh();
    };

    /**
     * The session's events: one record per occurrence, created and logged in
     * exactly one place. Both views read this list and never add to it.
     * @type {{id: string, device: string, name: string, text: string}[]}
     */
    const eventLog = [];

    /** @param {any} entry */
    const eventNode = (entry) => {
      const node = cloneTemplate("event");
      node.setAttribute("data-id", entry.id);
      node.setAttribute("data-device", entry.device);
      node.textContent = `${entry.name}: ${entry.text}`;
      return node;
    };

    /** The combined view: every record in the session, whichever tab is open. */
    const renderEvents = () => {
      treeView.reconcile(events, eventLog, {
        nodeKey: dataId,
        recordKey: recordId,
        createNode: eventNode,
        updateNode: () => {},
      });
      eventsEmpty.hidden = eventLog.length > 0;
    };

    /** @param {string} device @param {string} name @param {string} text */
    const recordEvent = (device, name, text) => {
      eventLog.push({ id: `event-${eventLog.length + 1}`, device, name, text });
      logEvent(LOG_AREA.event, name, text);
      renderEvents();
    };

    /** @param {string} id */
    const rootAnchor = (id) =>
      tree.querySelector(
        `[data-anchor="bluetooth-device"][data-id="${CSS.escape(id)}"]`,
      );

    /**
     * Where devices come from. The browser's adapter, until the demo puts
     * simulated nodes behind the same API (ADR-0037).
     */
    let adapter = navigator.bluetooth;

    /** Drops the session, disconnecting first. Authorization is untouched. */
    const discardSession = () => {
      adapter = navigator.bluetooth;
      for (const record of roots.values())
        if (record.device?.gatt.connected) record.device.gatt.disconnect();
      roots.clear();
      eventLog.length = 0;
      renderEvents();
      discardMeshSession();
    };

    /**
     * Connects and discovers into an existing record. Reconnect runs the same
     * path, so a failed root recovers without a second chooser prompt.
     * @param {any} record
     */
    const connectAndDiscover = async (record) => {
      record.state = "Connecting";
      record.note = "";
      refresh();
      /** @type {string[]} */
      let entries = [];
      try {
        const server = await record.device.gatt.connect();
        const services = await server.getPrimaryServices();
        const discovered = await Promise.all(
          services.map(async (/** @type {any} */ service) => ({
            id: service.uuid,
            label: serviceLabel(service.uuid),
            characteristics: (await service.getCharacteristics()).map(
              (/** @type {any} */ characteristic) => ({
                id: characteristic.uuid,
                label: characteristic.uuid,
              }),
            ),
          })),
        );
        record.services = discovered;
        record.state = "Connected";
        record.note = discovered.length === 0 ? SESSION.limited : "";
        setStatus(SESSION.connected);
        entries = [EVENT.connected, discoveredEvent(discovered.length)];
      } catch {
        record.state = "Connection failed";
        setStatus(SESSION.failed, true);
        entries = [EVENT.failed];
      }
      if (!live) return;
      for (const text of entries) recordEvent(record.id, record.name, text);
      refresh();
    };

    /** @param {any} record */
    const disconnectDevice = (record) => {
      if (record.device?.gatt.connected) record.device.gatt.disconnect();
      record.state = "Disconnected";
      setStatus(SESSION.disconnected, true);
      recordEvent(record.id, record.name, EVENT.disconnected);
      refresh();
    };

    /** @param {any} record */
    const removeDevice = (record) => {
      if (record.device?.gatt.connected) record.device.gatt.disconnect();
      roots.delete(record.id);
      recordEvent(record.id, record.name, EVENT.removed);
      refresh();
    };

    /**
     * Opens the browser chooser from the click, then connects and discovers.
     * The root is created before the connection attempt, so a failed
     * connection still leaves a row to act on.
     * @param {any} options
     */
    const chooseDevice = async (options) => {
      if (!window.isSecureContext) {
        setStatus(RECOVERY.insecure, true);
        return;
      }
      const bluetooth = navigator.bluetooth;
      if (!bluetooth) {
        setStatus(RECOVERY.unsupported, true);
        return;
      }
      if (typeof bluetooth.requestDevice !== "function") {
        setStatus(RECOVERY.unavailable, true);
        return;
      }
      setStatus(SESSION.choosing);
      // Keep requestDevice in the click's user-activation task. Availability is
      // observed in parallel so this warning cannot consume that gesture.
      const availability =
        typeof bluetooth.getAvailability === "function"
          ? bluetooth.getAvailability().catch(() => false)
          : Promise.resolve(false);
      let device;
      try {
        device = await bluetooth.requestDevice(options);
      } catch (error) {
        const available = await availability;
        if (/** @type {Error} */ (error).name === "SecurityError")
          setStatus(SESSION.permission, true);
        else if (
          /** @type {Error} */ (error).name === "NotFoundError" &&
          available
        )
          setStatus(RECOVERY.ready);
        else setStatus(RECOVERY.unavailable, true);
        return;
      }
      if (!live) return;
      // A real chooser never appends to a Demo session, in either tab. The
      // demo's devices sit in the same session a real one does, so the whole
      // session goes rather than the parts of it that used to be separate.
      if (session.getAttribute("data-state") === "demo") {
        discardSession();
        renderRoots();
        paintSelection(null);
        // The demo's keys belong to devices that have just been discarded.
        if (meshKeys?.simulated) clearKeys();
      }
      session.setAttribute("data-state", "");
      adapter = navigator.bluetooth;
      await adoptDevice(device);
    };

    /**
     * Lists a device the browser already permits as a root of its own, without
     * connecting to it. Authorization is not a connection, and the chooser is
     * not the only way a device becomes known.
     * @param {any} device
     */
    const listKnownDevice = (device) => {
      if (roots.has(device.id)) return;
      roots.set(device.id, {
        id: device.id,
        name: device.name || "Unnamed device",
        state: AUTHORIZED_STATE,
        note: "",
        services: [],
        device,
      });
      renderRoots();
    };

    /**
     * Puts one device into both tabs and finds out what it offers. A chosen
     * device and a simulated one take this same path, which is what makes the
     * demo worth anything (ADR-0037).
     * @param {any} device
     */
    const adoptDevice = async (device) => {
      void trackDevice(device);
      watchDisconnect(device);
      const existing = roots.get(device.id);
      recordEvent(
        device.id,
        existing ? existing.name : device.name || "Unnamed device",
        EVENT.chosen,
      );
      if (existing) {
        // A browser device ID already in the session selects its own root.
        existing.device = device;
        renderRoots();
        paintSelection(rootAnchor(device.id));
        if (device.gatt.connected) setStatus(SESSION.connected);
        else await connectAndDiscover(existing);
        return;
      }
      const record = {
        id: device.id,
        name: device.name || "Unnamed device",
        state: "Connecting",
        note: "",
        services: [],
        device,
      };
      roots.set(record.id, record);
      await connectAndDiscover(record);
    };

    /**
     * Notices when a link goes away, however it went.
     *
     * The two tabs hold the same device object, so a Mesh conversation ending
     * disconnects the device the GATT tab is showing as connected — and on
     * real hardware a link drops on its own constantly. Without this the GATT
     * root keeps saying "Connected", with a service list read from a link that
     * is gone, until somebody presses something.
     * @param {any} device
     */
    /** @type {Set<string>} */
    const watchedForDrop = new Set();

    const watchDisconnect = (device) => {
      if (typeof device.addEventListener !== "function") return;
      // Once per device. A device chosen again selects its existing root and
      // reconnects, and a listener added on each of those is one more copy of
      // the same line in the trail every time the link drops.
      if (watchedForDrop.has(device.id)) return;
      watchedForDrop.add(device.id);
      device.addEventListener(
        "gattserverdisconnected",
        () => {
          logEvent(LOG_AREA.gatt, "GATT link dropped", device.id);
          const record = roots.get(device.id);
          if (!record || record.state === "Disconnected") return;
          record.state = "Disconnected";
          record.services = [];
          recordEvent(device.id, record.name, EVENT.disconnected);
          renderRoots();
        },
        { signal: watches.signal },
      );
    };

    /** The approved catalog goes to every chooser path (spec: Page behavior). */
    const catalog = () => [...SERVICE_CATALOG.keys()];

    find('[data-part="bluetooth-add-any"]').addEventListener("click", () =>
      chooseDevice({ acceptAllDevices: true, optionalServices: catalog() }),
    );

    /** The chooser the Mesh action opens, wherever the adapter happens to be. */
    const meshChooser = () => ({
      filters: [{ services: [MESH_PROVISIONING] }, { services: [MESH_PROXY] }],
      optionalServices: catalog(),
    });

    find('[data-part="bluetooth-add-mesh"]').addEventListener("click", () =>
      requestMeshDevice(),
    );

    const loadDemo = async () => {
      const refusal = refuseLocalMesh();
      if (refusal) return setStatus(refusal, true);
      // A demo session and a real session never share the tree.
      discardSession();
      const simulated = window.PlannerMeshSim.create();
      adapter = simulated.bluetooth;
      // The simulated network's keys arrive with its devices. Nothing to
      // paste, and nothing to transcribe wrongly.
      installKeys({ ...window.PlannerMeshSim.keys(), simulated: true });
      session.setAttribute("data-state", "demo");
      meshSession.setAttribute("data-state", "demo");
      for (const device of simulated.devices) await adoptDevice(device);
      paintSelection(null);
      await describeKnownNodes();
      setStatus(
        `Demo session loaded with ${simulated.devices.length} simulated nodes, and that network's keys. No hardware was contacted.`,
      );
    };

    find('[data-part="bluetooth-load-demo"]').addEventListener("click", () =>
      loadDemo(),
    );

    /* ---- Mesh tab -------------------------------------------------------- */

    const meshPanel = /** @type {HTMLElement} */ (
      page.querySelector('[data-part="bluetooth-panel"][data-key="mesh"]')
    );
    /** @param {string} selector */
    const meshFind = (selector) =>
      /** @type {HTMLElement} */ (meshPanel.querySelector(selector));
    const meshSession = meshFind('[data-part="mesh-session"]');
    const meshTree = meshFind('[data-part="bluetooth-tree"]');
    const meshInspector = meshFind('[data-part="mesh-inspector"]');
    const linkState = meshFind('[data-part="mesh-link-state"]');
    const meshCapability = meshFind('[data-part="mesh-capability"]');
    const relayInput = /** @type {HTMLInputElement} */ (
      meshFind('[data-part="mesh-relay"]')
    );
    const roomInput = /** @type {HTMLInputElement} */ (
      meshFind('[data-part="mesh-room"]')
    );
    const reloadPeer = meshFind('[data-part="mesh-reload-peer"]');
    const chooserAsk = meshFind('[data-part="mesh-chooser-ask"]');
    const chooserAccept = meshFind('[data-part="mesh-chooser-accept"]');
    const armWrites = /** @type {HTMLInputElement} */ (
      meshFind('[data-part="mesh-arm-writes"]')
    );
    const roleInputs = /** @type {HTMLInputElement[]} */ ([
      ...meshPanel.querySelectorAll('[data-part="mesh-role-input"]'),
    ]);

    /** Development opt-in state lives in the page URL (ADR-0032). */
    const urlValue = (/** @type {string} */ key) =>
      new URL(window.location.href).searchParams.get(key) || "";
    /** @param {Record<string, string>} changes */
    const writeUrl = (changes) => {
      const url = new URL(window.location.href);
      for (const [key, value] of Object.entries(changes)) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      window.history.replaceState(null, "", url.toString());
    };

    /** The relay link. `role` empty means this page reaches only its adapter. */
    const link = {
      role: ["bridge", "console"].includes(urlValue("role"))
        ? urlValue("role")
        : "",
      relay: urlValue("relay"),
      room: urlValue("room"),
      /** @type {EventSource | null} */
      source: null,
      peer: false,
    };
    relayInput.value = link.relay;
    roomInput.value = link.room;

    /** One record per authorized device on this adapter. */
    /** @type {Map<string, any>} */
    const meshLocal = new Map();
    /**
     * The browser device behind each record. Kept apart from the record
     * because records are published to a Console as JSON, and a device handle
     * is neither serialisable nor meaningful at the other end.
     */
    /** @type {Map<string, any>} */
    const meshDevices = new Map();
    /** What a Bridge last reported. A Console renders this instead. */
    /** @type {any[]} */
    let meshRemote = [];
    const meshRecords = () =>
      link.role === "console" ? meshRemote : [...meshLocal.values()];

    /**
     * Why this page cannot run a Mesh operation itself, or nothing. A Console
     * holds no adapter and executes no Mesh operation of its own (ADR-0036):
     * it sends the action and renders what the Bridge sends back. Every local
     * Mesh operation asks here first, so the boundary is one place rather than
     * a rule each new operation has to remember.
     */
    const refuseLocalMesh = () =>
      link.role === "console"
        ? "This page is a Console. Mesh operations run on the Bridge, so ask it instead."
        : "";

    /** Stops every advertisement watch when the page goes away. */
    const watches = new AbortController();

    /** @param {keyof typeof MESH_CAPABILITY} which */
    const showMeshCapability = (which) => {
      meshCapability.textContent = MESH_CAPABILITY[which];
      meshCapability.hidden = false;
    };

    const meshDeviceNode = (/** @type {any} */ record) => {
      const node = cloneTemplate("meshDevice");
      node.setAttribute("data-id", record.id);
      return updateMeshDevice(node, record);
    };

    /**
     * A node that has described itself discloses its elements; one that has
     * not has nothing to open, and says so by having no chevron.
     * @param {Element} node @param {any} record
     */
    function updateMeshDevice(node, record) {
      fillLine(
        /** @type {Element} */ (node.querySelector(":scope > summary")),
        record.label,
        rowState(record),
      );
      // A node's address is how the network addresses it and how a plan will
      // refer to it, so it leads the row. It is derived from the record each
      // time rather than written into the name, which is the adapter's.
      const address = /** @type {HTMLElement} */ (
        node.querySelector('[data-part="mesh-address"]')
      );
      address.textContent =
        record.address === undefined ? "" : addressLabel(record.address);
      address.hidden = record.address === undefined;
      const children = /** @type {Element} */ (
        node.querySelector(':scope > [data-part="tree-children"]')
      );
      const elements = record.composition?.elements;
      node.setAttribute("data-state", elements ? "described" : "");
      if (!elements) {
        children.replaceChildren();
        node.removeAttribute("open");
        return node;
      }
      // Opening a node is the reader's, not ours: a described node grows a
      // chevron and waits. Reconciliation leaves whatever they chose alone.
      let section = children.querySelector('[data-part="mesh-section"]');
      if (!section) {
        section = cloneTemplate("meshSection");
        children.replaceChildren(section);
      }
      meshView.reconcile(
        /** @type {Element} */ (
          section.querySelector(':scope > [data-part="tree-children"]')
        ),
        elements.map((/** @type {any} */ element, /** @type {number} */ index) => ({
          id: `${record.id}:${index}`,
          index,
          address: (record.composition.address ?? 0) + index,
          models: element.models,
        })),
        {
          nodeKey: dataId,
          recordKey: recordId,
          createNode: meshElementNode,
          updateNode: updateMeshElement,
        },
      );
      return node;
    }

    const meshElementNode = (/** @type {any} */ element) => {
      const node = cloneTemplate("meshElement");
      node.setAttribute("data-id", element.id);
      return updateMeshElement(node, element);
    };

    /** @param {Element} node @param {any} element */
    function updateMeshElement(node, element) {
      fillLine(
        /** @type {Element} */ (node.querySelector(":scope > summary")),
        `Element ${element.index}`,
        addressLabel(element.address),
      );
      meshView.reconcile(
        /** @type {Element} */ (
          node.querySelector(':scope > [data-part="tree-children"]')
        ),
        element.models.map((/** @type {any} */ model) => ({
          id: `${element.id}:${modelKey(model)}`,
          ...model,
        })),
        {
          nodeKey: dataId,
          recordKey: recordId,
          createNode: (/** @type {any} */ model) => {
            const row = cloneTemplate("meshModel");
            row.setAttribute("data-id", model.id);
            return updateMeshModel(row, model);
          },
          updateNode: updateMeshModel,
        },
      );
      return node;
    }

    /** @param {Element} node @param {any} model */
    function updateMeshModel(node, model) {
      // A model this page has no name for keeps its number. Naming it anyway
      // would be a guess about somebody else's hardware.
      return fillLine(node, modelLabel(model), modelKey(model));
    }

    const meshGroupNode = (/** @type {any} */ branch) => {
      const node = cloneTemplate("meshGroup");
      node.setAttribute("data-id", branch.id);
      updateMeshGroup(node, branch);
      return node;
    };

    /** @param {Element} node @param {any} branch */
    function updateMeshGroup(node, branch) {
      fillLine(
        /** @type {Element} */ (node.querySelector(":scope > summary")),
        branch.name,
        String(branch.devices.length),
      );
      meshView.reconcile(
        /** @type {Element} */ (
          node.querySelector(':scope > [data-part="tree-children"]')
        ),
        branch.devices,
        {
          nodeKey: dataId,
          recordKey: recordId,
          createNode: meshDeviceNode,
          updateNode: updateMeshDevice,
        },
      );
      const empty = /** @type {HTMLElement} */ (
        node.querySelector(':scope > [data-part="mesh-empty"]')
      );
      empty.textContent = branch.empty;
      empty.hidden = branch.devices.length > 0;
    }

    /**
     * A model as its own node named it, so a binding is reported against the
     * name the node gave rather than against a number looked up twice.
     * @param {any} record @param {any} entry
     */
    const modelAt = (record, entry) =>
      record.composition?.elements?.[entry.element]?.models?.find(
        (/** @type {any} */ model) =>
          model.id === entry.id && Boolean(model.vendor) === entry.vendor,
      ) ?? { id: entry.id, vendor: entry.vendor, name: "" };

    /** Which application keys one model is bound to. @param {any} entry */
    const bindingOf = (entry) =>
      entry.status ||
      (entry.appKeyIndexes.length === 0
        ? "Bound to no application key"
        : `Bound to application key ${entry.appKeyIndexes.join(", ")}`);

    /**
     * Where a model publishes and what it listens to, as one sentence. A model
     * that does neither says so: an unwired model is a fact about a network,
     * not an absence of one.
     * @param {any} entry
     */
    const wiringOf = (entry) => {
      if (entry.status) return entry.status;
      const parts = [];
      if (entry.address)
        parts.push(
          `Publishes to ${addressLabel(entry.address)} under application key ${entry.appKeyIndex}, TTL ${entry.ttl}` +
            (entry.periodMs ? `, every ${entry.periodMs} ms` : ", on change"),
        );
      if (entry.subscriptions.length > 0)
        parts.push(
          `Listens on ${entry.subscriptions.map(addressLabel).join(", ")}`,
        );
      return parts.join(". ") || "Publishes nowhere and listens on nothing";
    };

    /**
     * How a node is wired into its network, one row per model — because
     * "which key, which group" is a question about one model, and a node whose
     * models answer it differently is the interesting case.
     *
     * Bindings and publication are two separate reads, and whichever have been
     * run land on the same row rather than each growing a list of their own
     * under the same name.
     * @param {any} record @returns {[string, string][]}
     */
    const modelFacts = (record) => {
      /** @type {Map<string, { entry: any, said: string[] }>} */
      const rows = new Map();
      /** @param {any} entry @param {string} said */
      const say = (entry, said) => {
        const key = `${entry.element}:${entry.id}:${entry.vendor}`;
        const row = rows.get(key) ?? { entry, said: [] };
        row.said.push(said);
        rows.set(key, row);
      };
      for (const entry of record.bound?.models ?? []) say(entry, bindingOf(entry));
      for (const entry of record.published?.models ?? [])
        say(entry, wiringOf(entry));
      return [...rows.values()].map(
        ({ entry, said }) =>
          /** @type {[string, string]} */ ([
            `${modelLabel(modelAt(record, entry))}, element ${entry.element}`,
            said.join(". "),
          ]),
      );
    };

    /**
     * What is known about one device. The tree rows and the popover both
     * render this, so the two surfaces cannot come to disagree.
     * @param {any} record @returns {[string, string][]}
     */
    const meshFacts = (record) => [
      ["Provisioning state", record.state],
      ...(record.condition
        ? /** @type {[string, string][]} */ ([
            ["Condition", MESH_CONDITION[record.condition].label],
            ["Why", MESH_CONDITION[record.condition].why],
          ])
        : []),
      ...(record.uuid
        ? /** @type {[string, string][]} */ ([
            ["Mesh Device UUID", uuidLabel(record.uuid)],
          ])
        : []),
      ...(record.oob !== null && record.oob !== undefined
        ? /** @type {[string, string][]} */ ([
            ["OOB information", oobLabel(record.oob)],
          ])
        : []),
      ...(record.identity
        ? /** @type {[string, string][]} */ ([
            ["Advertised identity", record.identity],
          ])
        : []),
      ...(record.composition
        ? /** @type {[string, string][]} */ ([
            ["Unicast address", addressLabel(record.composition.address)],
            ["Company", addressLabel(record.composition.company)],
            [
              "Product and version",
              `${addressLabel(record.composition.product)} / ${addressLabel(record.composition.version)}`,
            ],
            [
              "Features",
              record.composition.features.join(", ") || "None reported",
            ],
            ["Replay list size", String(record.composition.replayListSize)],
            ...(record.composition.trailingCount
              ? /** @type {[string, string][]} */ ([
                  [
                    "Not understood",
                    `${record.composition.trailingCount} trailing octet(s) this page could not account for`,
                  ],
                ])
              : []),
          ])
        : []),
      ...(record.reported?.defaultTtl
        ? /** @type {[string, string][]} */ ([
            ["Default TTL", String(record.reported.defaultTtl.ttl)],
          ])
        : []),
      ...(record.reported?.networkTransmit
        ? /** @type {[string, string][]} */ ([
            [
              "Network transmit",
              `${record.reported.networkTransmit.count} times, every ${record.reported.networkTransmit.intervalMs} ms`,
            ],
          ])
        : []),
      ...(record.reported?.relay
        ? /** @type {[string, string][]} */ ([
            [
              "Relay",
              `${record.reported.relay.relay}, retransmitting ${record.reported.relay.count} times every ${record.reported.relay.intervalMs} ms`,
            ],
          ])
        : []),
      ...(record.reported?.health
        ? /** @type {[string, string][]} */ ([
            [
              "Health",
              record.reported.health.unread ||
                (record.reported.health.faults.length === 0
                  ? "No faults reported"
                  : `${record.reported.health.faults.length} fault(s): ${record.reported.health.faults.map((/** @type {number} */ f) => addressLabel(f)).join(", ")}`),
            ],
          ])
        : []),
      ...(record.bound
        ? /** @type {[string, string][]} */ ([
            [
              "Application keys held",
              record.bound.status ||
                (record.bound.appKeyIndexes.length === 0
                  ? "None. Nothing sent under an application key reaches this node."
                  : record.bound.appKeyIndexes.join(", ")),
            ],
          ])
        : []),
      ...modelFacts(record),
      ...(record.hops
        ? /** @type {[string, string][]} */ ([
            [
              "Hops away",
              record.hops.minHops === record.hops.maxHops
                ? String(record.hops.minHops)
                : `${record.hops.minHops} to ${record.hops.maxHops}`,
            ],
          ])
        : []),
      ...(record.note
        ? /** @type {[string, string][]} */ ([["Last attempt", record.note]])
        : []),
      ["Browser device ID", record.id],
      ...(meshDevices.get(record.id)?.simulated
        ? /** @type {[string, string][]} */ ([
            ["Device", "Simulated. Nothing here reached any hardware."],
          ])
        : []),
    ];

    /** @param {Element | null} anchor */
    const showMeshInspector = (anchor) => {
      if (!anchor) {
        meshInspector.replaceChildren(cloneTemplate("meshInspectorEmpty"));
        return;
      }
      const record = meshRecords().find(
        (item) => item.id === anchor.getAttribute("data-id"),
      );
      if (!record) {
        meshInspector.replaceChildren(cloneTemplate("meshInspectorEmpty"));
        return;
      }
      const title = cloneTemplate("inspectorTitle");
      title.textContent = record.label;
      const detail = cloneTemplate("meshDetail");
      // What you can do to the row sits directly under its name. The fact list
      // below it is as long as the node is described, and actions under that
      // are actions nobody scrolls to.
      const parts = [title];
      /** @param {keyof typeof MESH_ACTION} name */
      const button = (name) =>
        actionButton(MESH_ACTION[name].part, async () => {
          record.note = await driveAction(name, record);
          renderMesh();
          showMeshInspector(anchor);
        });
      // A device asking to be provisioned is the one thing you can do to it,
      // and until this existed the branch listing them offered nothing at all.
      if (record.state === MESH_STATE.unprovisioned) {
        const actions = cloneTemplate("overviewActions");
        actions.append(button("provision"));
        parts.push(actions);
      }
      if (record.state === MESH_STATE.provisioned) {
        const actions = cloneTemplate("overviewActions");
        actions.append(button("describe"));
        if (
          record.composition?.elements?.some((/** @type {any} */ element) =>
            element.models.some(
              (/** @type {any} */ model) => model.id === 0x1000,
            ),
          )
        )
          actions.append(button("on"), button("off"));
        if (record.composition)
          actions.append(
            button("hops"),
            button("identify"),
            button("bindings"),
            button("publication"),
          );
        parts.push(actions);
      }
      if (record.composition) {
        const mark = cloneTemplate("overviewState");
        mark.setAttribute("data-state", "experimental");
        mark.textContent = EXPERIMENTAL;
        parts.push(mark);
      }
      parts.push(detail);
      for (const [term, value] of meshFacts(record)) {
        const dt = cloneTemplate("meshTerm");
        dt.textContent = term;
        const dd = cloneTemplate("meshValue");
        dd.textContent = value;
        detail.append(dt, dd);
      }
      meshInspector.replaceChildren(...parts);
    };

    const meshSurface = makeTreeSurface({
      tree: meshTree,
      session: meshSession,
      card: meshInspector,
      radioName: "mesh-selection",
      fill: showMeshInspector,
    });
    const meshView = meshSurface.view;

    const renderMesh = () => {
      const records = meshRecords();
      meshView.reconcile(
        meshTree,
        MESH_BRANCH.map((branch) => ({
          ...branch,
          devices: records.filter(
            (record) => meshBranchOf(record.state) === branch.id,
          ),
        })),
        {
          nodeKey: dataId,
          recordKey: recordId,
          createNode: meshGroupNode,
          updateNode: updateMeshGroup,
        },
      );
      meshSurface.refresh();
    };

    /**
     * Drops every Mesh record. Called wherever the discovery session is
     * dropped, so one tab can never hold fixtures while the other holds
     * hardware.
     */
    function discardMeshSession() {
      closeProxyChannels();
      meshLocal.clear();
      meshDevices.clear();
      meshSession.setAttribute("data-state", "");
      renderMesh();
      publishMesh();
    }


    /* ---- Network key material -------------------------------------------- */

    /**
     * Key material for this session. It outlives a reload because reloading a
     * Bridge is the action a Console exists to take, and dies with the tab
     * (ADR-0036). The surface that accepts it carries the warning.
     */
    const KEY_STORE = "planner-mesh-keys";
    /** @type {any} */
    let meshKeys = null;

    const keysDialog = /** @type {HTMLDialogElement} */ (
      meshFind('[data-part="mesh-keys-dialog"]')
    );
    const keysInput = /** @type {HTMLTextAreaElement} */ (
      meshFind('[data-part="mesh-keys-input"]')
    );
    const keysProblem = meshFind('[data-part="mesh-keys-problem"]');

    /**
     * Hex with or without an 0x prefix. Parsing "0x0001" at radix 16 yields
     * zero, because the x ends the number, so the prefix comes off first.
     * @param {unknown} value @param {number} fallback
     */
    const hexNumber = (value, fallback) => {
      // A number is already a number. Reading one as hex is how a stored IV
      // index of 305419896 comes back as 12975184534: this page writes its
      // key material down as JSON, and JSON has no hexadecimal — so anything
      // that survives a reload or a re-save arrives here decimal.
      if (typeof value === "number")
        return Number.isFinite(value) ? value : fallback;
      const parsed = Number.parseInt(
        String(value).trim().replace(/^0x/i, ""),
        16,
      );
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    /** @param {string} text @returns {any} */
    const readKeys = (text) => {
      const parsed = JSON.parse(text);
      if (!/^[0-9a-f]{32}$/i.test(parsed.netKey || ""))
        throw new Error("netKey must be 32 hex characters");
      return {
        simulated: Boolean(parsed.simulated),
        netKey: parsed.netKey,
        netKeyIndex: Number(parsed.netKeyIndex ?? 0),
        ivIndex: hexNumber(parsed.ivIndex, 0),
        address: hexNumber(parsed.address, 0x7ff),
        sequence: Number(parsed.sequence ?? 1),
        appKeys: parsed.appKeys ?? {},
        devKeys: parsed.devKeys ?? {},
        labels: parsed.labels ?? [],
      };
    };

    const loadStoredKeys = () => {
      try {
        const saved = window.sessionStorage.getItem(KEY_STORE);
        if (saved) meshKeys = readKeys(saved);
      } catch (error) {
        // Unreadable stored keys are the same as none, and saying so on mount
        // would be noise nobody asked for — but not saying it anywhere is how
        // a session silently starts with no keys.
        logEvent(LOG_AREA.keys, "Stored keys unreadable", String(error));
      }
    };

    /**
     * Writes this session's key material down for the tab, with anything the
     * caller wants written differently from what is held here.
     * @param {any} [overrides]
     */
    const storeKeys = (overrides) => {
      try {
        window.sessionStorage.setItem(
          KEY_STORE,
          JSON.stringify({ ...meshKeys, ...overrides }),
        );
      } catch {
        // Keys that cannot be stored still work for this page's lifetime.
      }
    };

    /**
     * Takes key material as this session's, and saves it for the tab.
     *
     * A key block carries its own starting sequence number, so the block this
     * session had reserved against the previous one no longer applies — but
     * the number cannot go backwards either. A node remembers what this
     * address has already sent whether or not this page was told to forget
     * its keys, and drops anything it has seen before as a replay. Entering
     * the same block twice would otherwise make every message silence.
     * @param {any} keys
     */
    const adoptKeys = (keys) => {
      meshKeys = keys;
      sequenceCeiling = 0;
      const floor = sequenceFloor.get(sequenceScope()) ?? 0;
      if (meshKeys.sequence < floor) {
        logEvent(
          LOG_AREA.keys,
          "Sequence rewind refused",
          `${meshKeys.sequence} has been sent from this address; resuming at ${floor}`,
        );
        meshKeys.sequence = floor;
      }
      storeKeys();
    };

    /** @param {any} blob */
    const installKeys = (blob) => adoptKeys(readKeys(JSON.stringify(blob)));

    /**
     * Sequence numbers, handed out in blocks whose end is written down before
     * any of the block is used.
     *
     * A node drops a sequence number it has already seen as a replay, and the
     * symptom is silence — which looks exactly like broken cryptography, as
     * this page's own help says. A counter living only in memory replays the
     * whole session's numbers after a reload, and reloading a Bridge is the
     * thing a Console exists to make somebody do.
     *
     * Writing every number down is a storage write per message. Writing the
     * end of a block down is one write per block, and loses at most a block of
     * numbers to a reload — which costs nothing, because a sequence number has
     * only to be larger than every one already sent.
     */
    const SEQUENCE_BLOCK = 100;
    /** The highest number this session has already written down as used. */
    let sequenceCeiling = 0;
    /**
     * The highest number reserved for one network key and source address,
     * kept past a clear so re-entered keys cannot rewind it into a replay.
     * @type {Map<string, number>}
     */
    const sequenceFloor = new Map();
    const sequenceScope = () => `${meshKeys.netKey}:${meshKeys.address}`;

    /**
     * The next number to send with, or null when this network key has run out
     * of them. Past 24 bits a sequence number needs an IV index update, which
     * is a network-wide operation this page does not perform — and wrapping
     * round silently would re-send numbers every node in the network would
     * then drop.
     */
    const nextSequence = () => {
      if (meshKeys.sequence > 0xffffff) return null;
      if (meshKeys.sequence >= sequenceCeiling) {
        // The end of the block goes down before any of the block is used, so
        // a reload resumes past it rather than inside it.
        sequenceCeiling = meshKeys.sequence + SEQUENCE_BLOCK;
        sequenceFloor.set(sequenceScope(), sequenceCeiling);
        storeKeys({ sequence: sequenceCeiling });
        logEvent(
          LOG_AREA.keys,
          "Sequence block reserved",
          `through ${sequenceCeiling}`,
        );
      }
      return meshKeys.sequence++;
    };

    const clearKeys = () => {
      meshKeys = null;
      keysInput.value = "";
      try {
        window.sessionStorage.removeItem(KEY_STORE);
      } catch {
        // A browser refusing storage still gets a working session.
      }
      for (const record of meshLocal.values()) {
        record.composition = null;
        record.bound = null;
        record.published = null;
        // Every one of these was read under key material this session no
        // longer holds. Leaving them on screen shows a reading nothing can
        // account for. The address stays: it is which node this is, not
        // something read about it, and it is what finds the node's own key
        // again instead of trying every key in the session.
        record.reported = null;
        record.hops = null;
        record.condition =
          record.state === MESH_STATE.provisioned ? "unknownNetwork" : undefined;
        record.note = "";
      }
      renderMesh();
      publishMesh();
    };

    meshFind('[data-part="mesh-keys-open"]').addEventListener("click", () => {
      keysProblem.hidden = true;
      // The reserved number, not the last one used: saving what this shows
      // must not move the stored counter back behind numbers already sent.
      if (meshKeys)
        keysInput.value = JSON.stringify(
          { ...meshKeys, sequence: Math.max(meshKeys.sequence, sequenceCeiling) },
          null,
          2,
        );
      keysDialog.showModal();
    });
    // The simulated network's own keys, from the simulator rather than copied
    // here, so the two cannot drift apart.
    meshFind('[data-part="mesh-keys-demo"]').addEventListener("click", () => {
      keysInput.value = JSON.stringify(window.PlannerMeshSim.keys(), null, 2);
      keysProblem.hidden = true;
    });
    meshFind('[data-part="mesh-keys-cancel"]').addEventListener("click", () =>
      keysDialog.close(),
    );
    meshFind('[data-part="mesh-keys-clear"]').addEventListener("click", () => {
      clearKeys();
      keysDialog.close();
    });
    meshFind('[data-part="mesh-keys-save"]').addEventListener("click", () => {
      try {
        adoptKeys(readKeys(keysInput.value));
      } catch (error) {
        keysProblem.textContent = `These keys were not readable: ${
          error instanceof Error ? error.message : String(error)
        }`;
        keysProblem.hidden = false;
        return;
      }
      keysDialog.close();
      renderMesh();
      void describeKnownNodes();
    });

    /* ---- Asking a node to describe itself --------------------------------- */

    const PROXY_DATA_IN = "00002add-0000-1000-8000-00805f9b34fb";
    const PROXY_DATA_OUT = "00002ade-0000-1000-8000-00805f9b34fb";

    /** Proxy conversations this page is holding open, by browser device id. */
    /** @type {Map<string, Promise<any>>} */
    const proxyChannels = new Map();

    /**
     * The proxy characteristics for one device, opened once and held open for
     * as long as the conversation lasts.
     *
     * Describing a node is six messages and reading its bindings is one per
     * model. Connecting for each of them costs a connect, a service lookup and
     * a characteristic lookup every time, which against real hardware is
     * seconds per message — and a connect that a previous message left open is
     * not free either. A proxy connection is meant to be held.
     * @param {any} device
     */
    const proxyChannel = (device) => {
      const held = proxyChannels.get(device.id);
      // A radio that dropped the link leaves `connected` false and a stale
      // characteristic behind, so the flag decides, not the cache.
      if (held && device.gatt.connected) return held;
      const opening = (async () => {
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(MESH_PROXY);
        const dataIn = await service.getCharacteristic(PROXY_DATA_IN);
        const dataOut = await service.getCharacteristic(PROXY_DATA_OUT);

        // The channel owns the notification stream, not each exchange: a
        // proxy PDU longer than the link's payload arrives in pieces, and
        // whoever put the pieces together has to be the same thing across
        // messages. A node also sends beacons of its own accord, so what
        // arrives is not necessarily an answer to anything.
        const consumers = new Set();
        const reassembly = window.PlannerMeshStack.proxy.reassembly();
        const onValue = (/** @type {any} */ event) => {
          const value = event.target.value;
          const frame = new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          );
          const whole = reassembly.add(frame);
          if (!whole) return;
          // Deleting from a Set while iterating it is defined, and a consumer
          // that has heard what it wanted removes itself.
          for (const consumer of consumers) consumer(whole);
        };
        await dataOut.startNotifications();
        dataOut.addEventListener("characteristicvaluechanged", onValue);

        const channel = {
          device,
          dataIn,
          /** @param {(pdu: any) => void} consumer @returns {() => void} */
          listen(consumer) {
            consumers.add(consumer);
            return () => consumers.delete(consumer);
          },
          /** @param {number} type @param {Uint8Array} pdu */
          async send(type, pdu) {
            const segments = window.PlannerMeshStack.proxy.split(type, pdu);
            if (segments.length > 1)
              logEvent(
                LOG_AREA.gatt,
                "Proxy PDU segmented",
                `${pdu.byteLength} octets in ${segments.length} writes`,
              );
            for (const segment of segments)
              await dataIn.writeValue(segment.buffer);
          },
          close() {
            dataOut.removeEventListener("characteristicvaluechanged", onValue);
            consumers.clear();
            if (device.gatt.connected) device.gatt.disconnect();
          },
          /** Why the proxy filter is not known to be set, or nothing. */
          filter: "",
          /**
           * Whether anything at all came back over this link. Proxy
           * configuration is mandatory for a proxy server, so a node that
           * answers none of it answers nothing, and trying device keys
           * against it buys a timeout each and learns nothing.
           */
          answered: false,
          /**
           * Which node is on the other end of this link, once it has said so.
           * A proxy advertisement names a network, never a node — but the
           * Filter Status is sent from the proxy's own primary element, so
           * confirming the filter settles the address too.
           * @type {number | undefined}
           */
          address: undefined,
        };
        logEvent(LOG_AREA.gatt, "Proxy channel open", device.id);
        channel.filter = await setProxyFilter(channel);
        return channel;
      })().catch((error) => {
        proxyChannels.delete(device.id);
        throw error;
      });
      proxyChannels.set(device.id, opening);
      return opening;
    };

    /**
     * Puts this page's own address on the node's proxy filter.
     *
     * Without this a real node answers nothing. A proxy server starts every
     * connection with an accept list that is empty, and forwards to the link
     * only what is addressed to a listed address or to all-nodes — so every
     * status message we ask for is dropped inside the node, and the symptom
     * here is a silence indistinguishable from a wrong key.
     *
     * Returns a reason when the node did not confirm it, rather than failing:
     * a stack that forwards everything regardless is still usable, and saying
     * which one this is is the whole point of the trail.
     * @param {any} channel
     */
    const setProxyFilter = async (channel) => {
      const stack = window.PlannerMeshStack;
      const meshCrypto = window.PlannerMeshCrypto;
      const { nid, encryptionKey, privacyKey } = await meshCrypto.k2(
        meshCrypto.bytesFromHex(meshKeys.netKey),
        Uint8Array.of(0x00),
      );

      /** @param {Uint8Array} body */
      const ask = async (body) => {
        const seq = nextSequence();
        if (seq === null) return null;
        const pdu = await stack.network.encode({
          encryptionKey,
          privacyKey,
          nid,
          ivIndex: meshKeys.ivIndex,
          // A proxy configuration message is a control message that goes no
          // further than the node on the other end of this link.
          ctl: 1,
          ttl: 0,
          seq,
          src: meshKeys.address,
          dst: 0x0000,
          transport: body,
          nonceType: stack.NONCE.proxy,
        });
        /** @type {(value: any) => void} */
        let settle = () => {};
        const answered = new Promise((resolve) => {
          settle = resolve;
        });
        const stop = channel.listen((/** @type {any} */ frame) => {
          if (frame.type !== stack.PROXY_TYPE.configuration) return;
          settle(frame.body);
        });
        await channel.send(stack.PROXY_TYPE.configuration, pdu);
        /** @type {number | undefined} */
        let timer;
        const heard = await Promise.race([
          answered,
          new Promise((resolve) => {
            timer = window.setTimeout(() => resolve(null), ANSWER_TIMEOUT);
          }),
        ]);
        window.clearTimeout(timer);
        stop();
        if (!heard) return null;
        const opened = await stack.network.decode({
          encryptionKey,
          privacyKey,
          ivIndex: meshKeys.ivIndex,
          pdu: heard,
          nonceType: stack.NONCE.proxy,
        });
        return opened;
      };

      // Accept-list first, which also clears whatever was on it, then our own
      // address. Addresses in these two messages are big-endian: the one
      // exception to the rule that an access payload is little-endian.
      const cleared = await ask(
        Uint8Array.of(stack.PROXY_CONFIG.setFilterType, stack.PROXY_FILTER.accept),
      );
      // A node that did not answer the first of these is not answering. Asking
      // the second buys nothing and costs another whole timeout, on every node
      // in the session that has gone quiet.
      if (!cleared) {
        logEvent(
          LOG_AREA.gatt,
          "Proxy filter not confirmed",
          `${channel.device.id} did not answer the filter request`,
        );
        return "the node did not confirm its proxy filter, so it may be dropping our answers before they reach this page";
      }
      channel.answered = true;
      const status = await ask(
        Uint8Array.of(
          stack.PROXY_CONFIG.addAddresses,
          (meshKeys.address >>> 8) & 0xff,
          meshKeys.address & 0xff,
        ),
      );
      if (!status || status.transport[0] !== stack.PROXY_CONFIG.filterStatus) {
        logEvent(
          LOG_AREA.gatt,
          "Proxy filter not confirmed",
          `${channel.device.id} did not answer the filter request`,
        );
        return "the node did not confirm its proxy filter, so it may be dropping our answers before they reach this page";
      }
      // Who answered, not who we hoped would: a Filter Status is sent from the
      // proxy's own primary element under the network key, so this is the one
      // thing a node tells us about itself before any device key is involved.
      channel.address = status.src;
      logEvent(
        LOG_AREA.gatt,
        "Proxy identified",
        `${channel.device.id} is ${addressLabel(status.src)}`,
      );
      const filter = stack.CONFIG.proxyFilterStatus(status.transport.slice(1));
      logEvent(
        LOG_AREA.gatt,
        "Proxy filter set",
        `${channel.device.id}: ${filter.filter} list, ${filter.size} address(es)`,
      );
      // An accept list our address is not on forwards nothing to us, and
      // saying "the node did not answer" about that would be a lie.
      if (filter.accepts && filter.size === 0)
        return "the node accepted an empty filter list, so nothing addressed to this page reaches it";
      return "";
    };

    /**
     * Ends one held proxy conversation. A node will only hold so many proxy
     * connections at once, so leaving ours open is taking one of them.
     * @param {string} id
     */
    const closeProxyChannel = (id) => {
      const opening = proxyChannels.get(id);
      if (!opening) return;
      proxyChannels.delete(id);
      void opening.then(
        (channel) => {
          channel.close();
          logEvent(LOG_AREA.gatt, "Proxy channel closed", id);
        },
        // A channel that never opened has already said why, at the exchange
        // that wanted it.
        () => {},
      );
    };

    /** Ends all of them, which is what leaving the page means. */
    const closeProxyChannels = () => {
      // Deleting the entry a Map iteration is standing on is defined, and
      // closing one is what deletes it.
      for (const id of proxyChannels.keys()) closeProxyChannel(id);
    };

    /**
     * One conversation at a time with any given node, and no waiting on a
     * conversation with a different one.
     *
     * Two messages in flight on one proxy connection is two answers with
     * nothing to tell them apart by, and whichever finishes first closes the
     * link the other is still using. Serialising everything instead would mean
     * pressing Identify on a lamp waited out a read of every other node in the
     * building, which against real hardware is most of a minute.
     * @type {Map<string, Promise<any>>}
     */
    const deviceTurns = new Map();

    /** @param {string} id @param {() => Promise<any>} run */
    const withDevice = (id, run) => {
      const queued = (deviceTurns.get(id) ?? Promise.resolve()).then(run, run);
      // The queue must not inherit a rejection, or every later turn skips.
      deviceTurns.set(
        id,
        queued.catch(() => {}),
      );
      return queued;
    };

    /**
     * The application key the Health Server is reached with.
     *
     * Only the Configuration Server may be addressed with a device key. Every
     * other model, the Health Server included, is bound to an application key
     * and refuses anything else — so Attention Set and Health Fault Get go out
     * under this one. Sending them under the device key gets them dropped
     * inside the node with no reply, which looks exactly like a node that does
     * not implement them.
     */
    const healthKey = () => meshKeys?.appKeys?.["0"] || "";

    const NO_HEALTH_KEY =
      "This session holds no application key, and the Health Server is reached with one.";

    /** The device key for one node, if this session holds it. @param {any} record */
    const deviceKeyFor = (record) =>
      meshKeys?.devKeys?.[addressLabel(record.address ?? 0)] ||
      meshKeys?.devKeys?.[String(record.address)] ||
      record.devKey ||
      "";

    /**
     * Asks one node for page 0 of its own description, over a proxy
     * connection. Returns a reason rather than throwing, because every reason
     * here is something the person reading the screen can act on.
     * @param {any} record @param {any} device
     */
    const describeNode = async (record, device) => {
      if (!meshKeys) return "No network keys have been entered for this session.";
      if (!device) return "This page holds no connection to that device.";
      const known = deviceKeyFor(record);
      // Ask the link who is on it. Confirming the proxy filter is the first
      // thing a channel does, and the node answers it from its own primary
      // element under the network key — so the address is known before any
      // device key is chosen, and the right key is looked up rather than
      // guessed at a timeout per wrong guess.
      const channel = await proxyChannel(device).then(
        (open) => open,
        // A link that would not open has already said so to whoever asked for
        // it; the exchange below reports it.
        () => null,
      );
      // Proxy configuration is mandatory for a proxy server. A node that
      // answers none of it is not going to answer a composition read either,
      // and trying every device key against it costs a timeout apiece to
      // learn what this link already knows.
      if (channel && !channel.answered)
        return "The node did not answer the proxy filter this page set, so it is answering nothing on this link. No device key was tried against it.";
      const announced = channel?.address;
      if (announced !== undefined) {
        const key =
          meshKeys.devKeys?.[addressLabel(announced)] || record.devKey || "";
        if (!key)
          return `This proxy is ${addressLabel(announced)}, and this session holds no device key for it. A node opens its own description with its own key.`;
        return askNode(record, device, announced, String(key));
      }

      // A node that does not answer proxy configuration says nothing about
      // itself, so each device key this session holds is tried until one is
      // answered. A key that already identified another node is not tried
      // again — two nodes cannot share a unicast address, and every wrong
      // guess costs a full answer timeout.
      const claimed = new Set(
        [...meshLocal.values()]
          .filter((other) => other !== record && other.address !== undefined)
          .map((other) => addressLabel(other.address)),
      );
      const attempts = known
        ? [[addressLabel(record.address ?? 0), known]]
        : Object.entries(meshKeys.devKeys ?? {}).filter(
            ([addressText]) => !claimed.has(addressText),
          );
      if (attempts.length === 0)
        return "This session holds no device key for any node.";
      let reason = "";
      for (const [addressText, devKey] of attempts) {
        reason = await askNode(record, device, hexNumber(addressText, 0), String(devKey));
        if (!reason) return "";
      }
      return reason;
    };

    /**
     * One attempt, against one address with one device key.
     * @param {any} record @param {any} device @param {number} address
     * @param {string} devKey
     */
    const askNode = async (record, device, address, devKey) => {
      const stack = window.PlannerMeshStack;
      const message = await exchange(
        device,
        address,
        devKey,
        stack.OPCODE.compositionDataGet,
        Uint8Array.of(0x00),
      );
      if (typeof message === "string") return message;
      if (!message) return "The node did not answer.";
      if (message.opcode !== stack.OPCODE.compositionDataStatus)
        return `The node answered with ${opcodeLabel(message.opcode)}, which this page does not handle.`;
      const page = stack.composition.readPage0(message.parameters.slice(1));
      record.address = address;
      // All of these were read against the last description; this is a new
      // one, and a node that has been reconfigured since answers differently.
      record.bound = null;
      record.published = null;
      record.hops = null;
      // The count, not the bytes: a record crosses the relay as JSON.
      record.composition = {
        ...page,
        address,
        trailing: undefined,
        trailingCount: page.trailing.length,
      };
      record.note = "";
      // The rest of the read surface: what a plan depends on, beyond what a
      // node is made of. Anything a node does not answer stays absent rather
      // than being reported as a zero.
      record.reported = await readConfigState(record, device, address, devKey);
      renderMesh();
      publishMesh();
      return "";
    };

    /**
     * One request and its answer, over a proxy connection. Returns the answer,
     * null when nothing came back, or a reason somebody can act on.
     *
     * Every Mesh operation in this panel goes through here, so this is the one
     * place a thrown Web Bluetooth error becomes a reason rather than an
     * unhandled rejection. On real hardware the connect, the service lookup
     * and the characteristic lookup all throw, and a caller that dropped the
     * rejection left its node sitting on "Reading…" with nothing said.
     *
     * TEMPORARY — the vendor's Connector specification has not arrived. When it
     * does, its command vocabulary replaces the body below and this signature
     * stays: opcode and parameters in, an answer or a reason out. Nothing above
     * this function assembles a PDU. See docs/open-questions.md.
     *
     * @param {any} device @param {number} address @param {string} devKey
     * @param {number} opcode @param {Uint8Array} [parameters]
     */
    const exchange = async (
      device,
      address,
      key,
      opcode,
      parameters = new Uint8Array(0),
      options = {},
    ) => {
      try {
        return await proxyExchange(
          device,
          address,
          key,
          opcode,
          parameters,
          options,
        );
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        logEvent(LOG_AREA.mesh, "Exchange threw", text);
        return `The device refused the exchange: ${text}`;
      }
    };

    /**
     * Tells a node which segments of its answer arrived.
     *
     * A sender of a segmented message retransmits until it is acknowledged and
     * then gives up, so a reader that only listens costs the network a
     * retransmission of every long answer it ever asks for. Sent as a control
     * message, which carries no application layer and a longer MIC.
     * @param {any} channel
     * @param {{to: number, seqZero: number, blockAck: number, nid: number,
     *   encryptionKey: Uint8Array, privacyKey: Uint8Array}} of
     */
    const acknowledgeSegments = async (channel, of) => {
      const stack = window.PlannerMeshStack;
      const seq = nextSequence();
      if (seq === null) return;
      try {
        await channel.send(
          stack.PROXY_TYPE.network,
          await stack.network.encode({
            encryptionKey: of.encryptionKey,
            privacyKey: of.privacyKey,
            nid: of.nid,
            ivIndex: meshKeys.ivIndex,
            ctl: 1,
            ttl: 4,
            seq,
            src: meshKeys.address,
            dst: of.to,
            transport: stack.transport.ack({
              seqZero: of.seqZero,
              blockAck: of.blockAck,
            }),
          }),
        );
        logEvent(
          LOG_AREA.mesh,
          "Segments acknowledged",
          `${addressLabel(of.to)}, seqZero ${of.seqZero}, block 0x${(of.blockAck >>> 0).toString(16)}`,
        );
      } catch (error) {
        // An acknowledgment that does not go out costs a retransmission, not
        // the answer, which has already arrived.
        logEvent(LOG_AREA.mesh, "Acknowledgment not sent", String(error));
      }
    };

    /**
     * The proxy transport itself, which throws the way Web Bluetooth does.
     * @param {any} device @param {number} address @param {string} devKey
     * @param {number} opcode @param {Uint8Array} [parameters]
     */
    const proxyExchange = async (
      device,
      address,
      key,
      opcode,
      parameters = new Uint8Array(0),
      options = {},
    ) => {
      const application = Boolean(options.application);
      const stack = window.PlannerMeshStack;
      const meshCrypto = window.PlannerMeshCrypto;
      const { nid, encryptionKey, privacyKey } = await meshCrypto.k2(
        meshCrypto.bytesFromHex(meshKeys.netKey),
        Uint8Array.of(0x00),
      );
      logEvent(
        LOG_AREA.mesh,
        "Exchange opening",
        `${device.id} → ${addressLabel(address)}, opcode ${opcodeLabel(opcode)}, NID 0x${nid.toString(16).padStart(2, "0")}`,
      );
      const channel = await proxyChannel(device);

      // Every notification is opened as it arrives, because only the reassembly
      // knows when the answer is finished. Waiting for the first notification
      // and then stopping would truncate every segmented answer — which is most
      // real ones, since a description longer than fifteen octets is segmented.
      const reassembly = stack.transport.reassembly();
      /** @type {any} */
      let first = null;
      /** @type {Uint8Array | null} */
      let upper = null;
      let frames = 0;
      let unopened = 0;
      let elsewhere = 0;
      // What to acknowledge, and to whom, once a segmented answer is whole.
      let segmentsFrom = 0;
      let seqZero = 0;
      let blockAck = 0;
      /** @type {(() => void) | null} */
      let complete = null;
      const answered = new Promise((resolve) => {
        complete = () => resolve(undefined);
      });

      const onProxyPdu = async (/** @type {any} */ incoming) => {
        // A node sends beacons of its own accord the moment notifications are
        // enabled. Counting one as a frame that failed to decrypt turns "this
        // node never answered" into "the network key did not open the answer",
        // which is the opposite diagnosis.
        if (incoming.type !== stack.PROXY_TYPE.network) {
          logEvent(
            LOG_AREA.mesh,
            "Proxy PDU ignored",
            `type ${incoming.type}, ${incoming.body.byteLength} octets`,
          );
          return;
        }
        frames += 1;
        const opened = await stack.network.decode({
          encryptionKey,
          privacyKey,
          ivIndex: meshKeys.ivIndex,
          pdu: incoming.body,
        });
        if (!opened) {
          unopened += 1;
          // The commonest cause is the frame belonging to another network, and
          // the NID byte is what says so without opening anything.
          logEvent(
            LOG_AREA.mesh,
            "Frame not opened by this network key",
            `frame ${frames}, ${incoming.body.byteLength} octets, NID 0x${(incoming.body[0] & 0x7f).toString(16).padStart(2, "0")}`,
          );
          return;
        }
        // Our own network carries other nodes' traffic, and a proxy forwards
        // whatever the filter lets through. A message from somebody else, or
        // to somebody else, is not the answer to this question — and taking
        // one as the answer opens the real one under the wrong nonce.
        if (opened.src !== address || opened.dst !== meshKeys.address) {
          elsewhere += 1;
          logEvent(
            LOG_AREA.mesh,
            "Frame is not this conversation",
            `from ${addressLabel(opened.src)} to ${addressLabel(opened.dst)}, asked ${addressLabel(address)}`,
          );
          return;
        }
        first = first ?? opened;
        const lower = stack.transport.read(opened.transport);
        const done = lower.segmented
          ? reassembly.add(opened.src, lower)
          : lower.upper;
        if (lower.segmented) {
          // A sender of a segmented message waits to be told which segments
          // arrived, and retransmits until it is. Saying nothing back works
          // here only because a simulated node asks for nothing.
          segmentsFrom = opened.src;
          seqZero = lower.seqZero;
          blockAck |= 1 << lower.segmentIndex;
        }
        logEvent(
          LOG_AREA.mesh,
          "Frame opened",
          `frame ${frames} from ${addressLabel(opened.src)}, ${lower.segmented ? "segment" : "whole"}, ${done ? "answer complete" : "waiting for more"}`,
        );
        if (!done) return;
        upper = done;
        complete?.();
      };
      const stop = channel.listen(onProxyPdu);

      // Taken here, after the channel is open, and not before.
      //
      // Opening a channel sends the proxy filter, which takes sequence
      // numbers of its own. A number reserved before that is lower than the
      // ones already on the wire, and a node keeps the highest sequence it
      // has seen from each source and discards anything not above it — so the
      // request would be dropped as a replay while the filter that preceded
      // it was accepted. Every first exchange with every node, silently.
      const seq = nextSequence();
      if (seq === null) {
        stop();
        return "This network key has used every sequence number it has. Enter a fresh key, or an IV index one higher.";
      }

      const segments = await stack.transport.seal({
        key: meshCrypto.bytesFromHex(key),
        device: !application,
        aid: application ? await meshCrypto.k4(meshCrypto.bytesFromHex(key)) : 0,
        seq,
        src: meshKeys.address,
        dst: address,
        ivIndex: meshKeys.ivIndex,
        access: stack.access.write(opcode, parameters),
      });
      // Access segmentation is a different thing from the proxy link's own,
      // and this page sends none of it: a segmented message needs a sequence
      // number per segment and an acknowledgement from the far end. Taking
      // the first segment and dropping the rest is how a vendor message with
      // a payload gets blamed on the device.
      if (segments.length > 1) {
        stop();
        return `That message needs ${segments.length} transport segments, which this page does not send.`;
      }
      const pdu = await stack.network.encode({
        encryptionKey,
        privacyKey,
        nid,
        ivIndex: meshKeys.ivIndex,
        ctl: 0,
        ttl: 4,
        seq,
        src: meshKeys.address,
        dst: address,
        transport: segments[0],
      });
      await channel.send(stack.PROXY_TYPE.network, pdu);
      // A sequence number a node has already seen is dropped as a replay, and
      // the symptom is silence, so the number sent is part of the trail.
      logEvent(
        LOG_AREA.mesh,
        "Proxy PDU written",
        `${pdu.byteLength + 1} octets, sequence ${seq}, ${application ? "application key" : "device key"}`,
      );

      // A node that never answers is the timeout path, not a failure to send.
      /** @type {number | undefined} */
      let timer;
      await Promise.race([
        answered,
        new Promise((resolve) => {
          timer = window.setTimeout(resolve, ANSWER_TIMEOUT);
        }),
      ]);
      window.clearTimeout(timer);
      stop();

      // Acknowledged after the answer is whole rather than segment by
      // segment: one message back instead of one per segment, and the sender
      // stops retransmitting as soon as it arrives.
      if (blockAck !== 0)
        await acknowledgeSegments(channel, {
          to: segmentsFrom,
          seqZero,
          blockAck,
          nid,
          encryptionKey,
          privacyKey,
        });

      if (frames === 0) {
        logEvent(
          LOG_AREA.mesh,
          "No answer",
          `nothing heard in ${ANSWER_TIMEOUT}ms from ${addressLabel(address)}`,
        );
        // The likeliest cause of total silence is the node dropping our
        // answers before they reach the link, and this page knows whether it
        // got the filter confirmed.
        return channel.filter
          ? `The node said nothing, and ${channel.filter}.`
          : null;
      }
      if (!first)
        return `The network key did not open the answer (${unopened} frame(s) heard${elsewhere ? `, ${elsewhere} for somebody else` : ""}).`;
      if (!upper)
        return `The answer arrived incomplete (${frames} frame(s) heard).`;
      const access = await stack.transport.open({
        key: meshCrypto.bytesFromHex(key),
        device: !application,
        szmic: 0,
        seq: first.seq,
        src: first.src,
        dst: meshKeys.address,
        ivIndex: meshKeys.ivIndex,
        upper,
      });
      if (!access) return "The device key did not open the answer.";
      return stack.access.read(access);
    };

    /**
     * Why a write cannot happen, or nothing. Arming is off by default and is
     * not written to the URL or to storage, so a reload disarms; a Console
     * cannot arm a Bridge, because only this control writes it (ADR-0036).
     * Simulated nodes are not real hardware and are always writable.
     * @param {any} record
     */
    const refuseWrite = (record) => {
      if (meshDevices.get(record.id)?.simulated) return "";
      if (!armWrites.checked)
        return "Writes to real hardware are not armed for this session.";
      return "";
    };

    /**
     * Which network a proxy belongs to, derived rather than assumed: the
     * identifier it advertises is what k3 makes of that network's key, so
     * comparing it against ours settles it without asking the node anything.
     */
    const markNetworks = async () => {
      if (!meshKeys) return;
      const ours = window.PlannerMeshCrypto.hexFromBytes(
        await window.PlannerMeshCrypto.k3(
          window.PlannerMeshCrypto.bytesFromHex(meshKeys.netKey),
        ),
      );
      for (const record of meshLocal.values()) {
        if (record.state !== MESH_STATE.provisioned) continue;
        const advertised = /Network ID ([0-9a-f]+)/.exec(record.identity || "");
        if (!advertised) continue;
        if (advertised[1] !== ours) {
          // The two identifiers are what settle a wrong-key report, and a
          // Network ID is derived from a key rather than being one.
          logEvent(
            LOG_AREA.keys,
            "Node is in another network",
            `${record.id} advertises ${advertised[1]}, this session's key derives ${ours}`,
          );
          record.condition = "otherNetwork";
          continue;
        }
        // Belonging to our network is all this settles. Whether it answered,
        // and under which key, is decided by asking it — so a condition that
        // came from asking is left alone.
        if (
          record.condition === "otherNetwork" ||
          record.condition === "unknownNetwork"
        )
          record.condition = undefined;
      }
    };

    /** The read pass in flight, if there is one. @type {Promise<void> | null} */
    let reading = null;
    /** Whether something arrived while a pass was running. */
    let readAgain = false;

    /**
     * Reads every node that is waiting for it, one pass at a time.
     *
     * A real proxy advertises every second or two, and every advertisement
     * asks for this. Without the guard each one starts its own pass over the
     * same nodes, and they share one proxy connection: several messages in
     * flight at once is several answers with nothing to tell them apart by,
     * and whichever pass finishes first disconnects the link the others are
     * still writing to. Anything that arrived mid-pass is picked up by the
     * repeat rather than by a second pass running alongside.
     */
    const describeKnownNodes = () => {
      if (reading) {
        readAgain = true;
        return reading;
      }
      reading = (async () => {
        do {
          readAgain = false;
          await readEveryNode();
        } while (readAgain);
      })().finally(() => {
        reading = null;
      });
      return reading;
    };

    const readEveryNode = async () => {
      if (!meshKeys || refuseLocalMesh()) return;
      await markNetworks();
      let described = 0;
      let shut = 0;
      const waiting = [...meshLocal.values()].filter((record) => {
        if (record.state !== MESH_STATE.provisioned || record.composition)
          return false;
        // A node in another network is not something to try keys against,
        // and one that has already been tried with every key this session
        // holds is not worth trying again on each advertisement. The button
        // on its detail asks again when something has changed.
        if (record.condition === "otherNetwork" || record.condition === "unopened")
          return false;
        return Boolean(meshDevices.get(record.id));
      });
      // Reading is a conversation with a device and they happen one at a
      // time, so every node in the queue says where it is in it.
      for (const record of waiting) record.condition = "queued";
      renderMesh();
      logEvent(
        LOG_AREA.mesh,
        "Reading nodes",
        `${waiting.length} of ${meshLocal.size} in this session`,
      );
      for (const record of waiting) {
        const device = meshDevices.get(record.id);
        record.condition = "asking";
        renderMesh();
        // One node that throws must not strand the rest of the queue on
        // "Waiting to be read" with nothing said about why.
        try {
          record.note = await withDevice(record.id, async () => {
            try {
              return await describeNode(record, device);
            } finally {
              // Inside the turn, so it cannot close a link that whatever took
              // the next turn on this node is already using.
              closeProxyChannel(record.id);
            }
          });
        } catch (error) {
          record.note = `Reading stopped: ${error instanceof Error ? error.message : String(error)}`;
          logEvent(LOG_AREA.mesh, "Read threw", `${record.id}: ${record.note}`);
        }
        if (record.composition) {
          record.condition = "read";
          described += 1;
        } else {
          record.condition = "unopened";
          shut += 1;
        }
        logEvent(
          LOG_AREA.mesh,
          "Node read finished",
          `${record.id}: ${record.condition}${record.note ? `, ${record.note}` : ""}`,
        );
      }
      renderMesh();
      publishMesh();
      // Saying nothing looks the same as doing nothing, and a session with no
      // nodes in it is the likeliest reason for both.
      if (described === 0 && shut === 0)
        setStatus(
          meshLocal.size === 0
            ? "Keys loaded. No devices in this session yet: add a Mesh device, or load the demo."
            : "Keys loaded. No node in this session is waiting to be described.",
        );
      else
        setStatus(
          `Keys loaded. ${described} node(s) described` +
            (shut > 0 ? `, ${shut} that this session holds no key for.` : "."),
        );
    };

    /**
     * Makes a device draw attention to itself for ten seconds. This is a write
     * and is deliberately not behind the arming control: blinking a light to
     * find out which one it is is not reconfiguring a network, and needing to
     * arm something first defeats what it is for.
     * @param {any} record
     */
    const identifyNode = async (record) => {
      const device = meshDevices.get(record.id);
      const appKey = healthKey();
      if (!device || record.address === undefined)
        return "This node has not been described yet.";
      if (!appKey) return NO_HEALTH_KEY;
      const answer = await exchange(
        device,
        // The Health Server's own element. It is usually the node's first,
        // and "usually" is not something to address a radio on.
        elementWith(record, 0x0002) ?? record.address,
        appKey,
        window.PlannerMeshStack.OPCODE.attentionSet,
        Uint8Array.of(10),
        { application: true },
      );
      if (!answer || typeof answer === "string")
        return answer || "The node did not answer.";
      return `Attending for ${window.PlannerMeshStack.CONFIG.attention(answer.parameters).seconds} seconds.`;
    };

    /**
     * Asks how far away a node actually is. Both ends of a heartbeat
     * arrangement are writes, so this is armed like the others.
     *
     * TEMPORARY — what this sets up is not yet the arrangement that measures
     * anything. A Heartbeat Subscription makes a node count heartbeats it
     * hears; the hop counts it reports are about the source it was given, and
     * the source given here is the node itself. Measuring the distance to a
     * node needs either a Heartbeat Publication aimed at us and the hop count
     * taken from the network TTL here, or a subscription on something that can
     * hold one — and a browser is not a node. Against a simulated node the
     * seeded hop count comes back either way, which is exactly why this stood.
     * See docs/open-questions.md.
     * @param {any} record
     */
    const measureHops = async (record) => {
      const refusal = refuseWrite(record);
      if (refusal) return refusal;
      const device = meshDevices.get(record.id);
      const devKey = deviceKeyFor(record);
      if (!device || !devKey || record.address === undefined)
        return "This node has not been described yet.";
      const stack = window.PlannerMeshStack;
      const answer = await exchange(
        device,
        record.address,
        devKey,
        stack.OPCODE.heartbeatSubscriptionSet,
        // Source, destination, then how long to listen for.
        window.PlannerMeshCrypto.join(
          le16(record.address),
          le16(meshKeys.address),
          Uint8Array.of(0x02),
        ),
      );
      if (!answer || typeof answer === "string")
        return answer || "The node did not answer.";
      if (answer.opcode !== stack.OPCODE.heartbeatSubscriptionStatus)
        return `The node answered with ${opcodeLabel(answer.opcode)}.`;
      const heard = stack.CONFIG.heartbeatSubscription(answer.parameters);
      if (!heard.ok) return `The node refused: ${heard.status}.`;
      // A node that answered about some other arrangement is not answering
      // about this one, and a flipped address is still a valid address.
      if (
        heard.source !== record.address ||
        heard.destination !== meshKeys.address
      )
        return `The node reported a subscription to ${addressLabel(heard.source)} at ${addressLabel(heard.destination)}, which is not the one it was asked for.`;
      record.hops = heard;
      renderMesh();
      publishMesh();
      return heard.minHops === heard.maxHops
        ? `${heard.minHops} hop(s) away.`
        : `Between ${heard.minHops} and ${heard.maxHops} hops away.`;
    };

    /**
     * Turns a node's Generic OnOff Server on or off. This is an application
     * message: it is secured with an application key, not a device key, which
     * is what an application key is for.
     * @param {any} record @param {boolean} on
     */
    const setOnOff = async (record, on) => {
      const refusal = refuseWrite(record);
      if (refusal) return refusal;
      const device = meshDevices.get(record.id);
      const appKey = meshKeys?.appKeys?.["0"];
      if (!device || record.address === undefined)
        return "This node has not been described yet.";
      if (!appKey)
        return "This session holds no application key, so nothing can be switched.";
      // A model is reached at the address of the element carrying it, not at
      // the node's first one. Addressing the node and hoping works only while
      // every server model happens to sit on element zero.
      const at = elementWith(record, 0x1000);
      if (at === null)
        return "No element on this node carries a Generic OnOff Server.";
      const stack = window.PlannerMeshStack;
      const answer = await exchange(
        device,
        at,
        appKey,
        stack.OPCODE.genericOnOffSet,
        // The transaction number stops a repeat being taken twice.
        Uint8Array.of(on ? 1 : 0, (record.tid = ((record.tid ?? 0) + 1) & 0xff)),
        { application: true },
      );
      if (!answer || typeof answer === "string")
        return answer || "The node did not answer.";
      if (answer.opcode !== stack.OPCODE.genericOnOffStatus)
        return `The node answered with ${opcodeLabel(answer.opcode)}.`;
      return stack.CONFIG.genericOnOff(answer.parameters).on
        ? "Reported on."
        : "Reported off.";
    };

    /**
     * The address of the element carrying a model, or null when no element
     * does. A node's elements are consecutive from its own address, which is
     * how one node holds several independently addressable things.
     * @param {any} record @param {number} id
     */
    const elementWith = (record, id) => {
      const elements = record.composition?.elements ?? [];
      for (const [index, element] of elements.entries())
        if (
          element.models.some(
            (/** @type {any} */ model) => !model.vendor && model.id === id,
          )
        )
          return record.composition.address + index;
      return null;
    };

    /**
     * Every model on every element, asked about one at a time. These
     * conversations are sequential because a proxy connection is: two messages
     * in flight at once is two answers with nothing to tell them apart by.
     * @param {any} record
     * @param {(index: number, model: any) => Promise<any>} ask
     */
    const forEachModel = async (record, ask) => {
      /** @type {any[]} */
      const found = [];
      for (const [index, element] of record.composition.elements.entries())
        for (const model of element.models) found.push(await ask(index, model));
      return found;
    };

    const oobDialog = /** @type {HTMLDialogElement} */ (
      meshFind('[data-part="mesh-oob-dialog"]')
    );
    const oobWhy = meshFind('[data-part="mesh-oob-why"]');
    const oobField = /** @type {HTMLElement} */ (
      meshFind('[data-part="mesh-oob-field"]')
    );
    const oobInput = /** @type {HTMLInputElement} */ (
      meshFind('[data-part="mesh-oob-input"]')
    );

    /**
     * Confirms what is about to be written to a device, and collects the
     * number it is showing when it has one.
     *
     * The number is the whole point of an out-of-band exchange: it is read off
     * the device by somebody standing in front of it, which is what ties the
     * key to that device rather than to whatever answered. So this prompt
     * belongs where the adapter is — on a Bridge, it is the person there who
     * can see the device, not whoever is driving from a Console.
     * @param {any} record @param {number} address @param {boolean} output
     * @returns {Promise<number | null>} the number, 0 when none is needed,
     *   or null when nobody confirmed
     */
    const askToProvision = (record, address, output) =>
      new Promise((resolve) => {
        oobWhy.textContent = output
          ? `${record.label} is showing a number. Read it off the device and type it here. It will be given the address ${addressLabel(address)}.`
          : `${record.label} proves nothing about itself, so anything in range could be answering. It will be given the address ${addressLabel(address)}.`;
        oobField.hidden = !output;
        oobInput.value = "";
        const settle = (/** @type {number | null} */ value) => {
          controls.abort();
          oobDialog.close();
          resolve(value);
        };
        const controls = new AbortController();
        meshFind('[data-part="mesh-oob-accept"]').addEventListener(
          "click",
          () => settle(output ? Number(oobInput.value) : 0),
          { signal: controls.signal },
        );
        meshFind('[data-part="mesh-oob-cancel"]').addEventListener(
          "click",
          () => settle(null),
          { signal: controls.signal },
        );
        // Escape and the backdrop both close a dialog without pressing
        // anything, and a promise nobody settles hangs the action forever.
        oobDialog.addEventListener("close", () => settle(null), {
          signal: controls.signal,
        });
        oobDialog.showModal();
        (output ? oobInput : oobDialog).focus();
      });

    const PROVISION_DATA_IN = "00002adb-0000-1000-8000-00805f9b34fb";
    const PROVISION_DATA_OUT = "00002adc-0000-1000-8000-00805f9b34fb";

    /**
     * The provisioning characteristics, spoken to the way the link requires.
     *
     * Data In is write-without-response and Data Out is a notification, and
     * ATT fragments neither — so every PDU is segmented across writes and put
     * back together from notifications. A public key is sixty-four octets, so
     * nothing in this exchange fits one write.
     * @param {any} device
     */
    const provisioningLink = async (device) => {
      const stack = window.PlannerMeshStack;
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(MESH_PROVISIONING);
      const dataIn = await service.getCharacteristic(PROVISION_DATA_IN);
      const dataOut = await service.getCharacteristic(PROVISION_DATA_OUT);

      const sar = stack.proxy.reassembly();
      /** @type {Uint8Array[]} */
      const inbox = [];
      const onValue = (/** @type {any} */ event) => {
        const value = event.target.value;
        const whole = sar.add(
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        );
        if (whole && whole.type === stack.PROXY_TYPE.provisioning)
          inbox.push(whole.body);
      };
      await dataOut.startNotifications();
      dataOut.addEventListener("characteristicvaluechanged", onValue);

      return {
        /** @param {number} type @param {Uint8Array} body */
        async send(type, body) {
          const pdu = window.PlannerMeshCrypto.join(Uint8Array.of(type), body);
          for (const segment of stack.proxy.split(
            stack.PROXY_TYPE.provisioning,
            pdu,
          ))
            await dataIn.writeValue(segment.buffer);
          logEvent(
            LOG_AREA.mesh,
            "Provisioning PDU written",
            `${device.id}, type ${type}, ${pdu.byteLength} octets`,
          );
        },
        /**
         * The next PDU, waited for. A device answers after the write has
         * resolved, never during it.
         * @param {number} type
         */
        async expect(type) {
          for (let left = ANSWER_TIMEOUT; left > 0 && inbox.length === 0; left -= 20)
            await new Promise((resolve) => setTimeout(resolve, 20));
          const frame = inbox.shift();
          if (!frame) return { fault: "The device stopped answering." };
          logEvent(
            LOG_AREA.mesh,
            "Provisioning PDU heard",
            `${device.id}, type ${frame[0]}`,
          );
          if (frame[0] === PROVISION_FAILED)
            return {
              fault: `The device refused: ${provisionFailure(frame[1])}.`,
            };
          if (frame[0] !== type)
            return { fault: `The device answered with PDU type ${frame[0]}.` };
          return { body: frame.slice(1) };
        },
        close() {
          dataOut.removeEventListener("characteristicvaluechanged", onValue);
          if (device.gatt.connected) device.gatt.disconnect();
        },
      };
    };

    /** Provisioning Failed, and what the device meant by it (Mesh Profile 5.4.4). */
    const PROVISION_FAILED = 0x09;
    const PROVISION_FAILURE = [
      "no error, which is not a refusal",
      "the PDU was not valid",
      "the PDU was the wrong shape",
      "it was not expecting that PDU yet",
      "the confirmation did not match — the number was probably wrong",
      "the device ran out of resources",
      "decryption failed",
      "an unexpected error",
      "the device could not assign the address",
      "the provisioning data was not usable",
    ];
    /** @param {number} code */
    const provisionFailure = (code) =>
      PROVISION_FAILURE[code] ?? `reason ${code}`;

    /**
     * The next unicast address nothing in this session is using. Every element
     * on a node takes one, so a node that reported nine of them occupies nine.
     */
    const nextUnicast = () => {
      let highest = 0;
      for (const text of Object.keys(meshKeys?.devKeys ?? {}))
        highest = Math.max(highest, hexNumber(text, 0));
      for (const record of meshLocal.values())
        if (record.address !== undefined)
          highest = Math.max(
            highest,
            record.address + (record.composition?.elements?.length ?? 1) - 1,
          );
      return Math.max(highest + 1, 0x0001);
    };

    /**
     * Brings one unprovisioned device into this session's network over
     * PB-GATT: the invite and what it can do, an elliptic-curve exchange, the
     * confirmation that proves whoever is provisioning it is standing in front
     * of it, and finally the network key and the address it is being given.
     *
     * Nothing here is fetched from anywhere: the device key both ends end up
     * with is derived on both sides and never sent.
     * @param {any} record
     */
    const provisionNode = async (record) => {
      if (!meshKeys) return "No network keys have been entered for this session.";
      const refusal = refuseWrite(record);
      if (refusal) return refusal;
      const device = meshDevices.get(record.id);
      if (!device) return "This page holds no connection to that device.";
      if (record.state !== MESH_STATE.unprovisioned)
        return "That device is not asking to be provisioned.";

      const stack = window.PlannerMeshStack;
      const meshCrypto = window.PlannerMeshCrypto;
      const link = await provisioningLink(device);
      try {
        const invite = Uint8Array.of(0x00);
        await link.send(stack.PROVISION.invite, invite);
        const said = await link.expect(stack.PROVISION.capabilities);
        if (said.fault) return said.fault;
        const capabilities = said.body;
        const reported = stack.provisioning.readCapabilities(capabilities);

        // A device that can show a number is asked to, and somebody in the
        // room reads it off and types it in. That is the whole point of the
        // exchange: it is what ties the key to the device in front of you.
        const output = reported.outputOobSize > 0;
        const address = nextUnicast();
        const typed = await askToProvision(record, address, output);
        if (typed === null) return "Provisioning was cancelled.";
        const auth = new Uint8Array(16);
        if (output) new DataView(auth.buffer).setUint32(12, typed);

        const start = Uint8Array.of(
          0x00,
          0x00,
          output ? stack.AUTH.output : stack.AUTH.none,
          output ? 0x03 : 0x00,
          output ? reported.outputOobSize : 0x00,
        );
        await link.send(stack.PROVISION.start, start);

        const ours = await stack.provisioning.makeProvisionerKeys();
        await link.send(stack.PROVISION.publicKey, ours.publicKey);
        const key = await link.expect(stack.PROVISION.publicKey);
        if (key.fault) return key.fault;
        const secret = await stack.provisioning.sharedSecret(
          ours.pair.privateKey,
          key.body,
        );

        const { confirmationSalt, confirmationKey } =
          await stack.provisioning.provisioningKeys(
            secret,
            meshCrypto.join(
              invite,
              capabilities,
              start,
              ours.publicKey,
              key.body,
            ),
          );
        const random = globalThis.crypto.getRandomValues(new Uint8Array(16));
        await link.send(
          stack.PROVISION.confirmation,
          await meshCrypto.cmac(confirmationKey, meshCrypto.join(random, auth)),
        );
        const commitment = await link.expect(stack.PROVISION.confirmation);
        if (commitment.fault) return commitment.fault;

        await link.send(stack.PROVISION.random, random);
        const shown = await link.expect(stack.PROVISION.random);
        if (shown.fault) return shown.fault;

        // Their confirmation has to match the random they only sent
        // afterwards. A device that cannot produce it did not know the number.
        const expected = await meshCrypto.cmac(
          confirmationKey,
          meshCrypto.join(shown.body, auth),
        );
        if (
          meshCrypto.hexFromBytes(expected) !==
          meshCrypto.hexFromBytes(commitment.body)
        )
          return "The device did not prove it knew the number. Nothing was written to it.";

        const session = await stack.provisioning.sessionKeys(
          secret,
          confirmationSalt,
          random,
          shown.body,
        );
        await link.send(
          stack.PROVISION.data,
          await meshCrypto.ccmEncrypt(
            session.sessionKey,
            session.sessionNonce,
            meshCrypto.join(
              meshCrypto.bytesFromHex(meshKeys.netKey),
              // Key index, then flags. Both little-endian, as the provisioning
              // data is; the IV index and the address that follow are not.
              le16(meshKeys.netKeyIndex),
              Uint8Array.of(0x00),
              Uint8Array.of(
                (meshKeys.ivIndex >>> 24) & 0xff,
                (meshKeys.ivIndex >>> 16) & 0xff,
                (meshKeys.ivIndex >>> 8) & 0xff,
                meshKeys.ivIndex & 0xff,
              ),
              Uint8Array.of((address >>> 8) & 0xff, address & 0xff),
            ),
            { micBytes: 8 },
          ),
        );
        const done = await link.expect(stack.PROVISION.complete);
        if (done.fault) return done.fault;

        // The device key is what this session needs to read the node it just
        // made. Neither end sent it; both derived it.
        meshKeys.devKeys = {
          ...meshKeys.devKeys,
          [addressLabel(address)]: meshCrypto.hexFromBytes(session.deviceKey),
        };
        storeKeys();
        record.address = address;
        record.condition = undefined;
        renderMesh();
        publishMesh();
        logEvent(
          LOG_AREA.keys,
          "Node provisioned",
          `${record.id} is now ${addressLabel(address)}`,
        );
        return `Provisioned as ${addressLabel(address)}. It should appear as a node of this network.`;
      } finally {
        link.close();
      }
    };

    /**
     * Which application keys a node holds, and which of them each of its
     * models is bound to.
     *
     * A model bound to no application key receives nothing an application
     * sends it. That is the commonest reason a node which provisioned
     * perfectly does nothing when asked to — and a node's own description says
     * nothing about it, so it has to be asked, one model at a time.
     * @param {any} record
     */
    const readBindings = async (record) => {
      const device = meshDevices.get(record.id);
      const devKey = deviceKeyFor(record);
      if (!device || !devKey || !record.composition)
        return "This node has not been described yet.";
      const stack = window.PlannerMeshStack;
      // Configuration lives on a node's first element, so every one of these
      // messages is addressed there. Which element is being asked about is a
      // parameter, not the destination.
      const address = record.composition.address;
      const held = await exchange(
        device,
        address,
        devKey,
        stack.OPCODE.appKeyGet,
        le16(meshKeys.netKeyIndex),
      );
      if (!held || typeof held === "string")
        return held || "The node did not answer.";
      if (held.opcode !== stack.OPCODE.appKeyList)
        return `The node answered with ${opcodeLabel(held.opcode)}.`;
      const keys = stack.CONFIG.appKeyList(held.parameters);

      const models = await forEachModel(record, (index, model) =>
        readModelBinding(record, device, devKey, index, model),
      );
      record.bound = {
        appKeyIndexes: keys.ok ? keys.appKeyIndexes : [],
        status: keys.ok ? "" : keys.status,
        models,
      };
      renderMesh();
      publishMesh();
      const bound = models.filter(
        (/** @type {any} */ entry) => entry.appKeyIndexes.length > 0,
      ).length;
      return `Holds ${keys.appKeyIndexes.length} application key(s); ${bound} of ${models.length} model(s) bound.`;
    };

    /**
     * One model's bindings. A vendor model is asked for with a different
     * message carrying its company as well, which this page does not send —
     * so it is reported as not asked rather than as bound to nothing.
     *
     * TEMPORARY — Config Vendor Model App Get (0x804d). Nothing in the demo
     * has a vendor model, and no real device has been in front of this yet.
     * @param {any} record @param {any} device @param {string} devKey
     * @param {number} index @param {any} model
     */
    const readModelBinding = async (record, device, devKey, index, model) => {
      const stack = window.PlannerMeshStack;
      const element = record.composition.address + index;
      const found = { element: index, id: model.id, vendor: Boolean(model.vendor) };
      if (model.vendor)
        return {
          ...found,
          appKeyIndexes: [],
          status: "Not asked: a vendor model takes its own message.",
        };
      const answer = await exchange(
        device,
        record.composition.address,
        devKey,
        stack.OPCODE.sigModelAppGet,
        window.PlannerMeshCrypto.join(le16(element), le16(model.id)),
      );
      if (!answer || typeof answer === "string")
        return {
          ...found,
          appKeyIndexes: [],
          status: answer || "The node did not answer.",
        };
      if (answer.opcode !== stack.OPCODE.sigModelAppList)
        return {
          ...found,
          appKeyIndexes: [],
          status: `Answered with ${opcodeLabel(answer.opcode)}.`,
        };
      const list = stack.CONFIG.modelAppList(answer.parameters);
      return {
        ...found,
        appKeyIndexes: list.ok ? list.appKeyIndexes : [],
        status: list.ok ? "" : list.status,
      };
    };

    /**
     * Where each of a node's models publishes, and which addresses it listens
     * on. Together with the bindings this is how a network is wired: a switch
     * publishes to a group and the lamps in a room subscribe to it, and
     * nothing in either node names the other.
     * @param {any} record
     */
    const readPublication = async (record) => {
      const device = meshDevices.get(record.id);
      const devKey = deviceKeyFor(record);
      if (!device || !devKey || !record.composition)
        return "This node has not been described yet.";
      const models = await forEachModel(record, (index, model) =>
        readModelPublication(record, device, devKey, index, model),
      );
      record.published = { models };
      renderMesh();
      publishMesh();
      const publishing = models.filter(
        (/** @type {any} */ entry) => entry.address,
      ).length;
      const listening = models.filter(
        (/** @type {any} */ entry) => entry.subscriptions.length > 0,
      ).length;
      return `${publishing} model(s) publishing, ${listening} subscribed to something.`;
    };

    /**
     * One model's publication and subscription, which are two messages.
     *
     * TEMPORARY — a vendor model takes its own message for each of these, as
     * it does for bindings, and this page sends neither.
     * @param {any} record @param {any} device @param {string} devKey
     * @param {number} index @param {any} model
     */
    const readModelPublication = async (record, device, devKey, index, model) => {
      const stack = window.PlannerMeshStack;
      const element = record.composition.address + index;
      const found = {
        element: index,
        id: model.id,
        vendor: Boolean(model.vendor),
        address: 0,
        subscriptions: /** @type {number[]} */ ([]),
      };
      if (model.vendor)
        return {
          ...found,
          status: "Not asked: a vendor model takes its own messages.",
        };
      /** @param {number} opcode @param {number} expected */
      const ask = async (opcode, expected) => {
        const answer = await exchange(
          device,
          record.composition.address,
          devKey,
          opcode,
          window.PlannerMeshCrypto.join(le16(element), le16(model.id)),
        );
        if (!answer || typeof answer === "string")
          return { fault: answer || "The node did not answer." };
        if (answer.opcode !== expected)
          return { fault: `Answered with ${opcodeLabel(answer.opcode)}.` };
        return { parameters: answer.parameters };
      };

      const where = await ask(
        stack.OPCODE.modelPublicationGet,
        stack.OPCODE.modelPublicationStatus,
      );
      if (where.fault) return { ...found, status: where.fault };
      const publication = stack.CONFIG.modelPublication(where.parameters);
      if (!publication.ok) return { ...found, status: publication.status };

      const listening = await ask(
        stack.OPCODE.sigModelSubscriptionGet,
        stack.OPCODE.sigModelSubscriptionList,
      );
      if (listening.fault)
        return {
          ...found,
          address: publication.address,
          ttl: publication.ttl,
          periodMs: publication.periodMs,
          appKeyIndex: publication.appKeyIndex,
          status: listening.fault,
        };
      const subscription = stack.CONFIG.modelSubscriptionList(
        listening.parameters,
      );
      return {
        ...found,
        address: publication.address,
        ttl: publication.ttl,
        periodMs: publication.periodMs,
        appKeyIndex: publication.appKeyIndex,
        subscriptions: subscription.ok ? subscription.addresses : [],
        status: subscription.ok ? "" : subscription.status,
      };
    };

    /**
     * Asking one node to describe itself, with the row saying where it is in
     * that conversation while it happens.
     * @param {any} record
     */
    const readNode = async (record) => {
      record.condition = "asking";
      renderMesh();
      const reason = await describeNode(record, meshDevices.get(record.id));
      record.condition = record.composition ? "read" : "unopened";
      return reason;
    };

    /**
     * Every Mesh action this panel offers, named once. A name and a record are
     * all it takes to run one, which is what lets a Console send the name and
     * a Bridge run it (ADR-0036) — and what keeps the vendor's Connector a
     * change underneath `exchange` rather than a change to five handlers.
     *
     * Adding an action means adding a row here. Nothing else knows the set.
     */
    const MESH_ACTION = {
      describe: { part: "mesh-describe", run: readNode },
      on: {
        part: "mesh-on",
        run: (/** @type {any} */ record) => setOnOff(record, true),
      },
      off: {
        part: "mesh-off",
        run: (/** @type {any} */ record) => setOnOff(record, false),
      },
      hops: { part: "mesh-hops", run: measureHops },
      identify: { part: "mesh-identify", run: identifyNode },
      provision: { part: "mesh-provision", run: provisionNode },
      bindings: { part: "mesh-bindings", run: readBindings },
      publication: { part: "mesh-publication", run: readPublication },
    };

    /**
     * Runs one named action against one record, here, on this page's own
     * adapter. Returns what the row should say about it.
     * @param {keyof typeof MESH_ACTION} name @param {any} record
     */
    const runAction = async (name, record) => {
      logEvent(LOG_AREA.mesh, "Action started", `${name} on ${record.id}`);
      // Behind whatever else is talking to this node, and nothing else: an
      // action on one lamp does not wait out a read of the whole building.
      const note = await withDevice(record.id, async () => {
        try {
          return await MESH_ACTION[name].run(record);
        } finally {
          // Inside the turn. One action is one conversation, and holding the
          // link open past it takes a proxy slot the node has few of — but
          // closing it after the turn has ended would disconnect whatever
          // took the next turn on this node.
          closeProxyChannel(record.id);
        }
      });
      logEvent(
        LOG_AREA.mesh,
        "Action finished",
        `${name} on ${record.id}: ${note || "no reason given"}`,
      );
      return note;
    };

    /**
     * What a press of an action button does, and the one place that decides
     * where the action runs. A Bridge runs it against its own adapter; a
     * Console has no adapter, so it sends the name and renders the answer
     * (ADR-0036). Every action goes through here, so that is one decision
     * rather than one per button.
     * @param {keyof typeof MESH_ACTION} name @param {any} record
     */
    const driveAction = async (name, record) => {
      record.note = "";
      return link.role === "console"
        ? relayAction(name, record)
        : runAction(name, record);
    };

    /**
     * Reads the configuration state a plan depends on. Each reading is its own
     * message, and a node that does not implement one simply has no value for
     * it here.
     * @param {any} record @param {any} device @param {number} address
     * @param {string} devKey
     */
    const readConfigState = async (record, device, address, devKey) => {
      const stack = window.PlannerMeshStack;
      /** @type {[string, number, number, (p: Uint8Array) => any][]} */
      const wanted = [
        ["defaultTtl", stack.OPCODE.defaultTtlGet, stack.OPCODE.defaultTtlStatus, stack.CONFIG.defaultTtl],
        ["networkTransmit", stack.OPCODE.networkTransmitGet, stack.OPCODE.networkTransmitStatus, stack.CONFIG.networkTransmit],
        ["relay", stack.OPCODE.relayGet, stack.OPCODE.relayStatus, stack.CONFIG.relay],
      ];
      /** @type {Record<string, any>} */
      const state = {};
      for (const [name, get, status, parse] of wanted) {
        const answer = await exchange(device, address, devKey, get);
        if (answer && typeof answer !== "string" && answer.opcode === status)
          state[name] = parse(answer.parameters);
      }
      // The Health Server is not the Configuration Server, so its two
      // readings go out under an application key rather than the device key
      // the rest of this uses.
      const appKey = healthKey();
      if (!appKey) {
        // Absent with a reason, rather than absent. A Health row missing
        // because nobody entered an application key looks exactly like a node
        // that does not implement Health.
        state.health = { unread: NO_HEALTH_KEY };
        return state;
      }
      const health = elementWith(record, 0x0002) ?? address;
      const attention = await exchange(
        device,
        health,
        appKey,
        stack.OPCODE.attentionGet,
        new Uint8Array(0),
        { application: true },
      );
      if (attention && typeof attention !== "string" && attention.opcode === stack.OPCODE.attentionStatus)
        state.attention = stack.CONFIG.attention(attention.parameters);
      const faults = await exchange(
        device,
        health,
        appKey,
        stack.OPCODE.healthFaultGet,
        // The company whose fault codes are being asked for.
        le16(record.composition.company),
        { application: true },
      );
      if (faults && typeof faults !== "string" && faults.opcode === stack.OPCODE.healthFaultStatus)
        state.health = stack.CONFIG.healthFaults(faults.parameters);
      return state;
    };
    /* ---- Relay link ------------------------------------------------------ */

    /** @param {string} text */
    const setLinkState = (text) => {
      linkState.textContent = text;
    };

    /** @param {string} verb @param {unknown} [payload] */
    const sendFrame = (verb, payload) => {
      if (!link.source || !link.peer) {
        logEvent(LOG_AREA.relay, "Frame not sent", `${verb}, no peer attached`);
        return;
      }
      logEvent(LOG_AREA.relay, "Frame sent", `${verb} as ${link.role}`);
      const url = `${link.relay}/send?room=${encodeURIComponent(link.room)}&role=${link.role}`;
      void fetch(url, { method: "POST", body: JSON.stringify({ verb, payload }) })
        .then((response) => {
          if (response.ok) return;
          logEvent(LOG_AREA.relay, "Relay refused a frame", `${verb}, HTTP ${response.status}`);
          setLinkState(LINK.lost);
        })
        .catch((error) => {
          logEvent(LOG_AREA.relay, "Relay unreachable", String(error));
          setLinkState(LINK.lost);
        });
    };

    /** A Bridge reports its own records; a Console has none to report. */
    const publishMesh = () => {
      if (link.role === "bridge") sendFrame(FRAME.state, [...meshLocal.values()]);
    };

    /* ---- Actions across the relay ---------------------------------------- */

    /** Actions this Console has sent and not yet heard back about. */
    /** @type {Map<number, (note: string) => void>} */
    const pending = new Map();
    let lastAction = 0;

    /**
     * A Console asking a Bridge to act. The keys, the adapter and the arming
     * control all stay on the Bridge: what crosses the relay is an action
     * name and a device identifier, never key material and never a PDU.
     * @param {keyof typeof MESH_ACTION} name @param {any} record
     */
    const relayAction = (name, record) =>
      new Promise((resolve) => {
        if (!link.peer) {
          resolve("No Bridge is attached, so nothing can act on that node.");
          return;
        }
        const id = (lastAction += 1);
        /** @type {number | undefined} */
        let timer;
        pending.set(id, (note) => {
          window.clearTimeout(timer);
          pending.delete(id);
          resolve(note);
        });
        timer = window.setTimeout(() => {
          pending.delete(id);
          logEvent(LOG_AREA.relay, "Action timed out", `${name} #${id}`);
          resolve(
            `The Bridge did not answer within ${ACTION_TIMEOUT / 1000} seconds.`,
          );
        }, ACTION_TIMEOUT);
        sendFrame(FRAME.act, { id, name, device: record.id });
      });

    /**
     * A Bridge acting on a Console's behalf. The action is looked up by name
     * rather than taken from the frame, so a frame naming something this page
     * does not offer does nothing but say so. Arming is read from this page's
     * own control, so a relayed action can no more arm a write than it can
     * open a chooser.
     * @param {any} payload
     */
    const actForPeer = async (payload) => {
      const id = Number(payload?.id);
      const name = String(payload?.name);
      /** @param {string} note */
      const answer = (note) => sendFrame(FRAME.acted, { id, note });
      if (!Object.hasOwn(MESH_ACTION, name))
        return answer(`This Bridge does not offer the action "${name}".`);
      const record = meshLocal.get(String(payload?.device));
      if (!record)
        return answer("The Bridge holds no device with that identifier.");
      record.note = "";
      renderMesh();
      publishMesh();
      const note = await runAction(
        /** @type {keyof typeof MESH_ACTION} */ (name),
        record,
      );
      record.note = note;
      renderMesh();
      // The answer and the records that changed with it travel together, so
      // the Console never renders a note against a stale node.
      publishMesh();
      answer(note);
    };

    /** @param {any} frame */
    const onFrame = (frame) => {
      logEvent(
        LOG_AREA.relay,
        "Frame received",
        `${frame.relay ? `relay:${frame.relay}` : frame.verb} as ${link.role}`,
      );
      if (frame.relay === "peer") {
        link.peer = Boolean(frame.present);
        setLinkState(link.peer ? LINK.joined : LINK.waiting);
        reloadPeer.hidden = !(link.role === "console" && link.peer);
        if (!link.peer) return;
        if (link.role === "console") sendFrame(FRAME.list);
        else publishMesh();
        return;
      }
      if (link.role === "bridge" && frame.verb === FRAME.reload)
        return window.location.reload();
      if (link.role === "bridge" && frame.verb === FRAME.ask)
        return showChooserAsk(ASK.offered, true);
      if (link.role === "bridge" && frame.verb === FRAME.list)
        return publishMesh();
      if (link.role === "bridge" && frame.verb === FRAME.act)
        return void actForPeer(frame.payload);
      if (link.role === "console" && frame.verb === FRAME.acted) {
        const settle = pending.get(Number(frame.payload?.id));
        // An answer to an action this page has already given up on is not an
        // error, and re-resolving a settled one is not possible.
        if (settle) settle(String(frame.payload?.note ?? ""));
        return;
      }
      if (link.role === "console" && frame.verb === FRAME.state) {
        meshRemote = Array.isArray(frame.payload) ? frame.payload : [];
        renderMesh();
      }
    };

    const closeLink = () => {
      link.source?.close();
      link.source = null;
      link.peer = false;
      reloadPeer.hidden = true;
      meshRemote = [];
      // An action whose Bridge has gone is answered now rather than left to
      // time out against a link that no longer exists.
      for (const settle of pending.values())
        settle("The relay link closed before the Bridge answered.");
      pending.clear();
    };

    const openLink = () => {
      if (!link.role || !link.relay || !link.room) {
        setLinkState(LINK.idle);
        return;
      }
      setLinkState(LINK.connecting);
      const url = `${link.relay}/join?room=${encodeURIComponent(link.room)}&role=${link.role}`;
      const source = new EventSource(url);
      link.source = source;
      source.onopen = () => setLinkState(LINK.waiting);
      source.onmessage = (event) => {
        try {
          onFrame(JSON.parse(event.data));
        } catch (error) {
          // A frame this page cannot read is the other end's problem to fix,
          // and it is only findable if this end says one arrived.
          logEvent(LOG_AREA.relay, "Unreadable frame", String(error));
        }
      };
      // EventSource retries a transient failure by itself; a refusal closes it.
      source.onerror = () =>
        setLinkState(
          source.readyState === EventSource.CLOSED ? LINK.refused : LINK.lost,
        );
    };

    /**
     * The radio group, the address bar and the link hold one value, and this
     * is the only writer, so no two of them can disagree.
     */
    const syncLinkControls = () => {
      for (const input of roleInputs) input.checked = input.value === link.role;
      relayInput.disabled = !link.role;
      roomInput.disabled = !link.role;
      // A Console runs nothing itself, so the controls that would start
      // something locally say so rather than appearing to work.
      const refusal = refuseLocalMesh();
      for (const part of ["mesh-keys-open", "bluetooth-load-demo"]) {
        const control = /** @type {HTMLButtonElement} */ (
          find(`[data-part="${part}"]`)
        );
        if (!control) continue;
        control.disabled = Boolean(refusal);
        if (refusal) control.title = refusal;
        else control.removeAttribute("title");
      }
    };

    /** @param {string} role */
    const claimRole = (role) => {
      link.role = role;
      link.relay = relayInput.value.trim().replace(/\/$/, "");
      link.room = roomInput.value.trim();
      relayInput.value = link.relay;
      writeUrl({ role: link.role, relay: link.relay, room: link.room });
      closeLink();
      syncLinkControls();
      if (link.role) openLink();
      else setLinkState(LINK.idle);
      renderMesh();
    };

    for (const input of roleInputs)
      input.addEventListener("change", () => claimRole(input.value));
    // The address is typed after a role is chosen, so editing it rejoins.
    for (const input of [relayInput, roomInput])
      input.addEventListener("change", () => {
        if (link.role) claimRole(link.role);
      });
    reloadPeer.addEventListener("click", () => sendFrame(FRAME.reload));

    /* ---- Asking for a device from elsewhere ------------------------------ */

    /** @param {string} text @param {boolean} [accept] */
    const showChooserAsk = (text, accept = false) => {
      meshFind('[data-part="mesh-chooser-ask-text"]').textContent = text;
      chooserAccept.hidden = !accept;
      chooserAsk.hidden = false;
    };
    const hideChooserAsk = () => {
      chooserAsk.hidden = true;
      chooserAccept.hidden = true;
    };

    /**
     * The browser opens its chooser only for a page someone just used, so a
     * Console cannot open the Bridge's. It asks, and the Bridge offers.
     */
    const requestMeshDevice = () => {
      if (link.role !== "console") return void chooseDevice(meshChooser());
      if (!link.peer) return showChooserAsk(ASK.unattached);
      sendFrame(FRAME.ask);
      showChooserAsk(ASK.sent);
    };

    chooserAccept.addEventListener("click", () => {
      hideChooserAsk();
      void chooseDevice(meshChooser());
    });

    /* ---- Device manager -------------------------------------------------- */

    const onAdvertisement = (/** @type {any} */ event) => {
      const record = meshLocal.get(event.device.id);
      if (!record) {
        // An advertisement from a device this session never adopted is the
        // difference between a silent radio and a radio nobody is listening to.
        logEvent(
          LOG_AREA.gatt,
          "Advertisement from an unknown device",
          event.device.id,
        );
        return;
      }
      const identity = meshIdentity(event.serviceData);
      logEvent(
        LOG_AREA.gatt,
        "Advertisement received",
        identity
          ? `${event.device.id}: ${identity.state}${identity.identity ? `, ${identity.identity}` : ""}`
          : `${event.device.id}: no Mesh service data`,
      );
      // Heard, and carrying neither Mesh service: this is not a Mesh device,
      // which is a different fact from never having been heard from.
      if (!identity) {
        if (record.state === MESH_STATE.absent) return;
        record.state = MESH_STATE.absent;
        renderMesh();
        publishMesh();
        return;
      }
      Object.assign(record, identity);
      record.label = identity.uuid
        ? uuidLabel(identity.uuid)
        : event.device.name || record.label;
      renderMesh();
      publishMesh();
      // A node heard for the first time while keys are already held describes
      // itself now, rather than waiting to be asked a second time.
      if (record.state === MESH_STATE.provisioned && !record.composition) {
        record.condition = meshKeys ? record.condition : "unknownNetwork";
        void describeKnownNodes();
      }
    };

    /**
     * Adds one authorized device to the Mesh session and watches what it
     * advertises. Authorization stays the browser's; this stores no list.
     * @param {any} device
     */
    const trackDevice = async (device) => {
      meshDevices.set(device.id, device);
      if (!meshLocal.has(device.id))
        meshLocal.set(device.id, {
          id: device.id,
          label: device.name || "Unnamed device",
          state: MESH_STATE.silent,
          uuid: "",
          oob: null,
          identity: "",
        });
      renderMesh();
      publishMesh();
      if (typeof device.watchAdvertisements !== "function")
        return showMeshCapability("watchAdvertisements");
      device.addEventListener("advertisementreceived", onAdvertisement);
      try {
        await device.watchAdvertisements({ signal: watches.signal });
      } catch (error) {
        // A refused watch leaves the row silent, which is what the row says.
        logEvent(LOG_AREA.gatt, "Advertisement watch refused", String(error));
      }
    };

    /** Previously authorized devices, without opening the chooser. */
    const adoptAuthorized = async () => {
      if (!adapter || typeof adapter.getDevices !== "function")
        return showMeshCapability("getDevices");
      try {
        const known = await adapter.getDevices();
        for (const device of known) {
          listKnownDevice(device);
          await trackDevice(device);
        }
        if (known.length > 0) setStatus(SESSION.authorized);
      } catch (error) {
        logEvent(LOG_AREA.gatt, "getDevices refused", String(error));
        showMeshCapability("getDevices");
      }
    };

    loadStoredKeys();
    syncLinkControls();
    setLinkState(LINK.idle);
    renderMesh();
    if (link.role) openLink();
    void adoptAuthorized();

    detect().then((capability) => {
      if (!live) return;
      setStatus(RECOVERY[capability], capability !== "ready");
      page.setAttribute("data-state", capability);
      // Real-device actions stay visible so a user can fix Bluetooth and retry;
      // the click path gives the recovery message for known failures.
      root.append(style, page);
    });

    return () => {
      live = false;
      discardSession();
      closeProxyChannels();
      closeLink();
      watches.abort();
      gattSurface.disconnect();
      meshSurface.disconnect();
      style.remove();
      page.remove();
    };
  };

  panel.register({ title: "Bluetooth", mount });
}
