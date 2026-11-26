const root = document.documentElement;
const systemReduced = matchMedia("(prefers-reduced-motion: reduce)");
let enabled = true;
let active = {};
let intensity = .65;
let meter;

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
    active.responding ? "responding" : active.thinking ? "thinking" : "idle";
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
  root.style.setProperty("--voice-level", "0");
}

export async function startMeter() {
  if (!enabled || systemReduced.matches || !navigator.mediaDevices?.getUserMedia || meter) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  const capture = {};
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
    let last = 0;
    let smoothed = 0;
    const tick = time => {
      if (meter !== capture) return;
      if (time - last > 32) {
        analyser.getByteTimeDomainData(samples);
        const sum = samples.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0);
        smoothed = smoothed * .75 + Math.min(1, Math.sqrt(sum / samples.length) * 5) * .25;
        root.style.setProperty("--voice-level", smoothed.toFixed(3));
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
