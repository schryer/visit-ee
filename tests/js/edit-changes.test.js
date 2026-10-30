// The edit mode's file changes (src/assets/edit-changes.js), run with
// `node --test tests/js/*.test.js`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, touchedPaths, describe, slug, parsePlacePath } from "../../src/assets/edit-changes.js";

const j = (value) => JSON.stringify(value, null, 2) + "\n";
// A public place in Rõuge, a private one of the site's, and a free id.
const K = "towns/rouge/places/kirik";
const S = "sites/oobikuoru/places/saun";
const C = "towns/rouge/places/coop";
const files = () => ({
  [`${K}/place.json`]: j({ name: "Rõuge kirik", category: "heritage", geo: { lat: 57.73, lng: 26.92 }, position: "estimate" }),
  [`${K}/strings/et.json`]: j({ description: "Kirik" }),
  [`${K}/strings/en.json`]: j({ description: "Church" }),
  [`${K}/strings/fi.json`]: null,
  [`${S}/place.json`]: j({ name: "Saun", category: "heritage", geo: { lat: 57.72, lng: 26.93 } }),
  [`${S}/strings/et.json`]: j({ description: "Saun" }),
  [`${S}/strings/en.json`]: j({ description: "Sauna" }),
  [`${S}/strings/fi.json`]: j({ description: "Sauna" }),
  [`${C}/place.json`]: null,
  "sites/oobikuoru/site.json": j({ id: "x", nearby: [{ place: "saun", walk_m: 900 }, { place: "kirik", road_km: 1 }] }),
});
const opts = { site: "oobikuoru" };

test("moving a place sets its position and drops the estimate", () => {
  const out = applyEdits(files(), [{ id: "kirik", dir: K, geo: { lat: 57.7312345, lng: 26.9254321 } }], opts);
  assert.deepEqual(Object.keys(out), [`${K}/place.json`]);
  assert.equal(out[`${K}/place.json`], j({ name: "Rõuge kirik", category: "heritage", geo: { lat: 57.73123, lng: 26.92543 } }));
});

test("a new place gets its file, descriptions and a place on the site's list", () => {
  const edit = { id: "coop", dir: C, isNew: true, name: "Rõuge Coop", category: "shop", geo: { lat: 57.7, lng: 26.9 }, text: { et: "Pood", en: "Shop" }, nearby: { on: true, walk_m: 800, road_km: null } };
  const out = applyEdits(files(), [edit], opts);
  assert.equal(out[`${C}/place.json`], j({ name: "Rõuge Coop", category: "shop", geo: { lat: 57.7, lng: 26.9 } }));
  assert.equal(JSON.parse(out[`${C}/strings/en.json`]).description, "Shop");
  assert.deepEqual(JSON.parse(out["sites/oobikuoru/site.json"]).nearby.at(-1), { place: "coop", walk_m: 800 });
});

test("a new place cannot take an id that exists", () => {
  assert.throws(() => applyEdits(files(), [{ id: "kirik", dir: K, isNew: true, name: "X", category: "shop", geo: { lat: 1, lng: 1 } }], opts), /already exists/);
});

test("taking a place off a site keeps the place", () => {
  const out = applyEdits(files(), [{ id: "saun", dir: S, nearby: { on: false } }], opts);
  assert.deepEqual(Object.keys(out), ["sites/oobikuoru/site.json"]);
  assert.deepEqual(JSON.parse(out["sites/oobikuoru/site.json"]).nearby, [{ place: "kirik", road_km: 1 }]);
});

test("a listed place keeps its spot and its distances unless they change", () => {
  const out = applyEdits(files(), [{ id: "saun", dir: S, nearby: { on: true, road_km: 2 } }], opts);
  assert.deepEqual(JSON.parse(out["sites/oobikuoru/site.json"]).nearby[0], { place: "saun", walk_m: 900, road_km: 2 });
});

test("deleting a place removes its folder and takes it off every site", () => {
  const out = applyEdits(files(), [{ id: "saun", dir: S, deleted: true }], opts);
  assert.equal(out[`${S}/place.json`], null);
  for (const lang of ["et", "en", "fi"]) assert.equal(out[`${S}/strings/${lang}.json`], null);
  assert.equal(`${K}/strings/et.json` in out, false);
  assert.deepEqual(JSON.parse(out["sites/oobikuoru/site.json"]).nearby, [{ place: "kirik", road_km: 1 }]);
});

