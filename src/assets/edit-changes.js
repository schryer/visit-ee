// What the map's edit mode (edit.js) changes in the content files, kept apart
// from the page so the tests can run it in Node.
//
// An edit is everything pending for one place, by id:
//   { id, isNew, deleted, geo: { lat, lng }, name, category,
//     text: { et, en }, nearby: { on, walk_m, road_km },
//     photo, photo_credit, url }
// Every field but id is optional; a missing one leaves the file as it is,
// and null removes it (photo, photo_credit, url). A moved place is no
// longer an estimate, so "position" goes. A photo is the storage service's
// object for it (edit.js uploads it first), or a file in places/ from
// before the service, which goes from the repository when replaced.

// The files a set of edits reads and writes, given the description
// languages (i18n/places/<lang>.json) and sites that exist.
export function touchedPaths(edits, { langs, sites }) {
  const paths = new Set();
  for (const e of edits) {
    paths.add(placePath(e.id));
    if (e.deleted || e.text) for (const lang of langs) paths.add(textPath(lang));
    if (e.deleted || e.nearby) for (const site of sites) paths.add(sitePath(site));
  }
  return [...paths];
}

// The new content of every file the edits change, from `files` (path to
// text, or null where a file does not exist). A deleted file maps to null.
// `site` is the site whose nearby list an edit's `nearby` refers to.
export function applyEdits(files, edits, { site }) {
  const json = {};
  const read = (path) => {
    if (!(path in json)) json[path] = files[path] == null ? null : JSON.parse(files[path]);
    return json[path];
  };
  const write = (path, value) => (json[path] = value);
  // Files that aren't JSON and go: photos no place uses any more.
  const removed = new Set();

  for (const e of edits) {
    const where = placePath(e.id);
    if (e.deleted) {
      const old = read(where);
      write(where, null);
      // Its photo goes too.
      if (typeof old?.photo === "string") removed.add(`places/${old.photo}`);
      for (const path of Object.keys(files).filter(isTextPath)) {
        const text = read(path);
        if (text && e.id in text) delete text[e.id];
      }
      for (const path of Object.keys(files).filter(isSitePath)) {
        const s = read(path);
        if (s?.nearby) s.nearby = s.nearby.filter((n) => n.place !== e.id);
      }
      continue;
    }

    const place = read(where) || {};
    if (!e.isNew && !files[where]) throw new Error(`${where} no longer exists`);
    if (e.isNew && files[where]) throw new Error(`${where} already exists; pick another id`);
    if (e.name !== undefined) place.name = e.name;
    if (e.category !== undefined) place.category = e.category;
    if (e.geo) {
      place.geo = { lat: round(e.geo.lat), lng: round(e.geo.lng) };
      delete place.position;
    }
    // A replaced or removed photo's file goes.
    if (typeof place.photo === "string" && e.photo !== undefined && e.photo !== place.photo) removed.add(`places/${place.photo}`);
    for (const key of ["photo", "photo_credit", "url"]) {
      if (e[key] === null) delete place[key];
      else if (e[key] !== undefined) place[key] = e[key];
    }
    write(where, ordered(place, ["name", "category", "geo", "position", "photo", "photo_credit", "url", "site"]));

    for (const [lang, value] of Object.entries(e.text || {})) {
      const path = textPath(lang);
      const text = read(path) || {};
      if (value) text[e.id] = value;
      else delete text[e.id];
      write(path, text);
    }

    if (e.nearby) {
      const path = sitePath(site);
      const s = read(path);
      if (!s) throw new Error(`${path} does not exist`);
      const list = (s.nearby || []).filter((n) => n.place !== e.id);
      const old = (s.nearby || []).find((n) => n.place === e.id);
      if (e.nearby.on) {
        const entry = { place: e.id };
        const walk = "walk_m" in e.nearby ? e.nearby.walk_m : old?.walk_m;
        const road = "road_km" in e.nearby ? e.nearby.road_km : old?.road_km;
        if (walk) entry.walk_m = walk;
        if (road) entry.road_km = road;
        // In place when it was listed already, so the diff stays small.
        const at = (s.nearby || []).findIndex((n) => n.place === e.id);
        if (at >= 0) list.splice(at, 0, entry);
        else list.push(entry);
      }
      s.nearby = list;
    }
  }

  const out = {};
  for (const [path, value] of Object.entries(json)) {
    const text = value === null ? null : JSON.stringify(value, null, 2) + "\n";
    if (text !== (files[path] ?? null)) out[path] = text;
  }
  for (const path of removed) out[path] = null;
  return out;
}

// One line per edit, for the pull request.
export function describe(e, base) {
  const name = e.name ?? base.places[e.id]?.name ?? e.id;
  if (e.deleted) return `Delete ${name} (${e.id})`;
  const parts = [];
  if (e.isNew) parts.push(`Add ${name} (${e.id}, ${e.category})`);
  else {
    if (e.geo) parts.push(`Move ${name} to ${round(e.geo.lat)}, ${round(e.geo.lng)}`);
    if (e.name !== undefined) parts.push(`Rename ${e.id} to ${e.name}`);
    if (e.category !== undefined) parts.push(`${name} is now ${e.category}`);
  }
  if (e.photo) parts.push(`New photo of ${name}`);
  else if (e.photo === null) parts.push(`Remove the photo of ${name}`);
  if (e.photo_credit !== undefined && !e.isNew) parts.push(`Photo credit for ${name}`);
  if (e.url !== undefined && !e.isNew) parts.push(e.url === null ? `Remove the website of ${name}` : `Website of ${name}: ${e.url}`);
  for (const lang of Object.keys(e.text || {})) if (!e.isNew) parts.push(`New ${lang} description for ${name}`);
  if (e.nearby?.on === true) parts.push(`List ${name} near this site`);
  if (e.nearby?.on === false) parts.push(`Take ${name} off this site`);
  return parts.join("; ") || `${name}: no change`;
}

// "Rõuge Suurjärv" as "rouge-suurjarv".
export function slug(name) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Five decimals is about a metre.
export function round(x) {
  return Math.round(x * 1e5) / 1e5;
}

export const placePath = (id) => `places/${id}.json`;
export const textPath = (lang) => `i18n/places/${lang}.json`;
export const sitePath = (site) => `sites/${site}/site.json`;
const isTextPath = (path) => /^i18n\/places\/[^/]+\.json$/.test(path);
const isSitePath = (path) => /^sites\/[^/]+\/site\.json$/.test(path);

// The keys in `first` come first, in that order; the rest keep theirs.
function ordered(object, first) {
  const out = {};
  for (const key of first) if (key in object) out[key] = object[key];
  for (const key of Object.keys(object)) if (!(key in out)) out[key] = object[key];
  return out;
}
