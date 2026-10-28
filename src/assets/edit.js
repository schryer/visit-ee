// The map's edit mode: open a site page with ?edit to move, add, describe and
// remove places on the map, then send the lot as one pull request on the
// content repository. map.js loads this only then, so visitors never do.
//
// It talks to GitHub straight from the browser with a fine-grained token
// the editor makes once per device (contents and pull requests on the
// repository only), kept in this browser's storage. Pending edits are kept
// there too, so a reload loses nothing. The editor's own text is English.

import { applyEdits, describe, slug, round, touchedPaths, placePath } from "./edit-changes.js";

const API = "https://api.github.com";
// The widths of the copies of a photo the editor makes for the storage
// service (storage.sustenaut.eu, Sustenaut/storage), as JPEG and, where the
// browser can, WebP.
const PHOTO_WIDTHS = [480, 960, 1600];
const TOKEN_KEY = "visit-ee-edit-token";
const NEW_TOKEN =
  "https://github.com/settings/personal-access-tokens/new?name=visit.ee%20map%20editor" +
  "&description=Edits%20map%20places%20on%20visit.ee&contents=write&pull_requests=write&expires_in=90";

export function start(ctx) {
  const { box, map, ml, config, places, markers } = ctx;
  const { repository, site, categories } = config.edit;
  const editsKey = `visit-ee-edits:${repository}:${site}`;

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL("./edit.css", import.meta.url).href;
  document.head.append(css);

  const bar = el("div", "edit-bar");
  const panel = el("div", "edit-panel");
  panel.hidden = true;
  box.append(bar, panel);
  box.classList.add("is-editing");

  let token = load(TOKEN_KEY) || "";
  // What's in the repository: places, descriptions, this site's list.
  let base = null;
  // Pending edits by place id; see edit-changes.js.
  let edits = JSON.parse(load(editsKey) || "{}");
  // Markers of the places this page doesn't list, and of new ones.
  const extra = {};
  let picking = null;

  const save = () => store(editsKey, JSON.stringify(edits));
  const count = () => Object.keys(edits).length;

  // --- GitHub ----------------------------------------------------------------

  async function api(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      headers: {
        Accept: options.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`GitHub said ${response.status}${detail.message ? `: ${detail.message}` : ""}`);
    }
    return options.raw ? response.text() : response.json();
  }

  // The newest commit on the default branch and the files the editor needs.
  async function fetchBase() {
    const repo = await api(`/repos/${repository}`);
    if (!repo.permissions?.push) throw new Error(`This token can't write to ${repository}.`);
    const branch = repo.default_branch;
    const ref = await api(`/repos/${repository}/git/ref/heads/${branch}`);
    const commit = ref.object.sha;
    const tree = await api(`/repos/${repository}/git/trees/${commit}?recursive=1`);
    const paths = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
    const langs = paths.map((p) => p.match(/^i18n\/places\/([^/]+)\.json$/)?.[1]).filter(Boolean);
    const sites = paths.map((p) => p.match(/^sites\/([^/]+)\/site\.json$/)?.[1]).filter(Boolean);
    const placeIds = paths.map((p) => p.match(/^places\/([^/]+)\.json$/)?.[1]).filter(Boolean);
    const read = (path) => api(`/repos/${repository}/contents/${encodeURI(path)}?ref=${commit}`, { raw: true });
    const files = {};
    await Promise.all(
      [...placeIds.map(placePath), ...langs.map((l) => `i18n/places/${l}.json`), `sites/${site}/site.json`].map(async (path) => {
        files[path] = await read(path);
      }),
    );
    return {
      branch,
      commit,
      treeSha: tree.sha,
      paths: new Set(paths),
      langs,
      sites,
      files,
      read,
      places: Object.fromEntries(placeIds.map((id) => [id, JSON.parse(files[placePath(id)])])),
      text: Object.fromEntries(langs.map((l) => [l, JSON.parse(files[`i18n/places/${l}.json`])])),
      nearby: JSON.parse(files[`sites/${site}/site.json`]).nearby || [],
    };
  }

  // One commit on a new branch, and a pull request for it.
  async function openPullRequest(title) {
    const fresh = await fetchBase();
    const list = Object.values(edits);
    const paths = touchedPaths(list, fresh);
    const files = {};
    await Promise.all(
      paths.map(async (path) => {
        files[path] = path in fresh.files ? fresh.files[path] : fresh.paths.has(path) ? await fresh.read(path) : null;
      }),
    );
    const changed = applyEdits(files, list, { site });
    if (!Object.keys(changed).length) throw new Error("Nothing to change: the repository already has these edits.");
    const tree = await api(`/repos/${repository}/git/trees`, {
      method: "POST",
      body: {
        base_tree: fresh.treeSha,
        tree: Object.entries(changed).map(([path, content]) =>
          content === null ? { path, mode: "100644", type: "blob", sha: null } : { path, mode: "100644", type: "blob", content },
        ),
      },
    });
    const lines = list.map((e) => describe(e, fresh));
    const commit = await api(`/repos/${repository}/git/commits`, {
      method: "POST",
      body: { message: `${title}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`, tree: tree.sha, parents: [fresh.commit] },
    });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const head = `edit/${site}-places-${stamp}`;
    await api(`/repos/${repository}/git/refs`, { method: "POST", body: { ref: `refs/heads/${head}`, sha: commit.sha } });
    const body =
      `Made with the map's edit mode on ${location.origin}${location.pathname}.\n\n` +
      lines.map((l) => `- ${l}`).join("\n") +
      "\n";
    const pr = await api(`/repos/${repository}/pulls`, { method: "POST", body: { title, head, base: fresh.branch, body } });
    return pr.html_url;
  }

  // --- the map ---------------------------------------------------------------

  const pageIds = new Set(places.map((p) => p.id));
  const listed = (id) => (edits[id]?.nearby ? edits[id].nearby.on : pageIds.has(id) || base?.nearby.some((n) => n.place === id));

  function current(id) {
    const e = edits[id] || {};
    const b = base?.places[id] || {};
    const page = places.find((p) => p.id === id);
    return {
      id,
      isNew: !!e.isNew,
      deleted: !!e.deleted,
      name: e.name ?? b.name ?? page?.name ?? id,
      category: e.category ?? b.category ?? page?.cat ?? categories[0],
      geo: e.geo ?? b.geo ?? (page && { lng: page.lngLat[0], lat: page.lngLat[1] }),
      estimate: !e.geo && b.position === "estimate",
      text: Object.fromEntries((base?.langs || ["et", "en"]).map((l) => [l, e.text?.[l] ?? base?.text[l]?.[id] ?? ""])),
      nearby: base?.nearby.find((n) => n.place === id) || {},
      listed: listed(id),
      photo: e.photo !== undefined ? e.photo : b.photo ?? null,
      photo_credit: e.photo_credit !== undefined ? e.photo_credit ?? "" : b.photo_credit ?? "",
      url: e.url !== undefined ? e.url ?? "" : b.url ?? "",
    };
  }

  function markerFor(id) {
    if (markers[id]) return markers[id];
    if (extra[id]) return extra[id];
    const pin = el("button", "pin");
    pin.type = "button";
    const marker = new ml.Marker({ element: pin, draggable: true }).setLngLat([0, 0]).addTo(map);
    extra[id] = marker;
    wire(id, marker);
    return marker;
  }

  function wire(id, marker) {
    marker.setDraggable(true);
    marker.on("dragend", () => {
      const { lng, lat } = marker.getLngLat();
      change(id, { geo: { lat: round(lat), lng: round(lng) } });
      openForm(id);
    });
    marker.getElement().addEventListener("click", (event) => {
      event.stopPropagation();
      openForm(id);
    });
  }

  // Draw every place as it will be once the edits are in.
  function redraw() {
    const ids = new Set([...pageIds, ...Object.keys(base?.places || {}), ...Object.keys(edits)]);
    for (const id of ids) {
      const c = current(id);
      if (!c.geo) continue;
      const marker = markerFor(id);
      const pin = marker.getElement();
      // Only the category class changes: MapLibre's own classes on the pin
      // (maplibregl-marker) are what keep it on its spot.
      for (const name of [...pin.classList]) if (name.startsWith("cat-")) pin.classList.remove(name);
      pin.classList.add("pin", `cat-${c.category}`);
      if (!pageIds.has(id)) pin.setAttribute("aria-label", c.name);
      pin.title = c.name;
      pin.classList.toggle("pin--other", !c.listed);
      pin.classList.toggle("pin--edited", !!edits[id]);
      pin.classList.toggle("pin--estimate", c.estimate);
      pin.classList.toggle("pin--deleted", c.deleted);
      marker.setLngLat([c.geo.lng, c.geo.lat]);
    }
    // Undone new places go.
    for (const [id, marker] of Object.entries(extra)) {
      if (!base?.places[id] && !edits[id]) {
        marker.remove();
        delete extra[id];
      }
    }
    bar.querySelector(".edit-bar__count").textContent = count()
      ? `${count()} unsent`
      : "No changes yet";
    bar.querySelector(".edit-send").disabled = !base || !count();
    bar.querySelector(".edit-add").disabled = !base;
  }

  // Merge `fields` into a place's pending edit, dropping what matches the
  // repository again.
  function change(id, fields) {
    const e = { ...(edits[id] || { id }), ...fields };
    for (const key of Object.keys(e)) if (e[key] === undefined) delete e[key];
    const b = base?.places[id];
    if (b && !e.isNew) {
      if (e.name === b.name) delete e.name;
      if (e.category === b.category) delete e.category;
      for (const key of ["photo_credit", "url"]) if (e[key] !== undefined && (e[key] ?? undefined) === b[key]) delete e[key];
      if (e.photo !== undefined && JSON.stringify(e.photo) === JSON.stringify(b.photo ?? null)) delete e.photo;
      if (e.text) {
        for (const [l, v] of Object.entries(e.text)) if ((base.text[l]?.[id] || "") === v) delete e.text[l];
        if (!Object.keys(e.text).length) delete e.text;
      }
      if (e.nearby) {
        const was = base.nearby.find((n) => n.place === id);
        if (!!was === e.nearby.on && (!e.nearby.on || ((was.walk_m ?? null) === (e.nearby.walk_m ?? null) && (was.road_km ?? null) === (e.nearby.road_km ?? null))))
          delete e.nearby;
      }
    }
    if (Object.keys(e).filter((k) => k !== "id").length) edits[id] = e;
    else delete edits[id];
    save();
    redraw();
  }

  // A photo's address: a small copy from the storage service, or a file in
  // the repository from before it.
  function photoUrl(photo) {
    if (!photo) return null;
    if (typeof photo === "string") return `https://raw.githubusercontent.com/${repository}/${base.commit}/places/${photo}`;
    return `${config.edit.photos}/p/${photo.id}/${photo.widths[0]}.jpg`;
  }

  async function uploadPhoto(file) {
    const response = await fetch(`${config.edit.photos}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: await photoCopies(file),
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error || `the storage service said ${response.status}`);
    return answer;
  }

  // --- the panels ------------------------------------------------------------

  function show(...children) {
    panel.replaceChildren(...children);
    panel.hidden = false;
  }
  const hide = () => (panel.hidden = true);

  function signIn(message) {
    const input = el("input");
    input.type = "password";
    input.autocomplete = "off";
    input.placeholder = "github_pat_…";
    const status = el("p", "edit-status", message || "");
    const form = el("form");
    form.append(
      el("h3", "", "Sign in to edit"),
      para(
        "Edits go to ",
        link(`https://github.com/${repository}`, repository),
        " as a pull request. Make a fine-grained token for that repository only, with Contents and Pull requests set to Read and write, then paste it here. This browser keeps it until you sign out.",
      ),
      para(link(NEW_TOKEN, "Make a token on GitHub ↗")),
      label("Token", input),
      el("div", "edit-actions", ""),
      status,
    );
    form.querySelector(".edit-actions").append(btn("Sign in", null, "submit"));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      token = input.value.trim();
      status.textContent = "Checking…";
      try {
        base = await fetchBase();
        store(TOKEN_KEY, token);
        ready();
      } catch (err) {
        status.textContent = err.message;
      }
    });
    show(form);
    input.focus();
  }

  function openForm(id) {
    const c = current(id);
    const f = el("form", "edit-form");
    const name = input(c.name);
    const key = input(c.id);
    key.readOnly = !c.isNew;
    key.pattern = "[a-z0-9]+(-[a-z0-9]+)*";
    if (c.isNew) name.addEventListener("input", () => (key.value = slug(name.value)));
    const cat = el("select");
    for (const k of categories) {
      const o = el("option", "", k);
      o.value = k;
      o.selected = k === c.category;
      cat.append(o);
    }
    const texts = Object.fromEntries(Object.entries(c.text).map(([l, v]) => [l, input(v)]));
    const on = el("input");
    on.type = "checkbox";
    on.checked = c.listed;
    const walk = input(edits[id]?.nearby && "walk_m" in edits[id].nearby ? edits[id].nearby.walk_m ?? "" : c.nearby.walk_m ?? "");
    walk.type = "number";
    walk.min = "0";
    walk.placeholder = "straight line";
    const road = input(edits[id]?.nearby && "road_km" in edits[id].nearby ? edits[id].nearby.road_km ?? "" : c.nearby.road_km ?? "");
    road.type = "number";
    road.min = "0";
    road.step = "0.1";
    const where = c.geo ? `${round(c.geo.lat)}, ${round(c.geo.lng)}${c.estimate ? " (an estimate: drag the pin to fix it)" : ""}` : "";
    const status = el("p", "edit-status");

    // The photo: picked, shrunk to a few sizes and uploaded to the photo
    // service at once; the place then names it (or null for none).
    let photo = c.photo;
    const preview = el("img", "edit-photo");
    preview.alt = "";
    const showPhoto = () => {
      const src = photoUrl(photo);
      preview.hidden = !src;
      if (src) preview.src = src;
      drop.hidden = !src;
    };
    preview.addEventListener("error", () => (preview.hidden = true));
    const file = el("input");
    file.type = "file";
    file.accept = "image/*";
    file.addEventListener("change", async () => {
      if (!file.files[0]) return;
      status.textContent = "Uploading the photo…";
      try {
        photo = await uploadPhoto(file.files[0]);
        status.textContent = "";
      } catch (err) {
        status.textContent = `That photo didn't load: ${err.message}`;
      }
      showPhoto();
    });
    const drop = btn("Remove photo", () => {
      photo = null;
      file.value = "";
      showPhoto();
    });
    const credit = input(c.photo_credit);
    credit.placeholder = "Who took it, if not you";
    // A link per language stays in the JSON; the form edits a single one.
    const site_url = input(typeof c.url === "string" ? c.url : "");
    site_url.type = "url";
    site_url.placeholder = "https://…";
    site_url.disabled = typeof c.url !== "string";
    showPhoto();

    f.append(
      el("h3", "", c.isNew ? "New place" : c.name),
      el("p", "edit-where", c.deleted ? "Deleted when the pull request is merged." : where),
      label("Name (never translated)", name),
      label("Id, used in links (#id)", key),
      label("Category", cat),
      ...Object.entries(texts).map(([l, i]) => label(`Description, ${l}${["et", "en"].includes(l) ? " (needed)" : ""}`, i)),
      checkbox(on, "Listed near this site"),
      label("Walk to it, metres (optional)", walk),
      label("By road, km (optional)", road),
      preview,
      label("Photo", file),
      drop,
      label("Photo credit (optional)", credit),
      label(site_url.disabled ? "Website (one per language: edit it in the JSON)" : "Official website (optional)", site_url),
      status,
    );
    const actions = el("div", "edit-actions");
    actions.append(btn("Keep", null, "submit"), btn("Close", hide));
    if (edits[id]) actions.append(btn(c.isNew ? "Discard" : "Undo all", () => undo(id)));
    if (!c.isNew && !c.deleted) actions.append(btn("Delete place", () => (change(id, { deleted: true }), hide()), "button", "edit-danger"));
    f.append(actions);

    f.addEventListener("submit", (event) => {
      event.preventDefault();
      let newId = id;
      if (c.isNew) {
        newId = key.value.trim();
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(newId)) return (status.textContent = "The id is lowercase a-z, 0-9 and hyphens.");
        if (newId !== id && (base.places[newId] || edits[newId])) return (status.textContent = `There is already a place "${newId}".`);
      }
      if (!name.value.trim()) return (status.textContent = "A place needs a name.");
      for (const l of ["et", "en"]) if (texts[l] && !texts[l].value.trim()) return (status.textContent = `A place needs a description in ${l}.`);
      const text = Object.fromEntries(Object.entries(texts).map(([l, i]) => [l, i.value.trim()]).filter(([l, v]) => v || c.text[l]));
      const number = (i) => (i.value === "" ? null : Number(i.value));
      if (!site_url.disabled && site_url.value.trim() && !/^https:\/\/[^/]+\./.test(site_url.value.trim()))
        return (status.textContent = "The website must start with https://.");
      const fields = {
        name: name.value.trim(),
        category: cat.value,
        text,
        nearby: { on: on.checked, walk_m: number(walk), road_km: number(road) },
        photo_credit: credit.value.trim() || null,
      };
      if (!site_url.disabled) fields.url = site_url.value.trim() || null;
      fields.photo = photo;
      if (newId !== id) {
        const moved = { ...edits[id], id: newId };
        delete edits[id];
        extra[id]?.remove();
        delete extra[id];
        edits[newId] = moved;
      }
      change(newId, fields);
      hide();
    });
    show(f);
  }

  function undo(id) {
    delete edits[id];
    save();
    redraw();
    hide();
    const page = places.find((p) => p.id === id);
    if (page && !base?.places[id]) markers[id].setLngLat(page.lngLat);
  }

  function addPlace(geo) {
    let n = 1;
    while (edits[`new-${n}`] || base.places[`new-${n}`]) n++;
    const id = `new-${n}`;
    edits[id] = { id, isNew: true, geo: { lat: round(geo.lat), lng: round(geo.lng) }, category: categories[0], nearby: { on: true } };
    save();
    redraw();
    openForm(id);
  }

  function pick() {
    const status = el("p", "edit-status");
    const here = btn("Use where I stand", () => {
      status.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          stopPicking();
          addPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(map.getZoom(), 16) });
        },
        (err) => (status.textContent = `No position: ${err.message}`),
        { enableHighAccuracy: true, timeout: 20000 },
      );
    });
    here.disabled = !("geolocation" in navigator);
    const actions = el("div", "edit-actions");
    actions.append(here, btn("Cancel", () => (stopPicking(), hide())));
    show(el("h3", "", "Add a place"), para("Tap the map where it is. You can drag it afterwards."), actions, status);
    picking = (event) => {
      stopPicking();
      addPlace({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    };
    map.once("click", picking);
    map.getCanvas().style.cursor = "crosshair";
  }

  function stopPicking() {
    if (picking) map.off("click", picking);
    picking = null;
    map.getCanvas().style.cursor = "";
  }

  function review() {
    const list = el("ul", "edit-list");
    for (const e of Object.values(edits)) {
      const li = el("li");
      const what = el("button", "edit-link", describe(e, base));
      what.type = "button";
      what.addEventListener("click", () => openForm(e.id));
      li.append(what, btn("Undo", () => (undo(e.id), review())));
      list.append(li);
    }
    const title = input("Edit map places near " + site);
    const status = el("p", "edit-status");
    const actions = el("div", "edit-actions");
    const send = btn("Open pull request", async () => {
      send.disabled = true;
      status.textContent = "Sending…";
      try {
        const url = await openPullRequest(title.value.trim() || "Edit map places");
        edits = {};
        save();
        base = await fetchBase();
        redraw();
        status.replaceChildren("Done: ", link(url, url.replace("https://github.com/", "")), ". The map changes when it's merged and deployed.");
      } catch (err) {
        status.textContent = err.message;
        send.disabled = false;
      }
    });
    send.className = "edit-primary";
    actions.append(send, btn("Close", hide));
    show(el("h3", "", "Unsent changes"), list, label("Pull request title", title), actions, status);
  }

  // --- start -----------------------------------------------------------------

  bar.append(el("b", "", "Editing places"), el("span", "edit-bar__count"));
  const tools = el("span", "edit-bar__tools");
  tools.append(
    btn("Add place", () => base && pick(), "button", "edit-add"),
    btn("Send…", () => base && review(), "button", "edit-send"),
    btn("Sign out", () => {
      forget(TOKEN_KEY);
      token = "";
      base = null;
      signIn("Signed out. Unsent changes stay in this browser.");
    }),
  );
  bar.append(tools);

  for (const p of places) wire(p.id, markers[p.id]);
  redraw();

  function ready() {
    hide();
    redraw();
  }

  if (token) {
    fetchBase()
      .then((b) => ((base = b), ready()))
      .catch((err) => signIn(err.message));
  } else signIn();
}

