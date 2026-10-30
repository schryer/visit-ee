"""Steps for the visit.ee build: run `visit-ee build` and read what it wrote."""

from __future__ import annotations

import json
import re
import shutil
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

scenarios("languages.feature", "translations.feature", "seo.feature", "nearby.feature", "towns.feature")

ROOT = Path(__file__).resolve().parents[2]
PREVIEW_URL = "https://temp.schryer.eu"


class Page(HTMLParser):
    """The parts of a built page the steps look at."""

    def __init__(self, text: str) -> None:
        super().__init__()
        self.lang = ""
        self.alternates: dict[str, str] = {}
        self.canonical = ""
        self.robots = ""
        self.og: dict[str, str] = {}
        self.links: list[str] = []
        self.lang_text: list[tuple[str, str]] = []
        self.json_ld: list[dict] = []
        self._lang_stack: list[str | None] = []
        self._in_ld = False
        self.feed(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: v or "" for k, v in attrs}
        if tag == "html":
            self.lang = a.get("lang", "")
        if tag == "link" and a.get("rel") == "alternate" and "hreflang" in a:
            self.alternates[a["hreflang"]] = a["href"]
        if tag == "link" and a.get("rel") == "canonical":
            self.canonical = a["href"]
        if tag == "meta" and a.get("name") == "robots":
            self.robots = a.get("content", "")
        if tag == "meta" and a.get("property", "").startswith("og:"):
            self.og.setdefault(a["property"], a.get("content", ""))
        if tag == "script" and a.get("type") == "application/ld+json":
            self._in_ld = True
        for attr in ("href", "src", "poster"):
            if attr in a and not (tag == "link" and a.get("rel") in ("alternate", "canonical")):
                self.links.append(a[attr])
        if "srcset" in a:
            self.links.extend(part.strip().split(" ")[0] for part in a["srcset"].split(","))
        if tag not in ("meta", "link", "img", "source", "br", "input"):
            self._lang_stack.append(a.get("lang"))

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self._in_ld = False
        if tag not in ("meta", "link", "img", "source", "br", "input") and self._lang_stack:
            self._lang_stack.pop()

    def handle_data(self, data: str) -> None:
        if self._in_ld:
            self.json_ld.append(json.loads(data))
            return
        lang = next((lang for lang in reversed(self._lang_stack) if lang), None)
        if data.strip() and lang:
            self.lang_text.append((lang, data.strip()))


class Places(HTMLParser):
    """The nearby list of a page: each place's id, name, description and
    distance, in order."""

    PARTS = {"place__name": "name", "place__gloss": "description", "place__meta": "meta"}

    def __init__(self, text: str) -> None:
        super().__init__()
        self.rows: list[dict[str, str]] = []
        self._part = ""
        self.feed(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: v or "" for k, v in attrs}
        if tag == "li" and "data-place" in a:
            self.rows.append({"id": a["id"], "href": ""})
        # What the map's place card shows when it opens up.
        if self.rows and tag == "img" and "more__img" in a.get("class", ""):
            self.rows[-1]["photo"] = a.get("src", "")
        if self.rows and tag == "a" and a.get("class") == "more__link":
            self.rows[-1]["more"] = a.get("href", "")
            self.rows[-1]["more_target"] = a.get("target", "")
        part = self.PARTS.get(a.get("class", ""))
        if part and self.rows:
            self._part = part
            self.rows[-1][part] = ""
            if tag == "a":
                self.rows[-1]["href"] = a.get("href", "")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("a", "span"):
            self._part = ""

    def handle_data(self, data: str) -> None:
        if self._part and self.rows:
            self.rows[-1][self._part] += data

    def find(self, name: str) -> dict[str, str]:
        row = next((r for r in self.rows if r.get("name", "").strip() == name), None)
        assert row, f"no place {name!r} in {[r.get('name') for r in self.rows]}"
        return row


