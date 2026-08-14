/**
 * Provides shared DOM focus behavior for pointer-selected elements.
 * Contributes focusPointer, editable, ownsSpace and state to Planner.dom; it
 * listens to no channels.
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

  dom.focusPointer = focusPointer;
  dom.editable = editable;
  dom.ownsSpace = ownsSpace;
  dom.state = state;
}
