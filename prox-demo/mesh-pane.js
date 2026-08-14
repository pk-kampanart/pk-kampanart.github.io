/**
 * Owns the Mesh pane: open or collapsed to its rail, its width, which state
 * it shows, and the Nearby, Nodes and Log lists it draws from its engine. It
 * never talks to a device or a C API: everything goes through the MeshEngine
 * it is given (ADR-0042). Without one, or with one whose files are absent, it
 * cannot connect.
 * It also owns assign mode, the selected dot's card, each dot's node details,
 * and group Apply. All four read node data. Assignment remains a Plan command
 * (ADR-0010); Apply writes the network.
 * Channels: listens planner:selection-changed;
 * dispatches planner:selection-requested.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const OPEN_KEY = "mesh-planner:mesh-open";
  /** The part whose text says each state, so the copy lives in the markup. */
  const SAYS = {
    disk: "mesh-disk",
    unreachable: "mesh-unreachable",
    missing: "mesh-missing",
    offline: "mesh-connection-state",
    unplugged: "mesh-unplugged",
    connected: "mesh-connected-state",
  };
  /** The states that list nodes. */
  const LISTED = ["offline", "unplugged", "connected"];
  /** @type {MeshAddStep[]} */
  const STEPS = ["provision", "read", "appkey", "bind"];
  /** Each step status's mark, and the word a reader hears instead. */
  const MARKS = {
    pending: ["○", "not started"],
    running: ["◐", "in progress"],
    done: ["✓", "done"],
    failed: ["✗", "failed"],
  };
  // ponytail: the log keeps its last lines only; a bug report needs the recent ones.
  const LOG_LINES = 500;
  /** What a reader sees for each feature a node's composition lists. */
  const FEATURES = {
    proxy: "Proxy",
    relay: "Relay",
    friend: "Friend",
    lowPower: "Low power",
  };

  /** @returns {Promise<MeshPaneState>} */
  const reach = async (/** @type {MeshEngine | null} */ engine) => {
    if (location.protocol === "file:") return "disk";
    const browser = /** @type {{bluetooth?: unknown, serial?: unknown}} */ (
      navigator
    );
    // GATT needs Web Bluetooth and the dongle Web Serial; either reaches.
    if (!browser.bluetooth && !browser.serial) return "unreachable";
    if (!engine || (engine.installed && !(await engine.installed())))
      return "missing";
    return "offline";
  };

  /** @param {string} id */
  const shortId = (id) => `${id.slice(0, 4)}…${id.slice(-4)}`.toLowerCase();

  /** Four bars, never shown without the number beside them. @param {number} rssi */
  const bars = (rssi) =>
    "▂▄▆█"
      .slice(0, rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1)
      .padEnd(4, "_");

  /** @param {MeshNode} node */
  const nodeLabel = (node) =>
    `${node.name || shortId(node.id)} ${node.unicast}`;

  /** @param {number[]} channels */
  const channelsText = (channels) =>
    channels.map((number) => `Ch ${number}`).join(", ");

  /** @typedef {{id: string, floor: string, node: string, channels: number[]}} Held */

  /** Every assigned instance, with the floor it sits on. @param {PlanDocument} plan @returns {Held[]} */
  const heldIn = (plan) => {
    /** @type {Held[]} */
    const held = [];
    for (const floor of plan.floors)
      for (const application of floor.applications)
        for (const type of application.deviceTypes)
          for (const instance of type.instances)
            if (instance.assignment)
              held.push({
                id: instance.id,
                floor: floor.id,
                ...instance.assignment,
              });
    return held;
  };

  /** @param {Held[]} held @param {string} node @param {number} channel */
  const holderOf = (held, node, channel) =>
    held.find(
      (entry) => entry.node === node && entry.channels.includes(channel),
    );

  /** The channels no instance holds. @param {Held[]} held @param {MeshNode} node */
  const freeOf = (held, node) =>
    planner.meshChannels
      .of(node)
      .map((channel) => channel.number)
      .filter((number) => !holderOf(held, node.id, number));

  /** @param {Event} event */
  const claim = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  /** @param {number} count @param {string} noun */
  const counted = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

  /** @param {number} count */
  const nodesText = (count) => counted(count, "node");

  /** @param {MeshBackupState} backup */
  const backupAge = ({ at, changed }) => {
    if (at === null || changed) return "not backed up";
    const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
    if (minutes === 0) return "backup just now";
    if (minutes < 60) return "backup " + minutes + " min ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return "backup " + hours + " h ago";
    return "backup " + Math.floor(hours / 24) + " days ago";
  };

  /** @param {unknown} error */
  const reason = (error) =>
    error instanceof Error ? error.message : String(error);

  /** Only what a reader hears: aria-hidden glyphs stay out. @param {Element | null} element */
  const spoken = (element) =>
    [...(element?.childNodes || [])]
      .filter(
        (node) =>
          !(node instanceof Element) ||
          node.getAttribute("aria-hidden") !== "true",
      )
      .map((node) => node.textContent)
      .join("")
      .replace(/\s+/g, " ")
      .trim();

  /** @param {string} name @returns {HTMLElement} */
  const cloneOf = (name) => {
    const template = /** @type {HTMLTemplateElement | null} */ (
      document.querySelector(`[data-part="${name}"]`)
    );
    const root = template?.content.firstElementChild;
    if (!root) throw new Error(`${name} is missing`);
    return /** @type {HTMLElement} */ (root.cloneNode(true));
  };

  /** @param {MeshPaneOptions} options */
  const create = (options) => {
    if (
      !options?.pane ||
      !options.storage ||
      !options.store ||
      !options.registry ||
      !options.drawing
    )
      throw new TypeError(
        "mesh pane requires pane, storage, store, registry and drawing",
      );
    const { pane, storage, store, registry, drawing } = options;
    const engine = options.engine || null;
    /** @param {string} name */
    const part = (name) =>
      /** @type {HTMLElement | null} */ (
        pane.querySelector(`[data-part="${name}"]`)
      );
    const rail = part("mesh-rail");
    const collapse = part("mesh-collapse");
    const announcer = part("mesh-announcer");
    const connectButton = /** @type {HTMLButtonElement | null} */ (
      part("mesh-connect")
    );
    const disconnectButton = part("mesh-disconnect");
    const networkRow = part("mesh-network-row");
    const networkLine = part("mesh-network");
    const networkValue = part("mesh-network-value");
    const networkToggle = /** @type {HTMLElement | null} */ (
      networkRow?.querySelector('[data-part="tree-props-toggle"]') || null
    );
    const networkMenu = /** @type {HTMLElement | null} */ (
      networkRow?.querySelector('[data-part="tree-props-popover"]') || null
    );
    const exportButton = /** @type {HTMLButtonElement | null} */ (
      part("mesh-export")
    );
    const importButton = /** @type {HTMLButtonElement | null} */ (
      part("mesh-import")
    );
    const importFile = /** @type {HTMLInputElement | null} */ (
      part("mesh-import-file")
    );
    const importConfirm = part("mesh-import-confirm");
    const importPrompt = part("mesh-import-prompt");
    const importReplace = /** @type {HTMLButtonElement | null} */ (
      part("mesh-import-replace")
    );
    const importCancel = part("mesh-import-cancel");
    const importError = part("mesh-import-error");
    const reconnectButton = /** @type {HTMLButtonElement | null} */ (
      part("mesh-reconnect")
    );
    const via = /** @type {HTMLSelectElement | null} */ (part("mesh-via"));
    const pickButton = /** @type {HTMLButtonElement | null} */ (
      part("mesh-pick")
    );
    const nearbyList = part("mesh-nearby-list");
    const nodeList = part("mesh-node-list");
    const show = /** @type {HTMLSelectElement | null} */ (part("mesh-show"));
    const logBlock = /** @type {HTMLDetailsElement | null} */ (
      part("mesh-log")
    );
    const logText = part("mesh-log-text");
    const listening = new AbortController();
    const { signal } = listening;
    const announce = (/** @type {string} */ text) => {
      if (announcer) announcer.textContent = text;
    };
    /** @type {MeshPaneState | ""} */
    let state = "";
    // Connect is loading the engine.
    let loading = false;
    // The transport of the current or lost connection, and whether it lists
    // nearby devices live.
    /** @type {MeshTransport | ""} */
    let over = "";
    let live = true;
    let open = storage.getItem(OPEN_KEY) !== "false";

    // A saved page carries the lists it was saved with; they are session state.
    nearbyList?.replaceChildren();
    nodeList?.replaceChildren();

    /** @param {string} name @param {string} text */
    const write = (name, text) => {
      const element = part(name);
      if (element) element.textContent = text;
    };

    const reflect = () => {
      const gatt =
        over === "gatt" && ["connected", "unplugged"].includes(state);
      const noScan = state === "connected" && !live;
      const connected = state === "connected";
      const unplugged = state === "unplugged";
      const reached = ["offline", "unplugged", "connected"].includes(state);
      // The pane-level parts each state shows, derived here rather than in CSS.
      /** @type {Record<string, boolean>} */
      const shown = {
        "mesh-disk": state === "disk",
        "mesh-unreachable": state === "unreachable",
        "mesh-missing": state === "missing",
        "mesh-connection": reached,
        "mesh-nodes": reached,
        "mesh-log": reached,
        "mesh-unplugged": unplugged && !gatt,
        "mesh-unreached": unplugged && gatt,
        "mesh-reconnect": unplugged,
        "mesh-pick": gatt,
        "mesh-scan-hint": noScan,
        "mesh-scanning": !noScan,
        "mesh-connection-state": !unplugged && !connected && !loading,
        "mesh-connect": !unplugged && !connected,
        "mesh-loading": loading,
        "mesh-nearby": connected,
        "mesh-connected-state": connected,
        "mesh-disconnect": connected,
      };
      for (const [name, visible] of Object.entries(shown)) {
        const element = part(name);
        if (element) element.hidden = !visible;
      }
      pane.setAttribute(
        "data-state",
        `${open ? "open" : "collapsed"}${state ? ` ${state}` : ""}${
          loading ? " loading" : ""
        }${armed ? " assigning" : ""}${gatt ? " gatt" : ""}${
          noScan ? " no-scan" : ""
        }`,
      );
      document
        .querySelector('[data-part="toolbar-mesh"]')
        ?.setAttribute("aria-pressed", String(open));
      const listed = LISTED.includes(state);
      const count = listed ? ` (${nodesText(nodeRows.size)})` : "";
      write("mesh-rail-count", count);
      rail?.setAttribute("aria-label", `Open the Mesh pane${count}`);
    };

    /** @param {MeshPaneState} value */
    const enter = (value) => {
      state = value;
      reflect();
      decorate();
      void updateNetwork();
      announce(
        spoken(
          part(
            value === "unplugged" && over === "gatt"
              ? "mesh-unreached"
              : SAYS[value],
          ),
        ),
      );
    };

    // Measured open, so an unstored width is the stylesheet's, not the rail's.
    pane.setAttribute("data-state", "open");
    const width = planner.panelWidth.create({
      root: document.documentElement,
      workspace: options.workspace,
      splitter: options.splitter,
      panel: pane,
      surface: options.surface,
      storage,
      key: "mesh-planner:mesh-width",
      property: "--mesh-width",
      minimum: "--mesh-min-width",
      edge: "end",
    });

    const toggle = () => {
      // The splitter leaves the grid with the pane, so its focus goes too.
      const inside =
        pane.contains(document.activeElement) ||
        document.activeElement === options.splitter;
      open = !open;
      try {
        storage.setItem(OPEN_KEY, String(open));
      } catch {
        // Browser storage can be unavailable; preferences are best-effort.
      }
      reflect();
      announce(open ? "Mesh pane shown" : "Mesh pane hidden");
      // Focus inside the pane would fall to the body with the part it sat in.
      if (inside) (open ? collapse : rail)?.focus();
      return true;
    };

    // ---- Log ----------------------------------------------------------------

    /** @type {string[]} */
    const lines = [];
    /** @param {string} text */
    const log = (text) => {
      lines.push(text);
      if (lines.length > LOG_LINES) lines.shift();
      if (logText) logText.textContent = lines.join("\n");
    };

    // ---- Nodes --------------------------------------------------------------

    /** @type {MeshNode[]} */
    let nodes = [];
    /** @type {Map<string, {node: MeshNode, row: HTMLElement}>} */
    const nodeRows = new Map();
    /** What each button and slider does, rebound on every draw. */
    /** @type {WeakMap<Element, () => void>} */
    const actions = new WeakMap();
    /** What each element was last heard to report: session state. */
    /** @type {Map<string, Omit<MeshState, "address">>} */
    const reported = new Map();
    /** The node and key names each row last drew its Models from. */
    /** @type {WeakMap<Element, {node: MeshNode, names: string}>} */
    const modelsDrawn = new WeakMap();

    /** @param {string} what @param {Promise<void>} sending */
    const send = (what, sending) =>
      void sending.catch((error) => {
        log(`${what} failed: ${reason(error)}`);
        announce(`${what} failed: ${reason(error)}.`);
      });

    const blinks = (node) =>
      Boolean(
        engine?.capabilities.has("blink") &&
          (node.attention || planner.meshChannels.onOffs(node).length > 0),
      );
    const blink = (node) => {
      if (!engine) return;
      announce(`Blinking ${nodeLabel(node)}`);
      send("Blink", engine.blink(node.unicast));
    };

    /** Fills one channel's controls: its pane row and its dot's card share them.
     * A control the node's models or the engine cannot drive is absent.
     * @param {HTMLElement} block @param {MeshNode} node @param {MeshChannel} channel */
    const fillControls = (block, node, channel) => {
      const drives = planner.meshChannels.drives(node, channel);
      /** @param {keyof MeshDrives} control @param {string} capability */
      const driven = (control, capability) =>
        (engine?.capabilities.has(capability) && drives[control]) || "";
      const onoff = driven("onoff", "onoff");
      const lightness = driven("lightness", "lightness");
      const temperature = driven("temperature", "ctl");
      block.hidden = !engine || !(onoff || lightness || temperature);
      if (!engine || block.hidden) return;
      const label = `${nodeLabel(node)} channel ${channel.number}`;
      block.setAttribute("aria-label", label);
      say(block, "mesh-controls-name", `Ch ${channel.number}`);

      const onoffPart = inRow(block, "mesh-onoff");
      if (onoffPart) onoffPart.hidden = !onoff;
      if (onoff) {
        const on = reported.get(onoff)?.on;
        say(block, "mesh-onoff-mark", on === undefined ? "" : on ? "●" : "○");
        say(
          block,
          "mesh-onoff-state",
          on === undefined ? "unknown" : on ? "on" : "off",
        );
        for (const [name, value] of /** @type {const} */ ([
          ["mesh-on", true],
          ["mesh-off", false],
        ])) {
          const button = inRow(block, name);
          if (!button) continue;
          button.setAttribute(
            "aria-label",
            `Turn ${value ? "on" : "off"} ${label}`,
          );
          actions.set(button, () => send("On/Off", engine.onOff(onoff, value)));
        }
      }

      /** @param {string} name @param {string} address @param {number | undefined} value @param {string} unit @param {(address: string, value: number) => Promise<void>} set */
      const slider = (name, address, value, unit, set) => {
        const control = inRow(block, name);
        if (!control) return;
        control.hidden = !address;
        const input = control.querySelector("input");
        if (!address || !input) return;
        const title =
          control
            .querySelector('[data-part="mesh-control-name"]')
            ?.textContent?.trim() || "";
        input.setAttribute("aria-label", `${title} ${label}`);
        // A heard value never yanks a slider out from under its user.
        if (value !== undefined && document.activeElement !== input)
          input.value = String(value);
        say(
          control,
          "mesh-control-value",
          value === undefined ? "unknown" : `${value} ${unit}`,
        );
        actions.set(input, () =>
          send(title, set(address, input.valueAsNumber)),
        );
      };
      slider(
        "mesh-lightness",
        lightness,
        reported.get(lightness)?.lightness,
        "%",
        (address, value) => engine.lightness(address, value),
      );
      if (temperature) {
        // Asked once per connection: reported clears with the transport.
        if (
          state === "connected" &&
          reported.get(temperature)?.temperatureRange === undefined
        ) {
          reported.set(temperature, {
            ...reported.get(temperature),
            temperatureRange: null,
          });
          engine.temperatureRange(temperature).then(
            (range) => {
              if (!range) return;
              reported.set(temperature, {
                ...reported.get(temperature),
                temperatureRange: range,
              });
              draw();
            },
            (error) => {
              reported.set(temperature, {
                ...reported.get(temperature),
                temperatureRange: undefined,
              });
              log(`Temperature range failed: ${reason(error)}`);
            },
          );
        }
        const input = inRow(block, "mesh-temperature")?.querySelector("input");
        if (input) {
          // A server that names no range clamps to its own.
          const { min, max } = reported.get(temperature)?.temperatureRange || {
            min: 800,
            max: 20000,
          };
          input.min = String(min);
          input.max = String(max);
          // The largest whole step up to 100 K that divides the span, so both
          // ends are reachable.
          let step = 100;
          while ((max - min) % step) step -= 1;
          input.step = String(step);
          // Moving the bounds pins an unheard slider to an end.
          if (
            reported.get(temperature)?.temperature === undefined &&
            document.activeElement !== input
          )
            input.value = String(
              min + step * Math.round((max - min) / 2 / step),
            );
        }
      }
      slider(
        "mesh-temperature",
        temperature,
        reported.get(temperature)?.temperature,
        "K",
        (address, value) => engine.temperature(address, value),
      );
    };

    /** A node's elements and models, grouped by channel. @param {HTMLElement} row @param {MeshNode} node @param {MeshChannel[]} channels */
    const drawModels = (row, node, channels) => {
      const keyNames = keysNamed(store.read());
      const names = JSON.stringify(keyNames);
      const drawn = modelsDrawn.get(row);
      if (drawn?.node === node && drawn.names === names) return;
      modelsDrawn.set(row, { node, names });
      say(
        row,
        "mesh-model-count",
        String(node.elements.flatMap((element) => element.models).length),
      );
      row.querySelector('[data-part="mesh-model-elements"]')?.replaceChildren(
        ...node.elements.map((element, index) => {
          const channel = channels.find((entry) =>
            entry.elements.includes(element.address),
          );
          const item = cloneOf("mesh-element-template");
          say(
            item,
            "mesh-element-name",
            [
              channel && `Ch ${channel.number}`,
              `Element ${index}`,
              element.address,
            ]
              .filter(Boolean)
              .join(" · "),
          );
          item.querySelector('[data-part="mesh-element-models"]')?.append(
            ...element.models.map((model) => {
              const line = cloneOf("mesh-model-template");
              const [name, keys, routes] = planner.meshChannels.modelCells(
                model,
                keyNames,
              );
              say(line, "mesh-model-name", name);
              say(line, "mesh-model-keys", keys);
              say(line, "mesh-model-routes", routes);
              return line;
            }),
          );
          return item;
        }),
      );
    };

    /** @param {MeshNode} node @param {Held[]} held */
    const shows = (node, held) => {
      if (show?.value === "unassigned") return freeOf(held, node).length > 0;
      if (show?.value === "floor") {
        const floor = drawing.getAttribute("data-active-floor");
        return held.some(
          (entry) => entry.node === node.id && entry.floor === floor,
        );
      }
      return true;
    };

    const filter = (held = heldIn(store.read())) => {
      let visible = 0;
      for (const { node, row } of nodeRows.values()) {
        row.hidden = !shows(node, held);
        if (!row.hidden) visible += 1;
      }
      part("mesh-nodes-empty")?.toggleAttribute("hidden", visible > 0);
    };

    /** Unchanged text is not rewritten: the tree's observers would hear it.
     * @param {HTMLElement} item @param {string} name @param {string} text */
    const say = (item, name, text) => {
      const element = item.querySelector(`[data-part="${name}"]`);
      if (element && element.textContent !== text) element.textContent = text;
    };

    /** @param {MeshNode} node @param {PlanDocument} plan @param {Held[]} held */
    const nodeRow = (node, plan, held) => {
      const row = nodeRows.get(node.id)?.row || cloneOf("mesh-node-template");
      nodeRows.set(node.id, { node, row });
      row.setAttribute("data-id", node.id);
      const label = nodeLabel(node);
      // Named by the dots holding it, else as advertised.
      const holders = held
        .filter((entry) => entry.node === node.id)
        .map((entry) => planner.devices.instanceLabel(plan, entry.id));
      const first = held.find((entry) => entry.node === node.id);
      const line = lineOf(row);
      const name = inRow(row, "mesh-node-name");
      // An assigned row selects its instance; an unassigned one only
      // discloses, so its name leaves the tab order to the summary.
      for (const target of [line, name])
        if (target && first) actions.set(target, () => select(first.id));
        else if (target) actions.delete(target);
      if (name) {
        name.tabIndex = first ? 0 : -1;
        if (!first)
          actions.set(name, () => {
            /** @type {HTMLDetailsElement} */ (row).open = !(
              /** @type {HTMLDetailsElement} */ (row).open
            );
          });
      }
      say(
        row,
        "mesh-node-name",
        holders.length > 0
          ? holders.join(", ")
          : `${node.name || shortId(node.id)} · ${node.unicast}`,
      );
      // Hover does not switch floors, so name dots on other floors here.
      const active = drawing.getAttribute("data-active-floor");
      const away = new Set(
        held
          .filter((entry) => entry.node === node.id && entry.floor !== active)
          .map((entry) => entry.floor),
      );
      say(
        row,
        "mesh-node-floor",
        away.size > 0
          ? `· ${plan.floors
              .filter((floor) => away.has(floor.id))
              .map((floor) => floor.name)
              .join(", ")}`
          : "",
      );
      const flag = inRow(row, "mesh-node-conflict");
      if (flag)
        flag.hidden = !held.some(
          (entry) => entry.node === node.id && conflicted.has(entry.id),
        );
      const menu = /** @type {HTMLElement | null} */ (
        line?.querySelector('[data-part="tree-props-popover"]') || null
      );
      const menuToggle = inRow(row, "tree-props-toggle");
      if (menu && menuToggle) {
        menuToggle.popoverTargetElement = menu;
        menuToggle.setAttribute("aria-label", `Menu ${label}`);
        menuToggle.title = "Node menu";
        menu.setAttribute("aria-label", `Menu ${label}`);
      }
      say(
        row,
        "mesh-node-features",
        [
          node.features.map((feature) => `${FEATURES[feature]} ✓`).join(" "),
          counted(node.elements.length, "element"),
        ]
          .filter(Boolean)
          .join(" · "),
      );
      const free = freeOf(held, node);
      const assign = /** @type {HTMLButtonElement | null} */ (
        line?.querySelector(':scope > [data-part="mesh-assign"]') || null
      );
      if (assign && line) {
        assign.hidden = free.length === 0;
        assign.setAttribute("aria-label", `Assign ${label}`);
        actions.set(assign, () => arm(assign, line, node, free));
      }
      const blinkButton = inRow(row, "mesh-blink");
      if (blinkButton) {
        blinkButton.hidden = !blinks(node);
        blinkButton.setAttribute("aria-label", `Blink ${label}`);
        actions.set(blinkButton, () => blink(node));
      }
      const list = row.querySelector('[data-part="mesh-channels"]');
      if (!list) return row;
      const channels = planner.meshChannels.of(node);
      drawModels(row, node, channels);
      // Rows are reused, so a focused button survives an undo.
      while (list.children.length > channels.length)
        list.lastElementChild?.remove();
      while (list.children.length < channels.length) {
        const item = cloneOf("mesh-channel-template");
        item.append(cloneOf("mesh-controls-template"));
        list.append(item);
      }
      channels.forEach((channel, index) => {
        const { number } = channel;
        const item = /** @type {HTMLElement} */ (list.children[index]);
        const itemLine = inRow(item, "tree-line");
        const controls = inRow(item, "mesh-controls");
        if (controls) fillControls(controls, node, channel);
        const holder = holderOf(held, node.id, number);
        const name = holder
          ? planner.devices.instanceLabel(plan, holder.id) || ""
          : "";
        say(item, "mesh-channel-name", `Ch ${number}`);
        say(item, "mesh-channel-mark", holder ? "⇢" : "○");
        say(item, "mesh-channel-holder", holder ? name : "unassigned");
        if (itemLine && holder) actions.set(itemLine, () => select(holder.id));
        else if (itemLine) actions.delete(itemLine);
        const channelAssign = inRow(item, "mesh-assign");
        if (channelAssign && itemLine) {
          channelAssign.hidden = Boolean(holder);
          channelAssign.setAttribute(
            "aria-label",
            `Assign ${label} channel ${number}`,
          );
          actions.set(channelAssign, () =>
            arm(channelAssign, itemLine, node, [number]),
          );
        }
        const unassign = inRow(item, "mesh-unassign");
        if (unassign) {
          unassign.hidden = !holder;
          unassign.setAttribute(
            "aria-label",
            `Unassign ${label} channel ${number}`,
          );
          actions.set(unassign, () => {
            if (!holder) return;
            registry.dispatch({
              entity: "deviceInstance",
              action: "unassign",
              id: holder.id,
              value: { channels: [number] },
            });
            channelAssign?.focus();
            announce(`${label} Ch ${number} unassigned from ${name}`);
          });
        }
      });
      return row;
    };

    const draw = () => {
      if (!nodeList) return;
      const plan = store.read();
      const held = heldIn(plan);
      conflicted = planner.meshLinks.conflicts(plan, nodes);
      changes = pubsub
        ? planner.meshLinks.pending(plan, nodes, record.groups)
        : new Map();
      const rows = nodes.map((node) => nodeRow(node, plan, held));
      for (const [id, { row }] of nodeRows)
        if (!nodes.some((node) => node.id === id)) {
          row.remove();
          nodeRows.delete(id);
        }
      // Moving a row drops its focus, so rows already in order stay put.
      if (rows.some((row, index) => nodeList.children[index] !== row))
        nodeList.append(...rows);
      write("mesh-node-count", String(rows.length));
      filter(held);
      if (armed && !nodeRows.has(armed.node.id)) disarm();
      reflect();
      drawGroups(plan);
      decorate(plan, held);
      drawCard();
    };

    const updateNetwork = async () => {
      const visible = Boolean(engine && LISTED.includes(state));
      if (networkRow) networkRow.hidden = !visible;
      if (!visible || !engine || !networkValue) return;
      const project = store.read().project;
      const backup = await engine.backedUp();
      if (signal.aborted || store.read().project.id !== project.id) return;
      networkValue.textContent =
        project.name +
        " · " +
        nodesText(nodes.length) +
        " · " +
        backupAge(backup);
      if (backup.at === null || backup.changed)
        networkLine?.setAttribute("data-state", "warning");
      else networkLine?.removeAttribute("data-state");
    };

    const renderNodes = async () => {
      if (!engine) return;
      if (pubsub) record = await engine.record();
      nodes = await engine.nodes();
      draw();
      await updateNetwork();
    };

    // ---- Groups -------------------------------------------------------------

    const pubsub = Boolean(engine?.capabilities.has("pubsub"));
    /** @type {MeshRecord} */
    let record = { groups: {}, keys: {} };
    /** Each group's pending changes, derived on every draw. */
    /** @type {Map<string, MeshLinkChange[]>} */
    let changes = new Map();
    /** Conflicted instances, derived on every draw. */
    /** @type {Set<string>} */
    let conflicted = new Set();
    /** Each group's last Apply, [mark, text] per write, until its next Apply.
     * The key "" is the deleted groups. Session state. */
    /** @type {Map<string, [string, string][]>} */
    const results = new Map();
    /** The group whose Apply is writing; one at a time. */
    /** @type {string | null} */
    let applying = null;
    const deletedSlot = part("mesh-deleted-groups");
    // Saved pages can carry a stale deleted-groups block.
    deletedSlot?.replaceChildren();
    /** Verbs for successful writes, failed additions and failed removals. */
    const WRITES = {
      publish: ["publishes", "publish", "stop publishing"],
      subscribe: ["subscribes", "subscribe", "stop subscribing"],
    };

    /** Application names by AppKey index, for the Models list. @param {PlanDocument} plan */
    const keysNamed = (plan) => {
      /** @type {Record<number, string>} */
      const names = {};
      for (const floor of plan.floors)
        for (const application of floor.applications)
          if (record.keys[application.id])
            names[record.keys[application.id]] = application.name;
      return names;
    };

    /** Groups the engine holds an address for that the plan no longer has.
     * @param {PlanDocument} plan */
    const deletedIn = (plan) => {
      const kept = new Set(
        plan.floors.flatMap((floor) =>
          floor.applications.flatMap((application) =>
            application.groups.map((group) => group.id),
          ),
        ),
      );
      return Object.keys(record.groups).filter((id) => !kept.has(id));
    };

    /** @param {string} key @param {PlanDocument} plan */
    const changesOf = (key, plan) =>
      key
        ? changes.get(key) || []
        : deletedIn(plan).flatMap((id) => changes.get(id) || []);

    const applyBlock = () => {
      const block = cloneOf("mesh-apply-template");
      // Inside a tree row, a click here must not select or clear the group.
      block.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
          const button = /** @type {Element} */ (event.target).closest(
            "button",
          );
          if (button) actions.get(button)?.();
        },
        { signal },
      );
      return block;
    };

    /** `freeing` counts deleted groups whose address Apply would free.
     * @param {HTMLElement} block @param {string} key @param {string} name
     * @param {MeshLinkChange[]} list @param {number} [freeing] */
    const fillApply = (block, key, name, list, freeing = 0) => {
      const lines = results.get(key);
      const due = list.length > 0 || freeing > 0;
      block.hidden = !due && !lines;
      say(
        block,
        "mesh-pending",
        `${key ? "Mesh" : "Deleted groups"}: ${
          list.length > 0
            ? `${counted(list.length, "change")} pending`
            : freeing > 0
              ? "nothing left to remove"
              : "up to date"
        }`,
      );
      const button = inRow(block, "mesh-apply");
      if (button) {
        button.hidden = state !== "connected" || (!due && applying !== key);
        button.disabled = applying !== null;
        button.setAttribute("aria-label", `Apply ${name}`);
        actions.set(button, () => void apply(key, name));
      }
      const out = inRow(block, "mesh-apply-results");
      if (!out) return;
      out.hidden = !lines;
      out.setAttribute("aria-label", `Mesh changes applied to ${name}`);
      if (out.children.length > (lines?.length || 0)) out.replaceChildren();
      for (const [mark, text] of lines?.slice(out.children.length) || []) {
        const item = cloneOf("mesh-apply-result-template");
        say(item, "mesh-apply-mark", mark);
        say(item, "mesh-apply-text", text);
        out.append(item);
      }
    };

    /** Draws group rows and the shared deleted-groups block.
     * @param {PlanDocument} plan */
    const drawGroups = (plan) => {
      if (!pubsub) return;
      const names = new Map(
        plan.floors.flatMap((floor) =>
          floor.applications.flatMap((application) =>
            application.groups.map((group) => [group.id, group.name]),
          ),
        ),
      );
      for (const row of document.querySelectorAll(
        '[data-anchor="group"][data-part="tree-line"]',
      )) {
        const id = row.getAttribute("data-id") || "";
        const block = /** @type {HTMLElement} */ (
          row.querySelector(':scope > [data-part="mesh-apply-block"]') ||
            row.appendChild(applyBlock())
        );
        fillApply(block, id, names.get(id) || "", changesOf(id, plan));
      }
      if (!deletedSlot) return;
      const block = /** @type {HTMLElement} */ (
        deletedSlot.firstElementChild || deletedSlot.appendChild(applyBlock())
      );
      fillApply(
        block,
        "",
        "deleted groups",
        changesOf("", plan),
        deletedIn(plan).length,
      );
      deletedSlot.hidden = block.hidden;
    };

    /** Writes changes in order and reports each result. Deleted-group Apply
     * frees an address only if all removals for that group succeed.
     * @param {string} key @param {string} name */
    const apply = async (key, name) => {
      const plan = store.read();
      const list = changesOf(key, plan);
      const gone = key ? [] : deletedIn(plan);
      if (!engine || applying !== null || list.length + gone.length === 0)
        return;
      const block = key
        ? document.querySelector(
            `[data-anchor="group"][data-id="${CSS.escape(key)}"] > [data-part="mesh-apply-block"]`,
          )
        : deletedSlot?.firstElementChild;
      const focused = Boolean(block?.contains(document.activeElement));
      applying = key;
      /** @type {[string, string][]} */
      const lines = [];
      results.set(key, lines);
      draw();
      const failed = new Set();
      const held = heldIn(plan);
      for (const change of list) {
        const holder = holderOf(held, change.node, change.channel);
        const who = `${
          holder
            ? planner.devices.instanceLabel(plan, holder.id)
            : `${nodeName(change.node)} Ch ${change.channel}`
        } ${planner.meshChannels.modelName(change.model)}`;
        const [does, act, undo] = WRITES[change.role];
        try {
          const address = await engine.link(change);
          lines.push([
            "✓",
            `${who} ${change.on ? "" : "no longer "}${does} ${address}`,
          ]);
        } catch (error) {
          failed.add(change.group);
          lines.push([
            "✗",
            `${who} could not ${change.on ? act : undo}: ${reason(error)}`,
          ]);
        }
        log(`Apply ${name}: ${lines.at(-1)?.[1]}`);
        draw();
      }
      for (const group of gone)
        if (!failed.has(group))
          await engine.free(group).catch((error) => {
            log(`Freeing a deleted group failed: ${reason(error)}`);
          });
      applying = null;
      await renderNodes();
      const missed = lines.filter(([mark]) => mark === "✗").length;
      // Disabling the focused button drops focus. Restore it, or focus the
      // results list if Apply is now hidden.
      if (focused && block && !block.contains(document.activeElement)) {
        const button = inRow(/** @type {HTMLElement} */ (block), "mesh-apply");
        /** @type {HTMLElement | null} */ (
          button && !button.hidden
            ? button
            : block.querySelector('[data-part="mesh-apply-results"]')
        )?.focus();
      }
      announce(
        list.length > 0
          ? `${name}: ${list.length - missed} of ${counted(list.length, "change")} applied${
              missed > 0 ? `, ${missed} failed` : ""
            }`
          : `${name}: addresses freed`,
      );
    };

    // ---- Assignment -----------------------------------------------------------

    /** The armed Assign: what it takes, and the row focus returns to. */
    /** @type {{button: HTMLButtonElement, row: HTMLElement, node: MeshNode, channels: number[]} | null} */
    let armed = null;

    const dots = () =>
      /** @type {SVGElement[]} */ ([
        ...drawing.querySelectorAll('[data-part="surface-device"]'),
      ]);

    /** @param {string} id */
    const select = (id) =>
      document.dispatchEvent(
        new CustomEvent("planner:selection-requested", {
          detail: { kind: "device", id },
        }),
      );

    /** @param {string} id */
    const nodeName = (id) => {
      const node = nodes.find((entry) => entry.id === id);
      return node ? nodeLabel(node) : shortId(id);
    };

    const disarm = (back = false) => {
      if (!armed) return;
      const { button } = armed;
      armed = null;
      button.setAttribute("aria-pressed", "false");
      reflect();
      drawCard();
      if (back) button.focus();
    };

    /** Like placing a device type, assign mode claims the click (ADR-0022).
     * @param {HTMLButtonElement} button @param {HTMLElement} row @param {MeshNode} node @param {number[]} channels */
    const arm = (button, row, node, channels) => {
      const again = armed?.button === button;
      disarm();
      if (again) return;
      armed = { button, row, node, channels };
      button.setAttribute("aria-pressed", "true");
      reflect();
      drawCard();
      const held = heldIn(store.read());
      const here = dots();
      (
        here.find(
          (dot) =>
            !held.some((entry) => entry.id === dot.getAttribute("data-id")),
        ) || here[0]
      )?.focus();
    };

    /** @param {Element} dot */
    const assignTo = (dot) => {
      if (!armed) return;
      const id = dot.getAttribute("data-id") || "";
      const plan = store.read();
      const name = planner.devices.instanceLabel(plan, id) || "the device";
      const { node, channels, row } = armed;
      const current = heldIn(plan).find((entry) => entry.id === id);
      if (
        current &&
        current.node !== node.id &&
        !window.confirm(
          `${name} has ${nodeName(current.node)}. Replace it with ${nodeLabel(node)}?`,
        )
      )
        return;
      registry.dispatch({
        entity: "deviceInstance",
        action: "assign",
        id,
        value: { node: node.id, channels },
      });
      disarm();
      row.focus();
      announce(
        `${nodeLabel(node)} ${channelsText(channels)} assigned to ${name}`,
      );
    };

    /** @param {Event} event */
    const dotOf = (event) => {
      const { shape } = planner.surfaceSelect.entityAt(
        drawing,
        /** @type {MouseEvent} */ (event),
      );
      return shape?.getAttribute("data-part") === "surface-device"
        ? shape
        : null;
    };

    /** @param {Event} event */
    const claimClick = (event) => {
      // After a pan the surface swallows the click itself.
      if (!armed || drawing.hasAttribute("data-suppress-click")) return;
      claim(event);
      const dot = dotOf(event);
      if (dot) assignTo(dot);
    };

    /** @param {Event} event */
    const claimKey = (event) => {
      if (!armed) return;
      const { key } = /** @type {KeyboardEvent} */ (event);
      if (key === "Escape") {
        claim(event);
        disarm(true);
        return;
      }
      const target = /** @type {Element} */ (event.target);
      if (!drawing.contains(target)) return;
      const dot = target.closest('[data-part="surface-device"]');
      if (dot && (key === "Enter" || key === " ")) {
        claim(event);
        assignTo(dot);
      } else if (key.startsWith("Arrow")) {
        // Arrows walk the dots here rather than nudge one.
        claim(event);
        const here = dots();
        const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
        const from = dot ? here.indexOf(/** @type {SVGElement} */ (dot)) : -1;
        here[(from + step + here.length) % here.length]?.focus();
      }
    };

    // ---- Dots -----------------------------------------------------------------

    /** Pins a part of the surface region to a dot's edges.
     * @param {HTMLElement} element @param {Element} dot */
    const beside = (element, dot) => {
      const box = dot.getBoundingClientRect();
      const host = element.parentElement?.getBoundingClientRect();
      if (!host) return;
      element.style.setProperty("--dot-left", `${box.left - host.left}px`);
      element.style.setProperty("--dot-right", `${box.right - host.left}px`);
      element.style.setProperty("--dot-top", `${box.top - host.top}px`);
    };

    // A saved page already carries the detail and the card.
    const region = options.surface || drawing.parentElement;
    const detail = /** @type {HTMLElement | null} */ (
      region?.querySelector('[data-part="mesh-dot-detail"]') ||
        region?.appendChild(cloneOf("mesh-dot-detail-template")) ||
        null
    );
    let told = "";

    /** Shows the dot's name on the plan; this is its only visible text.
     * @param {string} [id] */
    const tell = (id = told) => {
      told = id;
      const dot = id
        ? drawing.querySelector(
            `[data-part="surface-device"][data-id="${CSS.escape(id)}"]`,
          )
        : null;
      if (!detail) return;
      detail.hidden = !dot;
      if (!dot) return;
      detail.textContent = dot.getAttribute("aria-label");
      beside(detail, dot);
      // Centred over the dot, but never past the region's edges.
      const box = dot.getBoundingClientRect();
      const host = detail.parentElement?.getBoundingClientRect();
      if (!host) return;
      const left =
        (box.left + box.right) / 2 - host.left - detail.offsetWidth / 2;
      detail.style.setProperty(
        "--detail-left",
        `${Math.max(0, Math.min(left, host.width - detail.offsetWidth))}px`,
      );
    };

    /** Writes what the mesh knows onto each dot: its channels' role, whether
     * it is on and heard, a conflict, and a name that says all of it.
     * @param {PlanDocument} [plan] @param {Held[]} [held] */
    const decorate = (plan = store.read(), held = heldIn(plan)) => {
      const heard = state === "connected";
      const additions = [...changes.values()]
        .flat()
        .filter((change) => change.on);
      for (const dot of dots()) {
        const id = dot.getAttribute("data-id") || "";
        const holding = held.find((entry) => entry.id === id);
        const node = nodes.find((entry) => entry.id === holding?.node);
        const channels = node
          ? planner.meshChannels
              .of(node)
              .filter((channel) => holding?.channels.includes(channel.number))
          : [];
        const input =
          channels.length > 0 &&
          channels.every((channel) => channel.role === "input");
        const states = channels
          .map(
            (channel) =>
              node &&
              reported.get(
                planner.meshChannels.drives(node, channel).onoff || "",
              )?.on,
          )
          .filter((on) => on !== undefined);
        const on = states.some(Boolean);
        const conflict = conflicted.has(id);
        const pending = additions.some(
          (change) =>
            change.node === holding?.node &&
            holding.channels.includes(change.channel),
        );
        for (const [token, value] of /** @type {const} */ ([
          ["output", channels.length > 0 && !input],
          ["input", input],
          ["on", on],
          ["unheard", Boolean(holding) && !heard],
          ["conflict", conflict],
          ["pending", pending],
        ]))
          planner.dom.state(dot, token, value);
        if (!holding) continue;
        dot.setAttribute(
          "aria-label",
          [
            planner.devices.instanceLabel(plan, id),
            ...holding.channels.map(
              (number) => `${nodeName(holding.node)} channel ${number}`,
            ),
            conflict && "conflict: in two groups",
            pending && "Link pending",
            states.length > 0 && (on ? "on" : "off"),
            heard ? "online" : "not heard",
          ]
            .filter(Boolean)
            .join(", "),
        );
      }
      tell();
    };

    // ---- Card -----------------------------------------------------------------

    const card = /** @type {HTMLElement | null} */ (
      region?.querySelector('[data-part="mesh-card"]') ||
        region?.appendChild(cloneOf("mesh-card-template")) ||
        null
    );
    /** @param {string} name */
    const cardPart = (name) =>
      /** @type {HTMLElement | null} */ (
        card?.querySelector(`[data-part="${name}"]`) || null
      );
    const picker = /** @type {HTMLSelectElement | null} */ (
      cardPart("mesh-card-picker")
    );
    /** The selected device instance, whose dot the card sits beside. */
    let selected = "";
    let choices = "";

    const drawCard = () => {
      if (!card) return;
      const dot =
        selected && !armed
          ? drawing.querySelector(
              `[data-part="surface-device"][data-id="${CSS.escape(selected)}"]`,
            )
          : null;
      const plan = store.read();
      const held = heldIn(plan);
      const holding = held.find((entry) => entry.id === selected);
      const node = nodes.find((entry) => entry.id === holding?.node);
      // The selected dot's node is highlighted in the pane.
      for (const [id, { row }] of nodeRows)
        row.setAttribute(
          "data-state",
          [
            id === holding?.node && "selected",
            row.matches('[data-state~="hovered"]') && "hovered",
          ]
            .filter(Boolean)
            .join(" "),
        );
      const free = holding
        ? []
        : nodes.flatMap((node) =>
            freeOf(held, node).map((number) => ({ node, number })),
          );
      card.hidden = !dot || (!holding && free.length === 0);
      if (!dot || card.hidden) return;
      const name = planner.devices.instanceLabel(plan, selected) || "";
      card.setAttribute("aria-label", `Mesh: ${name}`);
      const blinkButton = cardPart("mesh-card-blink");
      if (blinkButton) {
        blinkButton.hidden = !holding || !node || !blinks(node);
        if (holding)
          blinkButton.setAttribute(
            "aria-label",
            `Blink ${nodeName(holding.node)}`,
          );
        if (node) actions.set(blinkButton, () => blink(node));
        else actions.delete(blinkButton);
      }
      const heldPart = cardPart("mesh-card-held");
      const freePart = cardPart("mesh-card-free");
      if (heldPart) heldPart.hidden = !holding;
      if (freePart) freePart.hidden = Boolean(holding);
      if (holding) {
        say(
          card,
          "mesh-card-node",
          `${nodeName(holding.node)} · ${channelsText(holding.channels)}`,
        );
        drawCardControls(holding);
      }
      // Rebuilt only when the choices change, so a pan keeps the pick.
      const next = free
        .map(({ node, number }) => `${node.id} ${number}`)
        .join();
      if (picker && next !== choices) {
        choices = next;
        picker.replaceChildren(
          ...nodes
            .filter((node) => free.some((entry) => entry.node === node))
            .map((node) => {
              const group = cloneOf("mesh-card-picker-group-template");
              group.setAttribute("label", nodeLabel(node));
              group.append(
                ...free
                  .filter((entry) => entry.node === node)
                  .map(({ number }) => {
                    const option = cloneOf("mesh-card-picker-option-template");
                    option.setAttribute("value", `${node.id} ${number}`);
                    option.textContent = `Ch ${number}`;
                    return option;
                  }),
              );
              return group;
            }),
        );
      }
      beside(card, dot);
    };

    /** @param {Held} holding */
    const drawCardControls = (holding) => {
      const list = cardPart("mesh-card-controls");
      if (!list) return;
      const node = nodes.find((entry) => entry.id === holding.node);
      const channels = node
        ? planner.meshChannels
            .of(node)
            .filter((channel) => holding.channels.includes(channel.number))
        : [];
      // Blocks are reused, so a focused slider survives a heard state.
      while (list.children.length > channels.length)
        list.lastElementChild?.remove();
      while (list.children.length < channels.length)
        list.append(cloneOf("mesh-controls-template"));
      channels.forEach((channel, index) => {
        if (node)
          fillControls(
            /** @type {HTMLElement} */ (list.children[index]),
            node,
            channel,
          );
      });
    };

    const assignFromCard = () => {
      const [id, number] = (picker?.value || "").split(" ");
      const node = nodes.find((entry) => entry.id === id);
      if (!node || !selected) return;
      registry.dispatch({
        entity: "deviceInstance",
        action: "assign",
        id: selected,
        value: { node: node.id, channels: [Number(number)] },
      });
      cardPart("mesh-card-unassign")?.focus();
      const name = planner.devices.instanceLabel(store.read(), selected);
      announce(`${nodeLabel(node)} Ch ${number} assigned to ${name}`);
    };

    const unassignFromCard = () => {
      if (!selected) return;
      const name = planner.devices.instanceLabel(store.read(), selected);
      registry.dispatch({
        entity: "deviceInstance",
        action: "unassign",
        id: selected,
      });
      if (card?.hidden)
        /** @type {HTMLElement | null} */ (
          drawing.querySelector(
            `[data-part="surface-device"][data-id="${CSS.escape(selected)}"]`,
          )
        )?.focus();
      else picker?.focus();
      announce(`${name} unassigned`);
    };

    // ---- Nearby -------------------------------------------------------------

    /** @type {Map<string, {row: HTMLElement, rssi: number | null, label: string}>} */
    const nearby = new Map();
    /** The one Add the engine is running or can retry. */
    /** @type {{id: string, row: HTMLElement, step: number, running: boolean} | null} */
    let adding = null;

    /** @param {HTMLElement} row @param {string} name */
    const inRow = (row, name) =>
      /** @type {HTMLButtonElement | null} */ (
        row.querySelector(`[data-part="${name}"]`)
      );

    /** A row's own line, which takes its focus. @param {HTMLElement} row */
    const lineOf = (row) =>
      /** @type {HTMLElement | null} */ (
        row.querySelector(':scope > [data-part="tree-line"]')
      );

    const sort = () => {
      if (!nearbyList) return;
      // Rows never move under the pointer or the focus.
      if (
        nearbyList.matches(":hover") ||
        nearbyList.contains(document.activeElement)
      )
        return;
      const rows = [...nearby.values()]
        // A picked device has no signal and sorts first.
        .sort((left, right) => (right.rssi ?? 0) - (left.rssi ?? 0))
        .map((entry) => entry.row);
      if (rows.some((row, index) => nearbyList.children[index] !== row))
        nearbyList.append(...rows);
    };

    const lock = () => {
      for (const { row } of nearby.values()) {
        const add = inRow(row, "mesh-add");
        if (add) add.disabled = Boolean(adding?.running && adding.row !== row);
      }
      if (pickButton) pickButton.disabled = Boolean(adding?.running);
    };

    /** @param {HTMLElement} row @param {number} index @param {keyof typeof MARKS} status */
    const mark = (row, index, status) => {
      const step = row.querySelectorAll('[data-part="mesh-step"]')[index];
      if (!step) return;
      step.setAttribute("data-state", status);
      const [glyph, word] = MARKS[status];
      const [markPart, statePart] = [
        step.querySelector('[data-part="mesh-step-mark"]'),
        step.querySelector('[data-part="mesh-step-state"]'),
      ];
      if (markPart) markPart.textContent = glyph;
      if (statePart) statePart.textContent = word;
    };

    /** @param {HTMLElement} row @param {number} index */
    const stepName = (row, index) =>
      row
        .querySelectorAll('[data-part="mesh-step-name"]')
        [index]?.textContent?.trim() || "";

    /** @param {Promise<MeshNode>} running */
    const settle = async (running) => {
      if (!adding) return;
      const current = adding;
      current.running = true;
      lock();
      try {
        const node = await running;
        const label = nearby.get(current.id)?.label || node.name;
        nearby.delete(current.id);
        current.row.remove();
        adding = null;
        write("mesh-nearby-count", String(nearby.size));
        lock();
        await renderNodes();
        const row = nodeRows.get(node.id)?.row;
        if (row) lineOf(row)?.focus();
        announce(
          `${label} added as ${node.unicast}. Assign it to a device on the plan.`,
        );
      } catch (error) {
        if (adding !== current) return;
        current.running = false;
        lock();
        const name = stepName(current.row, current.step);
        mark(current.row, current.step, "failed");
        current.row.setAttribute("data-state", "failed");
        const status = inRow(current.row, "mesh-add-status");
        if (status) status.textContent = reason(error);
        const retry = inRow(current.row, "mesh-retry");
        retry?.setAttribute("aria-label", `Retry from ${name}`);
        log(`Add stopped at ${name}: ${reason(error)}`);
        if (current.row.contains(document.activeElement)) retry?.focus();
        announce(`Add stopped at ${name}: ${reason(error)}.`);
      }
    };

    /** @param {string} id */
    const add = (id) => {
      const entry = nearby.get(id);
      if (!engine || !entry) return;
      // A new Add abandons a failed one; the engine runs one at a time.
      adding?.row.removeAttribute("data-state");
      adding = { id, row: entry.row, step: 0, running: false };
      STEPS.forEach((_, index) => mark(entry.row, index, "pending"));
      entry.row.setAttribute("data-state", "adding");
      // Add hides with its row's state, so the row keeps the focus.
      entry.row.focus();
      void settle(engine.add(id));
    };

    const retry = () => {
      if (!engine || !adding) return;
      adding.row.setAttribute("data-state", "adding");
      adding.row.focus();
      void settle(engine.retry());
    };

    /** @param {MeshNearby} device */
    const heard = (device) => {
      if (!nearbyList) return;
      let entry = nearby.get(device.id);
      if (!entry) {
        const row = cloneOf("mesh-nearby-template");
        inRow(row, "mesh-add")?.addEventListener("click", () => add(device.id));
        inRow(row, "mesh-retry")?.addEventListener("click", retry);
        inRow(row, "mesh-open-log")?.addEventListener("click", () => {
          if (logBlock) logBlock.open = true;
          logBlock?.querySelector("summary")?.focus();
        });
        entry = { row, rssi: device.rssi, label: "" };
        nearby.set(device.id, entry);
        nearbyList.append(row);
        write("mesh-nearby-count", String(nearby.size));
      }
      entry.rssi = device.rssi;
      entry.label = device.name || shortId(device.id);
      const { row } = entry;
      const name = inRow(row, "mesh-nearby-name");
      if (name) name.textContent = entry.label;
      inRow(row, "mesh-signal")?.toggleAttribute(
        "hidden",
        device.rssi === null,
      );
      const signal = inRow(row, "mesh-bars");
      if (signal && device.rssi !== null)
        signal.textContent = bars(device.rssi);
      const rssi = inRow(row, "mesh-rssi");
      if (rssi && device.rssi !== null)
        rssi.textContent = String(device.rssi).replace("-", "−");
      inRow(row, "mesh-add")?.setAttribute("aria-label", `Add ${entry.label}`);
      lock();
      sort();
    };

    /** @param {string} id */
    const lost = (id) => {
      const entry = nearby.get(id);
      if (!entry || adding?.id === id) return;
      entry.row.remove();
      nearby.delete(id);
      write("mesh-nearby-count", String(nearby.size));
    };

    const forget = () => {
      nearby.clear();
      adding = null;
      nearbyList?.replaceChildren();
      write("mesh-nearby-count", "0");
    };

    // ---- Connection ---------------------------------------------------------

    const connect = async () => {
      if (!engine || !connectButton) return;
      connectButton.disabled = true;
      if (reconnectButton) reconnectButton.disabled = true;
      const transport = /** @type {MeshTransport} */ (via?.value || "gatt");
      try {
        await engine.connect(transport);
        over = transport;
        try {
          live = await engine.scan(true);
        } catch (error) {
          // Connected but deaf is not a state the pane shows, so close it.
          await engine.disconnect().catch(() => {});
          throw error;
        }
        enter("connected");
        draw();
        if (via) via.disabled = true;
        disconnectButton?.focus();
      } catch (error) {
        log(`Connect failed: ${reason(error)}`);
        announce(`Connect failed: ${reason(error)}.`);
      } finally {
        connectButton.disabled = false;
        if (reconnectButton) reconnectButton.disabled = false;
        if (loading) {
          loading = false;
          reflect();
        }
      }
    };

    // The chooser needs the press's user activation, so nothing waits first.
    const pick = async () => {
      if (!engine?.pick) return;
      try {
        add(await engine.pick());
      } catch (error) {
        log(`Pick failed: ${reason(error)}`);
        announce(`Pick failed: ${reason(error)}.`);
      }
    };

    const disconnect = async () => {
      if (!engine) return;
      try {
        await engine.scan(false);
        await engine.disconnect();
      } catch (error) {
        // Still connected, so the pane says so and Disconnect stays.
        log(`Disconnect failed: ${reason(error)}`);
        announce(`Disconnect failed: ${reason(error)}.`);
        return;
      }
      forget();
      reported.clear();
      draw();
      if (via) via.disabled = false;
      enter("offline");
      connectButton?.focus();
    };

    /** @type {Uint8Array | null} */
    let importBytes = null;
    const exportBackup = async () => {
      if (!engine) return;
      networkMenu?.hidePopover();
      networkToggle?.focus();
      if (exportButton) exportButton.disabled = true;
      try {
        const bytes = await engine.backup();
        const date = new Date();
        const today = [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-");
        const url = URL.createObjectURL(
          new Blob([Uint8Array.from(bytes).buffer], {
            type: "application/json",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download =
          store.read().project.name + " network " + today + ".json";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        announce("Backup exported. The file holds network keys in the clear.");
      } catch (error) {
        announce("Export failed: " + reason(error) + ".");
      } finally {
        if (exportButton) exportButton.disabled = false;
        void updateNetwork();
      }
    };

    const showImportError = (error) => {
      if (!importError) return;
      importError.textContent = reason(error);
      importError.hidden = false;
    };
    const returnImportFocus = () => {
      networkMenu?.showPopover();
      importButton?.focus();
    };
    const openImport = () => {
      if (!importFile) return;
      networkMenu?.hidePopover();
      importBytes = null;
      if (importConfirm) importConfirm.hidden = true;
      if (importError) {
        importError.textContent = "";
        importError.hidden = true;
      }
      importFile.value = "";
      importFile.click();
    };
    const chooseImport = async () => {
      const file = importFile?.files?.[0];
      if (importFile) importFile.value = "";
      if (!file || !importConfirm || !importPrompt) return;
      importConfirm.hidden = false;
      if (importError) {
        importError.textContent = "";
        importError.hidden = true;
      }
      if (importReplace) importReplace.disabled = true;
      const project = store.read().project;
      importPrompt.textContent =
        "Replace " +
        project.name +
        "'s network (" +
        nodesText(nodes.length) +
        ") with “" +
        file.name +
        "”? This browser will take over the network. Stop using it in the browser the backup came from.";
      try {
        importBytes = new Uint8Array(await file.arrayBuffer());
        if (importReplace) {
          importReplace.disabled = false;
          importReplace.focus();
        }
      } catch (error) {
        showImportError(error);
        importCancel?.focus();
      }
    };
    const cancelImport = () => {
      importBytes = null;
      if (importConfirm) importConfirm.hidden = true;
      if (importError) {
        importError.textContent = "";
        importError.hidden = true;
      }
      returnImportFocus();
    };
    const replaceNetwork = async () => {
      if (!engine || !importBytes || !importReplace) return;
      importReplace.disabled = true;
      try {
        await engine.restore(importBytes);
      } catch (error) {
        showImportError(error);
        importReplace.disabled = false;
        return;
      }
      importBytes = null;
      if (importConfirm) importConfirm.hidden = true;
      announce(
        "Backup imported. This browser now owns the network. Stop using the network in the browser the backup came from.",
      );
      networkToggle?.focus();
      void renderNodes();
      importReplace.disabled = false;
    };

    if (engine) {
      /** @param {string} type @param {(detail: any) => void} handle */
      const on = (type, handle) =>
        engine.events.addEventListener(
          type,
          (event) => handle(/** @type {CustomEvent} */ (event).detail),
          { signal },
        );
      on("nearby", heard);
      on("nearby-lost", (detail) => lost(detail.id));
      on("nodes-changed", () => void renderNodes());
      on("loading", () => {
        loading = true;
        reflect();
        announce(spoken(part("mesh-loading")));
      });
      // The transport is gone: what was heard over it is stale.
      on("unplugged", () => {
        const focused = pane.contains(document.activeElement);
        forget();
        reported.clear();
        draw();
        if (via) via.disabled = false;
        enter("unplugged");
        if (focused && !document.activeElement?.checkVisibility())
          reconnectButton?.focus();
      });
      on("log", (detail) => log(detail.text));
      on("state", (/** @type {MeshState} */ { address, ...state }) => {
        reported.set(address, { ...reported.get(address), ...state });
        draw();
      });
      on("step", (/** @type {MeshStepDetail} */ detail) => {
        if (!adding) return;
        const index = STEPS.indexOf(detail.step);
        if (detail.status === "running") adding.step = index;
        if (detail.status !== "failed") mark(adding.row, index, detail.status);
      });
    }

    rail?.addEventListener("click", toggle);
    collapse?.addEventListener("click", toggle);
    connectButton?.addEventListener("click", () => void connect(), { signal });
    reconnectButton?.addEventListener("click", () => void connect(), {
      signal,
    });
    pickButton?.addEventListener("click", () => void pick(), { signal });
    disconnectButton?.addEventListener("click", () => void disconnect(), {
      signal,
    });
    exportButton?.addEventListener("click", () => void exportBackup(), {
      signal,
    });
    importButton?.addEventListener("click", openImport, { signal });
    importFile?.addEventListener("change", () => void chooseImport(), {
      signal,
    });
    importFile?.addEventListener("cancel", returnImportFocus, { signal });
    importReplace?.addEventListener("click", () => void replaceNetwork(), {
      signal,
    });
    importCancel?.addEventListener("click", cancelImport, { signal });
    show?.addEventListener("change", () => filter(), { signal });
    /** @param {Event} event */
    const act = (event) => {
      const target = /** @type {Element} */ (event.target);
      const control =
        event.type === "change" ? target : target.closest("button");
      if (control) return actions.get(control)?.();
      if (event.type !== "click" || target.closest("input, select, label"))
        return;
      // A node's menu sits in its summary, and is not a click on the row.
      if (target.closest("[popover]")) return event.preventDefault();
      // Elsewhere on an assigned line, a pointer click selects the instance
      // holding it and only the chevron discloses. Enter and Space on a
      // summary click it too (detail 0); they disclose.
      const line = target.closest('[data-part="tree-line"]');
      const run = line && actions.get(line);
      const keyed = /** @type {MouseEvent} */ (event).detail === 0;
      if (!run || target.closest('[data-part="tree-chevron"]') || keyed) return;
      event.preventDefault();
      run();
    };
    /** Left collapses and Right expands the focused row, as in the workflow
     * tree. @param {KeyboardEvent} event */
    const disclose = (event) => {
      const target = /** @type {Element} */ (event.target);
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (target.closest("input, select, [popover]")) return;
      const branch = /** @type {HTMLDetailsElement | null} */ (
        target.closest("summary")?.parentElement || null
      );
      if (!(branch instanceof HTMLDetailsElement)) return;
      if (event.key === "ArrowRight") branch.open = true;
      else if (branch.open) branch.open = false;
      else {
        const parent = branch.parentElement?.closest("details");
        if (parent) lineOf(parent)?.focus();
      }
      event.preventDefault();
    };
    /** @param {Element | null} target */
    const dotIn = (target) =>
      target instanceof Element && drawing.contains(target)
        ? target.closest('[data-part="surface-device"]')
        : null;
    /** A dot under the pointer, else the focused one, shows its detail. @param {Event} event */
    const detailFor = (event) => {
      const entering = event.type === "pointerover" || event.type === "focusin";
      const dot =
        (entering && dotIn(/** @type {Element} */ (event.target))) ||
        dotIn(document.activeElement);
      tell(dot?.getAttribute("data-id") || "");
    };
    for (const type of ["pointerover", "pointerout", "focusin", "focusout"])
      drawing.addEventListener(type, detailFor, { signal });
    for (const host of [nodeList, card])
      for (const type of ["click", "change"])
        host?.addEventListener(type, act, { signal });
    part("mesh-tree")?.addEventListener("keydown", disclose, { signal });
    pane.addEventListener(
      "keydown",
      (event) => {
        if (armed && /** @type {KeyboardEvent} */ (event).key === "Escape") {
          claim(event);
          disarm(true);
        }
      },
      { signal },
    );
    // Capture on the region runs before the drawing's own listeners.
    region?.addEventListener("click", claimClick, { capture: true, signal });
    region?.addEventListener("keydown", claimKey, { capture: true, signal });
    document.addEventListener(
      "planner:selection-changed",
      (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail;
        selected = detail?.kind === "device" ? detail.id : "";
        drawCard();
      },
      { signal },
    );
    cardPart("mesh-card-assign")?.addEventListener("click", assignFromCard, {
      signal,
    });
    cardPart("mesh-card-unassign")?.addEventListener(
      "click",
      unassignFromCard,
      { signal },
    );
    const unsubscribe = store.subscribe(() => {
      draw();
      void updateNetwork();
    });
    if (engine) {
      const refreshBackup = setInterval(() => void updateNetwork(), 60000);
      signal.addEventListener("abort", () => clearInterval(refreshBackup), {
        once: true,
      });
    }
    // The surface writes its floor on every render, which redraws the dots,
    // and its viewBox on every pan.
    const redrawn = new MutationObserver((records) => {
      if (
        records.some((record) => record.attributeName === "data-active-floor")
      )
        draw();
      else {
        drawCard();
        tell();
      }
    });
    redrawn.observe(drawing, {
      attributes: true,
      attributeFilter: ["data-active-floor", "viewBox"],
    });
    nearbyList?.addEventListener("pointerleave", sort, { signal });
    nearbyList?.addEventListener(
      "focusout",
      (event) => {
        if (
          !nearbyList.contains(/** @type {Node | null} */ (event.relatedTarget))
        )
          sort();
      },
      { signal },
    );
    part("mesh-log-copy")?.addEventListener(
      "click",
      async () => {
        try {
          await navigator.clipboard.writeText(lines.join("\n"));
          announce("Log copied");
        } catch (error) {
          announce(`Copy failed: ${reason(error)}.`);
        }
      },
      { signal },
    );

    if (card) card.hidden = true;
    reflect();
    filter();
    void reach(engine).then((value) => {
      if (connectButton) connectButton.disabled = !engine;
      enter(value);
      if (value === "offline") void renderNodes();
    });

    return Object.freeze({
      toggle,
      disconnect: () => {
        rail?.removeEventListener("click", toggle);
        collapse?.removeEventListener("click", toggle);
        listening.abort();
        unsubscribe();
        redrawn.disconnect();
        width.disconnect();
      },
    });
  };

  planner.meshPane = Object.freeze({ create });
}
