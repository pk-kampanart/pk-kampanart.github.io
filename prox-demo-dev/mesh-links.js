/**
 * Turns the plan's Links into the model pairs the network must hold, and
 * compares them with what the nodes report (provisioning.md, "Groups and Links
 * on the network"). Every answer is derived on each call; nothing is stored.
 * Channels: none.
 */
{
  const planner = (window.Planner =
    window.Planner || /** @type {PlannerNamespace} */ ({}));
  /** @param {PlanDocument} plan */
  const instancesOf = (plan) =>
    plan.floors.flatMap((floor) =>
      floor.applications.flatMap((application) =>
        application.deviceTypes.flatMap((type) => type.instances),
      ),
    );

  /** Resolve an instance's assigned channels from its node's composition.
   * @param {DeviceInstance | undefined} instance @param {MeshNode[]} nodes */
  const channelsOf = (instance, nodes) => {
    const node = nodes.find((entry) => entry.id === instance?.assignment?.node);
    return node
      ? planner.meshChannels
          .of(node)
          .filter((channel) =>
            instance?.assignment?.channels.includes(channel.number),
          )
          .map((channel) => ({ node, channel }))
      : [];
  };

  /** An input channel can publish to one group address. Flag its instance
   * when Links place it in multiple groups (decision 38).
   * @param {PlanDocument} plan @param {MeshNode[]} nodes @returns {Set<string>} */
  const conflicts = (plan, nodes) => {
    const links = planner.links.derive(plan);
    return new Set(
      instancesOf(plan)
        .filter(
          (instance) =>
            links.filter((link) => link.deviceId === instance.id).length > 1 &&
            channelsOf(instance, nodes).some(
              ({ channel }) => channel.role === "input",
            ),
        )
        .map((instance) => instance.id),
    );
  };

  /** Changes needed to match the plan's Links: what the network lacks, and
   * what it holds for a group that no Link asks for. An address with no
   * matching group in the plan belongs to a deleted group and yields removals
   * only.
   * @param {PlanDocument} plan @param {MeshNode[]} nodes
   * @param {Record<string, string>} addresses group id → group address
   * @returns {Map<string, MeshLinkChange[]>} */
  const pending = (plan, nodes, addresses) => {
    const links = planner.links.derive(plan);
    const skipped = conflicts(plan, nodes);
    const instances = instancesOf(plan);
    /** @type {Map<string, MeshLinkChange[]>} */
    const result = new Map();
    /** @param {MeshModel | undefined} model @param {MeshLinkChange["role"]} role @param {string} address */
    const holds = (model, role, address) =>
      role === "publish"
        ? model?.publish === address
        : Boolean(model?.subscribe?.includes(address));
    /** @param {string} group @param {string} application */
    const compare = (group, application) => {
      const address = addresses[group] || "";
      /** @type {Omit<MeshLinkChange, "on">[]} */
      const wanted = [];
      for (const link of links) {
        if (link.groupId !== group) continue;
        const instance = instances.find((entry) => entry.id === link.deviceId);
        for (const { node, channel } of channelsOf(instance, nodes)) {
          if (channel.role === "input" && skipped.has(link.deviceId)) continue;
          const side = channel.role === "input" ? 0 : 1;
          const role = channel.role === "input" ? "publish" : "subscribe";
          for (const pair of planner.meshChannels.pairs) {
            const model = pair[side];
            const element = node.elements.find(
              (entry) =>
                channel.elements.includes(entry.address) &&
                entry.models.some((candidate) => candidate.id === model),
            );
            if (element)
              wanted.push({
                group,
                application,
                node: node.id,
                channel: channel.number,
                element: element.address,
                model,
                role,
              });
          }
        }
      }
      /** @type {MeshLinkChange[]} */
      const changes = wanted
        .filter(
          (want) =>
            !holds(
              nodes
                .find((node) => node.id === want.node)
                ?.elements.find((element) => element.address === want.element)
                ?.models.find((model) => model.id === want.model),
              want.role,
              address,
            ),
        )
        .map((want) => ({ ...want, on: true }));
      if (address)
        for (const node of nodes)
          for (const element of node.elements)
            for (const model of element.models)
              for (const role of /** @type {const} */ ([
                "publish",
                "subscribe",
              ]))
                if (
                  holds(model, role, address) &&
                  !wanted.some(
                    (want) =>
                      want.element === element.address &&
                      want.model === model.id &&
                      want.role === role,
                  )
                )
                  changes.push({
                    group,
                    application,
                    node: node.id,
                    channel:
                      planner.meshChannels
                        .of(node)
                        .find((channel) =>
                          channel.elements.includes(element.address),
                        )?.number || 0,
                    element: element.address,
                    model: model.id,
                    role,
                    on: false,
                  });
      result.set(group, changes);
    };
    for (const floor of plan.floors)
      for (const application of floor.applications)
        for (const group of application.groups)
          compare(group.id, application.id);
    for (const group of Object.keys(addresses))
      if (!result.has(group)) compare(group, "");
    return result;
  };

  planner.meshLinks = Object.freeze({ conflicts, pending });
}
