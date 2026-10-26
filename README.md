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
| `sites/<id>/media/` | Photos (resized at build time), logos and drone videos, served under `/media/<id>/`. |
| `i18n/languages.json` | Which languages are built, and their URL prefixes. |
| `i18n/ui/<lang>.json` | The platform's own text: buttons, labels, season names. |
| `lib/content.js` | Reads all of the above and works out every page to write. |
| `src/` | The Eleventy templates, CSS and the small script. |
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

- The shared visit.ee map, which mounts on `[data-visit-map]`.
- Booking.com links: set `booking_url` in `site.json`.
- Photos and details for private camping by the lake.
- Spring and winter photos or video for the season switch. A season shows
  once `site.json` lists media for it.
