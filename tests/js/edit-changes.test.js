// The edit mode's file changes (src/assets/edit-changes.js), run with
// `node --test tests/js/*.test.js`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, touchedPaths, describe, slug } from "../../src/assets/edit-changes.js";

const j = (value) => JSON.stringify(value, null, 2) + "\n";
const files = () => ({
  "places/kirik.json": j({ name: "Rõuge kirik", category: "heritage", geo: { lat: 57.73, lng: 26.92 }, position: "estimate" }),
  "places/muinastalu.json": j({ name: "Muinastalu", category: "heritage", geo: { lat: 57.72, lng: 26.93 } }),
  "places/coop.json": null,
  "i18n/places/et.json": j({ kirik: "Kirik", muinastalu: "Talu" }),
  "i18n/places/en.json": j({ kirik: "Church", muinastalu: "Farm" }),
  "i18n/places/fi.json": j({ muinastalu: "Tila" }),
  "sites/oobikuoru/site.json": j({ id: "x", nearby: [{ place: "muinastalu", walk_m: 900 }, { place: "kirik", road_km: 1 }] }),
});
const opts = { site: "oobikuoru" };

test("moving a place sets its position and drops the estimate", () => {
  const out = applyEdits(files(), [{ id: "kirik", geo: { lat: 57.7312345, lng: 26.9254321 } }], opts);
  assert.deepEqual(Object.keys(out), ["places/kirik.json"]);
  assert.equal(out["places/kirik.json"], j({ name: "Rõuge kirik", category: "heritage", geo: { lat: 57.73123, lng: 26.92543 } }));
});

test("a new place gets its file, descriptions and a place on the site's list", () => {
  const edit = { id: "coop", isNew: true, name: "Rõuge Coop", category: "shop", geo: { lat: 57.7, lng: 26.9 }, text: { et: "Pood", en: "Shop" }, nearby: { on: true, walk_m: 800, road_km: null } };
  const out = applyEdits(files(), [edit], opts);
  assert.equal(out["places/coop.json"], j({ name: "Rõuge Coop", category: "shop", geo: { lat: 57.7, lng: 26.9 } }));
  assert.equal(JSON.parse(out["i18n/places/en.json"]).coop, "Shop");
  assert.deepEqual(JSON.parse(out["sites/oobikuoru/site.json"]).nearby.at(-1), { place: "coop", walk_m: 800 });
});

test("a new place cannot take an id that exists", () => {
  assert.throws(() => applyEdits(files(), [{ id: "kirik", isNew: true, name: "X", category: "shop", geo: { lat: 1, lng: 1 } }], opts), /already exists/);
});

test("taking a place off a site keeps the place", () => {
  const out = applyEdits(files(), [{ id: "muinastalu", nearby: { on: false } }], opts);
  assert.deepEqual(Object.keys(out), ["sites/oobikuoru/site.json"]);
  assert.deepEqual(JSON.parse(out["sites/oobikuoru/site.json"]).nearby, [{ place: "kirik", road_km: 1 }]);
});

test("a listed place keeps its spot and its distances unless they change", () => {
  const out = applyEdits(files(), [{ id: "muinastalu", nearby: { on: true, road_km: 2 } }], opts);
  assert.deepEqual(JSON.parse(out["sites/oobikuoru/site.json"]).nearby[0], { place: "muinastalu", walk_m: 900, road_km: 2 });
});

test("deleting a place removes it from every language and site", () => {
  const out = applyEdits(files(), [{ id: "muinastalu", deleted: true }], opts);
  assert.equal(out["places/muinastalu.json"], null);
  assert.equal(JSON.parse(out["i18n/places/fi.json"]).muinastalu, undefined);
  assert.equal(JSON.parse(out["i18n/places/et.json"]).kirik, "Kirik");
  assert.deepEqual(JSON.parse(out["sites/oobikuoru/site.json"]).nearby, [{ place: "kirik", road_km: 1 }]);
});

test("touched paths cover the description languages and sites", () => {
  const paths = touchedPaths([{ id: "muinastalu", deleted: true }], { langs: ["et", "en", "fi"], sites: ["oobikuoru"] });
  assert.deepEqual(paths.sort(), ["i18n/places/en.json", "i18n/places/et.json", "i18n/places/fi.json", "places/muinastalu.json", "sites/oobikuoru/site.json"]);
});

test("an edit says what it does", () => {
  const base = { places: { kirik: { name: "Rõuge kirik" } } };
  assert.equal(describe({ id: "kirik", geo: { lat: 57.1, lng: 26.2 } }, base), "Move Rõuge kirik to 57.1, 26.2");
});

test("ids come from names", () => {
  assert.equal(slug("Rõuge Suurjärv"), "rouge-suurjarv");
  assert.equal(slug("Käsitöö- ja kohvikukoda"), "kasitoo-ja-kohvikukoda");
});

test("a photo, its credit and a website go into the place's file", () => {
  const out = applyEdits(files(), [{ id: "kirik", photo: "media/kirik.jpg", photo_credit: "David", url: "https://eelk.ee/rouge" }], opts);
  const place = JSON.parse(out["places/kirik.json"]);
  assert.equal(place.photo, "media/kirik.jpg");
  assert.equal(place.photo_credit, "David");
  assert.equal(place.url, "https://eelk.ee/rouge");
  assert.deepEqual(Object.keys(place), ["name", "category", "geo", "position", "photo", "photo_credit", "url"]);
});

test("a removed or replaced photo's file goes, and so does a deleted place's", () => {
  const f = { ...files(), "places/muinastalu.json": j({ name: "Muinastalu", category: "heritage", geo: { lat: 1, lng: 2 }, photo: "media/old.webp", url: "https://x.ee" }) };
  let out = applyEdits(f, [{ id: "muinastalu", photo: null, url: null }], opts);
  assert.equal(out["places/media/old.webp"], null);
  assert.equal(JSON.parse(out["places/muinastalu.json"]).photo, undefined);
  assert.equal(JSON.parse(out["places/muinastalu.json"]).url, undefined);
  out = applyEdits(f, [{ id: "muinastalu", photo: "media/muinastalu.jpg" }], opts);
  assert.equal(out["places/media/old.webp"], null);
  out = applyEdits(f, [{ id: "muinastalu", deleted: true }], opts);
  assert.equal(out["places/media/old.webp"], null);
  out = applyEdits(f, [{ id: "muinastalu", photo: "media/old.webp" }], opts);
  assert.equal("places/media/old.webp" in out, false);
});

test("a photo from the photo service replaces a file in the repository", () => {
  const f = { ...files(), "places/muinastalu.json": j({ name: "Muinastalu", category: "heritage", geo: { lat: 1, lng: 2 }, photo: "media/old.jpg" }) };
  const photo = { id: "0123456789abcdef", width: 1600, height: 1200, widths: [480, 960, 1600], formats: ["webp", "jpg"] };
  const out = applyEdits(f, [{ id: "muinastalu", photo }], opts);
  assert.deepEqual(JSON.parse(out["places/muinastalu.json"]).photo, photo);
  assert.equal(out["places/media/old.jpg"], null);
  // Replacing a service photo leaves the service to clean up.
  const again = applyEdits({ ...f, "places/muinastalu.json": out["places/muinastalu.json"] }, [{ id: "muinastalu", photo: null }], opts);
  assert.deepEqual(Object.keys(again), ["places/muinastalu.json"]);
});
