/**
 * Ships with Demo mode under ADR-0013: loads embedded plans and drives the
 * Mesh pane's own controls to connect and add simulated devices. Production
 * code may not drive those controls; this file does not own the pane or boot.
 * Channels: reads planner views and embedded files; uses Mesh pane controls.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const DEMOS = "dev/demo-projects/";
  const PANE_WAIT_TIMEOUT_MS = 10_000;

  const isObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  /** @param {string} path */
  const readJson = async (path) => {
    const embedded = planner.embeddedFiles?.text(path);
    if (embedded !== null && embedded !== undefined)
      return JSON.parse(embedded);
    const response = await fetch(path);
    if (!response.ok)
      throw new Error(`cannot read ${path}: ${response.status}`);
    return response.json();
  };

  const schema = planner.schema.read();
  const validate = (demo) => {
    if (!isObject(demo)) return ["Demo must be a JSON object"];
    const allowed = new Set([
      "name",
      "plan",
      "sandbox",
      "sandboxPreset",
      "add",
    ]);
    const extra = Object.keys(demo).filter((key) => !allowed.has(key));
    if (extra.length)
      return [`Demo has unsupported fields: ${extra.join(", ")}`];
    if (typeof demo.name !== "string" || !demo.name.trim())
      return ["Demo needs a name"];
    const result = planner.codec.read(demo.plan, schema);
    if (!result.ok) return [`Plan: ${result.reason}`];
    if (
      demo.sandbox !== undefined &&
      (demo.sandboxPreset !== undefined || !isObject(demo.sandbox))
    )
      return [
        "Sandbox preset must be an object or a preset reference, not both",
      ];
    if (
      demo.sandboxPreset !== undefined &&
      (typeof demo.sandboxPreset !== "string" ||
        !/^[a-z0-9-]+\.json$/.test(demo.sandboxPreset))
    )
      return ["Sandbox preset reference must name a JSON file"];
    if (
      demo.add !== undefined &&
      (!Array.isArray(demo.add) ||
        !demo.add.every((id) => typeof id === "string"))
    )
      return ["Add must be a list of device IDs"];
    if (
      demo.add?.length &&
      demo.sandbox === undefined &&
      demo.sandboxPreset === undefined
    )
      return ["Add requires a sandbox preset"];
    if (
      demo.sandbox &&
      demo.add?.some(
        (id) => !demo.sandbox.devices?.some((device) => device.id === id),
      )
    )
      return ["Add device IDs must exist in the sandbox preset"];
    return [];
  };

  /** @param {any} demo */
  const validateSandbox = async (demo) => {
    const sandbox = demo.sandboxPreset
      ? await readJson(`dev/sandbox-presets/${demo.sandboxPreset}`)
      : demo.sandbox;
    if (sandbox === undefined) return;
    const checker = planner.meshSandboxPreset;
    if (typeof checker?.check !== "function")
      throw new Error("Sandbox preset validator is unavailable");
    await checker.check(JSON.stringify(sandbox));
    if (
      demo.add?.some(
        (id) => !sandbox.devices?.some((device) => device.id === id),
      )
    )
      throw new Error("Add device IDs must exist in the sandbox preset");
  };

  /** @param {string} path */
  const dataUrlOf = async (path) => {
    const embedded = planner.embeddedFiles?.url(path);
    if (embedded) return embedded;
    const response = await fetch(path);
    if (!response.ok)
      throw new Error(`cannot read ${path}: ${response.status}`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  };

  /** @param {DemoProject} demo */
  const hydratedPlan = async (demo) => {
    const invalid = validate(demo);
    if (invalid.length) throw new Error(invalid.join("; "));
    const plan = planner.codec.copy(demo.plan);
    await Promise.all(
      plan.areas.map(async (area) => {
        const background = area.background;
        if (background && !/^data:/i.test(background.src))
          background.src = await dataUrlOf(background.src);
      }),
    );
    const result = planner.codec.read(plan, schema);
    if (!result.ok) throw new Error(`Plan: ${result.reason}`);
    return result.plan;
  };

  const list = async () => {
    const entries = await readJson(`${DEMOS}index.json`);
    if (
      !Array.isArray(entries) ||
      !entries.every(
        (entry) =>
          isObject(entry) &&
          typeof entry.name === "string" &&
          typeof entry.file === "string" &&
          /^[a-z0-9-]+\.json$/.test(entry.file),
      )
    )
      throw new Error("Demo index must be a list of named demo files");
    return entries.map((entry) => ({
      id: entry.file.slice(0, -".json".length),
      name: entry.name,
    }));
  };

  /** @param {string} id */
  const load = async (id) => {
    const entries = await list();
    if (!entries.some((entry) => entry.id === id))
      throw new Error(`Demo is not listed: ${id}`);
    const demo = await readJson(`${DEMOS}${id}.json`);
    const invalid = validate(demo);
    if (invalid.length) throw new Error(`${id}: ${invalid.join("; ")}`);
    await validateSandbox(demo);
    return demo;
  };

  /** @param {string} file */
  const preset = (file) => readJson(`dev/sandbox-presets/${file}`);

  /** @param {HTMLElement} pane @param {() => boolean} condition */
  const waitForPane = (pane, condition) =>
    new Promise((resolve, reject) => {
      let settled = false;
      let observer;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        window.clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (condition()) finish();
      };
      const timeout = window.setTimeout(
        () =>
          finish(
            new Error(
              `Timed out waiting for the Mesh pane after ${PANE_WAIT_TIMEOUT_MS} ms`,
            ),
          ),
        PANE_WAIT_TIMEOUT_MS,
      );
      observer = new MutationObserver(check);
      observer.observe(pane, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      check();
    });

  const deviceCount = (plan) =>
    plan.areas
      .flatMap((area) => area.applications)
      .flatMap((application) => application.deviceTypes)
      .reduce((total, type) => total + type.instances.length, 0);

  /** @param {DemoProject} demo @param {{plan?: boolean, devices?: boolean}} [options] */
  const run = async (demo, options = {}) => {
    const invalid = validate(demo);
    if (invalid.length) throw new Error(invalid.join("; "));
    await validateSandbox(demo);
    let plan = planner.app.read();
    if (options.plan !== false) {
      plan = await hydratedPlan(demo);
      plan.project.id = planner.app.read().project.id;
      planner.selection.activeArea(plan, plan.areas[0].id);
      planner.app.replace(plan);
      await planner.app.flush();
    }

    let fakes = 0;
    let added = 0;
    const sandbox = options.devices === false ? null : planner.meshSandbox;
    const presetFile = demo.sandboxPreset
      ? await readJson(`dev/sandbox-presets/${demo.sandboxPreset}`)
      : demo.sandbox;
    if (presetFile !== undefined && options.devices !== false && !sandbox)
      throw new Error("Mesh sandbox is unavailable");
    if (sandbox && presetFile !== undefined) {
      sandbox.importPreset(JSON.stringify(presetFile));
      fakes = sandbox.state().devices.length;
      const pane = /** @type {HTMLElement | null} */ (
        document.querySelector('[data-part="mesh"]')
      );
      if (!pane) throw new Error("Mesh pane is unavailable");
      const dongle = /** @type {HTMLButtonElement | null} */ (
        pane.querySelector('[data-part="mesh-via-dongle"]')
      );
      const connect = /** @type {HTMLButtonElement | null} */ (
        pane.querySelector('[data-part="mesh-connect"]')
      );
      if (!dongle || !connect)
        throw new Error("Mesh pane connection controls are unavailable");
      const connected = () =>
        pane.getAttribute("data-state")?.split(/\s+/).includes("connected");
      if (connected() && dongle.getAttribute("aria-pressed") !== "true") {
        const disconnect = pane.querySelector('[data-part="mesh-disconnect"]');
        if (!disconnect)
          throw new Error("Mesh pane Disconnect control is unavailable");
        disconnect.click();
        await waitForPane(pane, () => !connected());
      }
      // Locked while connected, when the dongle is already the transport.
      dongle.click();
      if (!connected()) {
        await waitForPane(pane, () => !connect.disabled);
        connect.click();
        await waitForPane(pane, connected);
      }

      const nearby = pane.querySelector('[data-part="mesh-nearby-list"]');
      const nodes = pane.querySelector('[data-part="mesh-node-list"]');
      if (!nearby || !nodes) throw new Error("Mesh pane lists are unavailable");
      const existing = new Set(sandbox.nodes().map((node) => node.id));
      for (const id of demo.add || []) {
        if (existing.has(id)) continue;
        const device = sandbox.state().devices.find((entry) => entry.id === id);
        if (!device) throw new Error(`Preset device not found: ${id}`);
        await waitForPane(pane, () =>
          [...nearby.querySelectorAll('[data-part="mesh-nearby-row"]')].some(
            (row) =>
              row.querySelector('[data-part="mesh-nearby-name"]')
                ?.textContent === device.name,
          ),
        );
        const row = [
          ...nearby.querySelectorAll('[data-part="mesh-nearby-row"]'),
        ].find(
          (entry) =>
            entry.querySelector('[data-part="mesh-nearby-name"]')
              ?.textContent === device.name,
        );
        const add = row?.querySelector('[data-part="mesh-add"]');
        if (!add) throw new Error(`Mesh pane cannot add ${device.name}`);
        add.click();
        await waitForPane(pane, () =>
          [...nodes.querySelectorAll('[data-part="mesh-node"]')].some(
            (node) => node.getAttribute("data-id") === id,
          ),
        );
        existing.add(id);
        added++;
      }
    }
    return { placed: deviceCount(plan), fakes, added };
  };

  planner.demoLoader = Object.freeze({
    list,
    load,
    preset,
    hydrate: hydratedPlan,
    run,
    validate,
    validateSandbox,
  });
}