test("touched paths cover the description languages and sites", () => {
  const paths = touchedPaths([{ id: "saun", dir: S, deleted: true }], { langs: ["et", "en", "fi"], sites: ["oobikuoru"] });
  assert.deepEqual(paths.sort(), [`${S}/place.json`, `${S}/strings/en.json`, `${S}/strings/et.json`, `${S}/strings/fi.json`, "sites/oobikuoru/site.json"]);
});

test("an edit says what it does", () => {
  const base = { places: { kirik: { name: "Rõuge kirik" } } };
  assert.equal(describe({ id: "kirik", dir: K, geo: { lat: 57.1, lng: 26.2 } }, base), "Move Rõuge kirik to 57.1, 26.2");
});

test("ids come from names", () => {
  assert.equal(slug("Rõuge Suurjärv"), "rouge-suurjarv");
  assert.equal(slug("Käsitöö- ja kohvikukoda"), "kasitoo-ja-kohvikukoda");
});

test("a photo, its credit and a website go into the place's file", () => {
  const out = applyEdits(files(), [{ id: "kirik", dir: K, photo: "media/kirik.jpg", photo_credit: "David", url: "https://eelk.ee/rouge" }], opts);
  const place = JSON.parse(out[`${K}/place.json`]);
  assert.equal(place.photo, "media/kirik.jpg");
  assert.equal(place.photo_credit, "David");
  assert.equal(place.url, "https://eelk.ee/rouge");
  assert.deepEqual(Object.keys(place), ["name", "category", "geo", "position", "photo", "photo_credit", "url"]);
});

test("a removed or replaced photo's file goes, and so does a deleted place's", () => {
  const f = { ...files(), [`${S}/place.json`]: j({ name: "Saun", category: "heritage", geo: { lat: 1, lng: 2 }, photo: "media/old.webp", url: "https://x.ee" }) };
  let out = applyEdits(f, [{ id: "saun", dir: S, photo: null, url: null }], opts);
  assert.equal(out[`${S}/media/old.webp`], null);
  assert.equal(JSON.parse(out[`${S}/place.json`]).photo, undefined);
  assert.equal(JSON.parse(out[`${S}/place.json`]).url, undefined);
  out = applyEdits(f, [{ id: "saun", dir: S, photo: "media/saun.jpg" }], opts);
  assert.equal(out[`${S}/media/old.webp`], null);
  out = applyEdits(f, [{ id: "saun", dir: S, deleted: true }], opts);
  assert.equal(out[`${S}/media/old.webp`], null);
  out = applyEdits(f, [{ id: "saun", dir: S, photo: "media/old.webp" }], opts);
  assert.equal(`${S}/media/old.webp` in out, false);
});

test("a photo from the photo service replaces a file in the repository", () => {
  const f = { ...files(), [`${S}/place.json`]: j({ name: "Saun", category: "heritage", geo: { lat: 1, lng: 2 }, photo: "media/old.jpg" }) };
  const photo = { id: "0123456789abcdef", width: 1600, height: 1200, widths: [480, 960, 1600], formats: ["webp", "jpg"] };
  const out = applyEdits(f, [{ id: "saun", dir: S, photo }], opts);
  assert.deepEqual(JSON.parse(out[`${S}/place.json`]).photo, photo);
  assert.equal(out[`${S}/media/old.jpg`], null);
  // Replacing a service photo leaves the service to clean up.
  const again = applyEdits({ ...f, [`${S}/place.json`]: out[`${S}/place.json`] }, [{ id: "saun", dir: S, photo: null }], opts);
  assert.deepEqual(Object.keys(again), [`${S}/place.json`]);
});

test("a description goes into the place's own strings, and an emptied one goes", () => {
  let out = applyEdits(files(), [{ id: "kirik", dir: K, text: { fi: "Kirkko", en: "St Mary's church" } }], opts);
  assert.equal(out[`${K}/strings/fi.json`], j({ description: "Kirkko" }));
  assert.equal(out[`${K}/strings/en.json`], j({ description: "St Mary's church" }));
  assert.deepEqual(Object.keys(out).sort(), [`${K}/strings/en.json`, `${K}/strings/fi.json`]);
  out = applyEdits(files(), [{ id: "saun", dir: S, text: { fi: "" } }], opts);
  assert.deepEqual(out, { [`${S}/strings/fi.json`]: null });
});

test("a place's folder says who owns it", () => {
  assert.deepEqual(parsePlacePath(`${K}/place.json`), { dir: K, owner: "towns/rouge", id: "kirik" });
  assert.deepEqual(parsePlacePath(`${S}/place.json`), { dir: S, owner: "sites/oobikuoru", id: "saun" });
  assert.equal(parsePlacePath(`${K}/strings/et.json`), null);
  assert.equal(parsePlacePath("sites/oobikuoru/site.json"), null);
});
