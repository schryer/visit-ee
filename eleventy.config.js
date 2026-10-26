// Eleventy settings for visit.ee. Run it through bin/visit-ee, which sets
// the VISIT_EE_* variables this reads.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Image from "@11ty/eleventy-img";

const require = createRequire(import.meta.url);
const OUT = process.env.VISIT_EE_OUT || "_site";

// The fonts, self-hosted: the weights the CSS uses, in the subsets the
// languages need (Cyrillic for Ukrainian). Barlow Condensed has no
// Cyrillic, so headings fall back to Source Sans 3 there.
const FONTS = [
  "@fontsource/barlow-condensed/600.css",
  "@fontsource/barlow-condensed/700.css",
  "@fontsource/source-sans-3/500.css",
  "@fontsource/source-sans-3/600.css",
  "@fontsource-variable/source-serif-4/wght.css",
  "@fontsource-variable/source-serif-4/wght-italic.css",
];
const SUBSETS = ["latin", "latin-ext", "cyrillic", "cyrillic-ext"];

function writeFonts() {
  const dir = path.join(OUT, "fonts");
  fs.mkdirSync(dir, { recursive: true });
  const css = [];
  for (const sheet of FONTS) {
    const file = require.resolve(sheet);
    const text = fs.readFileSync(file, "utf8");
    for (const block of text.split(/(?=\/\* )/)) {
      const name = block.match(/^\/\* (\S+) \*\//)?.[1];
      if (!name || !SUBSETS.some((s) => name.includes(`-${s}-`))) continue;
      const woff2 = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
      fs.copyFileSync(path.join(path.dirname(file), "files", woff2), path.join(dir, woff2));
      css.push(
        block
          .replace(/url\(\.\/files\/([^)]+\.woff2)\)/, "url(/fonts/$1)")
          .replace(/, url\(\.\/files\/[^)]+\.woff\) format\('woff'\)/, "")
          .trim(),
      );
    }
  }
  fs.writeFileSync(path.join(dir, "fonts.css"), css.join("\n\n") + "\n");
}

// Each site's language-neutral files (logos, videos) go out under
// /media/<site id>/, the same for every language. Photos go through the
// picture shortcode instead.
function copySiteMedia(content) {
  for (const site of content.sites) {
    for (const sub of ["logo", "video"]) {
      const from = path.join(site.dir, "media", sub);
      if (!fs.existsSync(from)) continue;
      fs.cpSync(from, path.join(OUT, "media", site.id, sub), { recursive: true, force: false });
    }
  }
}

const IMAGE_OPTIONS = {
  formats: ["avif", "webp", "jpeg"],
  outputDir: path.join(OUT, "img"),
  urlPath: "/img/",
  sharpAvifOptions: { quality: 55 },
  sharpWebpOptions: { quality: 72 },
  sharpJpegOptions: { quality: 78, mozjpeg: true },
};

// --quick (VISIT_EE_QUICK) makes one small JPEG per photo, for tests.
const QUICK = process.env.VISIT_EE_QUICK === "1";

async function imageMetadata(site, src, widths) {
  const options = QUICK ? { ...IMAGE_OPTIONS, formats: ["jpeg"], widths: [320] } : { ...IMAGE_OPTIONS, widths };
  return Image(path.join(site.dir, src), options);
}

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addWatchTarget("sites/");
  eleventyConfig.addWatchTarget("i18n/");
  eleventyConfig.addWatchTarget("lib/");

  eleventyConfig.on("eleventy.before", writeFonts);
  eleventyConfig.on("eleventy.after", async () => {
    const { default: visit } = await import("./src/_data/visit.js");
    const content = await visit();
    // Content that builds but is not finished, such as a place with no
    // description in a language its site is built in. In GitHub Actions
    // they show on the run and the pull request.
    for (const w of content.warnings) {
      process.stderr.write(process.env.GITHUB_ACTIONS ? `::warning file=${w.file}::${w.message}\n` : `visit-ee: warning: ${w.file}: ${w.message}\n`);
    }
    copySiteMedia(content);
  });

  // {% picture p.site, "media/photos/x.jpg", "alt", "(min-width: 60rem) 33vw, 100vw" %}
  eleventyConfig.addAsyncShortcode("picture", async (site, src, alt, sizes, opts = {}) => {
    const metadata = await imageMetadata(site, src, opts.widths || [480, 800, 1200, 1600]);
    return Image.generateHTML(metadata, {
      alt,
      sizes,
      loading: opts.eager ? "eager" : "lazy",
      decoding: "async",
      ...(opts.eager ? { fetchpriority: "high" } : {}),
      ...(opts.class ? { class: opts.class } : {}),
    });
  });

  // The absolute address of a 1200px JPEG, for og:image and JSON-LD.
  eleventyConfig.addAsyncShortcode("imageUrl", async (site, src) => {
    const metadata = await imageMetadata(site, src, [1200]);
    return process.env.VISIT_EE_URL + metadata.jpeg.at(-1).url;
  });

  eleventyConfig.addFilter("json", (value) => JSON.stringify(value).replace(/</g, "\\u003c"));

  return {
    dir: { input: "src", includes: "_includes", data: "_data" },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
  };
}
