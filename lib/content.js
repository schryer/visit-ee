// Reads the content (languages, UI strings, and each site's data and
// strings) and works out every page the build writes, in every language
// it can be written in.
//
// The rules:
//   - A language is built when i18n/languages.json enables it, and then
//     its UI catalog must hold every string the source language's does,
//     or the build fails: a page with a missing button label is a bug.
//   - A site is built in a language only when its own strings in that
//     language are complete. An incomplete translation is left out and
//     not linked, so a half-translated page never ships.
//   - The source language has no URL prefix; every other language lives
//     under /<prefix>/. Each part of a path is translated too: region and
//     town slugs are UI strings (slug.region.<id>, slug.town.<id>), and a
//     site's own slugs are its strings (slug, stay.<id>.slug,
//     groups.slug), so /louna-eesti/rouge/oobikuoru/peremaja/ is
//     /en/south-estonia/rouge/oobikuoru/family-house/ in English.
//   - Places guests can visit belong to the platform, so two sites in one
//     town share them: places/<id>.json holds the name, which is never
//     translated, the category and the position, and
//     i18n/places/<lang>.json a short description. Every place needs one
//     in each language languages.json lists in place_descriptions, or the
//     build fails; in any other language a site is built in, a missing
//     one is a warning and the place shows without it. A site's nearby
//     list names places by id, with the walking or road distance it knows.

import fs from "node:fs";
import path from "node:path";

export class ContentError extends Error {}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new ContentError(`${file}: ${err.message}`);
  }
}

function readStrings(file) {
  return fs.existsSync(file) ? readJson(file) : {};
}

function missingKeys(source, strings) {
  return Object.keys(source).filter((key) => !(key in strings));
}