class Build:
    def __init__(self, out: Path, base_url: str) -> None:
        self.out = out
        self.base_url = base_url

    def file(self, url: str) -> Path:
        path = self.out / unquote(urlsplit(url).path).lstrip("/")
        return path / "index.html" if url.endswith("/") else path

    def page(self, url: str) -> Page:
        path = self.file(url)
        assert path.is_file(), f"no page {url} in {self.out}"
        return Page(path.read_text(encoding="utf-8"))

    def places(self, url: str) -> Places:
        path = self.file(url)
        assert path.is_file(), f"no page {url} in {self.out}"
        return Places(path.read_text(encoding="utf-8"))

    def pages(self) -> list[str]:
        return sorted(
            "/" + str(p.parent.relative_to(self.out)).replace("\\", "/").removeprefix(".") + ("/" if p.parent != self.out else "")
            for p in self.out.rglob("index.html")
        )


def build(run, binary, content: Path, out: Path, *args: str):
    # Plain warnings, not GitHub annotations, even when CI runs the tests.
    return run(binary("visit-ee"), "build", "--quick", "--content", content, "--out", out, *args,
               env={"GITHUB_ACTIONS": None}, timeout=600)


_builds: dict[tuple[str, str], Build] = {}


def shared_build(run, binary, tmp_path_factory, env: str, url: str) -> Build:
    """One build of the real content per environment, shared by the
    scenarios that only read it."""
    key = (env, url)
    if key not in _builds:
        out = tmp_path_factory.mktemp(f"site-{env}")
        result = build(run, binary, ROOT, out, "--env", env, "--url", url)
        assert result.code == 0, result.describe()
        _builds[key] = Build(out, url)
    return _builds[key]


# --- given -------------------------------------------------------------------


@given("the sites are built", target_fixture="site")
def the_sites_are_built(run, binary, tmp_path_factory) -> Build:
    return shared_build(run, binary, tmp_path_factory, "preview", PREVIEW_URL)


@given(parsers.parse('the sites are built for production at "{url}"'), target_fixture="site")
def built_for_production(run, binary, tmp_path_factory, url: str) -> Build:
    return shared_build(run, binary, tmp_path_factory, "production", url)


@given("a copy of the content", target_fixture="content")
def a_copy_of_the_content(tmp_path: Path) -> Path:
    content = tmp_path / "content"
    shutil.copytree(ROOT / "i18n", content / "i18n")
    shutil.copytree(ROOT / "sites", content / "sites")
    shutil.copytree(ROOT / "towns", content / "towns")
    return content


def _place(content: Path, place: str) -> Path:
    """A place's folder, in its town's or its site's places/."""
    (found,) = [*content.glob(f"towns/*/places/{place}"), *content.glob(f"sites/*/places/{place}")]
    return found


def _remove_key(path: Path, key: str) -> None:
    strings = json.loads(path.read_text(encoding="utf-8"))
    assert key in strings, f"{path} has no {key} to remove"
    del strings[key]
    path.write_text(json.dumps(strings, ensure_ascii=False, indent=2), encoding="utf-8")


@given(parsers.parse('the English UI string "{key}" is removed'))
def remove_ui_string(content: Path, key: str) -> None:
    _remove_key(content / "i18n" / "ui" / "en.json", key)


@given(parsers.parse('the English string "{key}" of "{site_id}" is removed'))
def remove_site_string(content: Path, key: str, site_id: str) -> None:
    _remove_key(content / "sites" / site_id / "strings" / "en.json", key)


@given(parsers.parse('the English string "{key}" of "{site_id}" is "{value}"'))
def set_site_string(content: Path, key: str, site_id: str, value: str) -> None:
    path = content / "sites" / site_id / "strings" / "en.json"
    strings = json.loads(path.read_text(encoding="utf-8"))
    strings[key] = value
    path.write_text(json.dumps(strings, ensure_ascii=False, indent=2), encoding="utf-8")


@given(parsers.parse('the English description of the place "{place}" is removed'))
def remove_place_description(content: Path, place: str) -> None:
    (_place(content, place) / "strings" / "en.json").unlink()


