/**
 * Declares the attributes shared by templates and the DOM binder.
 * Contributes immutable vocabulary to Planner.dom; it owns no state and
 * listens to no channels.
 */
{
  const planner =
    (window.Planner = window.Planner || /** @type {PlannerNamespace} */ ({}));
  const dom =
    planner.dom || (planner.dom = /** @type {DomNamespace} */ ({}));

  dom.vocabulary = Object.freeze({
    ENTITY: "data-entity",
    ANCHOR: "data-anchor",
    ID: "data-id",
    SLOT: "data-slot",
    SLOT_AS: "data-slot-as",
    SLOT_TYPE: "data-slot-type",
    SLOT_DERIVED: "data-slot-derived",
    SLOT_TEMPLATE: "data-slot-template",
    ACT: "data-act",
    REGION: "data-region",
    FORMAT_VERSION: "data-format-version",
    PROJECT_ID: "data-project-id",
  });
}