// "{n} €" with {n: 30} is "30 €". An unknown placeholder stays as it is.
export function fill(text, vars = {}) {
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

function prefixed(lang, rest) {
  return "/" + (lang.prefix ? lang.prefix + "/" : "") + rest;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slug(strings, key, where) {
  const value = strings[key];
  if (!SLUG.test(value || "")) {
    throw new ContentError(`${where}: "${key}" must be a URL slug (lowercase a-z, 0-9 and single hyphens), not ${JSON.stringify(value)}`);
  }
  return value;
}

const LOCALES = { en: "en-GB" };

export const CATEGORIES = ["nature", "lake", "heritage", "museum", "viewpoint", "info", "food", "shop"];

// Where the content lives: the map's edit mode (src/assets/edit.js) sends
// its changes there as a pull request.
export const REPOSITORY = "schryer/visit-ee";

// The straight line between two { lat, lng }, in km.
function crowKm(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Places within this many km show in the map's On foot mode.
const ON_FOOT_KM = 5;

// The helpers every template calls through its page: strings, prices,
// distances and links, all in the page's language.
class Page {
  constructor(fields, content) {
    Object.assign(this, fields);
    Object.defineProperty(this, "content", { value: content, enumerable: false });
    this.language = content.languages.find((l) => l.code === this.lang);
    this.locale = LOCALES[this.lang] || this.lang;
  }

  // A string for this page: the site's own first, then the platform's.
  t(key, vars) {
    const siteStrings = this.site ? this.site.strings[this.lang] : null;
    let text = siteStrings && key in siteStrings ? siteStrings[key] : undefined;
    if (text === undefined) text = this.content.ui[this.lang][key];
    if (text === undefined) {
      throw new ContentError(`no string "${key}" in ${this.lang} (page ${this.url})`);
    }
    return fill(text, vars);
  }

  has(key) {
    const siteStrings = this.site ? this.site.strings[this.lang] : {};
    return key in siteStrings || key in this.content.ui[this.lang];
  }

  // The same string in the site's own language, to show beside a
  // translated name. Empty on a page already in that language.
  local(key) {
    if (!this.site || this.lang === this.site.source_language) return "";
    return this.site.strings[this.site.source_language][key] || "";
  }

  number(n) {
    return new Intl.NumberFormat(this.locale, { maximumFractionDigits: 1 }).format(n);
  }

  // 30 or [100, 150], in euros.
  money(eur) {
    const n = Array.isArray(eur)
      ? this.t("range", { a: this.number(eur[0]), b: this.number(eur[1]) })
      : this.number(eur);
    return this.t("money", { n });
  }

  distance(m) {
    const values = Array.isArray(m) ? m : [m];
    const km = Math.max(...values) >= 1000;
    const shown = values.map((v) => this.number(km ? v / 1000 : v));
    const n = shown.length > 1 ? this.t("range", { a: shown[0], b: shown[1] }) : shown[0];
    return this.t(km ? "distance.km" : "distance.m", { n });
  }

  // The site's nearby places, nearest first, each with a distance a guest
  // can use: walking time under 2 km, then the road distance the site
  // gives, then the straight line.
  get nearby() {
    const places = this.content.places;
    const descriptions = this.content.placeText[this.lang] || {};
    return this.site.nearby
      .map((entry) => {
        const place = places[entry.place];
        const km = crowKm(this.site.geo, place.geo);
        const metres = entry.walk_m ?? km * 1000;
        let distance;
        if (metres < 2000) distance = this.t("map.walk", { n: Math.max(1, Math.round(metres / 80)) });
        else if (entry.road_km) distance = this.t("map.road", { n: this.number(entry.road_km) });
        else distance = this.t("map.crow", { n: this.number(km < 10 ? Math.round(km * 10) / 10 : Math.round(km)) });
        return {
          id: entry.place,
          name: place.name,
          category: place.category,
          geo: place.geo,
          description: descriptions[entry.place] || "",
          distance,
          order: entry.walk_m ?? (entry.road_km ? entry.road_km * 1000 : km * 1000),
          onFoot: km <= ON_FOOT_KM,
        };
      })
      .sort((a, b) => a.order - b.order);
  }

  // The categories among the nearby places, with how many each has.
  get nearbyCategories() {
    const places = this.nearby;
    return CATEGORIES.map((id) => ({ id, count: places.filter((p) => p.category === id).length })).filter((c) => c.count);
  }

  // What the map script needs that the HTML does not say.
  get mapConfig() {
    const site = this.site;
    return {
      lang: this.lang,
      home: { lat: site.geo.lat, lng: site.geo.lng, name: this.t("site.short_name"), mark: this.media(site.logo.mark || site.logo.light) },
      // The maps service (bin/visit-ee --maps-url): its package loads the
      // map library and the area packs around home.
      maps: process.env.VISIT_EE_MAPS_URL,
      link: this.canonical,
      // For the edit mode (?edit), which opens pull requests on the content.
      edit: { repository: REPOSITORY, site: site.id, categories: CATEGORIES },
      strings: {
        one: this.t("map.places.one"),
        other: this.t("map.places.other"),
        copy: this.t("map.copy_link"),
        copied: this.t("map.link_copied"),
        close: this.t("map.close"),
        failed: this.t("map.failed"),
      },
      locale: this.mapLocale,
    };
  }

  // What the platform map script needs: each site built in this page's
  // language, at its position, with its mark and address.
  get platformMapConfig() {
    return {
      maps: process.env.VISIT_EE_MAPS_URL,
      sites: this.content.sites
        .map((site) => this.pageFor(site.id))
        .filter(Boolean)
        .map((page) => ({
          name: page.t("site.short_name"),
          line: page.t("site.place_line"),
          url: page.url,
          lat: page.site.geo.lat,
          lng: page.site.geo.lng,
          mark: page.media(page.site.logo.mark || page.site.logo.light),
        })),
      failed: this.t("platform.map.failed"),
      locale: this.mapLocale,
    };
  }

  // MapLibre's own labels.
  get mapLocale() {
    return {
      "NavigationControl.ZoomIn": this.t("map.zoom_in"),
      "NavigationControl.ZoomOut": this.t("map.zoom_out"),
      "CooperativeGesturesHandler.WindowsHelpText": this.t("map.gesture.ctrl"),
      "CooperativeGesturesHandler.MacHelpText": this.t("map.gesture.mac"),
      "CooperativeGesturesHandler.MobileHelpText": this.t("map.gesture.touch"),
      "AttributionControl.ToggleAttribution": this.t("map.attribution"),
    };
  }

  // ["et", "ru"] as "Estonian and Russian", in this page's language.
  languageList(codes) {
    const names = new Intl.DisplayNames([this.locale], { type: "language" });
    return new Intl.ListFormat(this.locale, { type: "conjunction" }).format(codes.map((c) => names.of(c)));
  }

  // Another page in this page's language, by key ("oobikuoru",
  // "oobikuoru/groups"), or undefined if it is not built in it.
  pageFor(key) {
    return this.content.pages.find((page) => page.key === key && page.lang === this.lang);
  }

  country(code) {
    return new Intl.DisplayNames([this.locale], { type: "region" }).of(code);
  }

  get home() {
    return prefixed(this.language, "");
  }

  get siteUrl() {
    return this.site ? this.pageFor(this.site.id).url : this.home;
  }

  stayUrl(id) {
    return this.pageFor(`${this.site.id}/${id}`).url;
  }

  get groupsUrl() {
    return this.pageFor(`${this.site.id}/groups`).url;
  }

  // Language-neutral files of the site (logos, videos), under /media/<id>/.
  media(file) {
    return mediaUrl(this.site, file);
  }

  absolute(url) {
    return this.content.baseUrl + url;
  }

  get canonical() {
    return this.absolute(this.url);
  }

  // The trail from visit.ee to this page. Regions and towns have no pages
  // yet, so they carry no url.
  get trail() {
    const trail = [{ name: this.t("platform.name"), url: this.home }];
    if (!this.site) return trail;
    trail.push({ name: this.t(`region.${this.site.region}`) });
    trail.push({ name: this.t(`town.${this.site.town}`) });
    trail.push({ name: this.t("site.short_name"), url: this.siteUrl });
    if (this.stay) trail.push({ name: this.t(`stay.${this.stay.id}.title`), url: this.url });
    if (this.kind === "groups") trail.push({ name: this.t("groups.title"), url: this.url });
    return trail;
  }

  // schema.org JSON-LD for the page. image is an absolute URL or empty.
  structuredData(image) {
    const graph = [];
    const trail = this.trail.filter((step) => step.url);
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: trail.map((step, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: step.name,
        item: this.absolute(step.url),
      })),
    });
    if (!this.site) {
      graph.push({ "@type": "WebSite", name: "visit.ee", url: this.canonical, inLanguage: this.lang });
      return { "@context": "https://schema.org", "@graph": graph };
    }

    const site = this.site;
    const business = {
      "@type": ["LodgingBusiness", "Campground"],
      "@id": this.absolute(this.siteUrl) + "#business",
      name: this.t("site.name"),
      alternateName: site.strings[site.source_language]["site.name"],
      url: this.absolute(this.siteUrl),
      telephone: site.phone,
      email: site.email,
      address: {
        "@type": "PostalAddress",
        streetAddress: site.address.street,
        postalCode: site.address.postal_code,
        addressLocality: site.address.locality,
        addressRegion: site.address.region,
        addressCountry: site.address.country,
      },
      geo: { "@type": "GeoCoordinates", latitude: site.geo.lat, longitude: site.geo.lng },
      knowsLanguage: site.spoken_languages,
      priceRange: this.money(priceRange(site)),
      currenciesAccepted: "EUR",
    };
    if (image) business.image = image;
    graph.push(business);

    if (this.kind === "site") {
      for (const place of this.nearby) {
        const node = {
          "@type": "TouristAttraction",
          name: place.name,
          geo: { "@type": "GeoCoordinates", latitude: place.geo.lat, longitude: place.geo.lng },
        };
        if (place.description) node.description = place.description;
        graph.push(node);
      }
    }

    if (this.stay) {
      const stay = this.stay;
      const place = {
        "@type": "Accommodation",
        name: this.t(`stay.${stay.id}.title`),
        description: this.t(`stay.${stay.id}.summary`),
        url: this.canonical,
        containedInPlace: { "@id": business["@id"] },
        amenityFeature: (stay.amenities || []).map((a) => ({
          "@type": "LocationFeatureSpecification",
          name: this.t(`amenity.${a}`),
          value: true,
        })),
      };
      if (stay.sleeps) place.occupancy = { "@type": "QuantitativeValue", maxValue: Math.max(...stay.sleeps) };
      if (stay.bedrooms) place.numberOfBedrooms = stay.bedrooms;
      if (image) place.image = image;
      graph.push(place);
    }
    return { "@context": "https://schema.org", "@graph": graph };
  }
}

