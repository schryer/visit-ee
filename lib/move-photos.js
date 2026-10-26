// move-photos: moves every place photo still kept in places/media/ to the
// storage service (schryer/storage), as the map's edit mode would upload
// it, then points the place at it and deletes the file. Commit the result
// as a pull request.
//
//   ./with-secrets bin/move-photos [--photos-url URL] [--content DIR]
//
// GITHUB_TOKEN is a token that may push to this repository, like the edit
// mode's: with-secrets exports the Bitwarden secret github-token as it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The same sizes and formats as src/assets/edit.js makes.
const WIDTHS = [480, 960, 1600];

const { values } = parseArgs({
  options: {
    "photos-url": { type: "string", default: "https://storage.sustenaut.eu/visit-ee" },
    content: { type: "string", default: ROOT },
  },
});
const token = process.env.GITHUB_TOKEN;
if (!token) {
  process.stderr.write("move-photos: set GITHUB_TOKEN to a token that may push to the repository (the Bitwarden secret github-token, through ./with-secrets)\n");
  process.exit(2);
}

const dir = path.join(values.content, "places");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const where = path.join(dir, file);
  const place = JSON.parse(fs.readFileSync(where, "utf8"));
  if (typeof place.photo !== "string") continue;
  const source = path.join(dir, place.photo);
  const image = sharp(source).rotate();
  const { width } = await image.metadata();
  const widths = WIDTHS.filter((w) => w < width);
  widths.push(Math.min(width, WIDTHS.at(-1)));
  const form = new FormData();
  for (const w of [...new Set(widths)]) {
    // rotate() turns it the way the camera held it; the output keeps no
    // metadata, so no GPS either.
    const resized = sharp(source).rotate().resize({ width: w });
    form.append(`${w}.jpg`, new Blob([await resized.clone().jpeg({ quality: 85, mozjpeg: true }).toBuffer()]), `${w}.jpg`);
    form.append(`${w}.webp`, new Blob([await resized.clone().webp({ quality: 80 }).toBuffer()]), `${w}.webp`);
  }
  const response = await fetch(`${values["photos-url"]}/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    process.stderr.write(`move-photos: ${file}: ${answer.error || response.status}\n`);
    process.exit(1);
  }
  place.photo = answer;
  fs.writeFileSync(where, JSON.stringify(place, null, 2) + "\n");
  fs.unlinkSync(source);
  process.stdout.write(`${file}: ${place.photo.id}\n`);
}
