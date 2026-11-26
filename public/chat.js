import { translations } from "./i18n.js";
import { markdown, node, webUrl } from "./markdown.js";
import { readReply } from "./stream.js";
import { canImportLegacy, createProfile, profiles, unlock } from "./vault.js";
import { prepareVision } from "./vision.js";
import { glassPreferences, mountGlass } from "./glass.js";
import { crop, setupStudio } from "./studio.js";
import { accountHeaders, accountVault, api, avatarImage, setAccountScope, setupAdmin } from "./accounts.js";
import { animate, endMeter, motionPreferences, motionState, startMeter, tokenLight, softError } from "./motion.js";

const byId = id => document.getElementById(id);
const prompt = byId("prompt");
const timeline = byId("timeline");
const messages = byId("messages");
const history = byId("history");
const send = byId("send");
const stop = byId("stop");
const status = byId("status");
const preferences = byId("preferences");
const confirmDelete = byId("confirm");
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const deviceLanguage = navigator.language.toLowerCase().startsWith("da") ? "da" : "en";
const visualDefaults = {
  theme: "auto", accent: "ink", customAccent: "#526c83", orbOne: "#c7d8ff", orbTwo: "#7763cc",
  orbStyle: "fluid", motionEnabled: true, motionIntensity: 65, ambience: true,
  glassOpacity: 77, glassBlur: 17, orbGlow: 62, orbSpeed: 80, orbDetail: 75, orbSize: 100,
  textSize: 16, density: "comfortable", rail: "glass",
};
const ranges = { glassOpacity: "glass-opacity", glassBlur: "glass-blur", orbGlow: "orb-glow",
  orbSpeed: "orb-speed", orbDetail: "orb-detail", orbSize: "orb-size", textSize: "text-size", motionIntensity: "motion-intensity" };
const defaults = () => ({
  ...visualDefaults,
  language: deviceLanguage,
  personality: "", memory: "", memoryEnabled: false, aiName: "", instructions: "",
  length: "balanced", style: "balanced",
  mode: "auto", collapsed: false, chats: [], active: null, images: [],
  displayName: "", avatar: "", memories: [],
});
const shell = document.querySelector(".shell");
const profileDialog = byId("profiles");
const unlockForm = byId("unlock-form");
const createForm = byId("create-form");
const conversationOptions = byId("conversation-options");
const editDialog = byId("edit-dialog");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const settingIds = {
  theme: "theme", accent: "accent", customAccent: "custom-accent", aiName: "ai-name", length: "response-length",
  style: "response-style", personality: "personality", instructions: "instructions", memory: "memory",
  displayName: "display-name", orbStyle: "orb-style", orbOne: "orb-one", orbTwo: "orb-two", density: "density", rail: "rail",
};
const modelNames = { instant: "Khat Instant", think: "Khat Think", pro: "Khat Pro", legacy: "Llama 3.3 70B", instantClassic: "Llama 3.1 8B", thinkClassic: "Qwen3 30B" };
let state = defaults();
let labels = translations[state.language];
let vault;
let accountsMode = false;
let registering = false;
let temporary;
let avatarDraft;
let memoryDraft;
let syncing = false;
let archives = false;
let optionsId;
let editing;
let pending;
let recording;
let cancelCapture;
let speaking;
let deleting;
let files = [];
let search = false;
let loadingFiles = false;
let notice = "";
let dailyUsage;
const voiceRoom = byId("voice-room");
let voiceReply = false;

function renderUsage() {
  const target = byId("usage");
  target.hidden = !dailyUsage;
  if (!dailyUsage) return;
  const { text = 0, image = 0, textLimit, imageLimit, estimatedNeurons, budget } = dailyUsage;
  target.textContent = `${labels.dailyUsage} · ${labels.textLimit} ${text}/${textLimit} · ${labels.imageLimit} ${image}/${imageLimit} · ${labels.estimatedUsage} ${estimatedNeurons}/${budget}`;
  const near = (textLimit > 0 && text >= textLimit * .8) || (imageLimit > 0 && image >= imageLimit * .8) || estimatedNeurons >= budget * .8;
  target.toggleAttribute("data-near", near);
  if (near) target.textContent += ` · ${labels.nearLimit}`;
}

async function refreshUsage() {
  const session = vault;
  if (!session?.account) return;
  try {
    const data = await api("/api/usage");
    if (vault !== session) return;
    dailyUsage = data;
    renderUsage();
  } catch {
    // The generation endpoint still enforces quota if the readout is unavailable.
  }
}

function voiceControls() {
  const busy = Boolean(recording || pending || speaking);
  byId("voice-listen").disabled = !Recognition || busy;
  byId("voice-mute").disabled = !recording;
  byId("voice-room-stop").disabled = !busy;
  byId("voice-room-status").textContent = voiceRoom.open
    ? (!Recognition ? labels.voiceUnsupported : speaking ? labels.speaking : labels[notice] || labels.voiceIdle)
    : "";
}

function report(key = "") {
  notice = key;
  status.textContent = labels[key] ?? "";
  voiceControls();
}

async function persist() {
  if (!vault) return false;
  try {
    await vault.save(state);
    return true;
  } catch (error) {
    report(labels[error.message] ? error.message : "storageFailed");
    return false;
  }
}

