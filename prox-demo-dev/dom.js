/**
 * Provides shared DOM focus behavior for pointer-selected elements.
 * Contributes focusPointer and editable to Planner.dom; it listens to no
 * channels.
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

  dom.focusPointer = focusPointer;
  dom.editable = editable;
}
