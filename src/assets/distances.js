// Walking and road distances from a site to the places it lists, worked out
// on the road networks the maps service publishes beside its area packs
// (maps.sustenaut.eu, Sustenaut/maps: index.json lists each area's
// "routes", a file mapbuild/routes.py writes). Nobody types a distance in:
// `make distances` (lib/distances-cli.js) writes sites/<site>/distances.json
// from these, the map's edit mode does the same when it moves a place, and
// the build fails when the file no longer matches where the site and its
// places are (lib/content.js).
//
// A network is {version: 1, nodes: [lng, lat, ...] in millionths of a
// degree, edges: [a, b, metres, modes, ...]}, an edge's modes being bits:
// on foot (1), by car from a to b (2), by car from b to a (4), and above them
// (modes >> 3) ETAK's road type over ten. A walk is the shortest way; a
// drive is the quickest, at SPEED on each type of road, and its distance is
// that way's length. Neighbouring
// areas' networks hold the same roads where they overlap, so they join
// where their nodes have the same coordinates.
//
// The way to a place starts and ends off the network, at a straight line
// to one of the nodes nearest it (within SNAP_M, and within SNAP_SPREAD_M of
// the nearest, so it never cuts across country to a farther road), which
// counts too. A place
// no network reaches has no distance of that kind, and the site shows the
// straight line instead.

export const FOOT = 1;
export const CAR_AB = 2;
export const CAR_BA = 4;
// km/h a car's way reckons with on each ETAK road type (modes >> 3): main,
// secondary, local, ramp, street, other (forest and farm roads).
const SPEED = { 1: 90, 2: 75, 3: 60, 4: 50, 5: 40, 6: 25 };
// Off the network, to or from the road.
const OFF_ROAD_KMH = 10;

// How far off the network a site or place may be, and how many nearby
// nodes it may start from (the nearest is sometimes a dead end).
export const SNAP_M = 1000;
const SNAP_SPREAD_M = 150;
const SNAP_NODES = 6;
// How far around the site and its places to read areas' networks, in
// degrees: about 15 km, so a road that leaves the box and comes back is
// still found.
const MARGIN = 0.15;
const CELL = 0.01;
const R = 6371008.8;

export function crowMetres(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The areas in the maps service's index.json whose networks the way from
// `points[0]` to the rest may use.
export function areasFor(index, points) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const box = [Math.min(...lngs) - 2 * MARGIN, Math.min(...lats) - MARGIN, Math.max(...lngs) + 2 * MARGIN, Math.max(...lats) + MARGIN];
  return (index.areas || []).filter(
    (a) => a.routes && a.bbox && a.bbox[0] <= box[2] && a.bbox[2] >= box[0] && a.bbox[1] <= box[3] && a.bbox[3] >= box[1],
  );
}