function appearance(visual = state) {
  glassPreferences(visual);
  motionPreferences(visual);
  const root = document.documentElement;
  root.dataset.theme = visual.theme;
  root.dataset.effectiveTheme = visual.theme === "auto" ? (systemDark.matches ? "dark" : "light") : visual.theme;
  root.dataset.accent = visual.accent;
  const hex = /^#[0-9a-f]{6}$/i.test(visual.customAccent) ? visual.customAccent : "#526c83";
  const luminance = [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const channel = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return sum + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  }, 0);
  root.style.setProperty("--custom-accent", hex);
  root.style.setProperty("--on-custom", luminance > 0.179 ? "#000" : "#fff");
  shell.classList.toggle("collapsed", state.collapsed);
  byId("collapse").setAttribute("aria-expanded", String(!state.collapsed));
  byId("collapse").textContent = state.collapsed ? labels.expand : labels.collapse;
}

async function showProfiles(showCreate = false) {
  shell.hidden = true;
  if (!profileDialog.open) profileDialog.showModal();
  try {
    const entries = await profiles();
    byId("profile-list").replaceChildren(...entries.map(({ id, name }) => {
      const option = node("option", name);
      option.value = id;
      return option;
    }));
    createForm.hidden = entries.length > 0 && !showCreate;
    unlockForm.hidden = !entries.length || showCreate;
    byId("toggle-create").hidden = !entries.length;
    byId("toggle-create").textContent = showCreate ? labels.back : labels.createProfile;
    byId("legacy-label").hidden = !canImportLegacy();
  } catch {
    byId("profile-status").textContent = labels.profileUnavailable;
    unlockForm.hidden = createForm.hidden = byId("toggle-create").hidden = true;
  }
}

function refreshIdentity() {
  byId("profile-name").textContent = state.displayName || vault?.name || "";
  const avatar = byId("account-avatar");
  avatar.hidden = !state.avatar;
  if (state.avatar) avatar.src = state.avatar;
  else avatar.removeAttribute("src");
}

function enterProfile(session) {
  vault = session;
  dailyUsage = undefined;
  state = { ...defaults(), ...session.data };
  if (!Object.hasOwn(translations, state.language)) state.language = deviceLanguage;
  temporary = undefined;
  refreshIdentity();
  byId("account-preferences").hidden = byId("account-memories").hidden = !session.account;
  byId("local-memory").hidden = Boolean(session.account);
  byId("temporary").hidden = !session.account;
  byId("temporary").setAttribute("aria-pressed", "false");
  byId("admin-open").hidden = session.account?.role !== "admin";
  byId("mode").value = state.mode;
  byId("history-search").value = "";
  byId("archives").setAttribute("aria-pressed", "false");
  byId("search").setAttribute("aria-pressed", "false");
  archives = search = false;
  report();
  shell.hidden = false;
  profileDialog.close();
  byId("account-auth").close();
  renderLanguage();
  updateControls();
  refreshUsage();
}

for (const form of [unlockForm, createForm]) {
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (vault || profileDialog.dataset.busy) return;
    profileDialog.dataset.busy = "true";
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    byId("profile-status").textContent = labels.opening;
    try {
      const name = byId("new-profile-name").value.trim();
      if (form === createForm && !name) throw new Error("profileUnavailable");
      const session = form === unlockForm
        ? await unlock(byId("profile-list").value, byId("unlock-password").value)
        : await createProfile(name, byId("new-profile-password").value,
          { ...defaults(), language: state.language }, byId("import-legacy").checked);
      enterProfile(session);
      byId("profile-status").textContent = "";
    } catch (error) {
      byId("profile-status").textContent = labels[error.message] ?? labels.profileUnavailable;
    } finally {
      delete profileDialog.dataset.busy;
      button.disabled = false;
      byId("unlock-password").value = "";
      byId("new-profile-password").value = "";
    }
  });
}
profileDialog.addEventListener("cancel", event => event.preventDefault());
byId("toggle-create").addEventListener("click", () => {
  if (!profileDialog.dataset.busy) showProfiles(createForm.hidden);
});
byId("profile-language").addEventListener("click", () => {
  if (profileDialog.dataset.busy) return;
  state.language = state.language === "da" ? "en" : "da";
  renderLanguage();
  showProfiles(!createForm.hidden && unlockForm.hidden);
});
async function resetSession() {
  cancelCapture?.();
  endMeter();
  stopSpeech();
  vault = undefined;
  dailyUsage = undefined;
  setAccountScope(null);
  temporary = undefined;
  avatarDraft = undefined;
  memoryDraft = undefined;
  state = { ...defaults(), language: state.language };
  prompt.value = "";
  files = [];
  for (const id of [...Object.values(settingIds), "edit-text", "conversation-name", "import-password", "removal-password"]) byId(id).value = "";
  byId("memory-entries").replaceChildren();
  byId("profile-name").textContent = "";
  refreshIdentity();
  renderLanguage();
  if (accountsMode) showAccount();
  else await showProfiles();
}

byId("lock").addEventListener("click", async () => {
  if (!vault || pending || byId("lock").disabled) return;
  byId("lock").disabled = true;
  try {
    await vault.flush().catch(() => {});
    await vault.release();
    await resetSession();
  } catch (error) {
    if (["signInRequired", "sessionChanged"].includes(error.message)) await resetSession();
    else report(labels[error.message] ? error.message : "unavailable");
  } finally {
    byId("lock").disabled = false;
  }
});

