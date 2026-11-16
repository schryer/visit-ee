// A site's distances.json (src/assets/distances.js), with the maps
// service's routes package (the sustenaut-maps git dependency, whose own
// tests cover the routing), run with `node --test tests/js/*.test.js`.
import { After, Then } from "@cucumber/cucumber";
import { mock as nodeMock } from "node:test";
import assert from "node:assert/strict";
import * as routes from "sustenaut-maps/routes";
import { distances, measure, stale } from "../../src/assets/distances.js";

// What node:test gave each test as `t`: its mocks, restored when the
// scenario ends, and the cleanups it registers with t.after().
const cleanups = [];
const scenarioContext = { mock: nodeMock, after: (fn) => cleanups.push(fn) };
After("@distances", async function () {
  while (cleanups.length) await cleanups.pop()();
  nodeMock.restoreAll();
});


const at = ([lng, lat]) => ({ lng, lat });
const A = [26.9, 57.7];
const B = [26.918, 57.7];
const C = [26.918, 57.71];
const D = [26.9, 57.71];
// A road from A to B (on foot and by car, a local road), and a path on from
// B to C, as mapbuild/routes.py writes them.
const network = {
  version: 1,
  nodes: [A, B, C].flatMap(([lng, lat]) => [Math.round(lng * 1e6), Math.round(lat * 1e6)]),
  edges: [0, 1, 1234, routes.FOOT | routes.CAR_AB | routes.CAR_BA | (3 << 3), 1, 2, 4321, routes.FOOT | (7 << 3)],
};
const index = { version: 1, areas: [{ path: "test", bbox: [26.8, 57.6, 27.0, 57.8], routes: { file: "routes/test.json" } }] };
const read = async (file) => (file === "index.json" ? index : network);

Then("distances.json rounds a walk to 10 m and a drive to 0.1 km, and has none where no road goes", function () {
  return (() => {
  const net = routes.joinNetworks([network]);
  const file = distances(routes, net, at(A), { b: at(B), c: at(C) });
  assert.deepEqual(file.from, at(A));
  assert.deepEqual(file.places.b, { at: at(B), walk_m: 1230, road_km: 1.2 });
  assert.deepEqual(file.places.c, { at: at(C), walk_m: 5560, road_km: null });
})(scenarioContext);
});

Then("measure reads the networks around the site and its places", function () {
  return (async () => {
  const file = await measure(routes, at(A), { b: at(B) }, { read });
  assert.deepEqual(file.places.b, { at: at(B), walk_m: 1230, road_km: 1.2 });
})(scenarioContext);
});

Then("measure stops where the maps service has no roads", function () {
  return (async () => {
  const empty = async (file) => (file === "index.json" ? { version: 1, areas: [] } : null);
  await assert.rejects(measure(routes, at(A), { b: at(B) }, { read: empty, where: "here" }), /here has no road network around it/);
})(scenarioContext);
});

Then("distances.json is stale when the site or a place moves, or the list changes", function () {
  return (() => {
  const file = { from: at(A), places: { b: { at: at(B) } } };
  assert.deepEqual(stale(file, at(A), { b: at(B) }), []);
  assert.deepEqual(stale(null, at(A), { b: at(B) }), ["there is no distances.json"]);
  assert.deepEqual(stale(file, at(D), { b: at(B) }), ["the site has moved"]);
  assert.deepEqual(stale(file, at(A), { b: at(C) }), ["b has moved"]);
  assert.deepEqual(stale(file, at(A), { b: at(B), c: at(C) }), ["c is not in it"]);
  assert.deepEqual(stale(file, at(A), {}), ["b is no longer listed"]);
})(scenarioContext);
});