// One graph from several areas' networks.
export function join(networks) {
  const ids = new Map();
  const lng = [];
  const lat = [];
  const edges = [];
  const node = (x, y) => {
    const key = x * 1e8 + y;
    let id = ids.get(key);
    if (id === undefined) {
      id = lng.length;
      ids.set(key, id);
      lng.push(x / 1e6);
      lat.push(y / 1e6);
    }
    return id;
  };
  const seen = new Set();
  for (const net of networks) {
    if (net.version !== 1) throw new Error(`a road network of version ${net.version}, not 1`);
    const n = net.nodes;
    const e = net.edges;
    for (let i = 0; i < e.length; i += 4) {
      const a = node(n[2 * e[i]], n[2 * e[i] + 1]);
      const b = node(n[2 * e[i + 1]], n[2 * e[i + 1] + 1]);
      // The same road from two areas counts once.
      const key = `${Math.min(a, b)},${Math.max(a, b)},${e[i + 2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b, e[i + 2], e[i + 3]);
    }
  }
  return graph(lng, lat, edges);
}

function graph(lng, lat, edges) {
  const count = lng.length;
  // Outgoing edges per node, for each mode: [to, metres, cost] triples,
  // the cost being metres on foot and seconds by car.
  const out = { foot: Array.from({ length: count }, () => []), car: Array.from({ length: count }, () => []) };
  for (let i = 0; i < edges.length; i += 4) {
    const [a, b, m, modes] = [edges[i], edges[i + 1], edges[i + 2], edges[i + 3]];
    if (modes & FOOT) out.foot[a].push(b, m, m), out.foot[b].push(a, m, m);
    const seconds = (m * 3.6) / (SPEED[modes >> 3] || SPEED[6]);
    if (modes & CAR_AB) out.car[a].push(b, m, seconds);
    if (modes & CAR_BA) out.car[b].push(a, m, seconds);
  }
  const grid = new Map();
  for (let i = 0; i < count; i++) {
    const key = cell(lng[i], lat[i]);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  return { lng, lat, out, grid };
}

const cell = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;

// The nodes a point may join the network at for a mode: the nearest few
// within SNAP_M that the mode can leave or reach, with the straight line
// to each.
function snap(g, point, mode) {
  const found = [];
  const dy = Math.ceil(SNAP_M / 111000 / CELL);
  const dx = Math.ceil(SNAP_M / (111000 * Math.cos((point.lat * Math.PI) / 180)) / CELL);
  const cx = Math.floor(point.lng / CELL);
  const cy = Math.floor(point.lat / CELL);
  for (let x = cx - dx; x <= cx + dx; x++) {
    for (let y = cy - dy; y <= cy + dy; y++) {
      for (const i of g.grid.get(`${x},${y}`) || []) {
        if (!g.out[mode][i].length && !(mode === "car" && reachable(g, i))) continue;
        const m = crowMetres(point, { lat: g.lat[i], lng: g.lng[i] });
        if (m <= SNAP_M) found.push([i, m]);
      }
    }
  }
  found.sort((a, b) => a[1] - b[1]);
  return found.filter(([, m]) => m <= found[0][1] + SNAP_SPREAD_M).slice(0, SNAP_NODES);
}

// A one-way road's end that no road leaves still takes a car in.
function reachable(g, i) {
  if (!g.into) {
    g.into = new Uint8Array(g.lng.length);
    for (const list of g.out.car) for (let k = 0; k < list.length; k += 3) g.into[list[k]] = 1;
  }
  return g.into[i] === 1;
}

// The length in metres of the best way from `from` to each of `to` by
// `mode` ("foot": the shortest, "car": the quickest); null where there is
// none.
export function shortest(g, from, to, mode) {
  const offCost = mode === "car" ? (m) => (m * 3.6) / OFF_ROAD_KMH : (m) => m;
  const starts = snap(g, from, mode);
  const ends = to.map((p) => snap(g, p, mode));
  const cost = new Float64Array(g.lng.length).fill(Infinity);
  const length = new Float64Array(g.lng.length);
  const heap = new Heap();
  for (const [i, m] of starts) {
    if (offCost(m) < cost[i]) (cost[i] = offCost(m)), (length[i] = m), heap.push(cost[i], i);
  }
  const wanted = new Set(ends.flat().map(([i]) => i));
  let left = wanted.size;
  while (heap.size && left) {
    const [c, i] = heap.pop();
    if (c > cost[i]) continue;
    if (wanted.delete(i)) left--;
    const list = g.out[mode][i];
    for (let k = 0; k < list.length; k += 3) {
      const j = list[k];
      const nc = c + list[k + 2];
      if (nc < cost[j]) (cost[j] = nc), (length[j] = length[i] + list[k + 1]), heap.push(nc, j);
    }
  }
  return ends.map((options) => {
    let best = Infinity;
    let metres = null;
    for (const [i, m] of options) {
      if (cost[i] + offCost(m) < best) (best = cost[i] + offCost(m)), (metres = length[i] + m);
    }
    return metres;
  });
}

// distances.json for a site: its position, and for each place it lists
// the position the distances are from, the walk in metres (to 10 m) and
// the road in km (to 0.1 km), or null where no network reaches.
export function distances(g, site, places) {
  const ids = Object.keys(places).sort();
  const points = ids.map((id) => places[id]);
  const walk = shortest(g, site, points, "foot");
  const road = shortest(g, site, points, "car");
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

// The networks the way from a site to its places may use, read with
// `get(path)` (a path on the maps service, such as index.json).
export async function networksFor(get, site, places) {
  const index = await get("index.json");
  const areas = areasFor(index, [site, ...Object.values(places)]);
  return Promise.all(areas.map((a) => get(a.routes.file)));
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

class Heap {
  constructor() {
    this.keys = [];
    this.values = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, value) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      values[i] = values[p];
      i = p;
    }
    keys[i] = key;
    values[i] = value;
  }
  pop() {
    const { keys, values } = this;
    const top = [keys[0], values[0]];
    const key = keys.pop();
    const value = values.pop();
    if (keys.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= keys.length) break;
        if (c + 1 < keys.length && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        values[i] = values[c];
        i = c;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  }
}