@given(parsers.parse('the Estonian description of the place "{place}" is removed'))
def remove_place_description_et(content: Path, place: str) -> None:
    _remove_key(_place(content, place) / "strings" / "et.json", "description")


@given(parsers.parse('Finnish is enabled, and "{site_id}" is translated into it'))
def enable_finnish(content: Path, site_id: str) -> None:
    path = content / "i18n" / "languages.json"
    config = json.loads(path.read_text(encoding="utf-8"))
    for lang in config["languages"]:
        if lang["code"] == "fi":
            lang["enabled"] = True
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    # English text stands in for the Finnish: only completeness matters here.
    shutil.copy(content / "i18n" / "ui" / "en.json", content / "i18n" / "ui" / "fi.json")
    strings = content / "sites" / site_id / "strings"
    shutil.copy(strings / "en.json", strings / "fi.json")


@given(parsers.parse('only "{place}" has a Finnish description'))
def one_finnish_description(content: Path, place: str) -> None:
    path = _place(content, place) / "strings" / "fi.json"
    path.write_text(json.dumps({"description": "Viron syvin järvi"}, ensure_ascii=False), encoding="utf-8")


@given(parsers.parse('the place "{place}" has the {field} "{value}"'))
def set_place_field(content: Path, place: str, field: str, value: str) -> None:
    path = _place(content, place) / "place.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data[field] = value
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@given(parsers.parse('the place "{place}" shows the stored photo "{photo_id}", by "{credit}"'))
def service_photo(content: Path, place: str, photo_id: str, credit: str) -> None:
    path = _place(content, place) / "place.json"
    data = json.loads(path.read_text())
    data["photo"] = {"id": photo_id, "width": 1600, "height": 1200, "widths": [480, 960, 1600], "formats": ["webp", "jpg"]}
    data["photo_credit"] = credit
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


@given(parsers.parse('the place "{place}" has a photo file in the repository'))
def repository_photo(content: Path, place: str) -> None:
    media = _place(content, place) / "media"
    media.mkdir(exist_ok=True)
    shutil.copy(ROOT / "tests" / "fixtures" / "photo.jpg", media / f"{place}.jpg")
    path = _place(content, place) / "place.json"
    data = json.loads(path.read_text())
    data["photo"] = f"media/{place}.jpg"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


@given(parsers.parse('the place "{place}" is also in "{owner}"'))
def duplicate_place(content: Path, place: str, owner: str) -> None:
    shutil.copytree(_place(content, place), content / owner / "places" / place)


