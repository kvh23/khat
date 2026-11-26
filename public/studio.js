import { node } from "./markdown.js";

function crop(data, ratio) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const target = { square: 1, portrait: 3 / 4, landscape: 4 / 3 }[ratio];
        const width = Math.floor(Math.min(image.naturalWidth, image.naturalHeight * target));
        const height = Math.floor(width / target);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(image, (image.naturalWidth - width) / 2,
          (image.naturalHeight - height) / 2, width, height, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = reject;
    image.src = `data:image/jpeg;base64,${data}`;
  });
}

export function setupStudio({ state, labels, persist, report }) {
  const dialog = document.getElementById("studio");
  const form = document.getElementById("image-form");
  const gallery = document.getElementById("gallery");
  const submit = document.getElementById("generate");
  const status = document.getElementById("image-status");
  let busy = false;
  let preview;

  function render() {
    preview = null;
    gallery.replaceChildren();
    for (const item of state().images) {
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
      remove.addEventListener("click", () => {
        state().images = state().images.filter(image => image.id !== item.id);
        persist();
        render();
      });
      figure.append(open, caption, download, remove);
      gallery.append(figure);
    }
  }

  document.getElementById("studio-open").addEventListener("click", () => {
    status.textContent = "";
    render();
    dialog.showModal();
  });
  document.getElementById("studio-close").addEventListener("click", () => dialog.close());
  document.getElementById("image-preview").addEventListener("close", () => {
    document.getElementById("full-image").removeAttribute("src");
    preview = null;
  });
  dialog.addEventListener("cancel", event => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    preview?.close();
    gallery.replaceChildren();
    form.reset();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (busy || !data.prompt.trim()) return;
    if (state().images.length >= 12) {
      status.textContent = labels().galleryFull;
      return;
    }
    busy = true;
    submit.disabled = true;
    const close = document.getElementById("studio-close");
    close.disabled = true;
    status.textContent = labels().creatingImage;
    try {
      const response = await fetch("/api/image", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const image = await crop(result.image, data.ratio);
      state().images.unshift({ id: crypto.randomUUID(), prompt: data.prompt.trim(), data: image });
      await persist();
      status.textContent = labels().imageReady;
      render();
    } catch (error) {
      const code = Object.hasOwn(labels(), error.message) ? error.message : "imageFailed";
      status.textContent = labels()[code];
      report(code);
    } finally {
      busy = false;
      close.disabled = false;
      submit.disabled = false;
    }
  });
}
