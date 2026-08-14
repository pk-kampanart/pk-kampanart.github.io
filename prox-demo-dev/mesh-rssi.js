{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const bands = Object.freeze([
    Object.freeze({ name: "excellent", min: -55 }),
    Object.freeze({ name: "good", min: -65 }),
    Object.freeze({ name: "fair", min: -75 }),
    Object.freeze({ name: "weak", min: -95 }),
    Object.freeze({ name: "unusable", min: -Infinity }),
  ]);
  /** @param {number} dbm */
  const band = (dbm) =>
    bands.find((candidate) => dbm >= candidate.min)?.name || "unusable";
  const statuses = Object.freeze(
    /** @type {MeshRssiStatus[]} */ ([
      "success",
      "no-record",
      "timeout",
      "invalid-destination",
      "appkey-missing",
      "local-node-missing",
      "busy",
      "invalid-response",
    ]),
  );
  /** @param {{status: number, rssiAvg: number, rssiMin: number, rssiMax: number, secondsSinceLastTx: number, deviceCount: number}} event */
  const stats = (event) => {
    const status = statuses[event.status] || "invalid-response";
    const success = status === "success";
    return {
      status,
      avg: success ? event.rssiAvg : null,
      min: success ? event.rssiMin : null,
      max: success ? event.rssiMax : null,
      secondsSinceLastTx: success ? event.secondsSinceLastTx : null,
      deviceCount: success ? event.deviceCount : null,
    };
  };
  /** Missing node replies resolve as timeout results; disconnect or abort rejects.
   * @param {MeshEngine} engine @param {MeshNode[]} nodes @param {{signal?: AbortSignal, progress?(done: number, total: number, result: {from: string, to: string, stats: MeshRssiStats}): void}} [options]
   */
  const audit = async (engine, nodes, options = {}) => {
    const request = engine.rssi;
    if (typeof request !== "function")
      throw new Error("the mesh engine does not support RSSI");
    const { signal, progress } = options;
    const abort = () => {
      const error = new Error("The RSSI audit was aborted");
      error.name = "AbortError";
      return error;
    };
    if (signal?.aborted) throw abort();
    const total = nodes.reduce(
      (count, from) =>
        count +
        nodes.filter((to) => to.unicast !== from.unicast && to.mac).length,
      0,
    );
    if (nodes.length >= 2 && total === 0)
      throw new Error(
        "no node has a MAC; RSSI needs nodes added over the dongle",
      );
    /** @type {{from: string, to: string, stats: MeshRssiStats}[]} */
    const results = [];
    let done = 0;
    for (const from of nodes)
      for (const to of nodes) {
        if (to.unicast === from.unicast || !to.mac) continue;
        if (signal?.aborted) throw abort();
        const result = {
          from: from.unicast,
          to: to.mac,
          stats: await request.call(engine, from.unicast, to.mac),
        };
        results.push(result);
        progress?.(++done, total, result);
        if (signal?.aborted) throw abort();
      }
    return results;
  };
  planner.meshRssi = Object.freeze({ bands, band, statuses, stats, audit });
}
