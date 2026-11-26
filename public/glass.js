const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const pointer = matchMedia("(hover: hover) and (pointer: fine)");
const contrast = matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)");
const supportsBlur = CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)");
let surface;
let gleam;
let rect;
let frame;
let x;
let y;

export function glassPreferences(state) {
  root.dataset.ambience = state.ambience ? "on" : "off";
  root.dataset.density = state.density;
  root.dataset.rail = state.rail;
  root.style.setProperty("--glass-opacity", `${state.glassOpacity}%`);
  root.style.setProperty("--glass-blur", `${state.glassBlur}px`);
  root.style.setProperty("--chat-type", `${state.textSize}px`);
  root.style.setProperty("--orb-glow", String(state.orbGlow / 100));
  root.style.setProperty("--orb-tempo", String(2 - state.orbSpeed / 100));
  root.style.setProperty("--orb-detail", String(state.orbDetail / 100));
  root.style.setProperty("--orb-user-size", String(state.orbSize / 100));
  if (!state.motionEnabled || state.motionIntensity === 0) reset();
}

function reset() {
  if (frame) cancelAnimationFrame(frame);
  frame = undefined;
  if (gleam) gleam.style.opacity = "0";
  surface = gleam = rect = undefined;
}

function materialTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory ?? 4;
  root.dataset.glassTier = contrast.matches || !supportsBlur ? "opaque" :
    reduced.matches || cores < 4 || memory < 4 ? "light" :
    pointer.matches && cores >= 6 ? "full" : "balanced";
  reset();
}

export function mountGlass() {
  for (const element of document.querySelectorAll(".top, aside, #composer, dialog, #mode, #status")) {
    element.classList.add("liquid-glass");
    if (!element.matches("select, #status")) {
      const shine = document.createElement("span");
      shine.className = "glass-gleam";
      shine.setAttribute("aria-hidden", "true");
      const lens = document.createElement("span");
      lens.className = "glass-lens";
      lens.setAttribute("aria-hidden", "true");
      lens.append(shine);
      element.prepend(lens);
    }
  }
  materialTier();
  for (const query of [reduced, pointer, contrast]) query.addEventListener("change", materialTier);
  document.addEventListener("pointermove", event => {
    if (root.dataset.glassTier !== "full" || document.hidden || root.dataset.motion === "off") return;
    const next = event.target instanceof Element ? event.target.closest(".liquid-glass") : null;
    if (surface !== next) {
      reset();
      surface = next;
      gleam = surface?.firstElementChild?.classList.contains("glass-lens") ? surface.firstElementChild.firstElementChild : undefined;
    }
    if (!gleam) return;
    x = event.clientX;
    y = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!surface?.isConnected) return;
      rect ??= surface.getBoundingClientRect();
      gleam.style.transform = `translate3d(${x - rect.left - 70}px, ${y - rect.top - 35}px, 0)`;
      gleam.style.opacity = ".72";
    });
  }, { passive: true });
  document.addEventListener("pointerleave", reset);
  window.addEventListener("resize", reset, { passive: true });
  document.addEventListener("scroll", () => { rect = undefined; }, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    root.toggleAttribute("data-paused", document.hidden);
    if (document.hidden) reset();
  });
}
