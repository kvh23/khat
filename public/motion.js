const root = document.documentElement;
const systemReduced = matchMedia("(prefers-reduced-motion: reduce)");
let enabled = true;
let active = {};
let intensity = .65;
let meter;
let settle;
let pulse;

export function motionPreferences(state) {
  intensity = state.motionIntensity / 100;
  enabled = state.motionEnabled !== false && state.motionIntensity !== 0;
  root.dataset.motion = enabled ? "on" : "off";
  root.dataset.orbStyle = state.orbStyle;
  root.style.setProperty("--orb-one", state.orbOne);
  root.style.setProperty("--orb-two", state.orbTwo);
  root.style.setProperty("--intensity", intensity);
  if ((!enabled || systemReduced.matches) && meter) endMeter();
}

export function motionState(change) {
  active = { ...active, ...change };
  root.dataset.orbState = active.image ? "image" : active.listening ? "listening" :
    active.responding ? "responding" : active.thinking ? "thinking" : active.speaking ? "speaking" : active.error ? "error" : "idle";
}

export function softError() {
  clearTimeout(settle);
  motionState({ error: true });
  settle = setTimeout(() => motionState({ error: false }), 900);
}

export function tokenLight(length) {
  if (!enabled || systemReduced.matches || document.hidden || pulse) return;
  pulse = requestAnimationFrame(() => {
    pulse = 0;
    root.style.setProperty("--token-light", String(Math.min(1, .32 + length * .04)));
    if (!active.responding) root.style.removeProperty("--token-light");
  });
}

export function animate(element, keyframes, duration) {
  if (enabled && !systemReduced.matches && typeof element.animate === "function") {
    element.animate(keyframes, { duration: duration * (.55 + intensity * .7), easing: "cubic-bezier(.2,.75,.25,1)" });
  }
}

export function endMeter() {
  const capture = meter;
  meter = undefined;
  if (!capture) return;
  cancelAnimationFrame(capture.frame);
  capture.stream?.getTracks().forEach(track => track.stop());
  capture.context?.close().catch(() => {});
  for (const orb of capture.orbs) orb.style.removeProperty("--voice-level");
  for (const key of ["level", "low", "high"]) capture.waves?.style.removeProperty(`--voice-${key}`);
}

export async function startMeter() {
  if (!enabled || systemReduced.matches || !navigator.mediaDevices?.getUserMedia || meter) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  const capture = { orbs: [...document.querySelectorAll(".orb-small, .orb-hero, .orb-voice")], waves: document.querySelector(".voice-waves") };
  meter = capture;
  try {
    const context = new Context();
    capture.context = context;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (meter !== capture) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    capture.stream = stream;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    await context.resume();
    if (meter !== capture) return;
    const samples = new Uint8Array(analyser.fftSize);
    const frequencies = new Uint8Array(analyser.frequencyBinCount);
    let last = 0;
    let smoothed = 0;
    const tick = time => {
      if (meter !== capture) return;
      if (time - last > 32) {
        analyser.getByteTimeDomainData(samples);
        const sum = samples.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0);
        smoothed = smoothed * .75 + Math.min(1, Math.sqrt(sum / samples.length) * 5) * .25;
        analyser.getByteFrequencyData(frequencies);
        const average = (start, end) => {
          let energy = 0;
          for (let bin = start; bin < end; bin++) energy += frequencies[bin];
          return energy / ((end - start) * 255);
        };
        const level = smoothed.toFixed(3);
        for (const orb of capture.orbs) {
          if (orb.style.getPropertyValue("--voice-level") !== level) orb.style.setProperty("--voice-level", level);
        }
        capture.waves?.style.setProperty("--voice-level", level);
        capture.waves?.style.setProperty("--voice-low", average(1, 8).toFixed(3));
        capture.waves?.style.setProperty("--voice-high", average(8, 28).toFixed(3));
        last = time;
      }
      capture.frame = requestAnimationFrame(tick);
    };
    capture.frame = requestAnimationFrame(tick);
  } catch {
    if (meter === capture) endMeter();
  }
}

systemReduced.addEventListener("change", () => { if (systemReduced.matches) endMeter(); });
window.addEventListener("pagehide", endMeter);
document.addEventListener("visibilitychange", () => { if (document.hidden) endMeter(); });