function showAccount() {
  shell.hidden = true;
  const dialog = byId("account-auth");
  if (!dialog.open) dialog.showModal();
}

function accountForm() {
  byId("account-title").textContent = labels[registering ? "registerTitle" : "accountWelcome"];
  byId("account-submit").textContent = labels[registering ? "createAccount" : "signIn"];
  byId("account-toggle").textContent = labels[registering ? "signIn" : "register"];
  byId("account-password").autocomplete = registering ? "new-password" : "current-password";
  byId("invitation-field").hidden = !registering;
  byId("invite").required = registering;
}

async function openAccount(account) {
  setAccountScope(account);
  const workspace = await api("/api/workspace");
  const { images } = await api("/api/studio-history");
  enterProfile(accountVault(account, workspace, images));
}

async function initialize() {
  try {
    const result = await fetch("/api/session");
    if (result.status === 404) {
      await showProfiles();
      return;
    }
    accountsMode = true;
    if (!result.ok) throw new Error("unavailable");
    const { account } = await result.json();
    if (account) await openAccount(account);
    else showAccount();
  } catch {
    accountsMode = true;
    showAccount();
    byId("account-status").textContent = labels.unavailable;
  }
}

byId("account-auth").addEventListener("cancel", event => event.preventDefault());
byId("account-toggle").addEventListener("click", () => {
  registering = !registering;
  accountForm();
});
byId("account-language").addEventListener("click", () => {
  state.language = state.language === "da" ? "en" : "da";
  renderLanguage();
});
byId("account-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = byId("account-status");
  const submit = byId("account-submit");
  if (submit.disabled) return;
  submit.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  fields.textContent = labels.opening;
  try {
    const { account } = await api(registering ? "/api/register" : "/api/login", data);
    await openAccount(account);
    fields.textContent = "";
    form.reset();
    registering = false;
    accountForm();
  } catch (error) {
    fields.textContent = labels[error.message] || labels.unavailable;
  } finally {
    byId("account-password").value = "";
    submit.disabled = false;
  }
});

async function syncWorkspace() {
  const session = vault;
  if (!session?.account || syncing || pending || temporary || prompt.value || document.querySelector("dialog[open]")) return;
  syncing = true;
  try {
    const apply = await session.reload();
    if (apply && session === vault && !pending && !temporary && !prompt.value && !document.querySelector("dialog[open]")) {
      const updated = apply();
      if (!updated) return;
      state = { ...state, ...updated };
      byId("mode").value = state.mode;
      refreshIdentity();
      renderLanguage();
    }
  } catch (error) {
    if (["signInRequired", "sessionChanged"].includes(error.message) && session === vault) await resetSession();
  } finally {
    syncing = false;
  }
}
window.addEventListener("focus", syncWorkspace);
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncWorkspace(); });
setInterval(() => { if (!document.hidden) syncWorkspace(); }, 30_000);

byId("export-account").addEventListener("click", async () => {
  const session = vault;
  if (!session?.account) return;
  try {
    await session.flush().catch(() => {});
    const data = await api("/api/export");
    if (session !== vault) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = node("a");
    link.href = url;
    link.download = "khat-account.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (error) {
    report(labels[error.message] || "unavailable");
  }
});

byId("removal-cancel").addEventListener("click", () => byId("account-removal").close());
byId("account-removal").addEventListener("close", () => { byId("removal-password").value = ""; });
byId("removal-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api("/api/delete-account", { password: byId("removal-password").value });
    byId("account-removal").close();
    await resetSession();
  } catch (error) {
    byId("removal-status").textContent = labels[error.message] || labels.unavailable;
  } finally {
    byId("removal-password").value = "";
    button.disabled = false;
  }
});

async function openImport() {
  const items = await profiles();
  byId("import-profile").replaceChildren(...items.map(item => {
    const option = node("option", item.name);
    option.value = item.id;
    return option;
  }));
  byId("import-status").textContent = items.length ? "" : labels.noLocalProfiles;
  byId("import-dialog").showModal();
}
byId("import-close").addEventListener("click", () => byId("import-dialog").close());
byId("import-dialog").addEventListener("close", () => { byId("import-password").value = ""; });
byId("import-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  let local;
  const session = vault;
  try {
    local = await unlock(byId("import-profile").value, byId("import-password").value);
    if (session !== vault) return;
    const old = state;
    const known = new Set(state.chats.map(chat => chat.id));
    const chats = [...state.chats, ...local.data.chats.filter(chat => !known.has(chat.id))];
    const memories = [...state.memories];
    if (local.data.memory && memories.length < 40 && !memories.some(mem => mem.content === local.data.memory)) {
      memories.push({ id: crypto.randomUUID(), content: local.data.memory.slice(0, 500), source: "manual" });
    }
    state = { ...state, chats, memories };
    if (!await persist()) {
      if (session === vault) state = old;
      throw new Error(notice);
    }
    let imageError = false;
    for (const image of (local.data.images ?? []).slice().reverse()) {
      if (session !== vault) return;
      if (state.images.length >= 12) { imageError = true; break; }
      if (state.images.some(current => current.id === image.id)) continue;
      try {
        const data = await crop(image.data.split(",")[1], undefined, true);
        const item = { id: image.id, prompt: image.prompt, data };
        await session.saveImage(item);
        if (session !== vault) return;
        state.images.unshift(item);
      } catch {
        imageError = true;
      }
    }
    byId("import-dialog").close();
    renderHistory();
    report(imageError ? "importPartial" : "imported");
  } catch (error) {
    byId("import-status").textContent = labels[error.message] || labels.unavailable;
  } finally {
    local?.release();
    button.disabled = false;
    byId("import-password").value = "";
  }
});

