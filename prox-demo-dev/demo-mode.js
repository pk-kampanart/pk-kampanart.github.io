/**
 * Owns project-scoped Demo mode: entering and leaving simulated projects, then
 * applying the chosen demo to the Mesh pane. It does not implement the loader,
 * codec, storage, or Mesh simulation; those belong to their respective rails.
 * Channels: listens DOMContentLoaded and user controls; dispatches no planner
 * events and delegates device setup to the demo loader.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const PENDING_KEY = "mesh-planner:demo-mode-pending";
  const CHOICES = new Set(["prox-apartment", "demo-residence", "copy-plan"]);
  /** @type {StoreRails | null} */
  let railsCache = null;
  // Built on first use: scripts load alphabetically, and none works at load.
  /** @returns {StoreRails} */
  const rails = () =>
    (railsCache ??= planner.storeRails.create({
      db: planner.db,
      codec: planner.schema.setup().codec,
    }));
  const active = () => planner.projects.isDemo(planner.app.read());

  /** @param {string} choice */
  const enter = async (choice) => {
    if (!CHOICES.has(choice)) throw new Error(`Unknown demo choice: ${choice}`);
    await planner.app.ready();
    if (active()) throw new Error("Already in Demo mode");
    await planner.app.flush();
    const loader = planner.demoLoader;
    if (!loader) throw new Error("Demo loader is unavailable");
    const current = planner.app.read();
    let plan;
    if (choice === "copy-plan") {
      plan = planner.codec.copy(current);
      plan.project.name = `${current.project.name} (demo)`;
      for (const area of plan.areas)
        for (const application of area.applications)
          for (const type of application.deviceTypes)
            for (const instance of type.instances) delete instance.assignment;
    } else {
      const demo = await loader.load(choice);
      plan = await loader.hydrate(demo);
    }
    const created = await rails().createDemoProject(plan);
    if (!created.ok || !created.record)
      throw new Error(created.reason || "Could not create demo project");
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ id: created.record.id, choice }),
    );
    planner.db.setLastProjectId(created.record.id);
    location.reload();
  };

  const leave = async () => {
    await planner.app.ready();
    if (!active()) return;
    await planner.app.flush();
    const db = planner.db;
    const last = db.getLastRealProjectId();
    let real = last && (await db.getProject(last));
    const isDemoRecord = (record) =>
      planner.projects.isDemo(/** @type {PlanDocument} */ (record.payload));
    if (real && isDemoRecord(real)) real = null;
    if (!real) {
      const projects = await db.getAllProjects();
      real = projects.find((record) => !isDemoRecord(record)) || null;
    }
    if (!real) {
      const created = await rails().createProject(
        await db.defaultProjectName(),
      );
      if (!created.ok || !created.record)
        throw new Error(created.reason || "Could not create real project");
      real = created.record;
    }
    db.setLastProjectId(real.id);
    db.setLastRealProjectId(real.id);
    if (planner.meshEngineForced === true) planner.clearMeshEngineOverride?.();
    else location.reload();
  };

  planner.demoMode = Object.freeze({ active, enter, leave });

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      const template = /** @type {HTMLTemplateElement | null} */ (
        document.querySelector('[data-part="demo-dialog-template"]')
      );
      const dialog = /** @type {HTMLDialogElement | null} */ (
        template?.content.firstElementChild?.cloneNode(true)
      );
      const tryTemplate = /** @type {HTMLTemplateElement | null} */ (
        document.querySelector('[data-part="demo-try-template"]')
      );
      const leaveTemplate = /** @type {HTMLTemplateElement | null} */ (
        document.querySelector('[data-part="demo-leave-template"]')
      );
      const entry = /** @type {HTMLElement | null} */ (
        document.querySelector('[data-part="demo-entry"]')
      );
      const sign = /** @type {HTMLElement | null} */ (
        document.querySelector('[data-part="demo-sign"]')
      );
      const label = sign?.querySelector('[data-part="demo-sign-label"]');
      const signError = sign?.querySelector('[data-part="demo-sign-error"]');
      const error = /** @type {HTMLElement | null} */ (
        dialog?.querySelector('[data-part="demo-error"]')
      );
      if (
        !dialog ||
        !tryTemplate ||
        !leaveTemplate ||
        !entry ||
        !sign ||
        !label ||
        !signError ||
        !error
      )
        throw new Error("Demo mode controls are missing");
      // A saved page may carry a failure from the session it was saved in.
      signError.textContent = "";
      document.body.append(dialog);
      // State tokens, never `hidden`: a saved-page snapshot drops hidden elements.
      const say = (message) => {
        error.textContent = message;
      };
      /**
       * A control that belongs to one project kind exists only while that kind
       * is open, so a reader without author styles never meets it on the
       * other. A saved page already carries it; it is reused, never doubled.
       * @param {HTMLTemplateElement} template
       * @param {HTMLElement} parent
       * @param {Node | null} before
       * @param {boolean} wanted
       */
      const place = (template, parent, before, wanted) => {
        const control = /** @type {HTMLButtonElement} */ (
          template.content.firstElementChild
        );
        const saved = /** @type {HTMLButtonElement | null} */ (
          parent.querySelector(
            `[data-part="${control.getAttribute("data-part")}"]`,
          )
        );
        if (!wanted) {
          saved?.remove();
          return null;
        }
        if (saved) {
          saved.disabled = false;
          return saved;
        }
        const button = /** @type {HTMLButtonElement} */ (
          control.cloneNode(true)
        );
        parent.insertBefore(button, before);
        return button;
      };
      dialog
        .querySelector('[data-part="demo-cancel"]')
        ?.addEventListener("click", () => dialog.close());
      for (const [part, choice] of [
        ["demo-prox-apartment", "prox-apartment"],
        ["demo-demo-residence", "demo-residence"],
        ["demo-copy-plan", "copy-plan"],
      ]) {
        const button = /** @type {HTMLButtonElement | null} */ (
          dialog.querySelector(`[data-part="${part}"]`)
        );
        button?.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await enter(choice);
          } catch (cause) {
            say(`Could not open demo: ${String(cause)}`);
            button.disabled = false;
          }
        });
      }

      void planner.app.ready().then(async () => {
        const demo = active();
        const kind = demo ? "demo" : "real";
        entry.setAttribute("data-state", kind);
        sign.setAttribute("data-state", kind);
        const tryButton = place(tryTemplate, entry, null, !demo);
        if (tryButton) {
          dialog.addEventListener("close", () => tryButton.focus());
          tryButton.addEventListener("click", () => {
            say("");
            dialog.showModal();
            /** @type {HTMLButtonElement | null} */ (
              dialog.querySelector('[data-part="demo-prox-apartment"]')
            )?.focus();
          });
        }
        const leaveButton = place(leaveTemplate, sign, signError, demo);
        leaveButton?.addEventListener("click", async () => {
          leaveButton.disabled = true;
          try {
            await leave();
          } catch (cause) {
            leaveButton.disabled = false;
            signError.textContent = `Could not leave Demo mode: ${String(cause)}`;
          }
        });
        const text = demo ? "Demo Mode — Simulated Devices" : "";
        // The next frame, so the status region is in the accessibility tree
        // before it speaks; a saved page already carrying the text stays quiet.
        if (label.textContent !== text)
          requestAnimationFrame(() => (label.textContent = text));
        if (!demo) return;
        const pending = sessionStorage.getItem(PENDING_KEY);
        if (!pending) return;
        sessionStorage.removeItem(PENDING_KEY);
        try {
          const { id, choice } = JSON.parse(pending);
          if (id !== planner.app.read().project.id || !CHOICES.has(choice))
            return;
          const loader = planner.demoLoader;
          if (!loader) throw new Error("Demo loader is unavailable");
          const current = planner.app.read();
          const demoFile =
            choice === "copy-plan"
              ? {
                  name: current.project.name,
                  plan: current,
                  sandbox: await loader.preset("test-rig.json"),
                  add: [],
                }
              : await loader.load(choice);
          await loader.run(demoFile, { plan: false });
        } catch (cause) {
          signError.textContent = `Could not load simulated devices: ${String(cause)}`;
        }
      });
    },
    { once: true },
  );
}
