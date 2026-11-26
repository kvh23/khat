const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const contrast = matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)");
const supportsBlur = CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)");
export function glassPreferences(state, previous) {
  for (const [key, value] of [
    ["ambience", state.ambience ? "on" : "off"], ["density", state.density], ["rail", state.rail],
  ]) {
    if (state[key] !== previous?.[key]) root.dataset[key] = value;
  }
  for (const [key, property, value] of [
    ["glassOpacity", "--glass-opacity", `${state.glassOpacity}%`],
    ["glassBlur", "--glass-blur", `${state.glassBlur}px`],
    ["textSize", "--chat-type", `${state.textSize}px`],
    ["orbGlow", "--orb-glow", state.orbGlow / 100],
    ["orbSpeed", "--orb-tempo", 2 - state.orbSpeed / 100],
    ["orbDetail", "--orb-detail", state.orbDetail / 100],
    ["orbSize", "--orb-user-size", state.orbSize / 100],
  ]) {
    if (state[key] !== previous?.[key]) root.style.setProperty(property, value);
  }
}

function materialTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory ?? 4;
  root.dataset.glassTier = contrast.matches || !supportsBlur ? "opaque" :
    reduced.matches || cores < 4 || memory < 4 ? "light" :
    cores >= 6 ? "full" : "balanced";
}

export function mountGlass() {
  for (const element of document.querySelectorAll(".top, aside, #composer, dialog, #mode, #status")) {
    element.classList.add("liquid-glass");
  }
  materialTier();
  for (const query of [reduced, contrast]) query.addEventListener("change", materialTier);
  document.addEventListener("visibilitychange", () => {
    root.toggleAttribute("data-paused", document.hidden);
  });
}
