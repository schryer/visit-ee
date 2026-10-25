"""Steps for the visit.ee build: run `visit-ee build` and read what it wrote."""

from __future__ import annotations

import json
import re
import shutil
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

scenarios("languages.feature", "translations.feature", "seo.feature")

ROOT = Path(__file__).resolve().parents[2]
PREVIEW_URL = "https://visit.schryer.eu"


class Page(HTMLParser):
    """The parts of a built page the steps look at."""

    def __init__(self, text: str) -> None:
        super().__init__()
        self.lang = ""
        self.alternates: dict[str, str] = {}
        self.canonical = ""
        self.robots = ""
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

    def pages(self) -> list[str]:
        return sorted(
            "/" + str(p.parent.relative_to(self.out)).replace("\\", "/").removeprefix(".") + ("/" if p.parent != self.out else "")
            for p in self.out.rglob("index.html")
        )


def build(run, binary, content: Path, out: Path, *args: str):
    return run(binary("visit-ee"), "build", "--quick", "--content", content, "--out", out, *args, timeout=600)


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
    return content


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


# --- when --------------------------------------------------------------------


@pytest.fixture
def out(tmp_path: Path) -> Path:
    return tmp_path / "out"


@when("I build it", target_fixture="result")
def i_build_it(run, binary, content: Path, out: Path):
    return build(run, binary, content, out)


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
    data = json.loads((ROOT / "sites" / site_id / "site.json").read_text(encoding="utf-8"))
    for stay in data["stays"]:
        for lang in (a, b):
            prefix = "" if lang == data["source_language"] else f"/{lang}"
            url = f"{prefix}/{data['path']}/{stay['id']}/"
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


@then(parsers.parse('the page "{url}" does not link to "{target}"'))
def page_does_not_link(site: Build, url: str, target: str) -> None:
    assert target not in site.page(url).links


# --- then: search engines ----------------------------------------------------


@then("robots.txt disallows everything")
def robots_disallows(site: Build) -> None:
    assert re.search(r"^Disallow: /$", site.file("/robots.txt").read_text(), re.M)


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
