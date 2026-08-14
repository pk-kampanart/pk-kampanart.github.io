/**
 * Development-only Sandbox page. Simulated LEDs always animate, even under
 * reduced motion, so a designer without hardware can see blink and flash
 * states in this dev-only diagnostic view.
 */
{
  const panel = /** @type {Window["PlannerDevPanel"]} */ (
    window.PlannerDevPanel
  );
  const planner = /** @type {PlannerNamespace} */ (window.Planner);
  if (!panel?.register || !panel.open)
    throw new Error("Developer panel host is unavailable");
  /** @param {HTMLElement} root */
  const mount = (root) => {
    let gone = false;
    /** @type {{close(): void} | null} */
    let editor = null;
    const controller = new AbortController();
    /** @param {EventTarget} target @param {string} type @param {(event: any) => void} listener @param {boolean} [capture] */
    const listen = (target, type, listener, capture = false) =>
      target.addEventListener(type, listener, {
        signal: controller.signal,
        capture,
      });
    const style = document.createElement("style");
    style.textContent = `
      [data-part="mesh-sandbox-page"] { border-top: var(--border-width) solid var(--border); padding-top: var(--space-5); display: grid; gap: var(--space-4); font-size: var(--size-2); min-width: 0; }
      [data-part="mesh-sandbox-page"] h3, [data-part="mesh-sandbox-page"] p { margin: 0; }
      [data-part="mesh-sandbox-page"] h3 { font-size: var(--size-3); }
      [data-part="mesh-sandbox-page"] label { display: inline-flex; align-items: center; gap: var(--space-3); }
      [data-part="mesh-sandbox-page"] select { max-width: 100%; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-content"] { display: grid; gap: var(--space-5); min-width: 0; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-row"] { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); min-width: 0; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-section"] { min-width: 0; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-section"] > summary { font-weight: 600; cursor: pointer; margin-bottom: var(--space-3); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-devices"] { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-4); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-card"] { border: var(--border-width) solid var(--border); border-radius: var(--radius); padding: var(--space-4); display: grid; gap: var(--space-3); min-width: 0; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-header"] { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); min-width: 0; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-photo"] { flex: none; display: grid; place-items: center; width: 2rem; height: 2rem; border: var(--border-width) solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--control-surface); color: var(--text-faint); text-decoration: none; font-size: var(--size-1); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-photo"] img { width: 100%; height: 100%; object-fit: contain; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-info"] { display: grid; gap: var(--space-1); min-width: 0; overflow-wrap: anywhere; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-title"] { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-name"] { font-weight: 600; color: var(--ink); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-meta"] { color: var(--text-muted); font-size: var(--size-1); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-address"] { color: var(--text-muted); font: var(--size-1) var(--font-mono); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-no-mac"] { color: var(--danger-strong); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-actions"] { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-led"] { --led-dot: var(--led-off); display: inline-flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); border: var(--border-width) solid var(--border); border-radius: 999px; background: var(--surface-inset); font-size: var(--size-1); white-space: nowrap; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-led"]::before { content: ""; flex: none; width: .45em; height: .45em; border-radius: 50%; background: var(--led-dot); animation: sandbox-blink var(--led-blink, 0s) steps(1) infinite; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-led"][data-state~="red"] { --led-dot: var(--led-red); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-led"][data-state~="red-blink"] { --led-dot: var(--led-red); --led-blink: 1s; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-led"][data-state~="blue"] { --led-dot: var(--led-blue); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-led"][data-state~="blue-blink"] { --led-dot: var(--led-blue); --led-blink: .5s; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-led"][data-state~="off"]::before { border: var(--border-width) solid var(--led-off); background: transparent; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-led"][data-state~="red-flash"] { --led-dot: var(--led-red); --led-blink: .2s; color: var(--danger-strong); border-color: var(--danger-border); background: var(--danger-surface); }
      @keyframes sandbox-blink { 50% { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) {
        [data-part="mesh-sandbox-page"] [data-part="sandbox-led"]::before { animation-duration: var(--led-blink, 0s) !important; }
      }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-device-fake"] { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); min-width: 0; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-steps"] { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); margin: 0; padding: 0; border: 0; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-steps"] legend { float: left; margin-right: var(--space-2); color: var(--text-muted); font-size: var(--size-1); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-step"] { position: relative; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-step"] input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-step"] span { display: inline-flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); border: var(--border-width) solid var(--border-strong); border-radius: 999px; background: var(--control-surface); font-size: var(--size-1); line-height: 1.6; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-step"] span::before { content: "○" / ""; color: var(--text-faint); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-step"] input:hover + span { background: var(--control-surface-hover); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-step"] input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 1px; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-step"] input:checked + span { border-color: var(--danger); background: var(--danger-surface); color: var(--danger-strong); font-weight: 600; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-step"] input:checked + span::before { content: "✗" / ""; color: var(--danger); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-fail-steps-separator"] { color: var(--text-faint); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-models"] { display: grid; grid-template-columns: 1.4rem repeat(5, max-content); margin: 0 0 0 var(--space-4); padding: 0; list-style: none; font-size: var(--size-1); overflow-x: auto; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-element"], [data-part="mesh-sandbox-page"] [data-part="sandbox-model-element"] > ul { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; list-style: none; margin: 0; padding: 0; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-header"] { display: contents; color: var(--text-faint); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-header"] > *, [data-part="mesh-sandbox-page"] [data-part="sandbox-model-row"] > * { padding-inline-end: var(--space-3); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-header"] > * { font-size: var(--size-1); text-transform: uppercase; letter-spacing: .03em; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-element-title"] { grid-column: 1 / -1; padding-top: var(--space-1); margin-top: var(--space-1); border-top: var(--border-width) solid var(--border); color: var(--ink); font-weight: 600; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-address"] { color: var(--text-muted); font: var(--size-1) var(--font-mono); font-weight: 400; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-row"] { display: contents; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-row"] > * { padding-block: 1px; white-space: nowrap; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-keys"], [data-part="mesh-sandbox-page"] [data-part="sandbox-model-routes"], [data-part="mesh-sandbox-page"] [data-part="sandbox-model-value"] { color: var(--text-muted); font-family: var(--font-mono); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-on"][data-state~="on"] { color: var(--accent-strong); font-weight: 600; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-on"][data-state~="off"] { color: var(--text-muted); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-row"][data-state~="foundation"] > * { background: var(--surface-inset); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-foundation-tag"] { margin-left: var(--space-1); padding: 0 var(--space-1); border: var(--border-width) solid var(--border-strong); border-radius: 999px; color: var(--text-muted); font-size: .75em; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-row"][data-state~="failing"] [data-part="sandbox-model-name"] { color: var(--danger-strong); font-weight: 600; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-fail"] { display: grid; place-items: center; align-self: center; width: 1rem; height: 1rem; margin: 0; padding: 0; appearance: none; border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-sm); background: var(--control-surface); cursor: pointer; font-size: var(--size-1); line-height: 1; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-fail"]::before { content: "○"; color: var(--text-faint); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-fail"]:hover { background: var(--control-surface-hover); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-fail"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-fail"]:checked { border-color: var(--danger); background: var(--danger-surface); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-fail"]:checked::before { content: "✗"; color: var(--danger); font-weight: 700; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-summary"] { cursor: pointer; color: var(--text-muted); font-size: var(--size-1); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-summary"] button { min-height: 0; margin-left: var(--space-2); padding: 0 var(--space-2); font-size: inherit; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-model-fail-count"] { color: var(--danger-strong); font-weight: 600; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-composition"] { margin: var(--space-1) 0 var(--space-1) var(--space-4); color: var(--text-muted); font: var(--size-1) var(--font-mono); overflow-wrap: anywhere; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-dialog"] { position: fixed; inset: 8vh auto auto 50%; transform: translateX(-50%); width: min(52rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); min-width: min(20rem, calc(100vw - 2rem)); max-height: 84vh; overflow: auto; resize: both; box-sizing: border-box; border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-dialog); background: var(--surface-raised); color: var(--text); padding: var(--space-6); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-dialog"]:not([open]) { display: none; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-body"] { display: grid; gap: var(--space-5); min-width: 0; max-width: 100%; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-heading"] { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-heading"] h3 { margin: 0; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-grid"] { overflow: auto; max-width: 100%; min-width: 0; }
      [data-part="mesh-sandbox-page"] table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
      [data-part="mesh-sandbox-page"] th, [data-part="mesh-sandbox-page"] td { padding: var(--space-1) var(--space-2); text-align: end; white-space: nowrap; }
      [data-part="mesh-sandbox-page"] th[scope="row"] { text-align: start; }
      [data-part="mesh-sandbox-page"] td button { font: inherit; min-width: 4.5rem; text-align: center; border-color: currentColor; color: var(--text-muted); }
      [data-part="mesh-sandbox-page"] td button:has(> span) { flex-direction: column; }
      [data-part="mesh-sandbox-page"] td button > span { display: block; font-size: var(--size-3); }
      [data-part="mesh-sandbox-page"] td button small { display: block; color: var(--text-muted); font-size: var(--size-1); }
      [data-part="mesh-sandbox-page"] td button[data-state~="excellent"] > span { color: var(--signal-excellent); }
      [data-part="mesh-sandbox-page"] td button[data-state~="good"] > span { color: var(--signal-good); }
      [data-part="mesh-sandbox-page"] td button[data-state~="fair"] > span { color: var(--signal-fair); }
      [data-part="mesh-sandbox-page"] td button[data-state~="weak"] > span { color: var(--signal-weak); }
      [data-part="mesh-sandbox-page"] td button[data-state~="unusable"] > span { color: var(--signal-unusable); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi"] { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-numbers"] { display: contents; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-numbers"][hidden] { display: none; }
      [data-part="mesh-sandbox-page"] input[type="number"] { width: 5em; }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-legend"] { display: flex; flex-wrap: wrap; gap: var(--space-4); color: var(--text-muted); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-legend"] [data-state~="excellent"] { color: var(--signal-excellent); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-legend"] [data-state~="good"] { color: var(--signal-good); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-legend"] [data-state~="fair"] { color: var(--signal-fair); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-legend"] [data-state~="weak"] { color: var(--signal-weak); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-rssi-legend"] [data-state~="unusable"] { color: var(--signal-unusable); }
      [data-part="mesh-sandbox-page"] [data-part="sandbox-message"] { color: var(--text-muted); }
      [data-part="mesh-sandbox-page"] [hidden] { display: none; }

    `;
    const section = document.createElement("section");
    section.dataset.part = "mesh-sandbox-page";
    section.setAttribute("aria-labelledby", "mesh-sandbox-title");
    section.innerHTML = `
      <h3 id="mesh-sandbox-title">Sandbox</h3>
      <label><input type="checkbox" data-part="sandbox-switch"> Use sandbox engine</label>
      <div data-part="sandbox-content" hidden>
        <div data-part="sandbox-row">
          <label>Preset <select data-part="sandbox-presets"></select></label>
          <button type="button" data-part="sandbox-view-json">View JSON</button>
          <button type="button" data-part="sandbox-import-open">Import…</button>
          <input type="file" accept=".json,application/json" data-part="sandbox-import" aria-label="Import preset file" hidden>
          <button type="button" data-part="sandbox-export">Export</button>
        </div>
        <details open data-part="sandbox-section">
          <summary data-part="sandbox-devices-title" tabindex="-1">Devices (0)</summary>
          <div data-part="sandbox-row">
            <label>Catalog SKU <select data-part="sandbox-catalog"></select></label>
            <button type="button" data-part="sandbox-add" disabled>Add device</button>
          </div>
          <ul data-part="sandbox-devices"></ul>
        </details>
        <button type="button" data-part="sandbox-rssi-open">Edit RSSI…</button>
      </div>
      <p data-part="sandbox-message" role="status"></p>
      <dialog data-part="sandbox-rssi-dialog" aria-labelledby="sandbox-rssi-title">
        <div data-part="sandbox-rssi-body">
          <div data-part="sandbox-rssi-heading">
            <h3 id="sandbox-rssi-title">RSSI — row hears column</h3>
            <button type="button" data-part="sandbox-rssi-close" aria-label="Close RSSI editor">✕</button>
          </div>
          <label><input type="checkbox" data-part="sandbox-vary"> Vary RSSI (random within min–max per read)</label>
          <div data-part="sandbox-grid">
            <table><thead></thead><tbody></tbody></table>
          </div>
          <div data-part="sandbox-row">
            <label>From <select data-part="sandbox-from"></select></label>
            <label>To <select data-part="sandbox-to"></select></label>
          </div>
          <form data-part="sandbox-rssi">
            <label>Status <select data-part="sandbox-status"></select></label>
            <span data-part="sandbox-numbers">
              <label>Min <input type="number" name="min" required step="any"></label>
              <label>Avg <input type="number" name="avg" required step="any"></label>
              <label>Max <input type="number" name="max" required step="any"></label>
            </span>
            <button type="submit">Save RSSI</button>
          </form>
          <div data-part="sandbox-rssi-legend" aria-label="RSSI strength legend"></div>
        </div>
      </dialog>`;
    root.append(section, style);

    /** @param {string} name @returns {any} */
    const part = (name) => section.querySelector(`[data-part="${name}"]`);
    /** @param {HTMLSelectElement} select @param {{value: string, label: string}[]} entries */
    const fill = (select, entries) => {
      const kept = select.value;
      select.replaceChildren(
        ...entries.map(({ value, label }) => new Option(label, value)),
      );
      if (entries.some((entry) => entry.value === kept)) select.value = kept;
    };
    /** @param {{sku?: string, name: string, mac: string}} device */
    const describe = (device) =>
      [...new Set([device.sku, device.name, device.mac].filter(Boolean))].join(
        " · ",
      );
    /** @param {{sku?: string, name: string}} device */
    const short = (device) => device.name || device.sku || "";
    /** @param {unknown} error */
    const message = (error) => {
      if (gone) return;
      const line = part("sandbox-message");
      line.textContent = "";
      setTimeout(() => {
        if (!gone)
          line.textContent =
            error instanceof Error ? error.message : String(error);
      }, 100);
    };
    const format = (number) => String(number).replace("-", "−");
    const status = /** @type {HTMLSelectElement} */ (part("sandbox-status"));
    for (const value of planner.meshRssi.statuses) {
      const label = value
        .replaceAll("-", " ")
        .replace(/^./, (letter) => letter.toUpperCase())
        .replace("Appkey", "AppKey");
      status.add(new Option(label, value));
    }
    const legend = part("sandbox-rssi-legend");
    planner.meshRssi.bands.forEach((band, index, bands) => {
      const item = document.createElement("span");
      item.dataset.state = band.name;
      item.textContent = `■ ${Number.isFinite(band.min) ? `≥${format(band.min)}` : `<${format(bands[index - 1].min)}`} ${band.name}`;
      legend.append(item);
    });
    legend.append(" · no record   ⌀ error");

    const toggle = part("sandbox-switch");
    toggle.checked =
      new URLSearchParams(location.search).get("mesh-engine") === "sandbox";
    listen(toggle, "change", () => {
      const url = new URL(location.href);
      if (toggle.checked) url.searchParams.set("mesh-engine", "sandbox");
      else url.searchParams.delete("mesh-engine");
      url.searchParams.set("dev", "mesh-sandbox");
      location.assign(url.href);
    });

    void planner.app
      .ready()
      .then(async () => {
        if (gone) return;
        const sandbox = planner.meshSandbox;
        if (!sandbox) return;
        const [products, families, catalogFile] = await Promise.all([
          sandbox.catalog(),
          sandbox.families(),
          fetch("dev/catalog/catalog.json").then((response) => {
            if (!response.ok) throw new Error("Device catalog is unavailable");
            return response.json();
          }),
        ]);
        if (gone) return;
        const productsBySku = new Map(
          products.map((product) => [product.sku, product]),
        );
        const list = part("sandbox-devices");
        const from = part("sandbox-from");
        const to = part("sandbox-to");
        const form = part("sandbox-rssi");
        const dialog = part("sandbox-rssi-dialog");
        const grid = part("sandbox-grid");
        const openRssi = part("sandbox-rssi-open");
        const showNumbers = () => {
          const numbers = part("sandbox-numbers");
          numbers.hidden = status.value !== "success";
          for (const input of numbers.querySelectorAll("input"))
            input.disabled = numbers.hidden;
        };
        const showPair = () => {
          const record = sandbox.state().rssi[`${from.value}>${to.value}`];
          status.value = record ? record.status || "success" : "no-record";
          for (const key of ["avg", "min", "max"])
            form[key].value = record?.[key] ?? "";
          form.querySelector("button").disabled =
            !from.value || from.value === to.value;
          showNumbers();
        };
        /** @param {any[]} devices */
        const drawGrid = (devices) => {
          const { rssi } = sandbox.state();
          const head = document.createElement("tr");
          head.append(document.createElement("td"));
          for (const device of devices) {
            const cell = document.createElement("th");
            cell.scope = "col";
            cell.textContent = short(device);
            head.append(cell);
          }
          grid.querySelector("thead").replaceChildren(head);
          grid.querySelector("tbody").replaceChildren(
            ...devices.map((source) => {
              const row = document.createElement("tr");
              const label = document.createElement("th");
              label.scope = "row";
              label.textContent = short(source);
              row.append(label);
              for (const target of devices) {
                const cell = document.createElement("td");
                row.append(cell);
                if (source === target) {
                  cell.textContent = "—";
                  continue;
                }
                const entry = rssi[`${source.id}>${target.id}`];
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.source = source.id;
                button.dataset.target = target.id;
                if (!entry || entry.status) {
                  button.textContent =
                    !entry || entry.status === "no-record" ? "·" : "⌀";
                  const spoken = entry
                    ? [...status.options]
                        .find((option) => option.value === entry.status)
                        ?.text.toLowerCase() || entry.status
                    : "no record";
                  button.setAttribute(
                    "aria-label",
                    `${short(source)} hears ${short(target)}, ${spoken}`,
                  );
                } else {
                  const band = planner.meshRssi.band(entry.avg);
                  button.dataset.state = band;
                  const average = document.createElement("span");
                  average.textContent = format(entry.avg);
                  button.append(average);
                  const range = document.createElement("small");
                  range.textContent = `${format(entry.min)}–${format(entry.max)}`;
                  button.append(range);
                  button.setAttribute(
                    "aria-label",
                    `${short(source)} hears ${short(target)} ${format(entry.avg)} dBm, ${band}`,
                  );
                }
                cell.append(button);
              }
              return row;
            }),
          );
        };
        /** @param {any} device */
        const modelsOf = (device) => {
          if (device.composition) return device.composition.elements;
          const product = productsBySku.get(device.sku);
          return product
            ? planner.meshSig.composition(product, catalogFile.elementTemplates)
                .elements
            : [];
        };
        const { ids } = planner.meshChannels;
        const writable = new Set(planner.meshChannels.writable);
        const ON_OFF = [ids.onOff, ids.ctl, ids.lightness];
        /** @param {string} unicast */
        const hex = (unicast) => `0x${unicast}`;
        /** @param {string} tag @param {string} name @param {string} [text] */
        const make = (tag, name, text = "") => {
          const element = document.createElement(tag);
          element.dataset.part = name;
          element.textContent = text;
          return element;
        };
        // What makeCard draws from; when it changes, render rebuilds the card.
        /** @param {any} device */
        const identity = (device) =>
          JSON.stringify([
            device.name,
            device.sku,
            device.mac,
            device.composition,
          ]);
        /** @type {WeakMap<Element, string>} */
        const builtFrom = new WeakMap();
        /** @param {any} device */
        const makeCard = (device) => {
          const card = document.createElement("li");
          card.dataset.part = "sandbox-device-card";
          card.dataset.deviceId = device.id;
          card.innerHTML = `
          <div data-part="sandbox-device-header">
            <a data-part="sandbox-device-photo" target="_blank" rel="noopener"><img></a>
            <div data-part="sandbox-device-info">
              <div data-part="sandbox-device-title"><strong data-part="sandbox-device-name"></strong><span data-part="sandbox-led"></span><span data-part="sandbox-device-address"></span></div>
              <span data-part="sandbox-device-meta"></span>
            </div>
            <div data-part="sandbox-device-actions">
              <button type="button" data-part="sandbox-factory-reset">Factory reset</button>
              <button type="button" data-part="sandbox-remove">Remove</button>
            </div>
          </div>
          <div data-part="sandbox-device-fake">
            <label><input type="checkbox" data-part="sandbox-unreachable"> Unreachable</label>
            <label><input type="checkbox" data-part="sandbox-attention"> Supports Attention</label>
            <fieldset data-part="sandbox-fail-steps" role="radiogroup"><legend>Fail Add at</legend>
              <label data-part="sandbox-fail-step"><input type="radio" value="provision"><span>Provision</span></label><span data-part="sandbox-fail-steps-separator" aria-hidden="true">›</span>
              <label data-part="sandbox-fail-step"><input type="radio" value="read"><span>Read</span></label><span data-part="sandbox-fail-steps-separator" aria-hidden="true">›</span>
              <label data-part="sandbox-fail-step"><input type="radio" value="appkey"><span>Setup key</span></label><span data-part="sandbox-fail-steps-separator" aria-hidden="true">›</span>
              <label data-part="sandbox-fail-step"><input type="radio" value="bind"><span>Bind</span></label>
            </fieldset>
          </div>
          <details data-part="sandbox-models-details">
            <summary data-part="sandbox-model-summary"><span data-part="sandbox-model-count"></span><span data-part="sandbox-model-fail-count"></span><span data-part="sandbox-model-source"></span><button type="button" data-part="sandbox-model-clear" hidden>Clear</button></summary>
            <p data-part="sandbox-composition"></p>
            <ul data-part="sandbox-models">
              <li data-part="sandbox-model-header"><span title="Fail writes">✗</span><span>model</span><span>keys</span><span>pub/sub</span><span>state</span><span>value</span></li>
            </ul>
          </details>`;
          const inCard = (name) => card.querySelector(`[data-part="${name}"]`);
          const photo = inCard("sandbox-device-photo");
          const product = productsBySku.get(device.sku);
          const family = product && families[product.family];
          if (family) {
            photo.href = family.shopUrl;
            photo.setAttribute("aria-label", `${device.sku} in the Prox store`);
            const image = photo.querySelector("img");
            image.src = family.image;
            image.alt = device.sku;
          } else photo.remove();
          inCard("sandbox-device-name").textContent = short(device);
          inCard("sandbox-device-meta").textContent = [
            device.sku,
            family?.name.replace(/^PROX-/, ""),
          ]
            .filter(Boolean)
            .join(" · ");
          for (const [name, action] of [
            ["sandbox-factory-reset", "Factory reset"],
            ["sandbox-remove", "Remove"],
            ["sandbox-model-clear", "Clear failing writes for"],
          ])
            inCard(name).setAttribute(
              "aria-label",
              `${action} ${describe(device)}`,
            );
          inCard("sandbox-fail-steps").setAttribute(
            "aria-label",
            `Fail Add at for ${describe(device)}`,
          );
          for (const input of inCard("sandbox-fail-steps").querySelectorAll(
            "input",
          ))
            input.name = `fail-add-${device.id}`;
          const elements = modelsOf(device).map(
            (/** @type {any} */ element) => ({
              models: element.models.map(({ id }) => id.toUpperCase()),
            }),
          );
          const composition = device.composition || product;
          const features = planner.meshChannels
            .features(parseInt(composition?.features || "0", 16))
            .map((feature) => planner.meshChannels.featureNames[feature]);
          inCard("sandbox-composition").textContent = [
            `CID ${composition?.companyId || "—"}`,
            `PID ${composition?.productId || "—"}`,
            `VID ${composition?.versionId || "—"}`,
            `CRPL ${composition?.crpl || "—"}`,
            features.join(", ") || "no features",
          ].join(" · ");
          inCard("sandbox-model-count").textContent =
            `Models (${elements.reduce((count, element) => count + element.models.length, 0)})`;
          const channels = planner.meshChannels.of(
            /** @type {any} */ ({
              elements: elements.map((element, index) => ({
                address: String(index),
                models: element.models.map((id) => ({ id })),
              })),
            }),
          );
          const table = inCard("sandbox-models");
          elements.forEach((element, index) => {
            const block = make("li", "sandbox-model-element");
            const title = make("span", "sandbox-model-element-title");
            const channel = channels.find((entry) =>
              entry.elements.includes(String(index)),
            );
            title.append(
              `Element ${index}${channel ? ` · Ch ${channel.number}` : ""} `,
              make("span", "sandbox-model-address"),
            );
            const rows = document.createElement("ul");
            for (const id of element.models) {
              const name = planner.meshChannels.modelName(id);
              const row = make("li", "sandbox-model-row");
              row.dataset.model = `${index}/${id}`;
              const foundation = planner.meshChannels.foundation.includes(id);
              let fail = document.createElement("span");
              if (writable.has(id)) {
                fail = make("input", "sandbox-model-fail");
                fail.type = "checkbox";
                fail.value = `${index}/${id}`;
                fail.setAttribute(
                  "aria-label",
                  `Fail writes to ${name}, element ${index}`,
                );
              }
              const label = make("span", "sandbox-model-name", name);
              if (foundation)
                label.append(
                  make("span", "sandbox-foundation-tag", "foundation"),
                );
              row.append(
                fail,
                label,
                make("span", "sandbox-model-keys"),
                make("span", "sandbox-model-routes"),
                make("span", "sandbox-model-on"),
                make("span", "sandbox-model-value"),
              );
              rows.append(row);
            }
            block.append(title, rows);
            table.append(block);
          });
          builtFrom.set(card, identity(device));
          return card;
        };
        /** @param {any} device @param {HTMLElement} card */
        const updateCard = (device, card) => {
          const inCard = (name) => card.querySelector(`[data-part="${name}"]`);
          inCard("sandbox-unreachable").checked = Boolean(device.unreachable);
          inCard("sandbox-attention").checked = Boolean(device.attention);
          for (const input of inCard("sandbox-fail-steps").querySelectorAll(
            "input",
          ))
            input.checked = input.value === device.failStep;
          const failed = new Set(device.failWrites || []);
          for (const row of card.querySelectorAll(
            '[data-part="sandbox-model-row"]',
          )) {
            const failing = failed.has(row.dataset.model);
            row.dataset.state = [
              planner.meshChannels.foundation.includes(
                row.dataset.model.split("/")[1],
              ) && "foundation",
              failing && "failing",
            ]
              .filter(Boolean)
              .join(" ");
            const fail = row.querySelector('[data-part="sandbox-model-fail"]');
            if (fail) fail.checked = failing;
          }
          inCard("sandbox-model-fail-count").textContent = failed.size
            ? ` · ${failed.size} failing`
            : "";
          inCard("sandbox-model-clear").hidden = failed.size === 0;
        };
        /** @param {string} id */
        const showDeviceStatus = (id) => {
          const card = [...list.children].find(
            (item) => item.dataset.deviceId === id,
          );
          if (!card) return;
          const device = sandbox.state().devices.find((item) => item.id === id);
          if (!device) return;
          const current = sandbox.deviceStatus(id);
          const node = device.reset
            ? undefined
            : sandbox.nodes().find((entry) => entry.id === id);
          const led = card.querySelector('[data-part="sandbox-led"]');
          led.dataset.state = current.led;
          led.textContent = {
            red: "Unprovisioned",
            "red-blink": "Provisioning…",
            blue: "Provisioned",
            "blue-blink": "Attention",
            "red-flash":
              device.failStep && current.lifecycle !== "provisioned"
                ? `Add failed at ${device.failStep}`
                : "Write failed",
            off: "Off · unreachable",
          }[current.led];
          const address = card.querySelector(
            '[data-part="sandbox-device-address"]',
          );
          address.replaceChildren(device.mac);
          if (node && !node.mac) {
            const missing = make("span", "sandbox-device-no-mac", "no MAC");
            missing.title = "Added over GATT: Web Bluetooth hides the MAC";
            address.replaceChildren(missing);
          }
          if (node) address.append(` · ${hex(node.unicast)}`);
          card.querySelector('[data-part="sandbox-model-source"]').textContent =
            node ? "" : " · catalog composition";
          const range = productsBySku.get(device.sku)?.temperatureRange;
          card
            .querySelectorAll('[data-part="sandbox-model-element"]')
            .forEach((/** @type {HTMLElement} */ block, index) => {
              const element = node?.elements[index];
              block.querySelector(
                '[data-part="sandbox-model-address"]',
              ).textContent = element ? hex(element.address) : "";
              const state = current.models.find(
                (entry) => entry.element === index,
              );
              for (const row of block.querySelectorAll(
                '[data-part="sandbox-model-row"]',
              )) {
                const id = row.dataset.model.split("/")[1];
                const model = element?.models.find((entry) => entry.id === id);
                const [, keys, routes] = model
                  ? planner.meshChannels.modelCells(model)
                  : ["", "—", ""];
                const cell = (/** @type {string} */ name) =>
                  row.querySelector(`[data-part="${name}"]`);
                cell("sandbox-model-keys").textContent = keys;
                cell("sandbox-model-routes").textContent = routes || "—";
                const on =
                  ON_OFF.includes(id) && state?.on !== undefined
                    ? state.on
                      ? "on"
                      : "off"
                    : "";
                cell("sandbox-model-on").textContent = on || "—";
                cell("sandbox-model-on").dataset.state = on;
                const value = cell("sandbox-model-value");
                value.textContent =
                  id === ids.lightness && state?.lightness !== undefined
                    ? `${state.lightness} %`
                    : id === ids.temperature && state?.temperature !== undefined
                      ? `${state.temperature} K`
                      : "—";
                if (id === ids.temperature && range)
                  value.title = `range ${range.min}–${range.max} K`;
              }
            });
        };
        const render = () => {
          const state = sandbox.state();
          const devices = state.devices;
          part("sandbox-devices-title").textContent =
            `Devices (${devices.length})`;
          const choices = devices.map((device) => ({
            value: device.id,
            label: short(device),
          }));
          const pair = `${from.value}>${to.value}`;
          fill(from, choices);
          fill(to, choices);
          if (from.value === to.value && devices.length > 1)
            to.value = choices.find(({ value }) => value !== from.value).value;
          if (`${from.value}>${to.value}` !== pair) showPair();
          drawGrid(devices);
          const cards = new Map(
            [...list.children].map((card) => [card.dataset.deviceId, card]),
          );
          for (const card of cards.values())
            if (!devices.some((device) => device.id === card.dataset.deviceId))
              card.remove();
          devices.forEach((device, index) => {
            let card = cards.get(device.id);
            if (card && builtFrom.get(card) !== identity(device)) {
              const old = card;
              card = makeCard(device);
              const models = '[data-part="sandbox-models-details"]';
              card.querySelector(models).open = old.querySelector(models).open;
              const focused = /** @type {any} */ (document.activeElement);
              old.replaceWith(card);
              if (old.contains(focused)) {
                const part = (/** @type {Element} */ element) =>
                  element.closest("[data-part]")?.dataset.part;
                const twin = [...card.querySelectorAll(focused.tagName)].find(
                  (/** @type {any} */ element) =>
                    part(element) === part(focused) &&
                    element.value === focused.value,
                );
                twin?.focus();
                if (document.activeElement !== twin)
                  card.querySelector('[data-part="sandbox-remove"]').focus();
              }
            }
            card ||= makeCard(device);
            if (list.children[index] !== card)
              list.insertBefore(card, list.children[index] || null);
            updateCard(device, card);
            showDeviceStatus(device.id);
          });
          part("sandbox-vary").checked = Boolean(state.vary);
        };
        listen(sandbox.events, "change", render);
        listen(sandbox.events, "device-status", (event) =>
          showDeviceStatus(event.detail.id),
        );
        // A Link changes a node's subscriptions and nothing else reports it.
        const engine = planner.app.meshEngine();
        if (engine) listen(engine.events, "nodes-changed", render);
        render();
        part("sandbox-content").hidden = false;
        listen(list, "change", (event) => {
          const control = event.target;
          const card = control.closest('[data-part="sandbox-device-card"]');
          if (!card) return;
          const id = card.dataset.deviceId;
          try {
            if (control.dataset.part === "sandbox-unreachable")
              sandbox.setDevice(id, { unreachable: control.checked });
            else if (control.dataset.part === "sandbox-attention")
              sandbox.setDevice(id, { attention: control.checked });
            else if (control.matches('[data-part="sandbox-fail-step"] input'))
              sandbox.setDevice(id, { failStep: control.value });
            else if (control.dataset.part === "sandbox-model-fail") {
              const failing = new Set(
                sandbox.state().devices.find((entry) => entry.id === id)
                  ?.failWrites,
              );
              if (control.checked) failing.add(control.value);
              else failing.delete(control.value);
              sandbox.setDevice(id, { failWrites: [...failing] });
            }
          } catch (error) {
            message(error);
            render();
          }
        });
        listen(list, "click", (event) => {
          // A click on the armed Fail Add at chip disarms it; a radio fires no
          // change for that.
          const step = event.target.closest(
            '[data-part="sandbox-fail-step"] input',
          );
          if (step) {
            const id = step.closest('[data-part="sandbox-device-card"]').dataset
              .deviceId;
            if (
              sandbox.state().devices.find((entry) => entry.id === id)
                ?.failStep === step.value
            )
              sandbox.setDevice(id, { failStep: null });
            return;
          }
          const button = event.target.closest("button");
          const card = button?.closest('[data-part="sandbox-device-card"]');
          if (!button || !card || !list.contains(card)) return;
          const device = sandbox
            .state()
            .devices.find(({ id }) => id === card.dataset.deviceId);
          if (!device) return;
          try {
            if (button.dataset.part === "sandbox-model-clear") {
              // Inside the summary, the click would also toggle Models.
              event.preventDefault();
              sandbox.setDevice(device.id, { failWrites: [] });
              card.querySelector('[data-part="sandbox-model-summary"]').focus();
            } else if (button.dataset.part === "sandbox-factory-reset") {
              sandbox.factoryReset(device.id);
              card.querySelector('[data-part="sandbox-factory-reset"]').focus();
              message(`Factory reset ${describe(device)}.`);
            } else if (button.dataset.part === "sandbox-remove") {
              const at = [...list.children].indexOf(card);
              sandbox.removeDevice(device.id);
              (
                list.children[at]?.querySelector(
                  '[data-part="sandbox-remove"]',
                ) || part("sandbox-devices-title")
              ).focus();
              message(`Removed ${describe(device)}.`);
            }
          } catch (error) {
            message(error);
          }
        });
        listen(grid, "click", (event) => {
          const button = event.target.closest("button");
          if (!button || !grid.contains(button)) return;
          from.value = button.dataset.source;
          to.value = button.dataset.target;
          showPair();
          (status.value === "success" ? form.avg : status).focus();
        });
        listen(from, "change", showPair);
        listen(to, "change", showPair);
        listen(status, "change", showNumbers);
        listen(form, "submit", (/** @type {SubmitEvent} */ event) => {
          event.preventDefault();
          const record = sandbox.state().rssi[`${from.value}>${to.value}`];
          const numbers = Object.fromEntries(
            ["avg", "min", "max"].map((key) => [key, Number(form[key].value)]),
          );
          try {
            sandbox.setRssi(
              from.value,
              to.value,
              status.value === "no-record"
                ? null
                : status.value === "success"
                  ? { ...(record && !record.status && record), ...numbers }
                  : { status: status.value },
            );
            showPair();
            message(
              `Saved RSSI from ${from.selectedOptions[0].text} to ${to.selectedOptions[0].text}.`,
            );
          } catch (error) {
            message(error);
          }
        });
        listen(openRssi, "click", () => {
          dialog.show();
          part("sandbox-rssi-close").focus();
        });
        listen(part("sandbox-rssi-close"), "click", () => dialog.close());
        listen(dialog, "close", () => openRssi.focus());
        // The Developer panel handles Escape in document capture; intercept it
        // at window capture only when it comes from inside this editor.
        listen(
          window,
          "keydown",
          (event) => {
            if (
              event.key !== "Escape" ||
              !dialog.open ||
              !dialog.contains(event.target)
            )
              return;
            event.preventDefault();
            event.stopImmediatePropagation();
            dialog.close();
          },
          true,
        );
        listen(part("sandbox-vary"), "change", (event) => {
          try {
            sandbox.setVary(event.target.checked);
          } catch (error) {
            message(error);
            render();
          }
        });
        const add = part("sandbox-add");
        const catalog = part("sandbox-catalog");
        fill(
          catalog,
          products.map(({ sku }) => ({ value: sku, label: sku })),
        );
        add.disabled = !products.length;
        listen(add, "click", () => {
          try {
            message(`Added ${describe(sandbox.addDevice(catalog.value))}.`);
          } catch (error) {
            message(error);
          }
        });
        const presets = part("sandbox-presets");
        /** @type {{file: string, name: string}[]} */
        let builtins = [];
        // The select is also the indicator: the loaded preset, or a disabled
        // Custom once the devices or RSSI drift from it.
        const renderPresets = () => {
          const { preset } = sandbox.state();
          const edited = sandbox.edited();
          const options = builtins.map(
            ({ file, name }) => new Option(name, file),
          );
          if (preset && !builtins.some(({ name }) => name === preset))
            options.push(new Option(preset, ""));
          if (edited) options.push(new Option("Custom", ""));
          for (const option of options) option.disabled = !option.value;
          presets.replaceChildren(...options);
          presets.selectedIndex = edited
            ? options.length - 1
            : options.findIndex((option) => option.text === preset);
        };
        /** @param {number} count @param {string} noun */
        const counted = (count, noun) =>
          `${count} ${noun}${count === 1 ? "" : "s"}`;
        // Loading over an untouched preset loses nothing, so it asks only when
        // there are edits or nodes to lose.
        const replaces = () =>
          (!sandbox.edited() && !sandbox.nodes().length) ||
          confirm(
            `Replace ${counted(sandbox.state().devices.length, "device")}${sandbox.forgetting()}?`,
          );
        const presetName = () =>
          (!sandbox.edited() && sandbox.state().preset) || "Sandbox";
        listen(sandbox.events, "change", renderPresets);
        listen(presets, "change", async () => {
          const name = presets.selectedOptions[0].text;
          if (!replaces()) return renderPresets();
          try {
            await sandbox.loadPreset(presets.value);
            if (gone) return;
            showPair();
            message(`Loaded ${name}.`);
          } catch (error) {
            message(error);
            renderPresets();
          }
        });
        listen(part("sandbox-view-json"), "click", () => {
          editor = planner.devJsonEditor.open({
            title: "Sandbox preset",
            text: sandbox.exportPreset(presetName()),
            apply: (value) => {
              if (!replaces()) throw new Error("Kept the sandbox.");
              sandbox.importPreset(JSON.stringify(value));
              showPair();
              message("Applied the preset JSON.");
            },
          });
        });
        listen(part("sandbox-export"), "click", () => {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(
            new Blob([sandbox.exportPreset(presetName())], {
              type: "application/json",
            }),
          );
          link.download = "mesh-sandbox.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href));
          message(`Exported ${link.download}.`);
        });
        const importFile = part("sandbox-import");
        listen(part("sandbox-import-open"), "click", () => importFile.click());
        listen(importFile, "change", async () => {
          const file = importFile.files[0];
          if (!file) return;
          try {
            if (replaces()) {
              const contents = await file.text();
              if (gone) return;
              sandbox.importPreset(contents);
              showPair();
              message(`Imported ${file.name}.`);
            }
          } catch (error) {
            message(error);
          }
          if (!gone) importFile.value = "";
        });
        void sandbox
          .presets()
          .then((entries) => {
            if (gone) return;
            builtins = entries;
            renderPresets();
          })
          .catch(message);
      })
      .catch(message);

    return () => {
      gone = true;
      controller.abort();
      editor?.close();
      if (part("sandbox-rssi-dialog").open) part("sandbox-rssi-dialog").close();
      style.remove();
    };
  };

  panel.register({ title: "Sandbox", mount });

  const installChip = () => {
    const group = document.querySelector(
      '[data-part="toolbar-group-development"]',
    );
    if (!group) return false;
    const chip = group.querySelector('[data-part="toolbar-sandbox"]');
    if (new URLSearchParams(location.search).get("mesh-engine") !== "sandbox") {
      chip?.remove();
      return true;
    }
    if (chip) return true;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.part = "toolbar-sandbox";
    button.textContent = "Sandbox";
    button.title = "Sandbox engine active; open the Sandbox page";
    button.setAttribute(
      "aria-label",
      "Sandbox engine is active. Open the Sandbox page in the Developer panel.",
    );
    button.style.width = "auto";
    button.style.paddingInline = "var(--space-3)";
    button.style.whiteSpace = "nowrap";
    button.addEventListener("click", () => panel.open("mesh-sandbox"));
    group.append(button);
    return true;
  };
  const watchToolbar = () => {
    if (installChip()) return;
    const observer = new MutationObserver(() => {
      if (installChip()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  watchToolbar();
}
