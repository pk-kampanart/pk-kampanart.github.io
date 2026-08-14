/**
 * Owns which groups are hidden on the plan: view state, never part of the
 * plan (ADR-0002). A hidden group stops being drawn and nothing else changes —
 * its devices, counts and links stay. Each project's hidden groups outlast a
 * reload in this browser, as the grid's visibility does; storage that is
 * unavailable only costs that, and hiding still works until the page goes.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  const KEY = "mesh-planner:hidden-groups";

  /** @param {unknown} value @returns {Record<string, string[]>} */
  const checked = (value) => {
    /** @type {Record<string, string[]>} */
    const out = {};
    if (!value || typeof value !== "object") return out;
    for (const [project, ids] of Object.entries(value))
      if (Array.isArray(ids))
        out[project] = ids.filter((id) => typeof id === "string");
    return out;
  };

  /** @param {PlanDocument} plan @returns {Set<string>} */
  const groupIdsOf = (plan) =>
    new Set(
      (plan.floors || []).flatMap((floor) =>
        (floor.applications || []).flatMap((application) =>
          (application.groups || []).map((group) => group.id),
        ),
      ),
    );

  /** @param {GroupVisibilityOptions} options */
  const create = (options) => {
    if (typeof options?.project !== "function")
      throw new TypeError("group visibility requires the open project");
    const storage =
      options.storage === undefined ? window.localStorage : options.storage;
    /** @type {Record<string, string[]>} */
    let hidden = {};
    try {
      const raw = storage?.getItem(KEY);
      hidden = checked(raw ? JSON.parse(raw) : null);
    } catch {
      hidden = {};
    }

    const save = () => {
      try {
        storage?.setItem(KEY, JSON.stringify(hidden));
      } catch {
        // Browser storage can be unavailable; preferences are best-effort.
      }
    };

    /** @param {string} id */
    const isHidden = (id) => (hidden[options.project()] || []).includes(id);

    /**
     * Hides a shown group or shows a hidden one, and forgets groups `plan` no
     * longer holds, so a deleted group's id does not linger.
     * @param {PlanDocument} plan @param {string} id @returns {boolean} whether
     *   the group is now hidden
     */
    const toggle = (plan, id) => {
      const project = options.project();
      const present = groupIdsOf(plan);
      const now = !isHidden(id);
      const next = (hidden[project] || []).filter(
        (item) => item !== id && present.has(item),
      );
      if (now && present.has(id)) next.push(id);
      if (next.length) hidden[project] = next;
      else delete hidden[project];
      save();
      return now && present.has(id);
    };

    /** How many of `groups` are hidden. @param {Group[]} groups */
    const countHidden = (groups) =>
      groups.filter((group) => isHidden(group.id)).length;

    return Object.freeze({ isHidden, toggle, countHidden });
  };

  planner.groupVisibility = Object.freeze({ create });
}
