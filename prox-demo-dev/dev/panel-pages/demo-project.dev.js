/**
 * Development-only fixture. One click replaces the open project with a
 * two-floor demo laid out over the sample floor plans in dev/floorplans/, so
 * every planner feature has something real to act on. It may use DOM, fetch
 * and the store facade freely because it is never included in production
 * output. It writes the Plan only through the store, and the write is one
 * undo step.
 */
{
  const panel = window.PlannerDevPanel;
  if (!panel?.register) throw new Error("Developer panel host is unavailable");

  const PROJECT_NAME = "Demo Residence";

  // Intrinsic pixel size of each sample image. Room rectangles and device
  // points below are written in that image's own pixel space; fit() is the one
  // place that converts them to plan space, mirroring the xMidYMid meet the
  // surface renderer draws the background with.
  const GROUND_IMAGE = {
    url: "dev/floorplans/floor-plan-big.webp",
    width: 600,
    height: 600,
  };
  const FIRST_IMAGE = {
    url: "dev/floorplans/floor-plan-small.webp",
    width: 611,
    height: 446,
  };

  /** @param {{url: string, width: number, height: number}} image */
  const fit = (image) => {
    const extent = window.Planner.geo.WORLD_EXTENT;
    const scale = Math.min(
      extent.width / image.width,
      extent.height / image.height,
    );
    const offsetX = extent.x + (extent.width - image.width * scale) / 2;
    const offsetY = extent.y + (extent.height - image.height * scale) / 2;
    /** @param {number} x @param {number} y */
    const point = (x, y) => ({
      x: Math.round(offsetX + x * scale),
      y: Math.round(offsetY + y * scale),
    });
    /** @param {number[]} box */
    const rect = ([x, y, width, height]) => ({
      ...point(x, y),
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    });
    return { point, rect };
  };

  // Ground floor: the detached house. Master bedroom and ensuite top-left,
  // kitchen and dining right, living room bottom-right, two more bedrooms and
  // a bathroom down the left, hallway between them.
  const GROUND = {
    name: "Ground floor",
    image: GROUND_IMAGE,
    opacity: 100,
    applications: [
      {
        name: "Lighting",
        groups: [
          { name: "Master bedroom", color: "#1772e8", rect: [130, 70, 138, 152] },
          { name: "Ensuite", color: "#0c8599", rect: [272, 100, 58, 90] },
          { name: "Kitchen", color: "#e8590c", rect: [334, 68, 142, 132] },
          { name: "Dining", color: "#f08c00", rect: [352, 222, 100, 95] },
          {
            name: "Living room",
            color: "#2f9e44",
            rect: [352, 344, 126, 176],
            strokeWidth: 3,
          },
          { name: "Twin bedroom", color: "#7048e8", rect: [132, 228, 138, 92] },
          { name: "Bathroom", color: "#0ca678", rect: [130, 340, 120, 52] },
          { name: "Guest bedroom", color: "#c2255c", rect: [136, 398, 134, 120] },
          // Stroke off: the hallway reads as a fill only.
          {
            name: "Hallway",
            color: "#495057",
            rect: [272, 196, 76, 324],
            strokeType: "none",
          },
          // Undrawn on purpose: a group with no rectangle yet.
          { name: "Loft hatch", color: "#5c940d", rect: null },
        ],
        deviceTypes: [
          {
            name: "Ceiling light",
            at: [
              [199, 146],
              [301, 145],
              [405, 134],
              [402, 269],
              [415, 432],
              [201, 274],
              [190, 366],
              [203, 458],
              [310, 300],
            ],
          },
          {
            name: "Downlight",
            at: [
              [355, 95],
              [380, 95],
              [405, 95],
              [430, 95],
              [375, 380],
              [455, 380],
            ],
          },
          {
            name: "Wall switch",
            at: [
              [265, 215],
              [340, 190],
              [360, 350],
              [265, 315],
              [265, 405],
              [245, 385],
              [280, 205],
            ],
          },
          {
            name: "Pendant",
            at: [
              [385, 250],
              [420, 250],
            ],
          },
          // Empty on purpose: a device type with no instances placed yet.
          { name: "Spare fixture", at: [] },
        ],
      },
      {
        name: "Climate",
        groups: [
          {
            name: "Heating zone — north",
            color: "#e03131",
            rect: [126, 64, 352, 140],
            strokeType: "dashed",
            strokeWidth: 3,
            strokeOpacity: 45,
          },
          {
            name: "Heating zone — south",
            color: "#1098ad",
            rect: [126, 330, 352, 192],
            strokeType: "dashed",
            strokeWidth: 3,
            strokeOpacity: 45,
          },
        ],
        deviceTypes: [
          {
            name: "Thermostat",
            at: [
              [300, 250],
              [365, 400],
            ],
          },
          {
            name: "Radiator valve",
            at: [
              [140, 215],
              [470, 190],
              [445, 310],
              [470, 510],
              [140, 313],
              [142, 510],
              [135, 385],
            ],
          },
          {
            name: "Temperature sensor",
            at: [
              [250, 80],
              [250, 500],
            ],
          },
        ],
      },
      {
        name: "Security",
        groups: [
          {
            name: "Perimeter",
            color: "#495057",
            rect: [122, 62, 356, 458],
            strokeType: "dotted",
            strokeWidth: 4,
            strokeOpacity: 60,
          },
          // Stroke colour override: the stroke stays red when the fill changes.
          {
            name: "Entry",
            color: "#f59f00",
            rect: [282, 470, 58, 50],
            strokeWidth: 3,
            strokeColor: "#e03131",
          },
        ],
        deviceTypes: [
          {
            name: "Motion sensor",
            at: [
              [310, 210],
              [310, 440],
              [305, 490],
              [470, 350],
            ],
          },
          {
            name: "Door sensor",
            at: [
              [305, 518],
              [476, 140],
              [128, 240],
            ],
          },
          {
            name: "Smoke detector",
            at: [
              [300, 350],
              [390, 110],
              [200, 430],
            ],
          },
          // Outside the building, and so inside no group at all.
          {
            name: "Garden light",
            at: [
              [60, 560],
              [540, 560],
            ],
          },
        ],
      },
    ],
  };

  // First floor: the apartment plan. Living, dining and kitchen across the
  // top, bedroom and bathrooms below, second bedroom with a desk on the right.
  const FIRST = {
    name: "First floor",
    image: FIRST_IMAGE,
    opacity: 55,
    applications: [
      {
        name: "Lighting",
        groups: [
          { name: "Living room", color: "#2f9e44", rect: [58, 44, 148, 128] },
          { name: "Dining", color: "#f08c00", rect: [208, 48, 104, 148] },
          { name: "Kitchen", color: "#e8590c", rect: [316, 42, 92, 178] },
          // Long on purpose: a name that has to truncate in the tree.
          {
            name: "Upstairs north-east guest bedroom with ensuite and walk-in wardrobe",
            color: "#1772e8",
            rect: [412, 42, 156, 198],
          },
          { name: "Main bedroom", color: "#7048e8", rect: [56, 248, 150, 158] },
          {
            name: "Stair and wardrobe",
            color: "#495057",
            rect: [212, 262, 56, 134],
            strokeType: "none",
          },
          { name: "Bathroom", color: "#0ca678", rect: [272, 248, 84, 154] },
          {
            name: "Utility bathroom",
            color: "#c2255c",
            rect: [408, 262, 160, 144],
            strokeWidth: 3,
          },
        ],
        deviceTypes: [
          {
            name: "Ceiling light",
            at: [
              [130, 105],
              [258, 120],
              [360, 130],
              [452, 100],
              [130, 325],
              [312, 320],
              [487, 335],
              [240, 330],
            ],
          },
          {
            name: "Downlight",
            at: [
              [330, 60],
              [355, 60],
              [385, 60],
              [80, 60],
              [190, 60],
            ],
          },
          {
            name: "Wall switch",
            at: [
              [200, 160],
              [300, 190],
              [410, 215],
              [200, 260],
              [268, 300],
              [360, 270],
              [405, 290],
            ],
          },
          { name: "Desk lamp", at: [[520, 190]] },
        ],
      },
      {
        name: "Climate",
        groups: [
          {
            name: "Heating zone — day",
            color: "#e03131",
            rect: [54, 38, 360, 184],
            strokeType: "dashed",
            strokeWidth: 3,
            strokeOpacity: 45,
          },
          {
            name: "Heating zone — night",
            color: "#1098ad",
            rect: [54, 244, 516, 166],
            strokeType: "dashed",
            strokeWidth: 3,
            strokeOpacity: 45,
          },
        ],
        deviceTypes: [
          {
            name: "Thermostat",
            at: [
              [215, 215],
              [215, 390],
            ],
          },
          {
            name: "Radiator valve",
            at: [
              [62, 160],
              [310, 50],
              [560, 50],
              [62, 400],
              [350, 398],
              [560, 400],
            ],
          },
          {
            name: "Temperature sensor",
            at: [
              [150, 230],
              [450, 250],
            ],
          },
        ],
      },
      {
        name: "Security",
        groups: [
          {
            name: "Perimeter",
            color: "#495057",
            rect: [46, 36, 524, 374],
            strokeType: "dotted",
            strokeWidth: 4,
            strokeOpacity: 60,
          },
          {
            name: "Balcony door",
            color: "#f59f00",
            rect: [350, 392, 80, 26],
            strokeWidth: 3,
            strokeColor: "#e03131",
          },
        ],
        deviceTypes: [
          {
            name: "Motion sensor",
            at: [
              [240, 230],
              [240, 400],
              [500, 250],
            ],
          },
          {
            name: "Door sensor",
            at: [
              [390, 404],
              [55, 120],
              [568, 150],
            ],
          },
          {
            name: "Smoke detector",
            at: [
              [230, 215],
              [120, 280],
              [470, 240],
            ],
          },
          {
            name: "Window contact",
            at: [
              [140, 40],
              [280, 40],
            ],
          },
        ],
      },
      // Empty on purpose: an application with nothing under it.
      { name: "Scenes", groups: [], deviceTypes: [] },
    ],
  };

  /** @param {string} url @returns {Promise<string>} */
  const dataUrlOf = async (url) => {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`cannot read ${url}: ${response.status}`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  };

  /** @param {any} floor @param {() => string} ids @param {string} src */
  const floorOf = (floor, ids, src) => {
    const place = fit(floor.image);
    return {
      id: ids(),
      name: floor.name,
      background: { src, opacity: floor.opacity },
      applications: floor.applications.map((/** @type {any} */ application) => ({
        id: ids(),
        name: application.name,
        groups: application.groups.map((/** @type {any} */ group) => ({
          id: ids(),
          name: group.name,
          color: group.color,
          strokeType: group.strokeType ?? "solid",
          strokeWidth: group.strokeWidth ?? 2,
          strokeOpacity: group.strokeOpacity ?? 100,
          strokeColor: group.strokeColor ?? null,
          rect: group.rect ? place.rect(group.rect) : null,
        })),
        deviceTypes: application.deviceTypes.map((/** @type {any} */ type) => ({
          id: ids(),
          name: type.name,
          instances: type.at.map((/** @type {number[]} */ at) => ({
            id: ids(),
            ...place.point(at[0], at[1]),
          })),
        })),
      })),
    };
  };

  const buildPlan = async () => {
    const planner = window.Planner;
    const ids = planner.db.createId;
    const current = planner.app.read();
    const sources = await Promise.all(
      [GROUND, FIRST].map((floor) => dataUrlOf(floor.image.url)),
    );
    return {
      formatVersion: 1,
      // The store persists into the open record, which refuses a plan whose
      // project id is not its own.
      project: { id: current.project.id, name: PROJECT_NAME },
      floors: [GROUND, FIRST].map((floor, index) =>
        floorOf(floor, ids, sources[index]),
      ),
    };
  };

  /** @param {HTMLElement} root */
  const mount = (root) => {
    root.innerHTML = `
      <section data-part="demo-project-page" aria-label="Demo project">
        <h3 data-part="demo-project-heading">Demo project</h3>
        <p data-part="demo-project-note">
          Replaces the open project with ${PROJECT_NAME}: two floors over the
          sample plans in <code>dev/floorplans/</code>, rooms as groups,
          devices placed in the rooms they belong to. One undo step.
        </p>
        <button type="button" data-part="demo-project-load">Load demo project</button>
        <p data-part="demo-project-status" role="status"></p>
      </section>`;

    const style = document.createElement("style");
    style.textContent = `
      [data-part="demo-project-heading"] { margin: 0 0 12px; }
      [data-part="demo-project-note"] {
        margin: 0 0 16px;
        color: var(--text-muted, #586474);
      }
      [data-part="demo-project-status"] { margin: 12px 0 0; }
      [data-part="demo-project-status"][data-state~="failed"] { color: #a61b1b; }
    `;
    root.append(style);

    const button = /** @type {HTMLButtonElement} */ (
      root.querySelector('[data-part="demo-project-load"]')
    );
    const status = /** @type {HTMLElement} */ (
      root.querySelector('[data-part="demo-project-status"]')
    );

    button.addEventListener("click", async () => {
      button.disabled = true;
      status.removeAttribute("data-state");
      status.textContent = "Loading…";
      try {
        const plan = await buildPlan();
        // Before the write: replace() notifies the tree and the surface, and
        // they read the active floor while they render.
        window.Planner.selection.activeFloor(plan, plan.floors[0].id);
        window.Planner.app.replace(plan);
        await window.Planner.app.flush();
        const devices = plan.floors
          .flatMap((floor) => floor.applications)
          .flatMap((application) => application.deviceTypes)
          .reduce((total, type) => total + type.instances.length, 0);
        status.textContent = `Loaded ${plan.floors.length} floors, ${devices} devices. Undo restores the previous plan.`;
      } catch (error) {
        status.setAttribute("data-state", "failed");
        status.textContent = `Could not load the demo project: ${String(error)}`;
      } finally {
        button.disabled = false;
      }
    });
  };

  panel.register({ title: "Demo project", mount });
}
