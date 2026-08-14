/**
 * Development-only prototype review controls. The review host owns the
 * prototype registry; this page only changes whether its review chrome shows.
 */
{
  const panel = window.PlannerDevPanel;
  const prototypes = window.PlannerDevPrototypes;
  if (!panel?.register)
    throw new Error("Developer panel host is unavailable");
  if (!prototypes?.subscribe)
    throw new Error("Prototype review host is unavailable");

  /** @param {HTMLElement} root */
  const mount = (root) => {
    root.innerHTML = `
      <section data-part="prototypes-page" aria-label="Prototype controls">
        <h3 data-part="prototypes-heading">Prototypes</h3>
        <label data-part="prototypes-toggle">
          <input type="checkbox" data-action="prototype-review" />
          Show prototype review controls
        </label>
        <p data-part="prototypes-status" role="status"></p>
      </section>`;

    const toggle = /** @type {HTMLInputElement} */ (
      root.querySelector('[data-action="prototype-review"]')
    );
    const status = /** @type {HTMLElement} */ (
      root.querySelector('[data-part="prototypes-status"]')
    );

    const render = ({ available, reviewEnabled }) => {
      toggle.disabled = available.length === 0;
      toggle.checked = available.length > 0 && reviewEnabled;
      status.textContent = available.length
        ? `${available.length} prototype${available.length === 1 ? "" : "s"} available.`
        : "No prototypes are loaded.";
    };
    const unsubscribe = prototypes.subscribe(render);
    const change = () => prototypes.setReviewEnabled(toggle.checked);
    toggle.addEventListener("change", change);
    return () => {
      toggle.removeEventListener("change", change);
      unsubscribe();
    };
  };

  panel.register({ title: "Prototypes", mount });
}
