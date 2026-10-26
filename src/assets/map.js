// The visit.ee area map: draws a site's nearby places (the list in
// nearby.njk) on a map of the area, with On foot and By car modes,
// category filters, layer switches and a shareable link for each place.
// The list works without any of this. The map itself (MapLibre, the area
// packs and their style) comes from the maps service's package, loaded
// only when the map is about to scroll into view.

// Each mode is a saved set of rings, a view and which places it lists.
const MODES = {
  foot: { rings: [0.5, 1, 2], radius: 1.3 },
  car: { rings: [10, 25, 50], radius: 40 },
};

// The rings' colour, matching site.css.
const RED = "#C53E2A";

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
    map.fitBounds(maps.bounds(config.home, MODES[mode].radius), { padding: 24, duration: animate && !calm.matches ? 900 : 0 });
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
    maps = await import(`${config.maps}/lib/v1/map.js`);
    // The packs that reach the widest ring, with a margin.
    const reach = Math.max(...Object.values(MODES).flatMap((m) => m.rings)) * 1.2;
    ({ map, maplibre: ml } = await maps.createMap(box.querySelector(".nearby__canvas"), {
      center: config.home,
      radiusKm: reach,
      bounds: maps.bounds(config.home, MODES[state.mode].radius),
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

    setRings();
    applyLayers();
    filter();
    // The mode or place may have changed while the map loaded.
    const p = places.find((x) => x.id === state.selected);
    if (p) map.jumpTo({ center: p.lngLat, zoom: p.foot ? 14.5 : 11 });
    else map.fitBounds(maps.bounds(config.home, MODES[state.mode].radius), { padding: 24, duration: 0 });
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

function button(label, className, onClick, text) {
  const b = el("button", className, text);
  b.type = "button";
  if (text !== undefined || className.startsWith("pin")) b.setAttribute("aria-label", label);
  else b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
