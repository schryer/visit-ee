// Walking and road distances on the maps service's road networks
// (src/assets/distances.js), run with `node --test tests/js/*.test.js`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { areasFor, distances, join, networksFor, shortest, stale, FOOT, CAR_AB, CAR_BA } from "../../src/assets/distances.js";

// A network as mapbuild/routes.py writes it, from points in degrees and
// edges [a, b, metres, modes, road type].
function network(points, edges) {
  return {
    version: 1,
    nodes: points.flatMap(([lng, lat]) => [Math.round(lng * 1e6), Math.round(lat * 1e6)]),
    edges: edges.flatMap(([a, b, m, modes, kind]) => [a, b, m, modes | (kind << 3)]),
  };
}
const BOTH = FOOT | CAR_AB | CAR_BA;
const at = ([lng, lat]) => ({ lng, lat });
// A square of four roads, about 1.1 km a side: A (south-west), B (south-east),
// C (north-east), D (north-west).
const A = [26.9, 57.7];
const B = [26.918, 57.7];
const C = [26.918, 57.71];
const D = [26.9, 57.71];

test("a walk takes the shortest way, and a drive the quickest", () => {
  // A to C: east then north on a main road (2.2 km), or north then east on a
  // forest road (2 km).
  const g = join([network([A, B, C, D], [[0, 1, 1100, BOTH, 1], [1, 2, 1100, BOTH, 1], [0, 3, 1000, BOTH, 6], [3, 2, 1000, BOTH, 6]])]);
  assert.deepEqual(shortest(g, at(A), [at(C)], "foot"), [2000]);
  assert.deepEqual(shortest(g, at(A), [at(C)], "car"), [2200]);
});

test("a car keeps to a one-way road's direction; a walker does not", () => {
  // A to B one way only (along the line), and the long way round both ways.
  const g = join([network([A, B, C, D], [[1, 0, 1100, FOOT | CAR_AB, 3], [0, 3, 1100, BOTH, 3], [3, 2, 1100, BOTH, 3], [2, 1, 1100, BOTH, 3]])]);
  assert.deepEqual(shortest(g, at(A), [at(B)], "foot"), [1100]);
  assert.deepEqual(shortest(g, at(A), [at(B)], "car"), [3300]);
  assert.deepEqual(shortest(g, at(B), [at(A)], "car"), [1100]);
});

test("a path takes walkers only", () => {
  const g = join([network([A, B], [[0, 1, 1100, FOOT, 7]])]);
  assert.deepEqual(shortest(g, at(A), [at(B)], "foot"), [1100]);
  assert.deepEqual(shortest(g, at(A), [at(B)], "car"), [null]);
});

test("the way starts and ends off the road, along a straight line to it", () => {
  const g = join([network([A, B], [[0, 1, 1100, BOTH, 3]])]);
  // About 111 m north of A, and of B.
  const [walk] = shortest(g, { lng: A[0], lat: A[1] + 0.001 }, [{ lng: B[0], lat: B[1] + 0.001 }], "foot");
  assert.ok(Math.abs(walk - (1100 + 2 * 111)) < 2, walk);
});

test("a place far from any road has no way to it", () => {
  const g = join([network([A, B], [[0, 1, 1100, BOTH, 3]])]);
  assert.deepEqual(shortest(g, at(A), [{ lng: 27.2, lat: 57.9 }], "foot"), [null]);
});

test("neighbouring areas' networks join where they share a node, and a shared road counts once", () => {
  const west = network([A, B], [[0, 1, 1100, BOTH, 3]]);
  const east = network([B, C], [[0, 1, 1100, BOTH, 3]]);
  const both = network([A, B], [[0, 1, 1100, BOTH, 3]]);
  const g = join([west, east, both]);
  assert.deepEqual(shortest(g, at(A), [at(C)], "car"), [2200]);
  assert.equal(g.out.car[0].length, 3);
});

test("distances.json rounds a walk to 10 m and a drive to 0.1 km", () => {
  const g = join([network([A, B, C], [[0, 1, 1234, BOTH, 3], [1, 2, 4321, FOOT, 7]])]);
  const file = distances(g, at(A), { b: at(B), c: at(C) });
  assert.deepEqual(file.from, at(A));
  assert.deepEqual(file.places.b, { at: at(B), walk_m: 1230, road_km: 1.2 });
  assert.deepEqual(file.places.c, { at: at(C), walk_m: 5560, road_km: null });
});

test("distances.json is stale when the site or a place moves, or the list changes", () => {
  const file = { from: at(A), places: { b: { at: at(B) } } };
  assert.deepEqual(stale(file, at(A), { b: at(B) }), []);
  assert.deepEqual(stale(null, at(A), { b: at(B) }), ["there is no distances.json"]);
  assert.deepEqual(stale(file, at(D), { b: at(B) }), ["the site has moved"]);
  assert.deepEqual(stale(file, at(A), { b: at(C) }), ["b has moved"]);
  assert.deepEqual(stale(file, at(A), { b: at(B), c: at(C) }), ["c is not in it"]);
  assert.deepEqual(stale(file, at(A), {}), ["b is no longer listed"]);
});

test("only the areas around the site and its places are read", async () => {
  const index = {
    areas: [
      { path: "near", bbox: [26.8, 57.6, 27.0, 57.8], routes: { file: "routes/near.json" } },
      { path: "far", bbox: [24.5, 59.3, 24.9, 59.5], routes: { file: "routes/far.json" } },
      { path: "no-routes", bbox: [26.8, 57.6, 27.0, 57.8] },
    ],
  };
  assert.deepEqual(areasFor(index, [at(A), at(C)]).map((a) => a.path), ["near"]);
  const read = [];
  const get = async (file) => (read.push(file), file === "index.json" ? index : network([A, B], []));
  await networksFor(get, at(A), { c: at(C) });
  assert.deepEqual(read, ["index.json", "routes/near.json"]);
});