// --- helpers -----------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(text, onClick, type = "button", className) {
  const b = el("button", className, text);
  b.type = type;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

function input(value) {
  const i = el("input");
  i.value = value ?? "";
  return i;
}

function label(text, control) {
  const l = el("label", "edit-field");
  l.append(el("span", "", text), control);
  return l;
}

function checkbox(control, text) {
  const l = el("label", "edit-check");
  l.append(control, el("span", "", text));
  return l;
}

function para(...parts) {
  const p = el("p");
  p.append(...parts);
  return p;
}

function link(href, text) {
  const a = el("a", "", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

// A picked photo's copies for the storage service: "<width>.jpg" and, where
// the browser can make it, "<width>.webp", for each of PHOTO_WIDTHS the
// photo is wide enough for (or its own width, if it is narrower), turned
// the way the camera held it. Drawing it anew leaves its GPS and camera
// data behind.
async function photoCopies(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const widths = PHOTO_WIDTHS.filter((w) => w < bitmap.width);
  if (bitmap.width <= PHOTO_WIDTHS.at(-1)) widths.push(bitmap.width);
  else widths.push(PHOTO_WIDTHS.at(-1));
  const form = new FormData();
  let webp = true;
  for (const width of [...new Set(widths)]) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round((bitmap.height * width) / bitmap.width);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encode = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    form.append(`${width}.jpg`, await encode("image/jpeg", 0.85), `${width}.jpg`);
    // Safari makes PNG when asked for WebP: then there is JPEG only.
    const w = webp && (await encode("image/webp", 0.8));
    if (w?.type === "image/webp") form.append(`${width}.webp`, w, `${width}.webp`);
    else webp = false;
  }
  if (!webp) for (const name of [...form.keys()]) if (name.endsWith(".webp")) form.delete(name);
  return form;
}

// Storage can be missing or refuse (private windows); the editor still works
// for this visit without it.
function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function forget(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}