export function mediaUrl(site, file) {
  return `/media/${site.id}/${file.replace(/^media\//, "")}`;
}

function priceRange(site) {
  const all = site.stays.flatMap((s) => (s.prices || []).filter((p) => p.id !== "linen").flatMap((p) => [p.eur].flat()));
  return [Math.min(...all), Math.max(...all)];
}

export function load(contentDir, { baseUrl = "" } = {}) {
  const config = readJson(path.join(contentDir, "i18n", "languages.json"));
  const source = config.source;
  const languages = config.languages.filter((l) => l.enabled);
  if (!languages.some((l) => l.code === source)) {
    throw new ContentError(`the source language ${source} is not enabled in i18n/languages.json`);
  }

  const ui = {};
  const sourceUi = readJson(path.join(contentDir, "i18n", "ui", `${source}.json`));
  for (const lang of languages) {
    const strings = readStrings(path.join(contentDir, "i18n", "ui", `${lang.code}.json`));
    const missing = missingKeys(sourceUi, strings);
    if (missing.length) {
      throw new ContentError(
        `i18n/ui/${lang.code}.json is missing ${missing.length} UI string(s): ${missing.join(", ")}`,
      );
    }
    ui[lang.code] = strings;
  }

  const places = loadPlaces(contentDir);
  const placeText = {};
  const required = config.place_descriptions || [source];
  for (const code of new Set([...languages.map((l) => l.code), ...required])) {
    const file = `i18n/places/${code}.json`;
    placeText[code] = readStrings(path.join(contentDir, file));
    for (const id of Object.keys(placeText[code])) {
      if (!places[id]) throw new ContentError(`${file}: there is no place "${id}" in places/`);
    }
    if (required.includes(code)) {
      const missing = Object.keys(places).filter((id) => !placeText[code][id]);
      if (missing.length) throw new ContentError(`${file} has no description for ${missing.length} place(s): ${missing.join(", ")}`);
    }
  }
  const warnings = [];

  const sites = [];
  const sitesDir = path.join(contentDir, "sites");
  for (const id of fs.readdirSync(sitesDir).sort()) {
    const dir = path.join(sitesDir, id);
    if (!fs.existsSync(path.join(dir, "site.json"))) continue;
    const site = readJson(path.join(dir, "site.json"));
    site.dir = dir;
    const sourceStrings = readJson(path.join(dir, "strings", `${site.source_language}.json`));
    site.strings = {};
    site.languages = [];
    site.skipped = [];
    for (const lang of languages) {
      const strings = readStrings(path.join(dir, "strings", `${lang.code}.json`));
      const missing = missingKeys(sourceStrings, strings);
      if (missing.length) {
        site.skipped.push({ lang: lang.code, missing });
        continue;
      }
      site.strings[lang.code] = strings;
      site.languages.push(lang.code);
    }
    if (!site.languages.includes(site.source_language)) {
      throw new ContentError(`site ${id}: its source language ${site.source_language} is not enabled`);
    }
    for (const entry of site.nearby || []) {
      if (!places[entry.place]) throw new ContentError(`sites/${id}/site.json: nearby names no place "${entry.place}" in places/`);
    }
    site.nearby = site.nearby || [];
    for (const code of site.languages.filter((c) => !required.includes(c))) {
      const missing = site.nearby.map((e) => e.place).filter((id) => !placeText[code][id]);
      if (missing.length) {
        warnings.push({
          file: `i18n/places/${code}.json`,
          message: `${id} is built in ${code}, but ${missing.length} of its places have no description in it: ${missing.join(", ")}`,
        });
      }
    }
    sites.push(site);
  }

  const content = { source, languages, ui, places, placeText, sites, warnings, baseUrl: baseUrl.replace(/\/$/, "") };
  content.pages = pages(content);
  content.redirects = redirects(content);
  return content;
}

