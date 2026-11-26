const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const pointer = matchMedia("(pointer: fine)");
const selector = ".liquid-glass";
let surface;
let frame = 0;
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
}

function reset() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  surface?.classList.remove("reflecting");
  surface = null;
}

export function mountGlass() {
  for (const element of document.querySelectorAll(".top, aside, #composer, dialog, #mode, #status")) {
    element.classList.add("liquid-glass");
  }
  document.addEventListener("pointermove", event => {
    if (!pointer.matches || reduced.matches || document.hidden || root.dataset.motion === "off") return;
    const next = event.target instanceof Element ? event.target.closest(selector) : null;
    if (surface !== next) {
      reset();
      surface = next;
    }
    if (!surface) return;
    x = event.clientX;
    y = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!surface?.isConnected) return;
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty("--reflection-x", `${x - rect.left}px`);
      surface.style.setProperty("--reflection-y", `${y - rect.top}px`);
      surface.classList.add("reflecting");
    });
  }, { passive: true });
  document.addEventListener("pointerleave", reset);
  document.addEventListener("visibilitychange", () => {
    root.toggleAttribute("data-paused", document.hidden);
    if (document.hidden) reset();
  });
  reduced.addEventListener("change", reset);
}
