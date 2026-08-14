/**
 * Owns pure project-document rules and project-kind engine choice. It reads no
 * DOM or storage; the development override only selects an engine.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));

  /** @param {PlanDocument} plan @returns {boolean} */
  const isDemo = (plan) => plan.project.demo === true;
  /** @param {PlanDocument} plan @returns {MeshEngineFactory | undefined} */
  const engineFactoryFor = (plan) =>
    isDemo(plan) ? planner.meshSandboxEngine : planner.meshEngine;

  /** @param {PlanDocument} plan @param {string} id @param {string} name */
  const rename = (plan, id, name) => {
    const next = planner.codec.copy(plan);
    if (next.project?.id === id)
      next.project.name = String(name).trim() || "Untitled Project";
    return next;
  };

  planner.projects = Object.freeze({ isDemo, engineFactoryFor, rename });
}
