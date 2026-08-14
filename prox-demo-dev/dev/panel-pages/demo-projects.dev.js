/**
 * Development-only demo loader. It may fetch demo assets, use browser storage,
 * reload the page and drive the Mesh pane; Plan changes still go through the
 * application facade so each load is one undo step.
 */
{
  const panel = window.PlannerDevPanel;
  if (!panel?.register) throw new Error("Developer panel host is unavailable");

  const planner = window.Planner;
  const DEMOS = "dev/demo-projects/";
  const MY_DEMOS_KEY = "mesh-planner:my-demos";
  const RESUME_KEY = "mesh-planner:demo-resume";
  const PANE_WAIT_TIMEOUT_MS = 10_000;

  const isObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  const schema = () => {
    const source = document.querySelector('[data-part="schema"]');
    if (!source) throw new Error("Plan schema is unavailable");
    return JSON.parse(source.textContent || "{}");
  };

  /** @param {any} demo @returns {string[]} */
  const validateDemo = (demo) => {
    if (!isObject(demo)) return ["Demo must be a JSON object"];
    const allowed = new Set(["name", "plan", "sandbox", "add"]);
    const extra = Object.keys(demo).filter((key) => !allowed.has(key));
    if (extra.length)
      return [`Demo has unsupported fields: ${extra.join(", ")}`];
    if (typeof demo.name !== "string" || !demo.name.trim())
      return ["Demo needs a name"];
    if (!isObject(demo.plan)) return ["Demo needs a plan object"];
    const result = planner.codec.read(demo.plan, schema());
    if (!result.ok) return [`Plan: ${result.reason}`];
    if (demo.sandbox !== undefined && !isObject(demo.sandbox))
      return ["Sandbox preset must be an object"];
    if (
      demo.add !== undefined &&
      (!Array.isArray(demo.add) ||
        !demo.add.every((id) => typeof id === "string"))
    )
      return ["Add must be a list of device IDs"];
    if (demo.add?.length && demo.sandbox === undefined)
      return ["Add requires a sandbox preset"];
    if (
      demo.add?.some(
        (id) => !demo.sandbox.devices?.some((device) => device.id === id),
      )
    )
      return ["Add device IDs must exist in the sandbox preset"];
    return [];
  };

  /** @param {any} demo */
  const validateSandbox = async (demo) => {
    if (demo.sandbox === undefined) return;
    const checker = planner.meshSandboxPreset;
    if (typeof checker?.check !== "function")
      throw new Error("Sandbox preset validator is unavailable");
    await checker.check(JSON.stringify(demo.sandbox));
  };

  /** @param {string} text @returns {string[]} */
  const validateText = (text) => {
    let demo;
    try {
      demo = JSON.parse(text);
    } catch (error) {
      return [`Demo is not valid JSON: ${String(error)}`];
    }
    return validateDemo(demo);
  };

  /** @param {string} url @returns {Promise<string>} */
  const dataUrlOf = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`cannot read ${url}: ${response.status}`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  };

  /** @param {any} demo */
  const hydratedPlan = async (demo) => {
    const invalid = validateDemo(demo);
    if (invalid.length) throw new Error(invalid.join("; "));
    const plan = planner.codec.copy(demo.plan);
    await Promise.all(
      plan.floors.map(async (floor) => {
        const background = floor.background;
        if (background && !/^data:/i.test(background.src))
          background.src = await dataUrlOf(background.src);
      }),
    );
    const result = planner.codec.read(plan, schema());
    if (!result.ok) throw new Error(`Plan: ${result.reason}`);
    return result.plan;
  };

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
    plan.floors
      .flatMap((floor) => floor.applications)
      .flatMap((application) => application.deviceTypes)
      .reduce((total, type) => total + type.instances.length, 0);

  /** @param {any} demo @param {{confirmed?: boolean}} options */
  const loadDemo = async (demo, options = {}) => {
    const invalid = validateDemo(demo);
    if (invalid.length) throw new Error(invalid.join("; "));
    await validateSandbox(demo);
    const hasSandbox = demo.sandbox !== undefined;
    const accepted = hasSandbox
      ? options.confirmed === true ||
        window.confirm(
          `Load the ${demo.name} fake devices into the sandbox and switch to sandbox mode${planner.meshSandbox?.forgetting() ?? ""}?`,
        )
      : false;

    if (hasSandbox && accepted) {
      const current = new URL(location.href);
      if (current.searchParams.get("mesh-engine") !== "sandbox") {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify(demo));
        current.searchParams.set("mesh-engine", "sandbox");
        location.href = current.href;
        return null;
      }
    }

    const sandbox = hasSandbox && accepted ? planner.meshSandbox : null;
    if (hasSandbox && accepted && !sandbox)
      throw new Error("Mesh sandbox is unavailable after reload");
    const plan = await hydratedPlan(demo);
    plan.project.id = planner.app.read().project.id;
    planner.selection.activeFloor(plan, plan.floors[0].id);
    planner.app.replace(plan);
    await planner.app.flush();

    let fakes = 0;
    let added = 0;
    if (sandbox) {
      sandbox.importPreset(JSON.stringify(demo.sandbox));
      fakes = sandbox.state().devices.length;
      const pane = /** @type {HTMLElement | null} */ (
        document.querySelector('[data-part="mesh"]')
      );
      if (!pane) throw new Error("Mesh pane is unavailable");
      const via = /** @type {HTMLSelectElement | null} */ (
        pane.querySelector('[data-part="mesh-via"]')
      );
      const connect = /** @type {HTMLButtonElement | null} */ (
        pane.querySelector('[data-part="mesh-connect"]')
      );
      if (!via || !connect)
        throw new Error("Mesh pane connection controls are unavailable");
      const connected = () =>
        pane.getAttribute("data-state")?.split(/\s+/).includes("connected");
      if (connected() && via.value !== "dongle") {
        const disconnect = pane.querySelector('[data-part="mesh-disconnect"]');
        if (!disconnect)
          throw new Error("Mesh pane Disconnect control is unavailable");
        disconnect.click();
        await waitForPane(pane, () => !connected());
      }
      via.value = "dongle";
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
    return `Loaded ${demo.name}: ${deviceCount(plan)} devices placed, ${fakes} fake devices, ${added} added`;
  };

  /** @param {string} id @param {any} demo */
  const saveMyDemo = (id, demo) => {
    const entries = JSON.parse(localStorage.getItem(MY_DEMOS_KEY) || "[]");
    const index = entries.findIndex((entry) => entry.id === id);
    const item = { id, demo };
    if (index < 0) entries.push(item);
    else entries[index] = item;
    localStorage.setItem(MY_DEMOS_KEY, JSON.stringify(entries));
  };

  /** @param {any} demo */
  const download = (demo) => {
    const blob = new Blob([`${JSON.stringify(demo, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${
      demo.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "demo"
    }.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /** @param {HTMLElement} root */
  const mount = (root) => {
    root.innerHTML = `
      <section data-part="demo-projects-page" aria-label="Load Demo Project">
        <h3 data-part="demo-projects-heading">Load Demo Project</h3>
        <p data-part="demo-projects-note">
          Load a saved plan and, optionally, its matching fake devices. Each plan
          replacement is one undo step.
        </p>
        <section data-part="demo-projects-builtins" aria-label="Built-in demos">
          <h4>Built-in demos</h4>
          <div data-part="demo-projects-builtins-list"></div>
        </section>
        <section data-part="demo-projects-mine" aria-label="My demos">
          <h4>My demos</h4>
          <div data-part="demo-projects-mine-list"></div>
        </section>
        <p data-part="demo-projects-status" role="status"></p>
      </section>`;
    const style = document.createElement("style");
    style.textContent = `
      [data-part="demo-projects-heading"] { margin: 0 0 12px; }
      [data-part="demo-projects-note"] { margin: 0 0 16px; color: var(--text-muted, #586474); }
      [data-part="demo-projects-builtins"], [data-part="demo-projects-mine"] { display: grid; gap: 8px; margin-block: 16px; }
      [data-part="demo-projects-builtins"] h4, [data-part="demo-projects-mine"] h4 { margin: 0; }
      [data-part="demo-project-row"] { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px; border: 1px solid var(--border, #d8dee8); border-radius: var(--radius, 6px); }
      [data-part="demo-project-name"] { flex: 1 1 10rem; font-weight: 600; }
      [data-part="demo-projects-page"] button { font: inherit; }
      [data-part="demo-projects-status"] { margin: 12px 0 0; }
      [data-part="demo-projects-status"][data-state~="failed"] { color: var(--danger-strong, #a61b1b); }
    `;
    root.append(style);
    const builtins = /** @type {HTMLElement} */ (
      root.querySelector('[data-part="demo-projects-builtins-list"]')
    );
    const mine = /** @type {HTMLElement} */ (
      root.querySelector('[data-part="demo-projects-mine-list"]')
    );
    const status = /** @type {HTMLElement} */ (
      root.querySelector('[data-part="demo-projects-status"]')
    );
    status.tabIndex = -1;
    let alive = true;
    let editor = null;
    const focusMine = (id, part = "demo-edit") => {
      const row = [
        ...mine.querySelectorAll('[data-part="demo-project-row"]'),
      ].find((candidate) => candidate.dataset.id === id);
      const target = row?.querySelector(`[data-part="${part}"]`);
      if (target instanceof HTMLElement) target.focus();
      else mine.focus();
    };
    const say = (message, failed = false) => {
      status.textContent = message;
      if (failed) status.dataset.state = "failed";
      else status.removeAttribute("data-state");
    };
    const button = (label, action) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = label;
      element.addEventListener("click", action);
      return element;
    };
    const openEditor = (title, demo, readOnly, apply, applyLabel) => {
      if (!planner.devJsonEditor) throw new Error("JSON editor is unavailable");
      editor = planner.devJsonEditor.open({
        title,
        text: `${JSON.stringify(demo, null, 2)}\n`,
        readOnly,
        validate: validateText,
        ...(apply && {
          apply: async (value) => say(await apply(value)),
          applyLabel,
        }),
      });
    };
    const rowFor = (demo, kind, index, demoId) => {
      const row = document.createElement("div");
      row.dataset.id = demoId || "";
      row.dataset.part = "demo-project-row";
      row.tabIndex = -1;
      const name = document.createElement("span");
      name.dataset.part = "demo-project-name";
      name.textContent = demo.name;
      row.append(name);
      const actionButton = (label, part, action) => {
        const control = button(label, action);
        control.dataset.part = part;
        return control;
      };
      row.append(
        button("Load", async () => {
          const controls = [...row.querySelectorAll("button")];
          controls.forEach((control) => (control.disabled = true));
          say(`Loading ${demo.name}…`);
          try {
            const message = await loadDemo(demo);
            if (message) say(message);
          } catch (error) {
            say(`Could not load ${demo.name}: ${String(error)}`, true);
          } finally {
            if (alive)
              controls.forEach((control) => (control.disabled = false));
          }
        }),
      );
      if (kind === "built-in") {
        row.append(
          button("View JSON", () =>
            openEditor(`${demo.name} JSON`, demo, true),
          ),
          button("Copy as new", () => {
            const copy = planner.codec.copy(demo);
            copy.name = `Copy of ${demo.name}`;
            saveMyDemo(planner.db.createId(), copy);
            renderMine();
            say(`Copied ${demo.name} to My demos.`);
          }),
        );
      } else {
        row.append(
          actionButton("Edit", "demo-edit", () =>
            openEditor(
              `Edit ${demo.name}`,
              demo,
              false,
              async (value) => {
                const invalid = validateDemo(value);
                if (invalid.length) throw new Error(invalid.join("; "));
                await validateSandbox(value);
                saveMyDemo(demoId, value);
                renderMine();
                window.setTimeout(() => focusMine(demoId), 0);
                return `Saved ${value.name} to My demos.`;
              },
              "Save",
            ),
          ),
          actionButton("Delete", "demo-delete", () => {
            const entries = JSON.parse(
              localStorage.getItem(MY_DEMOS_KEY) || "[]",
            );
            entries.splice(index, 1);
            localStorage.setItem(MY_DEMOS_KEY, JSON.stringify(entries));
            renderMine();
            status.focus();
            say(`Deleted ${demo.name}.`);
          }),
          button("Export", () => download(demo)),
        );
      }
      return row;
    };
    const renderMine = () => {
      let entries;
      try {
        entries = JSON.parse(localStorage.getItem(MY_DEMOS_KEY) || "[]");
      } catch (error) {
        entries = [];
        say(`Could not read My demos: ${String(error)}`, true);
      }
      if (!Array.isArray(entries)) entries = [];
      mine.replaceChildren(
        ...entries.map((entry, index) =>
          rowFor(entry.demo, "mine", index, entry.id),
        ),
      );
      if (entries.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "No saved demos.";
        mine.append(empty);
      }
    };
    const loadBuiltins = async () => {
      try {
        const response = await fetch(`${DEMOS}index.json`);
        if (!response.ok)
          throw new Error(`cannot read demo index: ${response.status}`);
        const entries = await response.json();
        if (!Array.isArray(entries))
          throw new Error("Demo index must be a list");
        const demos = await Promise.all(
          entries.map(async (entry) => {
            const file = await fetch(`${DEMOS}${entry.file}`);
            if (!file.ok)
              throw new Error(`cannot read ${entry.file}: ${file.status}`);
            const demo = await file.json();
            const invalid = validateDemo(demo);
            if (invalid.length)
              throw new Error(`${entry.name}: ${invalid.join("; ")}`);
            await validateSandbox(demo);
            return demo;
          }),
        );
        if (!alive) return;
        builtins.replaceChildren(
          ...demos.map((demo, index) => rowFor(demo, "built-in", index)),
        );
      } catch (error) {
        say(`Could not list built-in demos: ${String(error)}`, true);
      }
    };
    renderMine();
    void loadBuiltins();

    try {
      const pending = sessionStorage.getItem(RESUME_KEY);
      if (pending) {
        sessionStorage.removeItem(RESUME_KEY);
        const demo = JSON.parse(pending);
        void planner.app.ready().then(async () => {
          if (!alive) return;
          say(`Resuming ${demo.name}…`);
          try {
            const message = await loadDemo(demo, { confirmed: true });
            if (message) say(message);
          } catch (error) {
            say(`Could not load ${demo.name}: ${String(error)}`, true);
          }
        });
      }
    } catch (error) {
      say(`Could not resume demo load: ${String(error)}`, true);
    }

    return () => {
      alive = false;
      editor?.close();
      style.remove();
    };
  };

  panel.register({ title: "Load Demo Project", mount });
}
