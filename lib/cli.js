// visit-ee: builds the visit.ee sites, or serves them while you edit.
//
//   visit-ee build [--content DIR] [--out DIR] [--env preview|production] [--url URL] [--maps-url URL]
//   visit-ee serve [the same] [--port N]
//
// --content is the folder holding i18n/ and sites/ (this repository by
// default). --env preview, the default, asks search engines to keep out;
// production lets them in. --url is the address the site is served at,
// for canonical links and the sitemap. --quick makes one small JPEG per
// photo instead of every size and format, for tests. --maps-url is the
// maps service the area maps load from (https://maps.sustenaut.eu by
// default; a local `maps` build works too).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: visit-ee build|serve [--content DIR] [--out DIR] [--env preview|production] [--url URL] [--maps-url URL] [--port N] [--quick]";

function fail(message) {
  process.stderr.write(`visit-ee: ${message}\n`);
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      content: { type: "string", default: ROOT },
      out: { type: "string", default: path.join(process.cwd(), "_site") },
      env: { type: "string", default: "preview" },
      url: { type: "string", default: "https://temp.schryer.eu" },
      "maps-url": { type: "string", default: "https://maps.sustenaut.eu" },
      port: { type: "string", default: "8080" },
      quick: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (err) {
  fail(`${err.message}\n${USAGE}`);
}
const { values, positionals } = parsed;
if (values.help) {
  process.stdout.write(USAGE + "\n");
  process.exit(0);
}
const command = positionals[0];
if (positionals.length !== 1 || !["build", "serve"].includes(command)) fail(USAGE);
if (!["preview", "production"].includes(values.env)) fail(`--env must be preview or production, not ${values.env}`);

process.env.VISIT_EE_CONTENT = path.resolve(values.content);
process.env.VISIT_EE_OUT = path.resolve(values.out);
process.env.VISIT_EE_ENV = values.env;
process.env.VISIT_EE_URL = values.url.replace(/\/$/, "");
process.env.VISIT_EE_QUICK = values.quick ? "1" : "0";
process.env.VISIT_EE_MAPS_URL = values["maps-url"].replace(/\/$/, "");

const { Eleventy } = await import("@11ty/eleventy");
process.chdir(ROOT);
const eleventy = new Eleventy("src", process.env.VISIT_EE_OUT, {
  configPath: path.join(ROOT, "eleventy.config.js"),
  quietMode: true,
});

try {
  if (command === "build") {
    await eleventy.write();
    process.stdout.write(`visit-ee: built ${process.env.VISIT_EE_OUT}\n`);
  } else {
    await eleventy.watch();
    await eleventy.serve(Number(values.port));
  }
} catch (err) {
  // Eleventy wraps the cause: report the innermost message, which names
  // the missing string or broken file.
  let cause = err;
  while (cause.originalError || cause.cause) cause = cause.originalError || cause.cause;
  fail(cause.message);
}
