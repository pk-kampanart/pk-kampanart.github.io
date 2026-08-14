/**
 * Owns pure project-document rules. It reads neither the DOM nor storage.
 * Channels: none.
 */
{
  /** @param {PlanDocument} plan @param {string} id @param {string} name */
  const rename = (plan, id, name) => {
    const next = planner.codec.copy(plan);
    if (next.project?.id === id)
      next.project.name = String(name).trim() || "Untitled Project";
    return next;
  };

  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.projects = Object.freeze({ rename });
}