function current() {
  return temporary ?? state.chats.find(chat => chat.id === state.active);
}

function closeMenu() {
  byId("sidebar").classList.remove("open");
  byId("menu").setAttribute("aria-expanded", "false");
}

function renderHistory() {
  history.replaceChildren();
  const chat = current();
  byId("chat-title").textContent = chat?.title || labels.newChat;
  const query = byId("history-search").value.trim().toLocaleLowerCase();
  const entries = state.chats.filter(entry => Boolean(entry.archived) === archives &&
    (!query || entry.title.toLocaleLowerCase().includes(query) ||
      entry.messages.some(msg => msg.content.toLocaleLowerCase().includes(query))));
  byId("no-history").hidden = entries.length > 0;
  byId("no-history").textContent = query || archives ? labels.noMatches : labels.noHistory;
  byId("new").disabled = Boolean(pending);
  for (const entry of entries) {
    const item = node("li");
    const select = node("button", entry.title);
    select.type = "button";
    select.disabled = Boolean(pending);
    select.setAttribute("aria-current", String(entry.id === state.active));
    select.addEventListener("click", () => openChat(entry.id));
    const remove = node("button", "⋯");
    remove.type = "button";
    remove.disabled = Boolean(pending);
    remove.setAttribute("aria-label", `${labels.conversationOptions}: ${entry.title}`);
    remove.addEventListener("click", () => {
      optionsId = entry.id;
      byId("conversation-name").value = entry.title;
      byId("archive-conversation").textContent = entry.archived ? labels.restore : labels.archive;
      conversationOptions.returnValue = "";
      conversationOptions.showModal();
    });
    item.append(select, remove);
    history.append(item);
  }
}

function renderFiles() {
  const list = byId("files");
  list.replaceChildren();
  list.hidden = !files.length;
  for (const file of files) {
    const item = node("li");
    const remove = node("button", `${file.name} ×`);
    remove.type = "button";
    remove.setAttribute("aria-label", `${labels.remove}: ${file.name}`);
    remove.addEventListener("click", () => {
      files = files.filter(entry => entry !== file);
      renderFiles();
    });
    item.append(remove);
    list.append(item);
  }
}

function stopSpeech() {
  if (!speaking) return;
  const { button } = speaking;
  speaking = null;
  window.speechSynthesis.cancel();
  if (button) {
    button.textContent = labels.read;
    button.setAttribute("aria-pressed", "false");
  }
  motionState({ speaking: false });
  voiceControls();
}

function speak(message, button) {
  const wasSpeaking = speaking && speaking.button === button;
  stopSpeech();
  if (wasSpeaking) return;
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return report("speechFailed");
  const utterance = new SpeechSynthesisUtterance(message.content);
  utterance.lang = message.language === "da" ? "da-DK" : "en-US";
  speaking = { button, utterance };
  if (button) {
    button.textContent = labels.stopReading;
    button.setAttribute("aria-pressed", "true");
  }
  utterance.onstart = () => {
    if (speaking?.utterance === utterance) {
      motionState({ speaking: true });
      voiceControls();
    }
  };
  utterance.onend = () => {
    if (speaking?.utterance === utterance) stopSpeech();
  };
  utterance.onerror = () => {
    if (speaking?.utterance !== utterance) return;
    stopSpeech();
    report("speechFailed");
  };
  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    stopSpeech();
    report("speechFailed");
  }
}

function messageAction(actions, key, onClick) {
  const button = node("button", labels[key]);
  button.type = "button";
  button.disabled = Boolean(pending);
  button.addEventListener("click", onClick);
  actions.append(button);
}

function messageElement(message, streamed = false, index = -1) {
  const element = node("article", undefined, `message ${message.role}`);
  const actions = node("div", undefined, "message-actions");
  messageAction(actions, "copy", async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      report("copied");
    } catch {
      report("copyFailed");
    }
  });
  if (message.role === "user") {
    element.textContent = message.content;
    if (message.files?.length) element.append(node("div", message.files.join(" · "), "message-label"));
    messageAction(actions, "edit", () => {
      editing = index;
      byId("edit-text").value = message.content;
      editDialog.returnValue = "";
      editDialog.showModal();
    });
    element.append(actions);
    return element;
  }
  const heading = node("div", state.aiName || "Khat", "message-label");
  if (Object.hasOwn(modelNames, message.model)) {
    heading.append(node("span", modelNames[message.model], "model-label"));
  }
  element.append(heading);
  if (streamed) {
    element.setAttribute("aria-hidden", "true");
    element.append(node("p", message.content));
    return element;
  }
  element.append(markdown(message.content, labels, report, Array.isArray(message.sources) ? message.sources : []));
  if (Array.isArray(message.sources) && message.sources.length) {
    const disclosure = node("details", undefined, "sources");
    disclosure.append(node("summary", labels.sources));
    const list = node("ol");
    for (const source of message.sources) {
      const href = webUrl(source.url);
      if (!href) continue;
      const link = node("a", source.title);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const item = node("li");
      item.append(link);
      list.append(item);
    }
    disclosure.append(list);
    element.append(disclosure);
  }
  if ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window) {
    const read = node("button", labels.read, "read");
    read.type = "button";
    read.setAttribute("aria-pressed", "false");
    read.addEventListener("click", () => speak(message, read));
    actions.append(read);
  }
  if (index === current()?.messages.length - 1 && current()?.messages[index - 1]?.role === "user") {
    messageAction(actions, "regenerate", () => submitChat(current().messages[index - 1].content, index - 1, true));
  }
  element.append(actions);
  return element;
}

