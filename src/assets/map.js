// The visit.ee area map: draws a site's nearby places (the list in
// nearby.njk) on a map of the area, with On foot and By car modes,
// category filters, layer switches and a shareable link for each place.
// The list works without any of this. MapLibre loads only when the map is
// about to scroll into view.

const VENDOR = "/assets/vendor";
const FONT = "noto-sans-regular";

// Each mode is a saved set of rings, a view and which places it lists.
const MODES = {
  foot: { rings: [0.5, 1, 2], radius: 1.3 },
  car: { rings: [10, 25, 50], radius: 40 },
};

// The style's colours, matching site.css.
const C = {
  land: "#F2EEDC",
  forest: "#DCE3C3",
  wet: "#E2E8D9",
  field: "#F1EBCC",
  yard: "#EAE4D3",
  water: "#AFC8CA",
  road: "#D7A25C",
  minor: "#FFFFFF",
  path: "#A88A63",
  rail: "#7A7166",
  trail: "#3F7A3A",
  border: "#8C7B8E",
  label: "#4A3A26",
  halo: "#F7F3E3",
  red: "#C53E2A",
};

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
  const pins = {};
  let ringLabels = [];

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
      if (pins[p.id]) pins[p.id].style.display = on ? "" : "none";
    }
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
    map.fitBounds(bounds(config.home, MODES[mode].radius), { padding: 24, duration: animate && !calm.matches ? 900 : 0 });
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
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${VENDOR}/maplibre/maplibre-gl.css`;
    document.head.append(css);
    const [lib] = await Promise.all([import(`${VENDOR}/maplibre/maplibre-gl.mjs`), script(`${VENDOR}/pmtiles.js`)]);
    ml = lib;
    const protocol = new window.pmtiles.Protocol();
    ml.addProtocol("pmtiles", protocol.tile);

    map = new ml.Map({
      container: box.querySelector(".nearby__canvas"),
      style: style(config),
      bounds: bounds(config.home, MODES[state.mode].radius),
      fitBoundsOptions: { padding: 24 },
      maxBounds: [[20.5, 57.0], [29.5, 60.0]],
      minZoom: 6,
      maxZoom: 17,
      cooperativeGestures: true,
      locale: config.locale,
      attributionControl: { compact: true },
    });
    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

    const home = el("div", "map-home");
    const img = document.createElement("img");
    img.src = config.home.mark;
    img.alt = "";
    home.append(img);
    new ml.Marker({ element: home }).setLngLat([config.home.lng, config.home.lat]).addTo(map);

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

    await new Promise((resolve) => map.once("load", resolve));
    setRings();
    applyLayers();
    filter();
    const p = places.find((x) => x.id === state.selected);
    if (p) map.jumpTo({ center: p.lngLat, zoom: p.foot ? 14.5 : 11 });
  }

  function setRings() {
    for (const m of ringLabels) m.remove();
    const rings = MODES[state.mode].rings;
    map.getSource("rings").setData({
      type: "FeatureCollection",
      features: rings.map((r) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: circle(config.home, r) } })),
    });
    ringLabels = rings.map((r) => {
      const label = el("div", "map-ring", r < 1 ? `${r * 1000} m` : `${r} km`);
      return new ml.Marker({ element: label }).setLngLat(circle(config.home, r, 4)[0]).addTo(map);
    });
  }

  // Layer switches, and each mode's emphasis: on foot the roads step back
  // and the trails come forward; by car the roads lead.
  function applyLayers() {
    if (!map) return;
    for (const layer of map.getStyle().layers) {
      const group = layer.metadata?.group;
      if (group) map.setLayoutProperty(layer.id, "visibility", state.layers[group] ? "visible" : "none");
      if (layer.metadata?.mode === "road") map.setPaintProperty(layer.id, "line-opacity", state.mode === "foot" ? 0.45 : 1);
      if (layer.metadata?.mode === "trail") map.setPaintProperty(layer.id, "line-width", state.mode === "foot" ? 3 : 1.6);
    }
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

function button(label, className, onClick, text) {
  const b = el("button", className, text);
  b.type = "button";
  if (text !== undefined || className.startsWith("pin")) b.setAttribute("aria-label", label);
  else b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });
}

// A circle of r km around { lat, lng }, as [lng, lat] points.
function circle(center, r, n = 128) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const dLat = ((r / 6371) * Math.cos(a) * 180) / Math.PI;
    const dLng = ((r / 6371) * Math.sin(a) * 180) / Math.PI / Math.cos((center.lat * Math.PI) / 180);
    points.push([center.lng + dLng, center.lat + dLat]);
  }
  return points;
}

function bounds(center, r) {
  const ring = circle(center, r, 8);
  const lngs = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

// The style: the national overview under the area packs. Each layer is
// written once per source; metadata.group ties it to a layer switch.
function style(config) {
  const sources = { ov: { type: "vector", url: `pmtiles://${location.origin}${config.overview}` } };
  const packs = config.packs.map((url, i) => {
    sources["p" + i] = { type: "vector", url: `pmtiles://${location.origin}${url}` };
    return "p" + i;
  });
  sources.rings = { type: "geojson", data: { type: "FeatureCollection", features: [] } };

  const layers = [{ id: "land", type: "background", paint: { "background-color": C.land } }];
  // One layer for the overview (shown below zoom 11) and one per pack.
  const each = (id, def, { overview = true, packsToo = true } = {}) => {
    if (overview) layers.push({ ...def, id: `ov-${id}`, source: "ov", maxzoom: def.ovMax ?? 11, ovMax: undefined });
    if (packsToo) for (const src of packs) layers.push({ ...def, id: `${src}-${id}`, source: src, ovMax: undefined });
  };
  const is = (values) => ["in", ["get", "class"], ["literal", values]];

  each("forest", { type: "fill", "source-layer": "landcover", filter: is(["forest", "scrub"]), paint: { "fill-color": C.forest } });
  each("wet", { type: "fill", "source-layer": "landcover", filter: is(["fen", "bog", "wet_meadow", "peat"]), paint: { "fill-color": C.wet } });
  each("field", { type: "fill", "source-layer": "landcover", filter: is(["farmland"]), paint: { "fill-color": C.field } }, { overview: false });
  each("yard", { type: "fill", "source-layer": "landcover", filter: is(["yard"]), paint: { "fill-color": C.yard } }, { overview: false });
  each("water", { type: "fill", "source-layer": "water", paint: { "fill-color": C.water } });
  each("waterway", {
    type: "line",
    "source-layer": "waterway",
    paint: { "line-color": C.water, "line-width": ["match", ["get", "class"], "river", 1.8, "stream", 1, 0.6] },
  });
  each("road-path", {
    type: "line",
    "source-layer": "road",
    filter: is(["path", "cycleway", "track"]),
    metadata: { group: "roads", mode: "road" },
    paint: { "line-color": C.path, "line-width": 1, "line-dasharray": [2, 2] },
  }, { overview: false });
  each("road-minor", {
    type: "line",
    "source-layer": "road",
    filter: is(["minor", "street", "link"]),
    metadata: { group: "roads", mode: "road" },
    paint: { "line-color": C.minor, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 5] },
  }, { overview: false });
  each("road-main", {
    type: "line",
    "source-layer": "road",
    filter: is(["primary", "secondary", "tertiary"]),
    metadata: { group: "roads", mode: "road" },
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": C.road,
      "line-width": ["interpolate", ["linear"], ["zoom"], 7, ["match", ["get", "class"], "primary", 1.4, 0.6], 15, ["match", ["get", "class"], "primary", 7, "secondary", 5.5, 4]],
    },
  });
  each("rail", { type: "line", "source-layer": "rail", paint: { "line-color": C.rail, "line-width": 1.2, "line-dasharray": [3, 2] } });
  each("building", {
    type: "fill",
    "source-layer": "building",
    minzoom: 14,
    metadata: { group: "buildings" },
    paint: {
      "fill-color": ["match", ["get", "use"],
        "lodging", "#E4B2A6", "shop", "#EBC99A", "culture", "#CDBFDD", "religious", "#CDBFDD",
        "education", "#BFD3E2", "health", "#BFD3E2", "sport", "#BFD3E2", "#D9D1C3"],
    },
  }, { overview: false });
  each("trail", {
    type: "line",
    "source-layer": "trail",
    metadata: { group: "trails", mode: "trail" },
    paint: { "line-color": C.trail, "line-width": 1.6, "line-dasharray": [1.5, 1] },
  }, { overview: false });
  each("boundary", {
    type: "line",
    "source-layer": "boundary",
    metadata: { group: "borders" },
    paint: { "line-color": C.border, "line-width": 1, "line-dasharray": [4, 2], "line-opacity": 0.8 },
  });
  layers.push({
    id: "rings",
    type: "line",
    source: "rings",
    metadata: { group: "rings" },
    paint: { "line-color": C.red, "line-width": 1.2, "line-opacity": 0.7, "line-dasharray": [4, 3] },
  });

  const text = (size) => ({
    "text-font": [FONT],
    "text-size": size,
    "text-max-width": 8,
  });
  const halo = { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.4 };
  each("water-label", {
    type: "symbol",
    "source-layer": "water",
    minzoom: 12,
    filter: ["has", "name"],
    layout: { ...text(12), "text-field": ["get", "name"] },
    paint: { ...halo, "text-color": "#3C6E8F" },
  }, { overview: false });
  each("road-label", {
    type: "symbol",
    "source-layer": "road",
    minzoom: 14,
    filter: ["has", "name"],
    layout: { ...text(11), "text-field": ["get", "name"], "symbol-placement": "line" },
    paint: halo,
  }, { overview: false });
  each("place-label", {
    type: "symbol",
    "source-layer": "place_label",
    layout: { ...text(["interpolate", ["linear"], ["zoom"], 8, 11, 14, 14]), "text-field": ["get", "name"] },
    paint: halo,
    ovMax: 10,
  });
  return {
    version: 8,
    glyphs: "/assets/map/fonts/{fontstack}/{range}.pbf",
    sources,
    layers: layers.map(({ ovMax, ...layer }) => layer),
  };
}
