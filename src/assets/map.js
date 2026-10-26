// The visit.ee area map: draws a site's nearby places (the list in
// nearby.njk) on a map of the area, with On foot and By car modes,
// category filters, layer switches and a shareable link for each place.
// The list works without any of this. The map itself (MapLibre, the area
// packs and their style) comes from the maps service's package, loaded
// only when the map is about to scroll into view. On a town's page the
// config has no home logo, opens on the town's whole area, and adds the
// places to stay there as links to their pages.

// Each mode is a saved set of rings, a view and which places it lists.
const MODES = {
  foot: { rings: [0.5, 1, 2], radius: 1.3 },
  car: { rings: [10, 25, 50], radius: 40 },
};

// The rings' colour, matching site.css.
const RED = "#C53E2A";

// Places closer than this on screen share one numbered marker, which
// splits as the map zooms in.
const CLUSTER_PX = 34;

const root = document.querySelector("[data-visit-map]");
if (root) start(root);

function start(root) {
  const config = JSON.parse(root.querySelector("[data-map-config]").textContent);
  const rows = [...root.querySelectorAll("[data-place]")];
  const places = rows.map((row) => ({
    id: row.id,
    row,
    cat: row.dataset.cat,
    lngLat: [Number(row.dataset.lng), Number(row.dataset.lat)],
    foot: row.dataset.foot === "true",
    name: row.querySelector(".place__name").textContent,
    meta: row.querySelector(".place__meta").textContent,
    icon: row.querySelector(".place__icon").innerHTML,
  }));
  const chips = [...root.querySelectorAll("[data-cat]")].filter((el) => el.tagName === "BUTTON");
  const modeButtons = [...root.querySelectorAll("[data-mode]")];
  const box = root.querySelector(".nearby__map");
  const tip = root.querySelector(".nearby__tip");
  const count = root.querySelector(".nearby__count");
  const plural = new Intl.PluralRules(config.lang);
  const calm = matchMedia("(prefers-reduced-motion: reduce)");

  const state = {
    mode: "car",
    cats: new Set(chips.map((c) => c.dataset.cat)),
    layers: Object.fromEntries([...root.querySelectorAll("[data-layer]")].map((i) => [i.dataset.layer, i.checked])),
    selected: null,
  };
  let map = null;
  let ml = null;
  let maps = null;
  const pins = {};
  let ringLabels = [];
  // The numbered markers on the map now.
  const clusters = [];
  // The town's box on the maps service, when the page is a town's.
  let areaBox = null;

  root.querySelector(".nearby__controls").hidden = false;
  box.hidden = false;

  // --- the list and controls, which work before the map loads --------------

  const visible = (p) => state.cats.has(p.cat) && (state.mode === "car" || p.foot);

  function filter() {
    let n = 0;
    for (const p of places) {
      const on = visible(p);
      if (on) n++;
      p.row.hidden = !on;
    }
    cluster();
    count.textContent = config.strings[plural.select(n) === "one" ? "one" : "other"].replace("{n}", n);
  }

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      const all = chips.map((c) => c.dataset.cat);
      const cat = chip.dataset.cat;
      // The first tap on a full set shows just that category.
      if (state.cats.size === all.length) state.cats = new Set([cat]);
      else if (state.cats.has(cat)) {
        state.cats.delete(cat);
        if (!state.cats.size) state.cats = new Set(all);
      } else state.cats.add(cat);
      for (const c of chips) c.setAttribute("aria-pressed", String(state.cats.has(c.dataset.cat)));
      filter();
    });
  }

  for (const b of modeButtons) b.addEventListener("click", () => setMode(b.dataset.mode, true));

  for (const input of root.querySelectorAll("[data-layer]")) {
    input.addEventListener("change", () => {
      state.layers[input.dataset.layer] = input.checked;
      applyLayers();
    });
  }

  for (const p of places) {
    p.row.querySelector(".place__name").addEventListener("click", (event) => {
      event.preventDefault();
      select(p.id, true);
    });
  }

  function setMode(mode, animate) {
    state.mode = mode;
    for (const b of modeButtons) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    filter();
    if (!map) return;
    setRings();
    applyLayers();
    map.fitBounds(view(mode), { padding: 24, duration: animate && !calm.matches ? 900 : 0 });
  }

  // What a mode shows: the town's whole area by car, if it has one, or
  // the mode's radius around home.
  function view(mode) {
    return mode === "car" && areaBox ? areaBox : maps.bounds(config.home, MODES[mode].radius);
  }

  function select(id, fly) {
    const p = places.find((x) => x.id === id);
    if (!p) return;
    if (!visible(p)) {
      state.cats.add(p.cat);
      for (const c of chips) c.setAttribute("aria-pressed", String(state.cats.has(c.dataset.cat)));
      if (!p.foot) setMode("car", false);
      filter();
    }
    state.selected = id;
    for (const x of places) {
      x.row.setAttribute("aria-current", String(x.id === id));
      pins[x.id]?.setAttribute("aria-current", String(x.id === id));
    }
    cluster();
    try {
      history.replaceState(null, "", "#" + id);
    } catch {}
    showTip(p);
    if (fly) {
      const r = box.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) box.scrollIntoView({ block: "nearest", behavior: calm.matches ? "auto" : "smooth" });
      if (map) map.flyTo({ center: p.lngLat, zoom: Math.max(map.getZoom(), p.foot ? 14.5 : 11), duration: calm.matches ? 0 : 900 });
    } else {
      p.row.scrollIntoView({ block: "nearest", behavior: calm.matches ? "auto" : "smooth" });
    }
  }

  function showTip(p) {
    const link = config.link + "#" + p.id;
    tip.replaceChildren();
    const head = el("div", "tip__row");
    head.append(el("b", "", p.name), button(config.strings.close, "tip__close", () => (tip.hidden = true), "✕"));
    const url = el("span", "tip__link", link);
    const done = el("span", "", config.strings.copied);
    done.hidden = true;
    const actions = el("div", "tip__row");
    actions.append(
      button(config.strings.copy, "", () => {
        const fallback = () => getSelection().selectAllChildren(url);
        try {
          navigator.clipboard.writeText(link).then(() => (done.hidden = false), fallback);
        } catch {
          fallback();
        }
      }),
      done,
    );
    tip.append(head, el("span", "", p.meta), url, actions);
    tip.hidden = false;
  }

  function fromHash() {
    const p = places.find((x) => x.id === decodeURIComponent(location.hash.slice(1)));
    if (!p) return;
    setMode(p.foot ? "foot" : "car", false);
    select(p.id, true);
  }
  addEventListener("hashchange", fromHash);

  filter();

  // --- the map ---------------------------------------------------------------

  const watch = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      watch.disconnect();
      load().catch((err) => {
        console.error(err);
        box.replaceChildren(el("p", "nearby__failed", config.strings.failed));
      });
    },
    { rootMargin: "400px" },
  );
  watch.observe(box);
  if (places.some((p) => "#" + p.id === location.hash)) fromHash();

  async function load() {
    maps = await import(`${config.maps}/lib/v1/map.js`);
    // The packs that reach the widest ring, with a margin.
    const reach = Math.max(...Object.values(MODES).flatMap((m) => m.rings)) * 1.2;
    const index = await maps.loadIndex();
    const [w, s, e, n] = index.areas.find((a) => a.path === config.area)?.bbox || [];
    if (n !== undefined) areaBox = [[w, s], [e, n]];
    ({ map, maplibre: ml } = await maps.createMap(box.querySelector(".nearby__canvas"), {
      center: config.home,
      radiusKm: reach,
      bounds: view(state.mode),
      fitBoundsOptions: { padding: 24 },
      minZoom: 6,
      locale: config.locale,
    }));
    map.addSource("rings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "rings",
      type: "line",
      source: "rings",
      metadata: { group: "rings" },
      paint: { "line-color": RED, "line-width": 1.2, "line-opacity": 0.7, "line-dasharray": [4, 3] },
    }, maps.firstLabel(map));
    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
    // Every municipality and its centre; the ones with a page link to it.
    // An older map package has no such function.
    maps.addMunicipalities?.(map, { links: config.towns || {} }).catch((err) => console.warn(err));
    map.on("zoomend", cluster);

    // A site's logo at home, or a dot at a town's centre.
    const home = el("div", config.home.mark ? "map-home" : "map-centre");
    if (config.home.mark) home.append(image(config.home.mark));
    new ml.Marker({ element: home }).setLngLat([config.home.lng, config.home.lat]).addTo(map);

    for (const stay of config.stays || []) {
      const link = el("a", "map-stay");
      link.href = stay.url;
      link.setAttribute("aria-label", stay.name);
      link.title = stay.name;
      link.append(image(stay.mark));
      new ml.Marker({ element: link }).setLngLat([stay.lng, stay.lat]).addTo(map);
    }

    for (const p of places) {
      const pin = button(`${p.name}, ${p.meta}`, "pin cat-" + p.cat, (event) => {
        event.stopPropagation();
        select(p.id, false);
      });
      pin.innerHTML = p.icon;
      pin.setAttribute("aria-current", String(p.id === state.selected));
      pins[p.id] = pin;
      new ml.Marker({ element: pin }).setLngLat(p.lngLat).addTo(map);
    }

    setRings();
    applyLayers();
    filter();
    // The mode or place may have changed while the map loaded.
    const p = places.find((x) => x.id === state.selected);
    if (p) map.jumpTo({ center: p.lngLat, zoom: p.foot ? 14.5 : 11 });
    else map.fitBounds(view(state.mode), { padding: 24, duration: 0 });
  }

  // Group the places that would overlap on screen: each group of two or
  // more shows as one numbered marker, which zooms in to its places when
  // tapped. The selected place always keeps its own pin.
  function cluster() {
    if (!map) return;
    const groups = [];
    for (const p of places) {
      if (!visible(p) || p.id === state.selected) continue;
      const at = map.project(p.lngLat);
      const near = groups.find((g) => Math.hypot(g.at.x - at.x, g.at.y - at.y) < CLUSTER_PX);
      if (near) near.places.push(p);
      else groups.push({ at, places: [p] });
    }
    for (const p of places) {
      const alone = groups.some((g) => g.places.length === 1 && g.places[0] === p);
      if (pins[p.id]) pins[p.id].style.display = visible(p) && (alone || p.id === state.selected) ? "" : "none";
    }
    for (const marker of clusters) marker.remove();
    clusters.length = 0;
    for (const g of groups.filter((g) => g.places.length > 1)) {
      const n = g.places.length;
      const lng = g.places.reduce((sum, p) => sum + p.lngLat[0], 0) / n;
      const lat = g.places.reduce((sum, p) => sum + p.lngLat[1], 0) / n;
      const label = config.strings[plural.select(n) === "one" ? "one" : "other"].replace("{n}", n);
      const b = button(label, "cluster", () => {
        const box = new ml.LngLatBounds(g.places[0].lngLat, g.places[0].lngLat);
        for (const p of g.places) box.extend(p.lngLat);
        map.fitBounds(box, { padding: 90, maxZoom: 17, duration: calm.matches ? 0 : 600 });
      }, String(n));
      clusters.push(new ml.Marker({ element: b }).setLngLat([lng, lat]).addTo(map));
    }
  }

  function setRings() {
    for (const m of ringLabels) m.remove();
    const rings = MODES[state.mode].rings;
    map.getSource("rings").setData({
      type: "FeatureCollection",
      features: rings.map((r) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: maps.circle(config.home, r) } })),
    });
    ringLabels = rings.map((r) => {
      const label = el("div", "map-ring", r < 1 ? `${r * 1000} m` : `${r} km`);
      return new ml.Marker({ element: label }).setLngLat(maps.circle(config.home, r, 4)[0]).addTo(map);
    });
  }

  // Layer switches, and each mode's emphasis: on foot the roads step back
  // and the trails come forward; by car the roads lead.
  function applyLayers() {
    if (!map) return;
    for (const [group, on] of Object.entries(state.layers)) maps.setGroup(map, group, on);
    maps.setEmphasis(map, state.mode);
    for (const m of ringLabels) m.getElement().style.display = state.layers.rings ? "" : "none";
  }
}

// --- helpers -----------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function image(src) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  return img;
}

function button(label, className, onClick, text) {
  const b = el("button", className, text);
  b.type = "button";
  if (text !== undefined || className.startsWith("pin")) b.setAttribute("aria-label", label);
  else b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
