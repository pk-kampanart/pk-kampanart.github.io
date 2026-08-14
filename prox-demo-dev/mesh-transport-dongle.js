/**
 * The USB dongle transport: Web Serial at 115200 baud, bytes in and out and
 * nothing else (ADR-0042). It knows no engine and no mesh message.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const BAUD = 115200;

  /** @param {MeshPortHandlers} handlers @returns {Promise<MeshPort>} */
  const open = async ({ receive, lost }) => {
    const serial = /** @type {any} */ (navigator).serial;
    if (!serial) throw new Error("this browser has no Web Serial");
    // A previously granted port reopens without a chooser, so Reconnect takes
    // one press after a replug.
    // ponytail: the first granted port wins; filter by the dongle's USB id if a second serial device ever gets granted.
    const [known] = await serial.getPorts();
    const port = known || (await serial.requestPort());
    await port.open({ baudRate: BAUD });
    const writer = port.writable.getWriter();
    let closing = false;
    let writing = Promise.resolve();
    /** @type {any} */
    let reader = null;

    // A framing error may leave a fresh readable stream. Unplugging leaves none.
    const read = async () => {
      let ended = false;
      while (port.readable && !closing && !ended) {
        reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) {
              ended = true;
              break;
            }
            if (value?.length) receive(value);
          }
        } catch {
          // The loop decides from port.readable whether the port survived.
        } finally {
          reader.releaseLock();
        }
      }
      if (!closing) lost(new Error("dongle disconnected"));
    };
    void read();

    return Object.freeze({
      write: (/** @type {Uint8Array} */ bytes) => {
        const done = writing.then(() => writer.write(bytes));
        writing = done.catch(() => {});
        return done;
      },
      close: async () => {
        closing = true;
        await reader?.cancel().catch(() => {});
        await writing;
        writer.releaseLock();
        await port.close().catch(() => {});
      },
    });
  };

  planner.meshTransportDongle = Object.freeze({ open });
}