function scrollToLatest() {
  timeline.scrollTop = timeline.scrollHeight;
}

function renderMessages() {
  const chat = current();
  byId("welcome").hidden = Boolean(chat?.messages.length);
  stopSpeech();
  document.documentElement.toggleAttribute("data-conversation", Boolean(chat?.messages.length));
  messages.replaceChildren(...(chat?.messages ?? []).map((message, index) => messageElement(message, false, index)));
  scrollToLatest();
}

function updateControls() {
  byId("activity").hidden = !pending;
  byId("voice-room-open").disabled = Boolean(pending);
  byId("composer-image").disabled = Boolean(pending);
  voiceControls();
  timeline.setAttribute("aria-busy", String(Boolean(pending)));
  for (const id of ["mode", "lock", "studio-open", "temporary", "admin-open"]) byId(id).disabled = Boolean(pending);
  send.disabled = !prompt.value.trim() || loadingFiles;
  send.hidden = Boolean(pending);
  stop.hidden = !pending;
  prompt.disabled = Boolean(pending);
  byId("language").disabled = Boolean(pending);
  byId("settings").disabled = Boolean(pending);
  byId("search").disabled = Boolean(pending);
  byId("attach").disabled = Boolean(pending) || loadingFiles;
  byId("voice").disabled = !Recognition || Boolean(pending);
}

function renderLanguage() {
  labels = translations[state.language];
  document.documentElement.lang = state.language;
  document.querySelectorAll("[data-label]").forEach(element => {
    element.textContent = labels[element.dataset.label];
  });
  for (const id of ["language", "profile-language", "account-language"]) {
    const language = byId(id);
    language.textContent = state.language === "da" ? "EN" : "DA";
    language.setAttribute("aria-label", labels.switchLanguage);
  }
  byId("lock").setAttribute("aria-label", vault?.account ? labels.signOut : labels.lock);
  accountForm();
  if (vault?.account) preferences.querySelector("[data-label=privacy]").textContent = labels.accountPrivacy;
  byId("history-search").placeholder = labels.searchHistory;
  appearance();
  byId("sidebar").setAttribute("aria-label", labels.history);
  timeline.setAttribute("aria-label", labels.conversation);
  byId("files").setAttribute("aria-label", labels.attachments);
  send.setAttribute("aria-label", labels.send);
  stop.setAttribute("aria-label", labels.stop);
  byId("voice").title = Recognition ? labels.voice : labels.voiceUnsupported;
  prompt.placeholder = `${labels.prompt}…`;
  renderFiles();
  renderHistory();
  renderMessages();
  renderUsage();
  report(notice);
}

