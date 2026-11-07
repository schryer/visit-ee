// A site's walking and road distances to the places it lists, as
// sites/<site>/distances.json keeps them. Nobody types a distance in: `make
// distances` (lib/distances-cli.js) and the map's edit mode work them out
// with the maps service's routes package (maps.sustenaut.eu
// lib/v1/routes.js, Sustenaut/maps), on its road networks, and the build
// fails when the file no longer fits where the site and its places are
// (lib/content.js). The routes package is passed in, so this file runs in
// Node (the sustenaut-maps git dependency) and the browser (the service's
// copy) alike.

// distances.json for a site: its position, and for each place it lists
// the position the distances are from, the walk in metres (to 10 m) and the
// road in km (to 0.1 km), or null where no road reaches. `routes` is the
// routes package and `net` its loadNetwork() around the site and places.
export function distances(routes, net, site, places) {
  const ids = Object.keys(places).sort();
  const points = ids.map((id) => places[id]);
  const walk = routes.route(net, site, points, "foot");
  const road = routes.route(net, site, points, "car");
  const out = {};
  ids.forEach((id, n) => {
    out[id] = {
      at: { lat: places[id].lat, lng: places[id].lng },
      walk_m: walk[n] == null ? null : Math.round(walk[n] / 10) * 10,
      road_km: road[n] == null ? null : Math.round(road[n] / 100) / 10,
    };
  });
  return {
    comment: "Made by `make distances` (or the map's edit mode) from the maps service's road networks; do not edit. The build fails when a position here is not the site's or the place's.",
    from: { lat: site.lat, lng: site.lng },
    places: out,
  };
}

// Works out a site's distances.json: reads the road networks around the
// site and its places with routes.loadNetwork (`read` as it takes it), and
// stops when there are none, rather than write straight lines for all.
export async function measure(routes, site, places, { read, where = "the maps service" } = {}) {
  const net = await routes.loadNetwork([site, ...Object.values(places)], read ? { read } : {});
  if (!net.lng.length) throw new Error(`${where} has no road network around it (index.json lists no area with routes there)`);
  return distances(routes, net, site, places);
}

// Whether distances.json still fits the site and its places, as a list of
// what doesn't (empty when it does).
export function stale(file, site, places) {
  if (!file) return ["there is no distances.json"];
  const same = (a, b) => a && b && a.lat === b.lat && a.lng === b.lng;
  const problems = [];
  if (!same(file.from, site)) problems.push("the site has moved");
  for (const [id, at] of Object.entries(places)) {
    const entry = file.places?.[id];
    if (!entry) problems.push(`${id} is not in it`);
    else if (!same(entry.at, at)) problems.push(`${id} has moved`);
  }
  for (const id of Object.keys(file.places || {})) if (!(id in places)) problems.push(`${id} is no longer listed`);
  return problems;
}
