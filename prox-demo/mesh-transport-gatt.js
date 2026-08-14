/**
 * The Bluetooth transport: Web Bluetooth GATT to one node at a time, bytes in
 * and out and nothing else (ADR-0042). Provisioning runs over the Mesh
 * Provisioning Service (0x1827), everything after over the Mesh Proxy Service
 * (0x1828). It knows no engine and no mesh message; the devices it hands out
 * are opaque to the engine.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @param {number} short */
  const uuid16 = (short) =>
    `0000${short.toString(16)}-0000-1000-8000-00805f9b34fb`;
  const SERVICES = {
    provisioning: {
      service: uuid16(0x1827),
      in: uuid16(0x2adb),
      out: uuid16(0x2adc),
    },
    proxy: { service: uuid16(0x1828), in: uuid16(0x2add), out: uuid16(0x2ade) },
  };
  // A write without response is never fragmented, so a proxy PDU is cut to
  // the smallest ATT payload, 20 octets: one SAR header and 19 of the PDU.
  const CHUNK = 19;
  // A node out of reach may never answer a connect. Calibrated on nothing yet.
  const CONNECT_MS = 10000;

  const bluetooth = () => {
    const found = /** @type {any} */ (navigator).bluetooth;
    if (!found)
      throw new Error(
        "this browser has no Web Bluetooth; connect via the USB dongle",
      );
    return found;
  };

  /** @param {DataView} view */
  const bytesOf = (view) =>
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();

  /** @param {Uint8Array} bytes */
  const hex = (bytes) =>
    Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

  /**
   * Live scan for unprovisioned devices, where the browser has one. Resolves
   * a stop function, or null when there is no live list.
   * @param {(device: {device: unknown, id: string, name: string, rssi: number}) => void} heard
   */
  const scan = async (heard) => {
    const found = bluetooth();
    if (!found.requestLEScan) return null;
    /** @param {any} event */
    const advert = (event) => {
      const data = event.serviceData?.get(SERVICES.provisioning.service);
      // The service data opens with the Device UUID.
      if (!data || data.byteLength < 16) return;
      heard({
        device: event.device,
        id: hex(bytesOf(data).subarray(0, 16)),
        name: event.device?.name || event.name || "",
        rssi: event.rssi ?? -100,
      });
    };
    let scanning;
    try {
      scanning = await found.requestLEScan({
        filters: [{ services: [SERVICES.provisioning.service] }],
      });
    } catch {
      // Refused, or behind a setting: the chooser still reaches devices.
      return null;
    }
    found.addEventListener("advertisementreceived", advert);
    return () => {
      found.removeEventListener("advertisementreceived", advert);
      scanning.stop();
    };
  };

  /**
   * Opens the browser's chooser; it needs the user's press, so call it before
   * any wait. With a Device UUID it lists that device only, else every
   * unprovisioned one; `proxy` lists network nodes instead.
   * @param {{id?: string, name?: string, proxy?: boolean}} [target]
   * @returns {Promise<unknown>}
   */
  const choose = async (target = {}) => {
    const { provisioning, proxy } = SERVICES;
    if (target.proxy)
      return bluetooth().requestDevice({
        filters: [{ services: [proxy.service] }],
      });
    /** @type {Record<string, unknown>} */
    const filter = { services: [provisioning.service] };
    if (target.id)
      filter.serviceData = [
        {
          service: provisioning.service,
          dataPrefix: Uint8Array.from(target.id.match(/../g) || [], (pair) =>
            parseInt(pair, 16),
          ),
        },
      ];
    // A browser without service-data filters still narrows by name.
    if (target.id && target.name) filter.name = target.name;
    return bluetooth().requestDevice({
      filters: [filter],
      optionalServices: [proxy.service],
    });
  };

  /** Devices this origin may reach without the chooser. @returns {Promise<unknown[]>} */
  const permitted = async () => {
    const found = /** @type {any} */ (navigator).bluetooth;
    return (await found?.getDevices?.().catch(() => [])) || [];
  };

  /**
   * Connects to one of the device's two mesh services. Over the proxy a PDU
   * is written in SAR chunks and handed on reassembled; provisioning bytes
   * pass as they are.
   * @param {any} device @param {"provisioning" | "proxy"} kind @param {MeshPortHandlers} handlers
   * @returns {Promise<MeshPort>}
   */
  const open = async (device, kind, { receive, lost }) => {
    const ids = SERVICES[kind];
    let closing = false;
    const dropped = () => {
      if (closing) return;
      closing = true;
      lost(new Error(`${device.name || "the node"} disconnected`));
    };
    /** @type {any} */
    let timer;
    try {
      const server = await Promise.race([
        device.gatt.connect(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`no answer in ${CONNECT_MS / 1000} s`)),
            CONNECT_MS,
          );
        }),
      ]);
      const service = await server.getPrimaryService(ids.service);
      const [input, output] = await Promise.all([
        service.getCharacteristic(ids.in),
        service.getCharacteristic(ids.out),
      ]);
      /** @type {{type: number, body: number[]} | null} */
      let partial = null;
      output.addEventListener(
        "characteristicvaluechanged",
        (/** @type {any} */ event) => {
          const bytes = bytesOf(event.target.value);
          if (kind === "provisioning") return receive(bytes);
          // Proxy SAR: 0 complete, 1 first, 2 continuation, 3 last.
          const sar = bytes[0] >> 6;
          const type = bytes[0] & 0x3f;
          if (sar <= 1) partial = { type, body: [] };
          else if (partial?.type !== type) return;
          partial.body.push(...bytes.subarray(1));
          if (sar === 1 || sar === 2) return;
          const pdu = Uint8Array.from([type, ...partial.body]);
          partial = null;
          receive(pdu);
        },
      );
      await output.startNotifications();
      device.addEventListener("gattserverdisconnected", dropped);
      let writing = Promise.resolve();
      return Object.freeze({
        write: (/** @type {Uint8Array} */ bytes) => {
          /** @type {Uint8Array[]} */
          const chunks = [];
          if (kind === "provisioning") chunks.push(bytes);
          else
            for (let at = 1; at < bytes.length || at === 1; at += CHUNK) {
              const first = at === 1;
              const last = at + CHUNK >= bytes.length;
              const sar = first && last ? 0 : first ? 1 : last ? 3 : 2;
              chunks.push(
                Uint8Array.from([
                  (sar << 6) | (bytes[0] & 0x3f),
                  ...bytes.subarray(at, at + CHUNK),
                ]),
              );
            }
          // A failed chunk drops the rest of its PDU; the next PDU still goes.
          const done = chunks.reduce(
            (queue, chunk) =>
              queue.then(() => input.writeValueWithoutResponse(chunk)),
            writing,
          );
          writing = done.catch(() => {});
          return done;
        },
        close: async () => {
          closing = true;
          device.removeEventListener("gattserverdisconnected", dropped);
          await writing;
          if (device.gatt.connected) device.gatt.disconnect();
        },
      });
    } catch (error) {
      closing = true;
      // Also abandons a connect still pending after the timeout.
      device.gatt.disconnect();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  planner.meshTransportGatt = Object.freeze({ scan, choose, permitted, open });
}