function openChat(id) {
  cancelCapture?.();
  temporary = undefined;
  byId("temporary").setAttribute("aria-pressed", "false");
  state.active = id;
  prompt.value = "";
  fitPrompt();
  files = [];
  renderFiles();
  renderHistory();
  renderMessages();
  animate(timeline, [{ opacity: .65, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], 180);
  closeMenu();
  report();
  persist();
  updateControls();
  if (window.matchMedia("(pointer: fine)").matches) prompt.focus();
}

systemDark.addEventListener("change", () => appearance(preferences.open ? previewVisual() : state));
byId("collapse").addEventListener("click", () => {
  state.collapsed = !state.collapsed;
  appearance();
  persist();
});
byId("mode").addEventListener("change", event => {
  state.mode = event.currentTarget.value;
  persist();
});
byId("history-search").addEventListener("input", renderHistory);
byId("archives").addEventListener("click", event => {
  archives = !archives;
  event.currentTarget.setAttribute("aria-pressed", String(archives));
  renderHistory();
});
conversationOptions.addEventListener("close", () => {
  const entry = state.chats.find(chat => chat.id === optionsId);
  if (!entry) return;
  if (conversationOptions.returnValue === "delete") {
    deleting = optionsId;
    confirmDelete.returnValue = "";
    confirmDelete.showModal();
  } else if (conversationOptions.returnValue === "archive") {
    entry.archived = !entry.archived;
    if (entry.id === state.active) openChat(null);
    else { persist(); renderHistory(); }
  } else if (conversationOptions.returnValue === "rename") {
    entry.title = byId("conversation-name").value.trim() || entry.title;
    persist();
    renderHistory();
  }
});
editDialog.addEventListener("close", () => {
  if (editDialog.returnValue === "send") submitChat(byId("edit-text").value.trim(), editing);
});
byId("temporary").addEventListener("click", () => {
  const next = !temporary;
  openChat(null);
  if (next) temporary = { id: crypto.randomUUID(), title: labels.temporary, messages: [] };
  byId("temporary").setAttribute("aria-pressed", String(next));
  renderHistory();
  report(next ? "temporaryNotice" : "");
});
byId("new").addEventListener("click", () => openChat(null));
byId("menu").addEventListener("click", () => {
  const open = byId("sidebar").classList.toggle("open");
  byId("menu").setAttribute("aria-expanded", String(open));
});
byId("language").addEventListener("click", () => {
  cancelCapture?.();
  state.language = state.language === "da" ? "en" : "da";
  persist();
  renderLanguage();
});
function renderMemoryDraft() {
  const entries = byId("memory-entries");
  entries.replaceChildren();
  memoryDraft.forEach((entry, index) => {
    const label = node("label", `${labels.memory} ${index + 1}`);
    const input = node("textarea");
    input.maxLength = 500;
    input.rows = 2;
    input.value = entry.content;
    input.addEventListener("input", () => { entry.content = input.value; entry.source = "manual"; });
    label.append(input);
    const remove = node("button", labels.delete);
    remove.type = "button";
    remove.addEventListener("click", () => {
      memoryDraft = memoryDraft.filter(item => item !== entry);
      renderMemoryDraft();
    });
    entries.append(label, remove);
  });
  byId("add-memory").disabled = memoryDraft.length >= 40;
}
byId("add-memory").addEventListener("click", () => {
  if (memoryDraft.length >= 40) return;
  memoryDraft.push({ id: crypto.randomUUID(), content: "", source: "manual" });
  renderMemoryDraft();
  [...byId("memory-entries").querySelectorAll("textarea")].at(-1)?.focus();
});
byId("settings").addEventListener("click", () => {
  for (const [key, id] of Object.entries(settingIds)) byId(id).value = state[key];
  byId("memory-enabled").checked = state.memoryEnabled;
  byId("motion-enabled").checked = state.motionEnabled;
  for (const [key, id] of Object.entries(ranges)) byId(id).value = state[key];
  byId("ambience").checked = state.ambience;
  avatarDraft = state.avatar;
  byId("avatar-file").value = "";
  memoryDraft = state.memories.map(entry => ({ ...entry }));
  renderMemoryDraft();
  byId("custom-color").hidden = state.accent !== "custom";
  preferences.returnValue = "";
  preferences.showModal();
});
byId("remove-avatar").addEventListener("click", () => {
  avatarDraft = "";
  byId("avatar-file").value = "";
});
byId("accent").addEventListener("change", event => {
  byId("custom-color").hidden = event.currentTarget.value !== "custom";
});
byId("clear-memory").addEventListener("click", () => { byId("memory").value = ""; });
function previewVisual() {
  const values = { ...state };
  for (const key of Object.keys(visualDefaults)) {
    const id = settingIds[key] ?? ranges[key];
    if (id) values[key] = ranges[key] ? Number(byId(id).value) : byId(id).value;
  }
  values.motionEnabled = byId("motion-enabled").checked;
  values.ambience = byId("ambience").checked;
  return values;
}
preferences.addEventListener("input", event => {
  const controls = [...Object.keys(visualDefaults).map(key => settingIds[key] ?? ranges[key]), "motion-enabled", "ambience"];
  if (controls.includes(event.target.id)) appearance(previewVisual());
});
byId("reset-visual").addEventListener("click", () => {
  for (const [key, value] of Object.entries(visualDefaults)) {
    const id = settingIds[key] ?? ranges[key];
    if (id) byId(id).value = value;
  }
  byId("motion-enabled").checked = visualDefaults.motionEnabled;
  byId("ambience").checked = visualDefaults.ambience;
  byId("custom-color").hidden = true;
  appearance(previewVisual());
});
preferences.addEventListener("close", async () => {
  appearance();
  if (preferences.returnValue === "deleteAccount") {
    byId("removal-status").textContent = "";
    byId("account-removal").showModal();
    return;
  }
  if (preferences.returnValue === "import") {
    await openImport().catch(() => report("profileUnavailable"));
    return;
  }
  if (preferences.returnValue !== "save") return;
  const selected = byId("avatar-file").files[0];
  const session = vault;
  const values = Object.fromEntries(Object.entries(settingIds).map(([key, id]) => [key, byId(id).value.trim()]));
  const memoryEnabled = byId("memory-enabled").checked;
  const visual = previewVisual();
  const visualValues = Object.fromEntries(Object.keys(visualDefaults).map(key => [key, visual[key]]));
  const memories = memoryDraft.filter(entry => entry.content.trim()).map(entry => ({ ...entry, content: entry.content.trim() }));
  let avatar = avatarDraft ?? "";
  if (selected) {
    try { avatar = await avatarImage(selected); }
    catch { report("invalidAvatar"); return; }
    finally { byId("avatar-file").value = ""; }
  }
  if (vault !== session) return;
  state = { ...state, ...values, ...visualValues, memoryEnabled, avatar, memories };
  refreshIdentity();
  appearance();
  renderMessages();
  report("saved");
  persist();
});
confirmDelete.addEventListener("close", () => {
  if (confirmDelete.returnValue !== "delete") return;
  state.chats = state.chats.filter(chat => chat.id !== deleting);
  if (state.active === deleting) openChat(null);
  else {
    renderHistory();
    persist();
    byId("new").focus();
  }
});

document.querySelectorAll("[data-prompt]").forEach(button => {
  button.addEventListener("click", () => {
    prompt.value = labels.prompts[button.dataset.prompt];
    updateControls();
    prompt.focus();
  });
});
byId("search").addEventListener("click", event => {
  search = !search;
  event.currentTarget.setAttribute("aria-pressed", String(search));
});
byId("attach").addEventListener("click", () => byId("upload").click());
byId("upload").addEventListener("change", async event => {
  const input = event.currentTarget;
  const selected = [...input.files];
  input.value = "";
  if (!selected.length) return;
  if (files.length + selected.length > 3) return report("invalidFile");
  loadingFiles = true;
  updateControls();
  const originalFiles = files;
  try {
    const isImage = file => /\.(?:jpe?g|png|webp)$/i.test(file.name);
    if (files.filter(file => file.vision).length + selected.filter(isImage).length > 1) throw new Error("invalidFile");
    const additions = await Promise.all(selected.map(async file => {
      if (isImage(file) && file.name.length <= 160) return { name: file.name, vision: await prepareVision(file) };
      if (file.size > 48000 || file.name.length > 160 || !input.accept.split(",").some(ext => file.name.toLowerCase().endsWith(ext))) {
        throw new Error("invalidFile");
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (text.length > 12000 || text.includes("\0")) throw new Error("invalidFile");
      return { name: file.name, text };
    }));
    if (originalFiles === files) {
      files = [...files, ...additions];
      renderFiles();
      report(additions.some(file => file.vision) ? "visionAttached" : "");
    }
  } catch {
    report("invalidFile");
  } finally {
    loadingFiles = false;
    updateControls();
  }
});

function listen(button, conversation = false) {
  if (recording) return recording.stop();
  if (!Recognition || pending) return report("voiceUnsupported");
  const session = new Recognition();
  let transcript = "";
  let cancelled = false;
  recording = session;
  cancelCapture = () => {
    cancelled = true;
    session.abort();
  };
  session.lang = state.language === "da" ? "da-DK" : "en-US";
  const finish = () => {
    if (recording !== session) return;
    recording = null;
    cancelCapture = undefined;
    motionState({ listening: false });
    endMeter();
    button.setAttribute("aria-pressed", "false");
    if (["listening", "voiceStarting"].includes(notice)) report();
    updateControls();
    if (conversation && !cancelled && voiceRoom.open && transcript.trim()) {
      voiceReply = true;
      submitChat(transcript.trim()).finally(() => { voiceReply = false; });
    }
  };
  session.onstart = () => {
    if (recording !== session) return;
    motionState({ listening: true });
    button.setAttribute("aria-pressed", "true");
    report("listening");
    startMeter();
  };
  session.onresult = result => {
    if (recording !== session || pending) return;
    const text = result.results[result.resultIndex][0].transcript;
    if (conversation) transcript = `${transcript} ${text}`.slice(0, 8000);
    else {
      prompt.value = `${prompt.value.trim()} ${text}`.trim().slice(0, prompt.maxLength);
      fitPrompt();
      updateControls();
    }
  };
  session.onend = finish;
  session.onerror = event => {
    if (recording !== session) return;
    cancelled = true;
    finish();
    if (event.error !== "aborted") report("voiceFailed");
  };
  try {
    session.start();
    report("voiceStarting");
    updateControls();
  } catch {
    cancelled = true;
    finish();
    report("voiceFailed");
  }
}
byId("voice").addEventListener("click", event => listen(event.currentTarget));
byId("voice-room-open").addEventListener("click", () => {
  stopSpeech();
  cancelCapture?.();
  voiceRoom.showModal();
  report();
});
byId("voice-listen").addEventListener("click", event => listen(event.currentTarget, true));
byId("voice-mute").addEventListener("click", () => { cancelCapture?.(); endMeter(); });
byId("voice-room-close").addEventListener("click", () => voiceRoom.close());
byId("voice-room-stop").addEventListener("click", () => {
  cancelCapture?.();
  pending?.abort();
  stopSpeech();
});
byId("voice-size").addEventListener("click", event => {
  const expanded = voiceRoom.classList.toggle("expanded");
  event.currentTarget.setAttribute("aria-pressed", String(expanded));
  event.currentTarget.textContent = labels[expanded ? "compactVoice" : "expandVoice"];
});
window.addEventListener("pagehide", () => {
  cancelCapture?.();
  stopSpeech();
});
document.addEventListener("visibilitychange", () => { if (document.hidden) cancelCapture?.(); });
voiceRoom.addEventListener("close", () => {
  voiceReply = false;
  cancelCapture?.();
  endMeter();
  pending?.abort();
  stopSpeech();
});

function fitPrompt() {
  prompt.style.height = "auto";
  prompt.style.height = `${Math.min(170, Math.max(56, prompt.scrollHeight))}px`;
}

prompt.addEventListener("input", () => { fitPrompt(); updateControls(); });
prompt.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && window.matchMedia("(pointer: fine)").matches) {
    event.preventDefault();
    if (!send.disabled) byId("composer").requestSubmit();
  }
});
stop.addEventListener("click", () => pending?.abort());

