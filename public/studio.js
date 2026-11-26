import { accountHeaders } from "./accounts.js";
import { animate, motionState } from "./motion.js";
import { node } from "./markdown.js";

export function crop(data, ratio, compact) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const target = { square: 1, portrait: 3 / 4, landscape: 4 / 3, wide: 16 / 9, tall: 9 / 16 }[ratio] ?? image.naturalWidth / image.naturalHeight;
        const width = Math.floor(Math.min(image.naturalWidth, image.naturalHeight * target));
        const height = Math.floor(width / target);
        const canvas = document.createElement("canvas");
        const scale = compact ? Math.min(1, 480 / Math.max(width, height)) : 1;
        canvas.width = Math.floor(width * scale);
        canvas.height = Math.floor(height * scale);
        canvas.getContext("2d").drawImage(image, (image.naturalWidth - width) / 2,
          (image.naturalHeight - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = reject;
    image.src = `data:image/jpeg;base64,${data}`;
  });
}

export function setupStudio({ state, labels, persist, report, vault, onUsage }) {
  const dialog = document.getElementById("studio");
  const form = document.getElementById("image-form");
  const gallery = document.getElementById("gallery");
  const submit = document.getElementById("generate");
  const status = document.getElementById("image-status");
  const skeleton = document.getElementById("studio-skeleton");
  const orb = document.getElementById("studio-orb");
  let busy = false;
  let preview;
  let ephemeral = false;
  let resultOnly;
  const loaded = new WeakMap();
  let opening = 0;

  function loadGallery() {
    const session = vault();
    if (!session?.account) return Promise.resolve();
    if (!loaded.has(session)) {
      loaded.set(session, session.loadImages().then(({ images }) => {
        if (vault() === session) state().images = images;
      }).catch(error => {
        loaded.delete(session);
        throw error;
      }));
    }
    return loaded.get(session);
  }

  function render() {
    preview = null;
    gallery.replaceChildren();
    for (const item of ephemeral ? (resultOnly ? [resultOnly] : []) : state().images) {
      const figure = node("figure");
      const image = node("img");
      image.src = item.data;
      image.alt = item.prompt;
      image.loading = "lazy";
      const open = node("button", undefined, "image-preview");
      open.type = "button";
      open.setAttribute("aria-label", `${labels().preview}: ${item.prompt}`);
      open.append(image);
      open.addEventListener("click", () => {
        const full = document.getElementById("full-image");
        full.src = item.data;
        full.alt = item.prompt;
        preview = document.getElementById("image-preview");
        preview.showModal();
      });
      const caption = node("figcaption", item.prompt);
      const download = node("a", labels().download);
      download.href = item.data;
      download.download = `khat-${item.id}.jpg`;
      const remove = node("button", labels().delete);
      remove.type = "button";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        const session = vault();
        if (ephemeral) { resultOnly = undefined; render(); return; }
        try { await session?.removeImage?.(item.id); }
        catch (error) { status.textContent = labels()[error.message] ?? labels().unavailable; remove.disabled = false; return; }
        if (vault() !== session) return;
        state().images = state().images.filter(image => image.id !== item.id);
        if (!vault()?.account) persist();
        render();
      });
      const again = node("button", labels().regenerate);
      again.type = "button";
      again.addEventListener("click", () => {
        if (busy) return;
        form.elements.prompt.value = item.prompt;
        form.requestSubmit();
      });
      figure.append(open, caption, download, again, remove);
      gallery.append(figure);
    }
  }

  async function open(prompt = "", temporary = false) {
    if (dialog.open) return;
    ephemeral = temporary;
    resultOnly = undefined;
    status.textContent = prompt ? labels().studioRouted : "";
    form.elements.prompt.value = prompt.slice(0, 900);
    render();
    dialog.showModal();
    if (temporary || !vault()?.account) {
      submit.disabled = false;
      return;
    }
    const request = ++opening;
    submit.disabled = true;
    try {
      await loadGallery();
      if (request !== opening || !dialog.open) return;
      render();
      submit.disabled = false;
    } catch {
      if (request === opening && dialog.open) status.textContent = labels().galleryUnavailable;
    }
  }
  for (const id of ["studio-open", "composer-image"]) document.getElementById(id).addEventListener("click", () => open());
  document.getElementById("studio-close").addEventListener("click", () => dialog.close());
  const fullscreen = document.getElementById("image-fullscreen");
  fullscreen.addEventListener("click", () => {
    const expanded = document.getElementById("image-preview").classList.toggle("fullscreen");
    fullscreen.setAttribute("aria-pressed", String(expanded));
    fullscreen.textContent = labels()[expanded ? "compactVoice" : "fullscreen"];
  });
  document.getElementById("image-preview").addEventListener("close", event => {
    event.currentTarget.classList.remove("fullscreen");
    fullscreen.setAttribute("aria-pressed", "false");
    fullscreen.textContent = labels().fullscreen;
    document.getElementById("full-image").removeAttribute("src");
    preview = null;
  });
  dialog.addEventListener("cancel", event => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    opening++;
    preview?.close();
    gallery.replaceChildren();
    form.reset();
    resultOnly = undefined;
    ephemeral = false;
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (data.enhance) data.enhance = true;
    if (data.quality === "balanced") delete data.quality;
    if (busy || submit.disabled || !data.prompt.trim()) return;
    if (!ephemeral && state().images.length >= 12) {
      status.textContent = labels().galleryFull;
      return;
    }
    const session = vault();
    busy = true;
    form.setAttribute("aria-busy", "true");
    skeleton.hidden = orb.hidden = false;
    motionState({ image: true });
    submit.disabled = true;
    const close = document.getElementById("studio-close");
    close.disabled = true;
    status.textContent = labels().creatingImage;
    try {
      const response = await fetch("/api/image", {
        method: "POST", headers: { "content-type": "application/json", ...accountHeaders() }, body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const image = await crop(result.image, data.ratio, Boolean(session?.account) && !ephemeral);
      const item = { id: crypto.randomUUID(), prompt: data.prompt.trim(), data: image };
      if (vault() !== session) return;
      if (ephemeral) resultOnly = item;
      else {
        await session?.saveImage?.(item);
        if (vault() !== session) return;
        state().images.unshift(item);
        if (!vault()?.account) await persist();
      }
      status.textContent = labels().imageReady;
      render();
      if (gallery.firstElementChild) animate(gallery.firstElementChild, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1 }], 300);
    } catch (error) {
      const code = Object.hasOwn(labels(), error.message) ? error.message : "imageFailed";
      status.textContent = labels()[code];
      report(code);
    } finally {
      busy = false;
      form.setAttribute("aria-busy", "false");
      skeleton.hidden = orb.hidden = true;
      motionState({ image: false });
      close.disabled = false;
      submit.disabled = false;
      onUsage();
    }
  });
  return { open, loadGallery };
}
