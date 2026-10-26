// The map on the platform home: Estonia, with a pin for each site that
// links to it. The cards below the map list the same sites, so the page
// works without it. Only the national overview loads: it reaches zoom 10,
// and the map stops there.

const root = document.querySelector("[data-platform-map]");
if (root) start(root).catch((err) => {
  console.error(err);
  root.querySelector(".platform-map__canvas").replaceChildren(el("p", "platform-map__failed", config(root).failed));
});

// Estonia, with a margin.
const ESTONIA = [[21.6, 57.45], [28.3, 59.75]];

function config(root) {
  return JSON.parse(root.querySelector("[data-map-config]").textContent);
}

async function start(root) {
  const { maps: base, sites, locale } = config(root);
  const maps = await import(`${base}/lib/v1/map.js`);
  const { map, maplibre } = await maps.createMap(root.querySelector(".platform-map__canvas"), {
    center: { lat: 58.6, lng: 25.0 },
    radiusKm: 0,
    bounds: ESTONIA,
    fitBoundsOptions: { padding: 12 },
    maxZoom: 10,
    locale,
  });
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
  for (const site of sites) {
    const link = el("a", "map-site");
    link.href = site.url;
    link.title = site.line;
    const mark = el("span", "map-home");
    const img = document.createElement("img");
    img.src = site.mark;
    img.alt = "";
    mark.append(img);
    link.append(mark, el("span", "map-site__name", site.name));
    // The name goes on the side with more room: east of the middle of
    // Estonia, it sits to the left of the mark.
    const east = site.lng > 25;
    if (east) link.classList.add("map-site--east");
    new maplibre.Marker({ element: link, anchor: east ? "right" : "left", offset: [east ? 24 : -24, 0] }).setLngLat([site.lng, site.lat]).addTo(map);
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