function modelHistory(entries, limit) {
  const result = [];
  for (const { role, content } of entries.slice(-20).reverse()) {
    if (!content.trim()) continue;
    const excerpt = content.slice(0, 8000);
    if (excerpt.length > limit) break;
    limit -= excerpt.length;
    result.unshift({ role, content: excerpt });
  }
  return result;
}

byId("composer").addEventListener("submit", event => {
  event.preventDefault();
  const content = prompt.value.trim();
  const imageRequest = /^(?:please\s+)?(?:generate|create|draw|paint|make|generér|generer|lav|tegn|skab)\s+(?:me\s+)?(?:an?\s+|et\s+|en\s+)?(?:image|picture|illustration|painting|billede|tegning)(?:\s+(?:of|af|med))?\s*[:—-]?\s+(.+)$/i.exec(content);
  if (imageRequest && !files.length) {
    studio.open(imageRequest[1], Boolean(temporary));
    return;
  }
  submitChat(content);
});

async function submitChat(content, replaceFrom = -1, regenerate = false) {
  if (!content || pending || loadingFiles || syncing) return;
  cancelCapture?.();
  const controller = new AbortController();
  pending = controller;
  const attachments = replaceFrom < 0 ? files : [];
  const vision = attachments.find(file => file.vision)?.vision;
  const textFiles = attachments.filter(file => !file.vision);
  const previous = current();
  const chat = previous ?? { id: crypto.randomUUID(), title: content.replace(/\s+/g, " ").slice(0, 64), messages: [] };
  if (!previous) state.chats.unshift(chat);
  state.active = chat.id;
  const previousMessages = chat.messages.slice();
  if (replaceFrom >= 0) chat.messages.length = replaceFrom;
  chat.messages.push(regenerate ? previousMessages[replaceFrom] : {
    role: "user", content, files: attachments.map(file => file.name),
  });
  if (replaceFrom < 0) {
    prompt.value = "";
    files = [];
  }
  renderFiles();
  renderHistory();
  renderMessages();
  updateControls();
  report("thinking");
  motionState({ thinking: true });
  const draft = messageElement({ role: "assistant", content: "" }, true);
  messages.append(draft);
  let partial = "";
  let paint = 0;
  let sources = [];
  let model;
  let answer;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...accountHeaders() },
      signal: controller.signal,
      body: JSON.stringify({
        messages: modelHistory(chat.messages, 48000 - textFiles.reduce((sum, file) => sum + file.text.length, 0)),
        personality: state.personality, memory: state.memoryEnabled ? state.memory : "",
        aiName: state.aiName, instructions: state.instructions, style: state.style, length: state.length,
        language: state.language, mode: state.mode, files: textFiles, ...(vision && { vision }), search, temporary: Boolean(temporary),
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error ?? "modelFailed");
    if (!response.body) throw new Error("modelFailed");
    model = response.headers.get("x-khat-model");
    sources = JSON.parse(decodeURIComponent(response.headers.get("x-khat-sources") ?? "%5B%5D"));
    let started = false;
    const reply = await readReply(response.body, text => {
      if (!started) {
        started = true;
        motionState({ thinking: false, responding: true });
        animate(draft, [{ opacity: .58 }, { opacity: 1 }], 200);
      }
      tokenLight(text.length - partial.length);
      partial = text;
      if (!paint) paint = requestAnimationFrame(() => {
        paint = 0;
        const follow = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 95;
        draft.lastElementChild.textContent = partial;
        if (follow) scrollToLatest();
      });
    });
    answer = { role: "assistant", content: reply, sources, model, language: state.language };
    chat.messages.push(answer);
    const learned = decodeURIComponent(response.headers.get("x-khat-memory") ?? "");
    if (vault?.account && !temporary && state.memoryEnabled && learned && state.memories.length < 40 &&
      !state.memories.some(entry => entry.content === learned)) {
      state.memories.push({ id: crypto.randomUUID(), content: learned, source: "explicit" });
    }
    report(response.headers.get("x-khat-fallback") === "true" ? "fallback" : "");
  } catch (error) {
    if (controller.signal.aborted && partial.trim()) {
      chat.messages.push({ role: "assistant", content: partial, sources, model, language: state.language });
    } else {
      chat.messages = previousMessages;
      if (replaceFrom < 0) {
        prompt.value = content;
        files = attachments;
      }
      if (!previous) {
        state.chats = state.chats.filter(entry => entry !== chat);
        state.active = null;
      }
    }
    if (!controller.signal.aborted) softError();
    report(controller.signal.aborted ? "stopped" : Object.hasOwn(labels, error.message) ? error.message : "modelFailed");
  } finally {
    if (paint) cancelAnimationFrame(paint);
    pending = null;
    motionState({ thinking: false, responding: false });
    if (!temporary) persist();
    renderHistory();
    renderMessages();
    renderFiles();
    updateControls();
    fitPrompt();
    if (voiceRoom.open && voiceReply && answer) speak(answer);
    else if (!voiceRoom.open && window.matchMedia("(pointer: fine)").matches) prompt.focus();
    refreshUsage();
  }
}

const studio = setupStudio({ state: () => state, labels: () => labels, persist, report, vault: () => vault, onUsage: refreshUsage });
setupAdmin(() => labels);
mountGlass();
motionState({});
renderLanguage();
updateControls();
initialize();
