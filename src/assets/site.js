// Small enhancements; every page works without them.
document.documentElement.classList.add("js");

// The phone menu: a button that opens the site's sections.
for (const header of document.querySelectorAll(".site-header")) {
  const button = header.querySelector(".menu-button");
  if (!button) continue;
  button.hidden = false;
  button.addEventListener("click", () => {
    const open = header.classList.toggle("is-open");
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? button.dataset.close : button.dataset.open;
  });
  header.querySelectorAll(".site-nav a").forEach((link) =>
    link.addEventListener("click", () => {
      header.classList.remove("is-open");
      button.setAttribute("aria-expanded", "false");
      button.textContent = button.dataset.open;
    }),
  );
}

// The season hero: show the season of the current month when there is
// media for it, let visitors switch, and play video only for those who
// have not asked for reduced motion.
const SEASON_OF_MONTH = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

for (const hero of document.querySelectorAll("[data-season-hero]")) {
  const panels = [...hero.querySelectorAll("[data-season]")];
  const buttons = [...hero.querySelectorAll("[data-season-pick]")];
  const have = new Set(panels.map((el) => el.dataset.season));

  const show = (season) => {
    for (const el of panels) {
      const on = el.dataset.season === season;
      el.hidden = !on;
      const video = el.querySelector("video");
      if (!video) continue;
      if (on && !calm.matches) video.play().catch(() => {});
      else video.pause();
    }
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.seasonPick === season));
  };

  for (const b of buttons) b.addEventListener("click", () => show(b.dataset.seasonPick));
  const switcher = hero.querySelector(".season-switch");
  if (switcher) switcher.hidden = false;

  const now = SEASON_OF_MONTH[new Date().getMonth()];
  show(have.has(now) ? now : hero.dataset.default);
  calm.addEventListener("change", () => show(buttons.find((b) => b.getAttribute("aria-pressed") === "true")?.dataset.seasonPick || hero.dataset.default));
}
