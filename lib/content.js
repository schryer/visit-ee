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
//     under /<prefix>/, with the same slugs.

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

const LOCALES = { en: "en-GB" };

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
    return this.site ? prefixed(this.language, this.site.path + "/") : this.home;
  }

  stayUrl(id) {
    return this.siteUrl + id + "/";
  }

  get groupsUrl() {
    return this.siteUrl + "groups/";
  }

  // Language-neutral files of the site (logos, videos).
  media(file) {
    return "/" + this.site.path + "/" + file;
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
    sites.push(site);
  }

  const content = { source, languages, ui, sites, baseUrl: baseUrl.replace(/\/$/, "") };
  content.pages = pages(content);
  return content;
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
      const base = prefixed(lang, site.path + "/");
      add({ key: `${site.id}`, kind: "site", lang: code, url: base, site });
      for (const stay of site.stays) {
        add({ key: `${site.id}/${stay.id}`, kind: "stay", lang: code, url: `${base}${stay.id}/`, site, stay });
      }
      if (site.groups) {
        add({ key: `${site.id}/groups`, kind: "groups", lang: code, url: `${base}groups/`, site });
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
