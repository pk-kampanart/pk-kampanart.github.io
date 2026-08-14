/**
 * Sets the toolchain boot marker. It owns no planner state and dispatches no
 * channels; the marker is set after the shell finishes loading.
 */
{
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      document.documentElement.dataset.app = "mesh-planner";
    },
    { once: true },
  );
}
