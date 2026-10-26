# visit.ee

Static sites for places to stay and things to do in Estonia. Each host
gets its own site under visit.ee, in every language it is translated into.
The first is Ööbikuoru Puhkekeskus in Rõuge, at
`/louna-eesti/rouge/oobikuoru/` (`/en/south-estonia/rouge/oobikuoru/` in
English).

For now it is built for `temp.schryer.eu`, a preview that asks search
engines to keep out. It moves to visit.ee later.

## Working on it

You need Node 20 or newer, and Python 3 for the tests.

```sh
make serve        # http://localhost:8080, rebuilt as you edit
make build        # the whole site into _site/
make functional   # the Gherkin tests in tests/features
```

`bin/visit-ee build --help` lists the options: `--env production` lets
search engines in, `--url` sets the address for canonical links and the
sitemap, and `--quick` skips most image sizes.

The first build takes a minute or two while it makes the AVIF, WebP and
JPEG versions of every photo. Later builds reuse them.

## Where things are

| Path | What it holds |
|---|---|
| `sites/<id>/site.json` | A site's facts that don't depend on language: address, prices, stays, photos, videos, nearby places, old addresses to redirect. |
| `sites/<id>/strings/<lang>.json` | A site's text in one language, as flat `key: text` pairs. The source language (Estonian) has every key. |
| `places/<id>.json` | A place guests can visit, shared by every site: its name (never translated), category and position. `"position": "estimate"` marks one still to check. |
| `i18n/places/<lang>.json` | A short description of each place, by id. Estonian and English need one for every place (`place_descriptions` in `i18n/languages.json`), or the build fails. In another language a site is built in, a missing one is a build warning, and the place shows without it. |
| `towns/<id>/town.json` | A town (municipality) page at `/<region>/<town>/`: its centre, the maps service area it opens on, and the places in it. Its text is in `towns/<id>/strings/<lang>.json`, built in a language on the same terms as a site. |
| `sites/<id>/media/` | Photos (resized at build time), logos and drone videos, served under `/media/<id>/`. |
| `i18n/languages.json` | Which languages are built, and their URL prefixes. |
| `i18n/ui/<lang>.json` | The platform's own text: buttons, labels, season names. |
| `lib/content.js` | Reads all of the above and works out every page to write. |
| `src/` | The Eleventy templates, CSS and scripts, including the area map (`src/assets/map.js`) and the map of every site on the home page (`src/assets/platform-map.js`). |
| `tests/` | The functional tests, run against `bin/visit-ee`. |

## Languages

Estonian is the source language and has no URL prefix. Every other
language lives under its own prefix, and every part of the path is
translated too: `/louna-eesti/rouge/oobikuoru/suured-puhkemajad/` is
`/en/south-estonia/rouge/oobikuoru/large-houses/` in English. Region and
town slugs are UI strings (`slug.region.<id>`, `slug.town.<id>`); a site's
own are its strings (`slug`, `stay.<id>.slug`, `groups.slug`). The build
fails on a slug that isn't lowercase a-z, 0-9 and hyphens, or that two
pages share. Each page names its other versions with `hreflang` links, and
so does the sitemap.

Changing a slug changes a published address: add the old one to the site's
`redirects` in `site.json` when that happens.

- **Adding a language:** add its UI strings in `i18n/ui/<code>.json` and
  set `enabled` in `i18n/languages.json`. The build fails if a UI string is
  missing.
- **Translating a site:** add `sites/<id>/strings/<code>.json` with every
  key the Estonian file has. Until it is complete, the site is not built in
  that language and nothing links to it.

Finnish, German and Ukrainian are set up but not enabled yet.

## The map

Each site page lists the places in its `nearby` list (`site.json`), nearest
first: walking time under 2 km, then the road distance the site gives
(`road_km`), then the straight line. The list is plain HTML with
schema.org data, so it works without JavaScript. `src/assets/map.js` draws
the same places on a map of the area once it scrolls into view, with On
foot and By car modes, category filters, layer switches and a link for
each place (`…/oobikuoru/#suurjarv`).

Each town has a page of its own with the same map, large and first on
the page, opening on the whole municipality, with every place in
`towns/<id>/town.json` listed under it (distances from the town centre)
and the sites in the town as cards and map markers. Every map names all
the municipalities and marks the settlement each is run from (the maps
service's `municipalities.json`); a municipality with a town page links to
it. Places that would overlap on screen share one numbered marker, which
zooms in to them when tapped. The sites' breadcrumbs
and place lists link to it.

The map comes from maps.sustenaut.eu (schryer/maps), which builds
vector tiles of Estonia from Maa- ja Ruumiamet (ETAK, EHAK, EHR) and RMK
data and serves a map package that any sustenaut.eu site loads: MapLibre,
the area packs within reach of the site, their style and fonts. visit.ee
adds the places, the rings and the controls. `bin/visit-ee build
--maps-url URL` points the pages at another copy of the service, such as
a local `maps` build.

## Changing the content

Edit the JSON files and open a pull request. Text in square brackets, like
`[Update the prices: ...]`, marks something still to be filled in.

## Deploying

`.github/workflows/deploy.yml` publishes every push to main to Cloudflare
Pages, at temp.schryer.eu. While visit.ee is in development it is on Pages
only, with no standby copy on the web server; adding one later is a
`standby` in the infra's `pubkit.json` plus a deploy key here, the way the
recipes site does it.

The workflow stays off until the hosting exists in
`schryer/schryer-eu-infra`. Then set:

- the repository variable `VISIT_EE_DEPLOY` to `on`
- the secret `CLOUDFLARE_GITHUB_API_TOKEN` and the variable
  `CLOUDFLARE_ACCOUNT_ID`, as on the recipes repository

Cloudflare Pages reads `_redirects`, which sends the old WordPress
addresses (`/puhkekula/`, `/kontakt/` and so on) to their new pages.

## Still to come

- The regions map on the home page.
- Booking.com links: set `booking_url` in `site.json`.
- Photos and details for private camping by the lake.
- Spring and winter photos or video for the season switch. A season shows
  once `site.json` lists media for it.
