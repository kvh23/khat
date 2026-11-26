import { node } from "./markdown.js";

let scope;
export function setAccountScope(account) { scope = account?.id; }
export function accountHeaders() { return scope ? { "X-Khat-Account": scope } : {}; }

export async function api(path, data, accountId = scope) {
  const headers = { ...(accountId && { "X-Khat-Account": accountId }), ...(data === undefined ? {} : { "Content-Type": "application/json" }) };
  const response = await fetch(path, data === undefined ? { headers } : {
    method: "POST", headers, body: JSON.stringify(data),
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "unavailable");
  return result;
}

export function accountVault(account, initial, images) {
  const request = (path, data) => api(path, data, account.id);
  let revision = initial.revision;
  let queue = Promise.resolve();
  let previous;
  let changes = 0;
  const snapshot = state => {
    const { chats, memories, active, images, memory, ...preferences } = state;
    return { preferences, chats, memories };
  };
  return {
    account,
    name: account.username,
    data: { ...initial.preferences, chats: initial.chats, memories: initial.memories, images },
    async reload() {
      await queue;
      const version = changes;
      const updated = await request(`/api/workspace?since=${revision}`);
      if (!updated || updated.revision === revision) return null;
      return () => {
        if (changes !== version) return null;
        revision = updated.revision;
        previous = undefined;
        return { ...updated.preferences, chats: updated.chats, memories: updated.memories };
      };
    },
    save(state) {
      changes++;
      const payload = snapshot(state);
      const serialized = JSON.stringify(payload);
      queue = queue.catch(() => {}).then(async () => {
        if (previous === serialized) return;
        await request("/api/workspace", { revision, ...JSON.parse(serialized) });
        previous = serialized;
        revision++;
      });
      return queue;
    },
    flush: () => queue,
    saveImage: item => request("/api/studio-history", item),
    removeImage: id => request("/api/studio-history", { id, remove: true }),
    release: () => request("/api/logout", {}),
  };
}

export function setupAdmin(labels) {
  const dialog = document.getElementById("admin");
  const list = document.getElementById("admin-users");
  const status = document.getElementById("admin-status");
  const invite = document.getElementById("invite-code");
  const stats = document.getElementById("admin-stats");
  const create = document.getElementById("issue-invite");
  let active = false;
  const error = err => { status.textContent = labels()[err.message] ?? labels().unavailable; };
  const label = (caption, control) => {
    const element = node("label", caption + " ");
    element.append(control);
    return element;
  };
  async function refresh() {
    const { users, usage } = await api("/api/admin");
    if (!active) return;
    const l = labels();
    stats.textContent = `${usage.day} UTC · ${l.textLimit}: ${usage.text} · ${l.imageLimit}: ${usage.image}`;
    list.replaceChildren();
    for (const user of users) {
      const counts = usage.users?.[user.id] ?? { text: 0, image: 0 };
      const row = node("form", undefined, "admin-user");
      const title = node("strong", user.username);
      const details = node("span", `${l.textLimit}: ${counts.text} · ${l.imageLimit}: ${counts.image}`);
      row.append(title, details);
      if (user.role === "member") {
        const enabled = node("input");
        enabled.type = "checkbox";
        enabled.checked = user.active === 1;
        const limit = (value, max) => {
          const input = node("input");
          input.type = "number";
          input.min = "0";
          input.max = String(max);
          input.required = true;
          input.value = value;
          return input;
        };
        const text = limit(user.text_limit, 35);
        const image = limit(user.image_limit, 8);
        const save = node("button", l.save, "primary");
        row.append(label(l.accountActive, enabled), label(l.textLimit, text), label(l.imageLimit, image), save);
        row.addEventListener("submit", async event => {
          event.preventDefault();
          save.disabled = true;
          try {
            await api("/api/admin/user", { id: user.id, active: enabled.checked, textLimit: +text.value, imageLimit: +image.value });
            status.textContent = l.saved;
          } catch (err) {
            error(err);
          } finally {
            save.disabled = false;
          }
        });
      }
      list.append(row);
    }
  }
  create.addEventListener("click", async () => {
    create.disabled = true;
    try {
      const result = await api("/api/admin/invite", {});
      if (!active) return;
      invite.value = result.invite;
      invite.hidden = false;
      invite.select();
      status.textContent = labels().inviteReady;
    } catch (err) {
      error(err);
    } finally {
      create.disabled = false;
    }
  });
  document.getElementById("admin-open").addEventListener("click", () => {
    dialog.showModal();
    active = true;
    status.textContent = labels().opening;
    refresh().then(() => { if (active) status.textContent = ""; }).catch(error);
  });
  dialog.addEventListener("close", () => {
    active = false;
    list.replaceChildren();
    stats.textContent = invite.value = "";
    invite.hidden = true;
  });
}

export async function avatarImage(file) {
  if (!file || file.size > 5_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("invalidAvatar");
  const href = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = href;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 96;
    const context = canvas.getContext("2d");
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(href);
  }
}
