/**
 * Provides shared DOM helpers: focus for pointer-selected elements, what
 * owns a key, data-state tokens, and the notice over the floor plan.
 * Contributes focusPointer, editable, ownsSpace, state and notice to
 * Planner.dom; it listens to no channels.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const dom = planner.dom || (planner.dom = /** @type {DomNamespace} */ ({}));

  const focusPointer = (/** @type {Element} */ element) => {
    const target =
      /** @type {{blur: () => void, focus: (options?: {focusVisible?: boolean}) => void}} */ (
        /** @type {unknown} */ (element)
      );
    if (document.activeElement === element) target.blur();
    target.focus({ focusVisible: false });
  };

  // A selection radio is focus, not text entry (ADR-0008): a shortcut must
  // still reach the document while a row is selected.
  const EDITABLE =
    'input:not([type="radio"]), textarea, select, [contenteditable="true"], [role="textbox"], dialog';

  const editable = (/** @type {EventTarget | null} */ target) =>
    Boolean(/** @type {Element | null} */ (target)?.closest?.(EDITABLE));

  // A focused field types a space and a focused button is pressed by one, so
  // only elsewhere may Space arm the surface's pan.
  const ownsSpace = (/** @type {EventTarget | null} */ target) =>
    editable(target) ||
    Boolean(
      /** @type {Element | null} */ (target)?.closest?.(
        'button, summary, [role="button"]',
      ),
    );

  /** Updates one data-state token and preserves the rest.
   * @param {Element} element @param {string} token @param {boolean} on */
  const state = (element, token, on) => {
    const tokens = new Set(
      (element.getAttribute("data-state") || "").split(/\s+/),
    );
    tokens.delete("");
    if (on) tokens.add(token);
    else tokens.delete(token);
    if (tokens.size) element.setAttribute("data-state", [...tokens].join(" "));
    else element.removeAttribute("data-state");
  };

  // Long enough to read once. A notice is for sight only: whoever shows one
  // has already said it to assistive technology.
  const NOTICE_MS = 3000;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let noticeTimer;
  /** Shows a short message over the floor plan; a newer one replaces it.
   * @param {string} message */
  const notice = (message) => {
    const element = /** @type {HTMLElement | null} */ (
      document.querySelector('[data-part="surface-notice"]')
    );
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      element.hidden = true;
    }, NOTICE_MS);
  };

  dom.focusPointer = focusPointer;
  dom.editable = editable;
  dom.ownsSpace = ownsSpace;
  dom.state = state;
  dom.notice = notice;
}
