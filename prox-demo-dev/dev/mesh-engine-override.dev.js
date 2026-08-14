/** Development-only query override; production Demo mode selects per project.
 * Sets a flag consumed by app.js; production never reads this query.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  planner.meshEngineForced =
    new URLSearchParams(location.search).get("mesh-engine") === "sandbox";
  if (planner.meshEngineForced && planner.meshSandboxEngine)
    planner.meshEngine = planner.meshSandboxEngine;
  planner.clearMeshEngineOverride = () => {
    const url = new URL(location.href);
    url.searchParams.delete("mesh-engine");
    location.assign(url.href);
  };
  if (
    planner.meshEngineForced &&
    ["http:", "https:"].includes(location.protocol)
  )
    void navigator.serviceWorker?.ready
      .then((registration) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => channel.port1.close();
        registration.active?.postMessage(
          {
            type: "cache",
            urls: [
              "dev/catalog/catalog.json",
              "dev/sandbox-presets/test-rig.json",
            ],
          },
          [channel.port2],
        );
      })
      .catch(() => {});
}