@given(parsers.parse('"{site_id}" has a private place "{place}" called "{name}"'))
def private_place(content: Path, site_id: str, place: str, name: str) -> None:
    folder = content / "sites" / site_id / "places" / place
    (folder / "strings").mkdir(parents=True)
    data = {"name": name, "category": "nature", "geo": {"lat": 57.7292, "lng": 26.9297}}
    (folder / "place.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    for lang, text in (("et", "Saun järve ääres"), ("en", "Sauna by the lake")):
        (folder / "strings" / f"{lang}.json").write_text(json.dumps({"description": text}), encoding="utf-8")


@given(parsers.parse('"{site_id}" lists the place "{place}" nearby'))
def list_place(content: Path, site_id: str, place: str) -> None:
    path = content / "sites" / site_id / "site.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["nearby"].append({"place": place})
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# --- when --------------------------------------------------------------------


@pytest.fixture
def out(tmp_path: Path) -> Path:
    return tmp_path / "out"


@when("I build it", target_fixture="result")
def i_build_it(run, binary, content: Path, out: Path):
    return build(run, binary, content, out)


@when(parsers.parse('I build it with the maps at "{url}"'), target_fixture="result")
def i_build_it_with_maps(run, binary, content: Path, out: Path, url: str):
    return build(run, binary, content, out, "--maps-url", url)


@when(parsers.parse('I build it with the photos at "{url}"'), target_fixture="result")
def i_build_it_with_photos(run, binary, content: Path, out: Path, url: str):
    return build(run, binary, content, out, "--photos-url", url)


@pytest.fixture
def site(out: Path) -> Build:
    """The build a `when` step wrote, unless a `given` step chose another."""
    return Build(out, PREVIEW_URL)


# --- then: languages ---------------------------------------------------------


@then(parsers.parse('the page "{url}" is in "{lang}"'))
def page_is_in(site: Build, url: str, lang: str) -> None:
    assert site.page(url).lang == lang


@then(parsers.parse('every stay of "{site_id}" has a page in "{a}" and in "{b}"'))
def every_stay_has_pages(site: Build, site_id: str, a: str, b: str) -> None:
    folder = ROOT / "sites" / site_id
    data = json.loads((folder / "site.json").read_text(encoding="utf-8"))
    for lang in (a, b):
        strings = json.loads((folder / "strings" / f"{lang}.json").read_text(encoding="utf-8"))
        ui = json.loads((ROOT / "i18n" / "ui" / f"{lang}.json").read_text(encoding="utf-8"))
        prefix = "" if lang == data["source_language"] else f"/{lang}"
        base = f"{prefix}/{ui['slug.region.' + data['region']]}/{ui['slug.town.' + data['town']]}/{strings['slug']}/"
        for stay in data["stays"]:
            url = base + strings[f"stay.{stay['id']}.slug"] + "/"
            assert site.page(url).lang == lang, url


@then(parsers.parse('the page "{url}" links "{lang}" to "{target}"'))
def page_links_language(site: Build, url: str, lang: str, target: str) -> None:
    assert site.page(url).alternates.get(lang) == site.base_url + target


@then(parsers.parse('the page "{url}" has no version in "{lang}"'))
def page_has_no_version(site: Build, url: str, lang: str) -> None:
    assert lang not in site.page(url).alternates


@then(parsers.parse('the page "{url}" shows "{text}" in "{lang}"'))
def page_shows_text_in(site: Build, url: str, text: str, lang: str) -> None:
    assert (lang, text) in site.page(url).lang_text


@then(parsers.parse('there is no page "{url}"'))
def there_is_no_page(site: Build, url: str) -> None:
    assert not site.file(url).exists(), f"{url} was built"


@then(parsers.parse('the page "{url}" links to "{target}"'))
def page_links(site: Build, url: str, target: str) -> None:
    assert target in site.page(url).links, site.page(url).links


@then(parsers.parse('the page "{url}" does not link to "{target}"'))
def page_does_not_link(site: Build, url: str, target: str) -> None:
    assert target not in site.page(url).links


# --- then: places nearby -----------------------------------------------------


@then(parsers.parse('the page "{url}" lists "{name}" at "{distance}"'))
def lists_place_at(site: Build, url: str, name: str, distance: str) -> None:
    meta = site.places(url).find(name)["meta"]
    assert meta.split("·")[0].strip() == distance, meta


@then(parsers.parse('the page "{url}" lists "{name}" first'))
def lists_place_first(site: Build, url: str, name: str) -> None:
    assert site.places(url).rows[0]["name"].strip() == name


@then(parsers.parse('the page "{url}" describes "{name}" as "{text}"'))
def describes_place(site: Build, url: str, name: str, text: str) -> None:
    assert site.places(url).find(name).get("description", "").strip() == text


@then(parsers.parse('the page "{url}" lists "{name}" without a description'))
def lists_place_bare(site: Build, url: str, name: str) -> None:
    assert "description" not in site.places(url).find(name)


@then(parsers.parse('the page "{url}" has the place "{place}" at "{href}"'))
def place_link(site: Build, url: str, place: str, href: str) -> None:
    row = next(r for r in site.places(url).rows if r["id"] == place)
    assert row["href"] == href


@then(parsers.parse('the place card of "{name}" on "{url}" links to "{href}" in a new tab'))
def card_links_out(site: Build, url: str, name: str, href: str) -> None:
    row = site.places(url).find(name)
    assert (row.get("more"), row.get("more_target")) == (href, "_blank"), row


@then(parsers.parse('the place card of "{name}" on "{url}" links to "{href}"'))
def card_links(site: Build, url: str, name: str, href: str) -> None:
    row = site.places(url).find(name)
    assert (row.get("more"), row.get("more_target")) == (href, ""), row


@then(parsers.parse('the place card of "{name}" on "{url}" shows "{src}"'))
def card_shows(site: Build, url: str, name: str, src: str) -> None:
    assert site.places(url).find(name).get("photo") == src


@then(parsers.parse('"{url}" lists the photo "{photo_id}"'))
def lists_photo(site: Build, url: str, photo_id: str) -> None:
    assert photo_id in json.loads(site.file(url).read_text())["photos"]


@then(parsers.parse('"{url}" lists the place "{place_id}" at {lat:g}, {lng:g}'))
def lists_place(site: Build, url: str, place_id: str, lat: float, lng: float) -> None:
    listed = json.loads(site.file(url).read_text())
    assert listed["version"] == 1, listed
    assert {"id": place_id, "lat": lat, "lng": lng} in listed["places"], listed


@then(parsers.parse('the place card of "{name}" on "{url}" has a photo'))
def card_has_photo(site: Build, url: str, name: str) -> None:
    photo = site.places(url).find(name).get("photo", "")
    assert photo and site.file(photo).is_file(), photo


@then(parsers.parse('the build has "{url}"'))
def build_has(site: Build, url: str) -> None:
    assert site.file(url).is_file(), url


@then(parsers.parse('the build does not have "{url}"'))
def build_lacks(site: Build, url: str) -> None:
    assert not site.file(url).exists(), url


# --- then: search engines ----------------------------------------------------


@then("robots.txt disallows everything")
def robots_disallows(site: Build) -> None:
    assert re.search(r"^Disallow: /$", site.file("/robots.txt").read_text(), re.M)


@then(parsers.parse('robots.txt lets "{agent}" read "{url}"'))
def robots_allows(site: Build, agent: str, url: str) -> None:
    robots = RobotFileParser()
    robots.parse(site.file("/robots.txt").read_text().splitlines())
    assert robots.can_fetch(agent, site.base_url + url)


@then(parsers.parse('robots.txt keeps "{agent}" out of "{url}"'))
def robots_disallows_agent(site: Build, agent: str, url: str) -> None:
    robots = RobotFileParser()
    robots.parse(site.file("/robots.txt").read_text().splitlines())
    assert not robots.can_fetch(agent, site.base_url + url)


@then(parsers.parse('the page "{url}" has a link preview with an image that resolves'))
def page_link_preview(site: Build, url: str) -> None:
    og = site.page(url).og
    for key in ("og:title", "og:description", "og:url", "og:image", "og:image:width", "og:image:height"):
        assert og.get(key), f"{url} has no {key}"
    assert og["og:image"].startswith(site.base_url + "/"), og["og:image"]
    assert site.file(og["og:image"]).is_file(), f"{url}: og:image {og['og:image']} was not built"


@then(parsers.parse('the link preview of "{url}" is a 1200×630 card'))
def link_preview_card(site: Build, url: str) -> None:
    og = site.page(url).og
    assert (og["og:image:width"], og["og:image:height"]) == ("1200", "630")
    data = site.file(og["og:image"]).read_bytes()
    # The JPEG's frame header: height, then width.
    sof = re.search(rb"\xff[\xc0-\xc2]..\x08(..)(..)", data, re.S)
    assert sof, f"{og['og:image']} is not a JPEG"
    assert (int.from_bytes(sof.group(2)), int.from_bytes(sof.group(1))) == (1200, 630)


@then(parsers.parse('the link preview of "{url}" is the one of "{other}"'))
def link_preview_same(site: Build, url: str, other: str) -> None:
    assert site.page(url).og["og:image"] == site.page(other).og["og:image"]


@then(parsers.parse('robots.txt names the sitemap "{url}"'))
def robots_names_sitemap(site: Build, url: str) -> None:
    text = site.file("/robots.txt").read_text()
    assert f"Sitemap: {url}" in text
    assert "Disallow: /\n" not in text


@then(parsers.parse('the page "{url}" asks not to be indexed'))
def page_noindex(site: Build, url: str) -> None:
    assert "noindex" in site.page(url).robots


@then(parsers.parse('the page "{url}" does not ask not to be indexed'))
def page_indexable(site: Build, url: str) -> None:
    assert "noindex" not in site.page(url).robots


@then(parsers.parse('the page "{url}" has the canonical address "{canonical}"'))
def page_canonical(site: Build, url: str, canonical: str) -> None:
    assert site.page(url).canonical == canonical


NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "x": "http://www.w3.org/1999/xhtml"}