function loadPlaces(contentDir) {
  const places = {};
  const dir = path.join(contentDir, "places");
  if (!fs.existsSync(dir)) return places;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    const where = `places/${file}`;
    if (!SLUG.test(id)) throw new ContentError(`${where}: a place id must be lowercase a-z, 0-9 and hyphens`);
    const place = readJson(path.join(dir, file));
    if (!CATEGORIES.includes(place.category)) {
      throw new ContentError(`${where}: category must be one of ${CATEGORIES.join(", ")}, not ${JSON.stringify(place.category)}`);
    }
    if (!(typeof place.geo?.lat === "number" && typeof place.geo?.lng === "number")) {
      throw new ContentError(`${where}: geo needs a lat and a lng`);
    }
    places[id] = place;
  }
  return places;
}

function pages(content) {
  const list = [];
  const add = (fields) => list.push(new Page(fields, content));

  for (const lang of content.languages) {
    add({ key: "platform", kind: "platform", lang: lang.code, url: prefixed(lang, "") });
  }
  for (const site of content.sites) {
    for (const code of site.languages) {
      const lang = content.languages.find((l) => l.code === code);
      const ui = content.ui[code];
      const strings = site.strings[code];
      const where = `sites/${site.id}/strings/${code}.json`;
      const base = prefixed(lang, [
        slug(ui, `slug.region.${site.region}`, `i18n/ui/${code}.json`),
        slug(ui, `slug.town.${site.town}`, `i18n/ui/${code}.json`),
        slug(strings, "slug", where),
      ].join("/") + "/");
      const children = new Map();
      const child = (key, value) => {
        if (children.has(value)) throw new ContentError(`${where}: "${key}" and "${children.get(value)}" are both "${value}"`);
        children.set(value, key);
        return `${base}${value}/`;
      };
      add({ key: `${site.id}`, kind: "site", lang: code, url: base, site });
      for (const stay of site.stays) {
        const key = `stay.${stay.id}.slug`;
        add({ key: `${site.id}/${stay.id}`, kind: "stay", lang: code, url: child(key, slug(strings, key, where)), site, stay });
      }
      if (site.groups) {
        add({ key: `${site.id}/groups`, kind: "groups", lang: code, url: child("groups.slug", slug(strings, "groups.slug", where)), site });
      }
    }
  }

  // Each page links to itself in every language it exists in, and names
  // the source language's version as the default.
  const byKey = new Map();
  for (const page of list) byKey.set(page.key, [...(byKey.get(page.key) || []), page]);
  for (const page of list) {
    const versions = byKey.get(page.key);
    page.alternates = versions.map((p) => ({ lang: p.lang, url: p.url, name: p.language.name, locale: p.language.locale }));
    const fallback = versions.find((p) => p.lang === content.source) || versions[0];
    page.xDefault = fallback.url;
  }
  return list;
}

// Each site's old addresses, to its pages in the source language. A
// target is "#anchor" on the site page, or the id of a stay or "groups".
function redirects(content) {
  const list = [];
  for (const site of content.sites) {
    const find = (key) => content.pages.find((p) => p.key === key && p.lang === site.source_language);
    for (const [from, to] of Object.entries(site.redirects || {})) {
      const page = to.startsWith("#") ? find(site.id) : find(`${site.id}/${to}`);
      if (!page) throw new ContentError(`sites/${site.id}/site.json: redirect ${from} names no page: ${to}`);
      list.push({ site: site.id, from, to: page.url + (to.startsWith("#") ? to : "") });
    }
  }
  return list;
}
