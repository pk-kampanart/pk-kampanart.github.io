/**
 * Development-only RSSI audit: asks each picked node what it heard from every
 * other and shows the answers as a matrix. It reads the live Mesh engine and
 * changes nothing in the Plan or the network.
 */
{
  const panel = window.PlannerDevPanel;
  const planner = window.Planner;
  if (!panel?.register) throw new Error("Developer panel host is unavailable");

  /** @param {MeshNode} node */
  const label = (node) => node.name || node.unicast;
  /** @param {string} mac */
  const colons = (mac) => mac.match(/../g)?.join(":") || mac;
  /** @param {number | null} value */
  const dbm = (value) => String(value).replace("-", "−");
  /** @param {MeshRssiStatus} status */
  const words = (status) =>
    status
      .replaceAll("-", " ")
      .replace(/^./, (letter) => letter.toUpperCase())
      .replace("Appkey", "AppKey");

  /** @param {HTMLElement} root */
  const mount = (root) => {
    root.innerHTML = `
      <section data-part="rssi-audit" aria-labelledby="rssi-audit-title">
        <h3 id="rssi-audit-title">RSSI audit</h3>
        <fieldset>
          <legend>Nodes</legend>
          <p data-part="rssi-audit-hint" hidden>RSSI works only for nodes
            added over the dongle. Over Bluetooth the browser hides a node's
            MAC, so no node can be asked about it. Connect over the dongle and
            add it again.</p>
          <ul data-part="rssi-audit-nodes"></ul>
        </fieldset>
        <p data-part="rssi-audit-unavailable" role="alert"></p>
        <div data-part="rssi-audit-actions">
          <button type="button" data-action="rssi-audit-run">Run audit</button>
          <button type="button" data-action="rssi-audit-cancel" hidden>Cancel</button>
        </div>
        <div data-part="rssi-audit-progress" hidden>
          <progress aria-label="Audit progress"></progress>
          <span data-part="rssi-audit-count"></span>
        </div>
        <div data-part="rssi-audit-grid" hidden>
          <table>
            <caption>Each row heard each column. dBm: avg over min…max.</caption>
            <thead></thead>
            <tbody></tbody>
          </table>
        </div>
        <p data-part="rssi-audit-status" role="status"></p>
      </section>`;
    const style = document.createElement("style");
    style.textContent = `
      [data-part="rssi-audit"] { display: grid; gap: var(--space-5); }
      [data-part="rssi-audit"] h3, [data-part="rssi-audit"] p { margin: 0; }
      [data-part="rssi-audit"] fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
      [data-part="rssi-audit"] legend { padding: 0 0 var(--space-3); font-weight: 600; }
      [data-part="rssi-audit"] ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
      [data-part="rssi-audit"] label { display: flex; gap: var(--space-4); font-variant-numeric: tabular-nums; }
      [data-part="rssi-audit-unavailable"] { color: var(--text-muted); }
      [data-part="rssi-audit-actions"], [data-part="rssi-audit-progress"] { display: flex; align-items: center; gap: var(--space-4); }
      [data-part="rssi-audit-grid"] { overflow-x: auto; }
      [data-part="rssi-audit"] table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
      [data-part="rssi-audit"] caption { text-align: start; color: var(--text-muted); padding-bottom: var(--space-2); }
      [data-part="rssi-audit"] th, [data-part="rssi-audit"] td { padding: var(--space-1) var(--space-4); text-align: end; white-space: pre; vertical-align: top; }
      [data-part="rssi-audit"] th[scope="row"] { text-align: start; }
      [data-part="rssi-audit"] [hidden] { display: none; }
    `;
    root.append(style);
    /** @param {string} name @returns {any} */
    const part = (name) =>
      root.querySelector(`[data-part="${name}"], [data-action="${name}"]`);
    const list = part("rssi-audit-nodes");
    const run = part("rssi-audit-run");
    const cancel = part("rssi-audit-cancel");
    const bar = part("rssi-audit-progress");
    const count = part("rssi-audit-count");
    const grid = part("rssi-audit-grid");
    const status = part("rssi-audit-status");
    /** @type {MeshEngine | null} */
    let engine = null;
    /** @type {MeshNode[]} */
    let nodes = [];
    /** @type {AbortController | null} */
    let running = null;

    const available = () =>
      !!engine?.capabilities.has("rssi") && typeof engine.rssi === "function";
    const check = () => {
      if (available()) part("rssi-audit-unavailable").textContent = "";
      run.disabled = !!running;
    };
    const refresh = async () => {
      check();
      if (!engine) return;
      const checked = new Set(
        [...list.querySelectorAll("input:not(:checked)")].map(
          (input) => input.value,
        ),
      );
      try {
        nodes = planner.meshChannels.live(await engine.nodes());
      } catch (error) {
        status.textContent = `Nodes unavailable: ${error instanceof Error ? error.message : String(error)}`;
        return;
      }
      part("rssi-audit-hint").hidden = nodes.every((node) => node.mac);
      list.replaceChildren(
        ...nodes.map((node) => {
          const item = document.createElement("li");
          const field = document.createElement("label");
          const input = document.createElement("input");
          input.type = "checkbox";
          input.value = node.unicast;
          input.checked = !checked.has(node.unicast);
          const name = document.createElement("span");
          name.textContent = label(node);
          const unicast = document.createElement("span");
          unicast.textContent = node.unicast;
          const mac = document.createElement("span");
          mac.textContent = node.mac
            ? colons(node.mac)
            : "no MAC: added over Bluetooth";
          field.append(input, name, unicast, mac);
          item.append(field);
          return item;
        }),
      );
    };

    /** @param {MeshNode[]} picked */
    const drawGrid = (picked) => {
      const heard = picked.filter((node) => node.mac);
      const cells = new Map();
      const head = document.createElement("tr");
      head.append(document.createElement("td"));
      for (const node of heard) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = label(node);
        head.append(cell);
      }
      grid.querySelector("thead").replaceChildren(head);
      grid.querySelector("tbody").replaceChildren(
        ...picked.map((from) => {
          const row = document.createElement("tr");
          const name = document.createElement("th");
          name.scope = "row";
          name.textContent = label(from);
          row.append(name);
          for (const to of heard) {
            const cell = document.createElement("td");
            if (to === from) cell.textContent = "—";
            else cells.set(`${from.unicast}>${to.mac}`, cell);
            row.append(cell);
          }
          return row;
        }),
      );
      grid.hidden = false;
      return cells;
    };

    run.addEventListener("click", async () => {
      // WIP: the pinned wasm build exports no rssi_stats, so real devices
      // get no RSSI yet; say so and send nothing (#80).
      if (!available()) {
        part("rssi-audit-unavailable").textContent =
          "The RSSI audit is not built for real devices yet.";
        return;
      }
      const picked = new Set(
        [...list.querySelectorAll("input:checked")].map((input) => input.value),
      );
      const chosen = nodes.filter((node) => picked.has(node.unicast));
      const cells = drawGrid(chosen);
      const tally = { heard: 0, "no record": 0, failed: 0 };
      let done = 0;
      // Known before the first answer, which on hardware can take a timeout.
      const macs = chosen.filter((node) => node.mac).length;
      let total = chosen.length * macs - macs;
      const controller = (running = new AbortController());
      run.disabled = true;
      cancel.hidden = false;
      bar.hidden = false;
      bar.querySelector("progress").removeAttribute("value");
      count.textContent = `0 of ${total} pairs`;
      status.textContent = "";
      try {
        await planner.meshRssi.audit(
          /** @type {MeshEngine} */ (engine),
          chosen,
          {
            signal: controller.signal,
            progress: (answered, pairs, { from, to, stats }) => {
              done = answered;
              total = pairs;
              const progress = bar.querySelector("progress");
              progress.max = pairs;
              progress.value = answered;
              count.textContent = `${answered} of ${pairs} pairs`;
              const cell = cells.get(`${from}>${to}`);
              if (stats.status === "success") {
                tally.heard += 1;
                cell.textContent = `${dbm(stats.avg)}\n${dbm(stats.min)}…${dbm(stats.max)}`;
              } else {
                tally[stats.status === "no-record" ? "no record" : "failed"] +=
                  1;
                cell.textContent = words(stats.status);
              }
            },
          },
        );
        status.textContent = [
          `${done} pairs`,
          ...Object.entries(tally).map(([key, value]) => `${value} ${key}`),
        ].join(" · ");
      } catch (error) {
        status.textContent =
          error instanceof Error && error.name === "AbortError"
            ? `Cancelled after ${done} of ${total} pairs.`
            : `Audit stopped: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        // Follow the hidden Cancel only; never pull focus from elsewhere.
        const refocus =
          document.activeElement === cancel ||
          document.activeElement === document.body;
        running = null;
        cancel.hidden = true;
        void refresh();
        if (refocus) run.focus();
      }
    });
    cancel.addEventListener("click", () => running?.abort());

    let gone = false;
    void planner.app.ready().then(() => {
      if (gone) return;
      engine = planner.app.meshEngine();
      engine?.events.addEventListener("nodes-changed", refresh);
      engine?.events.addEventListener("state", check);
      return refresh();
    });
    return () => {
      gone = true;
      running?.abort();
      engine?.events.removeEventListener("nodes-changed", refresh);
      engine?.events.removeEventListener("state", check);
    };
  };

  panel.register({ title: "RSSI audit", mount });
}