def _sitemap(site: Build) -> dict[str, dict[str, str]]:
    tree = ElementTree.parse(site.file("/sitemap.xml"))
    return {
        u.find("s:loc", NS).text.removeprefix(site.base_url): {
            link.get("hreflang"): link.get("href") for link in u.findall("x:link", NS)
        }
        for u in tree.getroot().findall("s:url", NS)
    }


@then("the sitemap lists every page that was built")
def sitemap_lists_every_page(site: Build) -> None:
    assert sorted(_sitemap(site)) == site.pages()


@then(parsers.parse('the sitemap lists "{url}" with its "{lang}" version'))
def sitemap_lists_with_version(site: Build, url: str, lang: str) -> None:
    alternates = _sitemap(site)[url]
    assert lang in alternates, alternates
    assert site.file(alternates[lang].removeprefix(site.base_url)).exists()


def _types(page: Page) -> list[str]:
    nodes = [node for ld in page.json_ld for node in ld.get("@graph", [ld])]
    return [t for node in nodes for t in ([node["@type"]] if isinstance(node["@type"], str) else node["@type"])]


@then(parsers.parse('the page "{url}" describes an "{kind}" for up to {n:d} people'))
def page_describes_accommodation(site: Build, url: str, kind: str, n: int) -> None:
    page = site.page(url)
    nodes = [node for ld in page.json_ld for node in ld["@graph"] if node["@type"] == kind]
    assert nodes, _types(page)
    assert nodes[0]["occupancy"]["maxValue"] == n


