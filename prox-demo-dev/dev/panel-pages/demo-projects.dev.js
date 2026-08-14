/** Development-only Developer panel for built-in and editable local demos. */
{
  const panel = window.PlannerDevPanel;
  if (!panel?.register) throw new Error("Developer panel host is unavailable");

  const planner = window.Planner;
  const loader = planner.demoLoader;
  if (!loader) throw new Error("Demo loader is unavailable");
  const MY_DEMOS_KEY = "mesh-planner:my-demos";
  const RESUME_KEY = "mesh-planner:demo-resume";
  const validateDemo = loader.validate;
  const validateSandbox = loader.validateSandbox;

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

  /** @param {DemoProject} demo @param {{confirmed?: boolean}} options */
  const loadDemo = async (demo, options = {}) => {
    const invalid = validateDemo(demo);
    if (invalid.length) throw new Error(invalid.join("; "));
    await validateSandbox(demo);
    const hasSandbox =
      demo.sandbox !== undefined || demo.sandboxPreset !== undefined;
    const accepted = hasSandbox
      ? options.confirmed === true ||
        window.confirm(
          `Load the ${demo.name} fake devices into the sandbox and switch to sandbox mode${planner.meshSandbox?.forgetting() ?? ""}?`,
        )
      : false;

    if (accepted) {
      const current = new URL(location.href);
      if (current.searchParams.get("mesh-engine") !== "sandbox") {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify(demo));
        current.searchParams.set("mesh-engine", "sandbox");
        location.href = current.href;
        return null;
      }
    }

    const result = await loader.run(demo, { devices: accepted });
    return `Loaded ${demo.name}: ${result.placed} devices placed, ${result.fakes} fake devices, ${result.added} added`;
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
        const entries = await loader.list();
        const demos = await Promise.all(
          entries.map((entry) => loader.load(entry.id)),
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
