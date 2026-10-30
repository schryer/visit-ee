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
//     town share them. Each is a folder of its own, and the folder says
//     who looks after it: a public place is in its town's,
//     towns/<town>/places/<id>/, and a private one in the site's that
//     runs it, sites/<site>/places/<id>/ (.github/CODEOWNERS gives each
//     folder its owners). place.json holds the name, which is never
//     translated, the category and the position, and strings/<lang>.json
//     a short description. Ids are unique across all the folders. Every
//     place needs a description in each language languages.json lists in
//     place_descriptions, or the build fails; in any other language a
//     site is built in, a missing one is a warning and the place shows
//     without it. A site's nearby list names places by id, with the
//     walking or road distance it knows. A place may have a photo, and a
//     page to send guests to: its own visit.ee site ("site") or else its
//     official website ("url", one address or one per language).
//   - A town (a municipality, the URL's area level) has its own page at
//     /<region>/<town>/, with the map large and every place in it:
//     towns/<id>/town.json holds its centre, towns/<id>/places/ the
//     public places in it, and towns/<id>/strings/<lang>.json its text.
//     The page lists those places and the private places of its sites.
//     It is built in a language on the same terms as a site. A town
//     folder without a town.json holds places but has no page yet.

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

// What schema.org calls each category; TouristAttraction for the rest.
const SCHEMA_TYPES = { info: "TouristInformationCenter", food: "CafeOrCoffeeShop", shop: "Store" };

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

  // The site or town whose strings and places this page shows.
  get owner() {
    return this.site || this.town || null;
  }

  // A string for this page: the site's own first, then the platform's.
  t(key, vars) {
    const siteStrings = this.owner ? this.owner.strings[this.lang] : null;
    let text = siteStrings && key in siteStrings ? siteStrings[key] : undefined;
    if (text === undefined) text = this.content.ui[this.lang][key];
    if (text === undefined) {
      throw new ContentError(`no string "${key}" in ${this.lang} (page ${this.url})`);
    }
    return fill(text, vars);
  }

  has(key) {
    const siteStrings = this.owner ? this.owner.strings[this.lang] : {};
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

  // The site's nearby places, or a town's places, nearest first (to the
  // site, or the town's centre), each with a distance a guest can use:
  // walking time under 2 km, then the road distance the site gives, then
  // the straight line.
  get nearby() {
    const places = this.content.places;
    const descriptions = this.content.placeText[this.lang] || {};
    const owner = this.owner;
    return owner.nearby
      .map((entry) => {
        const place = places[entry.place];
        const km = crowKm(owner.geo, place.geo);
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
          photo: placePhoto(place, this.content.placeDirs[entry.place]),
          link: this.placeLink(place),
          distance,
          order: entry.walk_m ?? (entry.road_km ? entry.road_km * 1000 : km * 1000),
          onFoot: km <= ON_FOOT_KM,
        };
      })
      .sort((a, b) => a.order - b.order);
  }

  // Where to read more about a place: its visit.ee site in this page's
  // language (or the site's own), else its official website.
  placeLink(place) {
    if (place.site) {
      const versions = this.content.pages.filter((p) => p.kind === "site" && p.site.id === place.site);
      const page = versions.find((p) => p.lang === this.lang) || versions.find((p) => p.lang === p.site.source_language);
      return { href: page.url, external: false };
    }
    if (!place.url) return null;
    const href = typeof place.url === "string" ? place.url : place.url[this.lang] || place.url.en || Object.values(place.url)[0];
    return { href, external: true, host: new URL(href).hostname.replace(/^www\./, "") };
  }

  // The categories among the nearby places, with how many each has.
  get nearbyCategories() {
    const places = this.nearby;
    return CATEGORIES.map((id) => ({ id, count: places.filter((p) => p.category === id).length })).filter((c) => c.count);
  }

  // What the map script needs that the HTML does not say.
  get mapConfig() {
    const site = this.site;
    const owner = this.owner;
    return {
      lang: this.lang,
      home: site
        ? { lat: site.geo.lat, lng: site.geo.lng, name: this.t("site.short_name"), mark: this.media(site.logo.mark || site.logo.light) }
        : { lat: owner.geo.lat, lng: owner.geo.lng, name: this.t(`town.${owner.id}`) },
      // A town's map opens on the whole municipality: its area pack's box.
      area: this.town ? this.town.map_area : undefined,
      // Every town page in this language, by its municipality's name, so
      // the map can link to it.
      towns: Object.fromEntries(
        this.content.towns
          .map((town) => [town.municipality, this.pageFor(`town/${town.id}`)?.url])
          .filter(([name, url]) => name && url),
      ),
      // The places to stay in a town, each a link to its site.
      stays: this.town ? this.townSites.map((s) => ({ ...s.geo, name: s.name, url: s.url, mark: s.mark })) : [],
      // The maps service (bin/visit-ee --maps-url): its package loads the
      // map library and the area packs around home.
      maps: process.env.VISIT_EE_MAPS_URL,
      link: this.canonical,
      // For the edit mode (?edit), which opens pull requests on a site's
      // content. A town's page has none yet.
      edit: site ? { repository: REPOSITORY, site: site.id, town: site.town, categories: CATEGORIES, photos: process.env.VISIT_EE_PHOTOS_URL } : undefined,
      strings: {
        one: this.t("map.places.one"),
        other: this.t("map.places.other"),
        copy: this.t("map.copy_link"),
        copied: this.t("map.link_copied"),
        close: this.t("map.close"),
        failed: this.t("map.failed"),
        more: this.t("map.more"),
        less: this.t("map.less"),
      },
      // Why the map zooms no closer where the maps service has no detail.
      detailNote: this.t("map.no_detail"),
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

  // The site whose main photo a home or town page shows in link previews,
  // which need an og:image: the first one with a photo built in this
  // page's language (in its town, for a town page). Undefined if none.
  get previewSite() {
    const sites = this.town ? this.townSites.map(({ site }) => site) : this.content.sites.filter((site) => this.pageFor(site.id));
    return sites.find((site) => site.photo);
  }

  // The sites in this page's town that are built in its language.
  get townSites() {
    const town = this.town ? this.town.id : this.site?.town;
    return this.content.sites
      .filter((site) => site.town === town && site.region === (this.town || this.site).region)
      .map((site) => ({ site, page: this.pageFor(site.id) }))
      .filter(({ page }) => page)
      .map(({ site, page }) => ({
        site,
        name: page.t("site.name"),
        line: page.t("site.place_line"),
        url: page.url,
        geo: site.geo,
        mark: mediaUrl(site, site.logo.mark || site.logo.light),
        logo: mediaUrl(site, site.logo.light),
        photoAlt: site.photo ? page.t("site.photo_alt") : page.t("hero.summer.alt"),
      }));
  }

  // The page of this page's town in its language, if it has one.
  get townUrl() {
    const id = this.town ? this.town.id : this.site?.town;
    return id ? this.pageFor(`town/${id}`)?.url : undefined;
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

  // The trail from visit.ee to this page. Regions have no pages yet, so
  // they carry no url; a town has one when it is built in this language.
  get trail() {
    const trail = [{ name: this.t("platform.name"), url: this.home }];
    const owner = this.owner;
    if (!owner) return trail;
    trail.push({ name: this.t(`region.${owner.region}`) });
    trail.push({ name: this.t(`town.${this.town ? owner.id : owner.town}`), url: this.townUrl });
    if (this.town) return trail;
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
    if (this.town) {
      graph.push({
        "@type": "TouristDestination",
        name: this.t(`town.${this.town.id}`),
        url: this.canonical,
        geo: { "@type": "GeoCoordinates", latitude: this.town.geo.lat, longitude: this.town.geo.lng },
        includesAttraction: this.nearby.map((place) => attraction(place, this.content.baseUrl)),
      });
      return { "@context": "https://schema.org", "@graph": graph };
    }
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
      for (const place of this.nearby) graph.push(attraction(place, this.content.baseUrl));
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

function attraction(place, baseUrl) {
  const node = {
    "@type": SCHEMA_TYPES[place.category] || "TouristAttraction",
    name: place.name,
    geo: { "@type": "GeoCoordinates", latitude: place.geo.lat, longitude: place.geo.lng },
  };
  if (place.description) node.description = place.description;
  if (place.link) node.url = place.link.external ? place.link.href : baseUrl + place.link.href;
  return node;
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

  const { places, placeDirs, placeOwners } = loadPlaces(contentDir);
  const placeText = {};
  const required = config.place_descriptions || [source];
  for (const code of new Set([...languages.map((l) => l.code), ...required])) {
    placeText[code] = {};
    for (const [id, dir] of Object.entries(placeDirs)) {
      const file = path.join(dir, "strings", `${code}.json`);
      const where = path.relative(contentDir, file);
      const description = readStrings(file).description;
      if (description) placeText[code][id] = description;
      else if (required.includes(code)) throw new ContentError(`${where}: place ${id} needs a description in ${code}`);
    }
  }
  const warnings = [];

  const sites = [];
  const sitesDir = path.join(contentDir, "sites");
  for (const id of fs.readdirSync(sitesDir).sort()) {
    const dir = path.join(sitesDir, id);
    if (!fs.existsSync(path.join(dir, "site.json"))) continue;
    const site = readJson(path.join(dir, "site.json"));
    site.id = site.id || id;
    site.dir = dir;
    readOwnStrings(site, dir, languages, "site");
    site.nearby = checkPlaces(site.nearby, `sites/${id}/site.json: nearby`);
    sites.push(site);
  }

  // Towns: a page per municipality, with every place in it.
  const towns = [];
  const townsDir = path.join(contentDir, "towns");
  for (const id of fs.existsSync(townsDir) ? fs.readdirSync(townsDir).sort() : []) {
    const dir = path.join(townsDir, id);
    if (!fs.existsSync(path.join(dir, "town.json"))) continue;
    const where = `towns/${id}/town.json`;
    const town = readJson(path.join(dir, "town.json"));
    town.id = id;
    town.dir = dir;
    if (!(typeof town.geo?.lat === "number" && typeof town.geo?.lng === "number")) {
      throw new ContentError(`${where}: geo needs a lat and a lng`);
    }
    if (town.places) throw new ContentError(`${where}: a town's places are the folders in towns/${id}/places/, not a list`);
    readOwnStrings(town, dir, languages, "town");
    towns.push(town);
  }
  // A town lists its own public places and the private places of the
  // sites in it.
  for (const town of towns) {
    const inTown = (owner) => (owner.town ? owner.town === town.id : sites.some((s) => s.id === owner.site && s.town === town.id));
    town.nearby = Object.keys(places)
      .filter((id) => inTown(placeOwners[id]))
      .map((place) => ({ place }));
  }

  // Each place a site or town lists must exist, and a missing description
  // in a language it is built in (beyond the required ones) is a warning.
  function checkPlaces(entries = [], where) {
    for (const entry of entries) {
      if (!places[entry.place]) throw new ContentError(`${where} names no place "${entry.place}" (no towns/*/places/${entry.place}/ or sites/*/places/${entry.place}/)`);
    }
    return entries;
  }
  for (const owner of [...sites, ...towns]) {
    for (const code of owner.languages.filter((c) => !required.includes(c))) {
      const missing = owner.nearby.map((e) => e.place).filter((id) => !placeText[code][id]);
      for (const id of missing) {
        warnings.push({
          file: `${path.relative(contentDir, placeDirs[id])}/strings/${code}.json`,
          message: `${owner.id} is built in ${code}, but its place ${id} has no description in it`,
        });
      }
    }
  }

  for (const [id, place] of Object.entries(places)) {
    if (place.site && !sites.some((site) => site.id === place.site)) {
      throw new ContentError(`${path.relative(contentDir, placeDirs[id])}/place.json: there is no site "${place.site}" in sites/`);
    }
  }
  for (const [id, owner] of Object.entries(placeOwners)) {
    if (owner.site && !sites.some((site) => site.id === owner.site)) {
      throw new ContentError(`sites/${owner.site}/places/${id}: there is no site.json in sites/${owner.site}/`);
    }
  }

  const content = { source, languages, ui, places, placeDirs, placeOwners, placeText, sites, towns, warnings, baseUrl: baseUrl.replace(/\/$/, "") };
  content.pages = pages(content);
  content.redirects = redirects(content);
  return content;
}

// A site's or town's strings in each enabled language. It is built in a
// language only when that language has every key its source language has.
function readOwnStrings(owner, dir, languages, what) {
  const sourceStrings = readJson(path.join(dir, "strings", `${owner.source_language}.json`));
  owner.strings = {};
  owner.languages = [];
  owner.skipped = [];
  for (const lang of languages) {
    const strings = readStrings(path.join(dir, "strings", `${lang.code}.json`));
    const missing = missingKeys(sourceStrings, strings);
    if (missing.length) {
      owner.skipped.push({ lang: lang.code, missing });
      continue;
    }
    owner.strings[lang.code] = strings;
    owner.languages.push(lang.code);
  }
  if (!owner.languages.includes(owner.source_language)) {
    throw new ContentError(`${what} ${owner.id}: its source language ${owner.source_language} is not enabled`);
  }
}

// Every place, by id, from the towns' and sites' places/ folders, with
// the folder each is in and who owns it ({town} or {site}).
function loadPlaces(contentDir) {
  const places = {};
  const placeDirs = {};
  const placeOwners = {};
  for (const kind of ["towns", "sites"]) {
    const top = path.join(contentDir, kind);
    for (const ownerId of fs.existsSync(top) ? fs.readdirSync(top).sort() : []) {
      const dir = path.join(top, ownerId, "places");
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      for (const id of fs.readdirSync(dir).sort()) {
        const placeDir = path.join(dir, id);
        const where = `${kind}/${ownerId}/places/${id}/place.json`;
        if (!fs.statSync(placeDir).isDirectory()) throw new ContentError(`${kind}/${ownerId}/places/${id}: a place is a folder with a place.json`);
        if (!SLUG.test(id)) throw new ContentError(`${where}: a place id must be lowercase a-z, 0-9 and hyphens`);
        if (places[id]) {
          throw new ContentError(`${where}: there is already a place "${id}" in ${path.relative(contentDir, placeDirs[id])}`);
        }
        const place = readJson(path.join(placeDir, "place.json"));
        if (!CATEGORIES.includes(place.category)) {
          throw new ContentError(`${where}: category must be one of ${CATEGORIES.join(", ")}, not ${JSON.stringify(place.category)}`);
        }
        if (!(typeof place.geo?.lat === "number" && typeof place.geo?.lng === "number")) {
          throw new ContentError(`${where}: geo needs a lat and a lng`);
        }
        checkPhoto(place.photo, placeDir, where);
        for (const url of place.url === undefined ? [] : typeof place.url === "string" ? [place.url] : Object.values(place.url)) {
          if (!/^https:\/\/[^/]+\./.test(url)) throw new ContentError(`${where}: url must be an https:// address, not ${JSON.stringify(url)}`);
        }
        places[id] = place;
        placeDirs[id] = placeDir;
        placeOwners[id] = kind === "towns" ? { town: ownerId } : { site: ownerId };
      }
    }
  }
  return { places, placeDirs, placeOwners };
}

// A place's photo is either in the storage service (an object the map's
// edit mode wrote: its id, the size of its largest copy, the widths and
// formats there are) or, from before that, a file in its folder.
const PHOTO_ID = /^[0-9a-f]{16}$/;

function checkPhoto(photo, dir, where) {
  if (photo === undefined) return;
  if (typeof photo === "string") {
    if (!fs.existsSync(path.join(dir, photo))) throw new ContentError(`${where}: there is no photo ${photo} in its folder`);
    return;
  }
  const ok =
    PHOTO_ID.test(photo?.id) &&
    Number.isInteger(photo.width) &&
    Number.isInteger(photo.height) &&
    Array.isArray(photo.widths) &&
    photo.widths.length > 0 &&
    photo.widths.every(Number.isInteger) &&
    Array.isArray(photo.formats) &&
    photo.formats.includes("jpg") &&
    photo.formats.every((f) => f === "jpg" || f === "webp");
  if (!ok) throw new ContentError(`${where}: photo must be a file in its folder, or {id, width, height, widths, formats} from the storage service`);
}

// What the templates need to show a place's photo: the picture shortcode's
// arguments for a file, or the storage service's addresses.
function placePhoto(place, dir) {
  const photo = place.photo;
  if (!photo) return null;
  if (typeof photo === "string") return { owner: { dir }, src: photo, credit: place.photo_credit || "" };
  const base = `${process.env.VISIT_EE_PHOTOS_URL}/p/${photo.id}`;
  const srcset = (format) => photo.widths.map((w) => `${base}/${w}.${format} ${w}w`).join(", ");
  const largest = photo.widths.at(-1);
  return {
    remote: true,
    webp: photo.formats.includes("webp") ? srcset("webp") : null,
    jpg: srcset("jpg"),
    src: `${base}/${photo.widths.find((w) => w >= 960) || largest}.jpg`,
    width: largest,
    height: Math.round((photo.height * largest) / photo.width),
    credit: place.photo_credit || "",
  };
}

// The ids of every photo-service photo a place uses, for its clean-up.
export function photosInUse(content) {
  return Object.values(content.places)
    .map((place) => place.photo?.id)
    .filter(Boolean)
    .sort();
}

function pages(content) {
  const list = [];
  const add = (fields) => list.push(new Page(fields, content));

  for (const lang of content.languages) {
    add({ key: "platform", kind: "platform", lang: lang.code, url: prefixed(lang, "") });
  }
  for (const town of content.towns) {
    for (const code of town.languages) {
      const lang = content.languages.find((l) => l.code === code);
      const ui = content.ui[code];
      const where = `i18n/ui/${code}.json`;
      const url = prefixed(lang, [
        slug(ui, `slug.region.${town.region}`, where),
        slug(ui, `slug.town.${town.id}`, where),
      ].join("/") + "/");
      add({ key: `town/${town.id}`, kind: "town", lang: code, url, town });
    }
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
