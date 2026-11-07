// visit-ee distances: write each site's distances.json, the walking and
// road distances from the site to the places it lists, worked out on the
// maps service's road networks (src/assets/distances.js).
//
//   visit-ee distances [--content DIR] [--maps-url URL]
//
// --maps-url is the maps service (https://maps.sustenaut.eu by default), or a
// folder holding a `maps build` (its index.json and routes/). A site whose
// file already fits is left as it is, so the networks are read only when
// something moved.

import fs from "node:fs";
import path from "node:path";
import { ContentError, loadPlaces } from "./content.js";
import { distances, join, networksFor, stale } from "../src/assets/distances.js";

function reader(maps) {
  if (/^https?:\/\//.test(maps)) {
    return async (file) => {
      const response = await fetch(`${maps}/${file}`);
      if (!response.ok) throw new ContentError(`${maps}/${file}: ${response.status} ${response.statusText}`);
      return response.json();
    };
  }
  return async (file) => JSON.parse(fs.readFileSync(path.join(maps, file), "utf8"));
}

export async function writeDistances(contentDir, maps) {
  const { places } = loadPlaces(contentDir);
  const get = reader(maps);
  const sitesDir = path.join(contentDir, "sites");
  const written = [];
  for (const id of fs.readdirSync(sitesDir).sort()) {
    const siteFile = path.join(sitesDir, id, "site.json");
    if (!fs.existsSync(siteFile)) continue;
    const site = JSON.parse(fs.readFileSync(siteFile, "utf8"));
    const listed = {};
    for (const entry of site.nearby || []) {
      if (!places[entry.place]) throw new ContentError(`sites/${id}/site.json: nearby names no place "${entry.place}"`);
      listed[entry.place] = places[entry.place].geo;
    }
    const file = path.join(sitesDir, id, "distances.json");
    const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    if (!stale(old, site.geo, listed).length) continue;
    const networks = await networksFor(get, site.geo, listed);
    if (!networks.length) throw new ContentError(`sites/${id}: ${maps} has no road network around it (index.json lists no area with routes there)`);
    const made = distances(join(networks), site.geo, listed);
    fs.writeFileSync(file, JSON.stringify(made, null, 2) + "\n");
    written.push(path.relative(contentDir, file));
  }
  return written;
}