@then(parsers.parse('the page "{url}" describes a "{kind}"'))
def page_describes(site: Build, url: str, kind: str) -> None:
    assert kind in _types(site.page(url))


@then(parsers.parse('"{old}" redirects to "{new}"'))
def redirects(site: Build, old: str, new: str) -> None:
    rules = [line.split() for line in site.file("/_redirects").read_text().splitlines() if line and not line.startswith("#")]
    assert [old, new, "301"] in rules, rules


@then("every internal link, image, video, script and stylesheet resolves")
def every_link_resolves(site: Build) -> None:
    broken = []
    for url in site.pages():
        for link in site.page(url).links:
            parts = urlsplit(link)
            if parts.scheme or link.startswith(("#", "mailto:", "tel:")) or not parts.path:
                continue
            target = parts.path if parts.path.startswith("/") else url + parts.path
            if not site.file(target).exists():
                broken.append(f"{url} -> {link}")
    assert not broken, "\n".join(broken)


def map_config(site: Build, url: str) -> dict:
    text = site.file(url).read_text(encoding="utf-8")
    config = re.search(r"<script type=\"application/json\" data-map-config>(.*?)</script>", text, re.S)
    assert config, f"no map on {url}"
    return json.loads(config.group(1))


@then(parsers.parse('the map on "{url}" loads from "{maps}"'))
def map_loads_from(site: Build, url: str, maps: str) -> None:
    assert map_config(site, url)["maps"] == maps


@then(parsers.parse('the map on "{url}" has "{name}" at "{href}"'))
def map_has_site(site: Build, url: str, name: str, href: str) -> None:
    sites = {s["name"]: s["url"] for s in map_config(site, url)["sites"]}
    assert sites.get(name) == href, sites
