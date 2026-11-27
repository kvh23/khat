import { welcomeCopy } from "./welcome.js";
import { resolveLanguage, conversationLanguage, translations } from "./i18n.js";
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
const modelButton = byId("mode");
const modelOptions = byId("model-options");
const confirmDelete = byId("confirm");
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const deviceLanguage = () => resolveLanguage("auto", navigator.language);
const visualDefaults = {
  theme: "auto", accent: "ink", customAccent: "#526c83", orbOne: "#c7d8ff", orbTwo: "#7763cc",
  orbStyle: "fluid", motionEnabled: true, motionIntensity: 65, ambience: true,
  glassOpacity: 77, glassBlur: 17, orbGlow: 62, orbSpeed: 80, orbDetail: 75, orbSize: 100,
  textSize: 16, density: "comfortable", rail: "glass",
};
const ranges = { glassOpacity: "glass-opacity", glassBlur: "glass-blur",
  textSize: "text-size", motionIntensity: "motion-intensity" };
const defaults = () => ({
  ...visualDefaults,
  language: "auto",
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
  theme: "theme", accent: "accent", customAccent: "custom-accent", language: "preferred-language", length: "response-length",
  style: "response-style", instructions: "instructions", memory: "memory",
  displayName: "display-name", orbStyle: "orb-style", orbOne: "orb-one", orbTwo: "orb-two", rail: "rail",
};
const appearanceControls = new Map(Object.keys(visualDefaults).map(key => {
  const control = byId(settingIds[key] ?? ranges[key] ?? (key === "motionEnabled" ? "motion-enabled" : key));
  return [control, key];
}).filter(([control]) => control));
const settingsOrb = preferences.querySelector(".personal-preview");
const previewObserver = new IntersectionObserver(([entry]) => {
  settingsOrb.toggleAttribute("data-visible", preferences.open && entry.isIntersecting);
}, { root: preferences.querySelector(".preferences-content") });
let previewFrame = 0;
let appliedVisual;
const modelNames = { instant: "Khat Instant", think: "Khat Think", pro: "Khat Pro", legacy: "Llama 3.3 70B", instantClassic: "Llama 3.1 8B", thinkClassic: "Qwen3 30B" };
let state = defaults();
let uiLanguage = deviceLanguage();
let labels = translations[uiLanguage];
let vault;
let accountsMode = false;
let registering = false;
let temporary;
let savingSettings = false;
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
  const warning = byId("quota-warning");
  warning.hidden = true;
  const studioUsage = byId("studio-allowance");
  target.hidden = studioUsage.hidden = !dailyUsage;
  if (!dailyUsage) return;
  const { text = 0, image = 0, textLimit, imageLimit, estimatedNeurons, budget } = dailyUsage;
  target.textContent = `${labels.dailyUsage} · ${labels.remaining}: ${labels.textLimit} ${Math.max(0, textLimit - text)}/${textLimit} · ${labels.imageLimit} ${Math.max(0, imageLimit - image)}/${imageLimit} · ${labels.estimatedUsage} ${estimatedNeurons}/${budget}`;
  const near = (textLimit > 0 && text >= textLimit * .8) || (imageLimit > 0 && image >= imageLimit * .8) || estimatedNeurons >= budget * .8;
  target.title = labels.usageHelp;
  studioUsage.textContent = `${labels.dailyUsage} · ${labels.imageLimit} ${image}/${imageLimit} · ${labels.studioStorageLimit}`;
  target.toggleAttribute("data-near", near);
  warning.hidden = !near;
  warning.textContent = near ? labels.nearLimit : "";
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

function applyVisual(visual) {
  const previous = appliedVisual;
  glassPreferences(visual, previous);
  if (["motionEnabled", "motionIntensity", "orbStyle", "orbOne", "orbTwo"].some(key => visual[key] !== previous?.[key])) {
    motionPreferences(visual, previous);
  }
  const root = document.documentElement;
  if (visual.theme !== previous?.theme) root.dataset.theme = visual.theme;
  const effective = visual.theme === "auto" ? (systemDark.matches ? "dark" : "light") : visual.theme;
  if (root.dataset.effectiveTheme !== effective) root.dataset.effectiveTheme = effective;
  if (visual.accent !== previous?.accent) root.dataset.accent = visual.accent;
  if (visual.customAccent !== previous?.customAccent) {
    const hex = /^#[0-9a-f]{6}$/i.test(visual.customAccent) ? visual.customAccent : "#526c83";
    const luminance = [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
      const channel = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
      return sum + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    }, 0);
    root.style.setProperty("--custom-accent", hex);
    root.style.setProperty("--on-custom", luminance > 0.179 ? "#000" : "#fff");
  }
  appliedVisual = Object.fromEntries(Object.keys(visualDefaults).map(key => [key, visual[key]]));
}

function labelIcon(id, label) {
  const button = byId(id);
  button.title = label;
  button.setAttribute("aria-label", label);
}

function appearance() {
  applyVisual(preferences.open ? previewVisual() : state);
  shell.classList.toggle("collapsed", state.collapsed);
  byId("collapse").setAttribute("aria-expanded", String(!state.collapsed));
  labelIcon("collapse", state.collapsed ? labels.expand : labels.collapse);
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
  if (!["auto", "da", "en"].includes(state.language)) state.language = "auto";
  temporary = undefined;
  refreshIdentity();
  byId("account-preferences").hidden = byId("account-memories").hidden = !session.account;
  preferences.querySelector('[data-section="account-preferences"]').hidden = !session.account;
  byId("local-memory").hidden = Boolean(session.account);

  byId("temporary").hidden = !session.account;
  byId("temporary").setAttribute("aria-pressed", "false");
  byId("admin-open").hidden = session.account?.role !== "admin";
  renderModel();
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
  if (session.account && !state.displayName?.trim()) byId("name-onboarding").showModal();
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
  state.language = uiLanguage === "da" ? "en" : "da";
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
  byId("registration-name-field").hidden = !registering;
  byId("registration-name").disabled = !registering;
  byId("registration-name").required = registering;
}

async function openAccount(account) {
  setAccountScope(account);
  const workspace = await api("/api/workspace");
  enterProfile(accountVault(account, workspace));
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
  state.language = uiLanguage === "da" ? "en" : "da";
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

const onboarding = byId("name-onboarding");
onboarding.addEventListener("cancel", event => event.preventDefault());
byId("name-onboarding-form").addEventListener("submit", async event => {
  event.preventDefault();
  const name = byId("onboarding-name").value.trim();
  const status = byId("onboarding-status");
  if (!name || /[\p{Cc}]/u.test(name)) {
    status.textContent = labels.displayNameInvalid;
    return;
  }
  const button = event.currentTarget.querySelector("button");
  if (button.disabled) return;
  button.disabled = true;
  const session = vault;
  try {
    await session.save({ ...state, displayName: name });
    if (vault !== session) return;
    state.displayName = name;
    refreshIdentity();
    renderWelcome();
    onboarding.close();
    status.textContent = "";
    byId("onboarding-name").value = "";
  } catch (error) {
    status.textContent = labels[error.message] || labels.storageFailed;
  } finally {
    button.disabled = false;
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
      renderModel();
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
    const incoming = (local.data.images ?? []).slice().reverse();
    let imageError = false;
    if (incoming.length) {
      try { await studio.loadGallery(); }
      catch { imageError = true; incoming.length = 0; }
    }
    for (const image of incoming) {
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
  labelIcon("menu", labels.expand);
}

let historyRows = [];
function renderHistory() {
  const chat = current();
  const title = chat?.title || labels.newChat;
  const titleLabel = byId("chat-title");
  titleLabel.hidden = Boolean(temporary);
  byId("temporary-note").hidden = !temporary;
  shell.toggleAttribute("data-temporary", Boolean(temporary));
  const temporaryButton = byId("temporary");
  temporaryButton.setAttribute("aria-pressed", String(Boolean(temporary)));
  if (temporary) temporaryButton.setAttribute("aria-describedby", "temporary-note");
  else temporaryButton.removeAttribute("aria-describedby");
  if (titleLabel.textContent !== title) titleLabel.textContent = title;
  const query = byId("history-search").value.trim().toLocaleLowerCase();
  const entries = state.chats.filter(entry => Boolean(entry.archived) === archives &&
    (!query || entry.title.toLocaleLowerCase().includes(query) ||
      entry.messages.some(msg => msg.content.toLocaleLowerCase().includes(query))));
  byId("no-history").hidden = entries.length > 0;
  byId("no-history").textContent = query || archives ? labels.noMatches : labels.noHistory;
  byId("new").disabled = Boolean(pending);
  if (entries.length !== historyRows.length || entries.some((entry, index) => entry !== historyRows[index].entry)) {
    historyRows = entries.map(entry => {
      const item = node("li");
      const select = node("button");
      select.type = "button";
      select.addEventListener("click", () => openChat(entry.id));
      const remove = node("button", "⋯");
      remove.type = "button";
      remove.addEventListener("click", () => {
        optionsId = entry.id;
        byId("conversation-name").value = entry.title;
        byId("archive-conversation").textContent = entry.archived ? labels.restore : labels.archive;
        conversationOptions.returnValue = "";
        conversationOptions.showModal();
      });
      item.append(select, remove);
      return { entry, item, select, remove };
    });
    history.replaceChildren(...historyRows.map(row => row.item));
  }
  for (const { entry, select, remove } of historyRows) {
    if (select.textContent !== entry.title) select.textContent = entry.title;
    select.disabled = remove.disabled = Boolean(pending);
    select.setAttribute("aria-current", String(entry.id === state.active));
    remove.setAttribute("aria-label", `${labels.conversationOptions}: ${entry.title}`);
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
    actionLabel(button, "read");
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
    actionLabel(button, "stopReading");
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

const actionPaths = {
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  edit: '<path d="m4 20 1-5L16 4l4 4L9 19zm10-14 4 4"/>',
  read: '<path d="M4 9h4l5-4v14l-5-4H4zm13-1a6 6 0 0 1 0 8m2-10a9 9 0 0 1 0 12"/>',
  regenerate: '<path d="M20 11a8 8 0 1 0-2 6m2-11v5h-5"/>',
};
function actionLabel(button, key) {
  button.title = labels[key];
  button.setAttribute("aria-label", labels[key]);
}
function messageAction(actions, key, onClick) {
  const button = node("button", undefined, "message-action");
  button.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${actionPaths[key]}</svg>`;
  actionLabel(button, key);
  button.type = "button";
  button.disabled = Boolean(pending);
  button.addEventListener("click", onClick);
  actions.append(button);
  return button;
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
    const bubble = node("div", message.content, "message-bubble");
    if (message.files?.length) bubble.append(node("div", message.files.join(" · "), "message-label"));
    element.append(bubble);
    messageAction(actions, "edit", () => {
      editing = index;
      byId("edit-text").value = message.content;
      editDialog.returnValue = "";
      editDialog.showModal();
    });
    element.append(actions);
    return element;
  }
  const heading = node("div", "Khat", "message-label");
  if (Object.hasOwn(modelNames, message.model)) {
    heading.append(node("span", modelNames[message.model].replace(/^Khat /, ""), "model-label"));
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
      const href = webUrl(source?.url);
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
    const read = messageAction(actions, "read", () => speak(message, read));
    read.classList.add("read");
    read.setAttribute("aria-pressed", "false");
  }
  if (index >= 1 && current()?.messages[index - 1]?.role === "user") {
    const regenerate = messageAction(actions, "regenerate", () => submitChat(current().messages[index - 1].content, index - 1, true));
    regenerate.classList.add("regenerate");
    regenerate.hidden = index !== current().messages.length - 1;
  }
  element.append(actions);
  return element;
}

function scrollToLatest() {
  timeline.scrollTop = timeline.scrollHeight;
}

let rendered = [];
let renderOwner;
let renderLanguageId;
let atBottom = true;

timeline.addEventListener("scroll", () => {
  atBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 95;
}, { passive: true });

function renderMessages(follow = true) {
  const chat = current();
  const turns = chat?.messages ?? [];
  byId("welcome").hidden = Boolean(turns.length);
  document.documentElement.toggleAttribute("data-conversation", Boolean(turns.length));
  let prefix = 0;
  if (renderOwner === chat && renderLanguageId === uiLanguage) {
    while (prefix < turns.length && turns[prefix] === rendered[prefix]) prefix++;
  }
  if (messages.children.length > prefix) {
    stopSpeech();
    while (messages.children.length > prefix) messages.lastElementChild.remove();
  }
  const next = document.createDocumentFragment();
  for (let index = prefix; index < turns.length; index++) next.append(messageElement(turns[index], false, index));
  messages.append(next);
  if (prefix !== rendered.length || prefix !== turns.length) {
    const oldLast = messages.children[Math.max(0, prefix - 1)]?.querySelector(".regenerate");
    if (oldLast) oldLast.hidden = prefix !== turns.length;
    const button = messages.lastElementChild?.querySelector(".regenerate");
    if (button) button.hidden = false;
  }
  for (const button of messages.querySelectorAll(".message-actions button")) button.disabled = Boolean(pending);
  renderOwner = chat;
  renderLanguageId = uiLanguage;
  rendered = turns.slice();
  if (follow) {
    atBottom = true;
    scrollToLatest();
  }
}

function updateControls() {
  byId("activity").hidden = !pending;
  byId("voice-room-open").disabled = Boolean(pending);
  byId("composer-image").disabled = Boolean(pending);
  voiceControls();
  timeline.setAttribute("aria-busy", String(Boolean(pending)));
  for (const id of ["mode", "lock", "studio-open", "temporary", "admin-open"]) byId(id).disabled = Boolean(pending);
  send.disabled = !prompt.value.trim() || loadingFiles || savingSettings;
  send.hidden = Boolean(pending);
  stop.hidden = !pending;
  prompt.disabled = Boolean(pending);
  byId("language").disabled = Boolean(pending);
  byId("settings").disabled = Boolean(pending) || savingSettings;
  byId("search").disabled = Boolean(pending);
  byId("attach").disabled = Boolean(pending) || loadingFiles;
  byId("voice").disabled = !Recognition || Boolean(pending);
}

function renderLanguage() {
  const preference = preferences.open ? byId("preferred-language").value : state.language;
  uiLanguage = resolveLanguage(preference, navigator.language);
  labels = translations[uiLanguage];
  document.documentElement.lang = uiLanguage;
  renderModel();
  labelIcon("preferences-close", labels.close);
  document.querySelectorAll("[data-label]").forEach(element => {
    element.textContent = labels[element.dataset.label] ?? element.textContent;
  });
  for (const id of ["language", "profile-language", "account-language"]) {
    const language = byId(id);
    language.textContent = uiLanguage === "da" ? "EN" : "DA";
    language.setAttribute("aria-label", labels.switchLanguage);
  }
  byId("lock").setAttribute("aria-label", vault?.account ? labels.signOut : labels.lock);
  accountForm();
  if (vault?.account) preferences.querySelector("[data-label=privacy]").textContent = labels.accountPrivacy;
  byId("history-search").placeholder = labels.searchHistory;
  preferences.querySelector("[data-settings-nav]").setAttribute("aria-label", labels.settings);
  byId("invite-code").setAttribute("aria-label", labels.invite);
  if (preferences.open) renderMemoryDraft();
  renderWelcome();
  labelIcon("archives", labels.archive);
  labelIcon("menu", byId("menu").getAttribute("aria-expanded") === "true" ? labels.collapse : labels.expand);
  appearance();
  byId("sidebar").setAttribute("aria-label", labels.history);
  timeline.setAttribute("aria-label", labels.conversation);
  byId("files").setAttribute("aria-label", labels.attachments);
  send.setAttribute("aria-label", labels.send);
  stop.setAttribute("aria-label", labels.stop);
  byId("voice").title = Recognition ? labels.voice : labels.voiceUnsupported;
  byId("image-prompt").placeholder = labels.imagePlaceholder;
  byId("instructions").placeholder = labels.instructionExample;
  prompt.placeholder = `${labels.prompt}…`;
  renderFiles();
  renderHistory();
  renderMessages();
  renderUsage();
  report(notice);
}

function openChat(id, isTemporary = false) {
  cancelCapture?.();
  temporary = isTemporary ? { id: crypto.randomUUID(), messages: [] } : undefined;
  state.active = id;
  if (!id) renderWelcome();
  prompt.value = "";
  fitPrompt();
  files = [];
  renderFiles();
  renderHistory();
  renderMessages();
  animate(timeline, [{ opacity: .65, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], 180);
  closeMenu();
  report();
  if (!vault?.account) persist();
  updateControls();
  if (window.matchMedia("(pointer: fine)").matches) prompt.focus();
}

systemDark.addEventListener("change", appearance);
byId("collapse").addEventListener("click", () => {
  state.collapsed = !state.collapsed;
  appearance();
  persist();
});
function renderModel() {
  const selected = modelOptions.querySelector(`input[value="${state.mode}"]`) ?? modelOptions.querySelector("input");
  selected.checked = true;
  byId("mode-value").textContent = modelNames[selected.value] ?? labels.auto;
  modelButton.setAttribute("aria-label", `${labels.model}: ${byId("mode-value").textContent}`);
}
function setModelMenu(open, restoreFocus = false) {
  modelOptions.hidden = !open;
  modelButton.setAttribute("aria-expanded", String(open));
  if (open) modelOptions.querySelector("input:checked")?.focus();
  else if (restoreFocus) modelButton.focus();
}
modelButton.addEventListener("click", () => setModelMenu(modelOptions.hidden));
modelOptions.addEventListener("change", event => {
  state.mode = event.target.value;
  renderModel();
  persist();
});
modelOptions.addEventListener("click", event => {
  if (event.target.matches("input")) setModelMenu(false, true);
});
modelOptions.addEventListener("keydown", event => {
  if (event.key === "Escape" || event.key === "Enter") {
    event.preventDefault();
    setModelMenu(false, true);
  }
});
modelButton.parentElement.addEventListener("focusout", event => {
  if (!modelButton.parentElement.contains(event.relatedTarget)) setModelMenu(false);
});
document.addEventListener("click", event => {
  if (!modelOptions.hidden && !modelButton.parentElement.contains(event.target)) setModelMenu(false);
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
    else renderHistory();
    persist();
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
  openChat(null, !temporary);
  byId("temporary").focus();
});
byId("new").addEventListener("click", () => openChat(null));
byId("menu").addEventListener("click", () => {
  const open = byId("sidebar").classList.toggle("open");
  byId("menu").setAttribute("aria-expanded", String(open));
  labelIcon("menu", open ? labels.collapse : labels.expand);
});
byId("language").addEventListener("click", () => {
  cancelCapture?.();
  state.language = uiLanguage === "da" ? "en" : "da";
  persist();
  renderLanguage();
});
function renderMemoryDraft() {
  const entries = byId("memory-entries");
  const draft = document.createDocumentFragment();
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
    draft.append(label, remove);
  });
  entries.replaceChildren(draft);
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
  byId("instructions").value = [state.instructions, state.personality].filter(Boolean).join("\n\n");
  byId("settings-status").hidden = true;
  selectSettingsTab(settingsTabs.find(tab => !tab.hidden));
  byId("memory-enabled").checked = state.memoryEnabled;
  byId("motion-enabled").checked = state.motionEnabled;
  for (const [key, id] of Object.entries(ranges)) byId(id).value = state[key];
  byId("ambience").checked = state.ambience;
  refreshSettingsControls();
  avatarDraft = state.avatar;
  byId("avatar-file").value = "";
  refreshAvatarDraft();
  memoryDraft = state.memories.map(entry => ({ ...entry }));
  renderMemoryDraft();
  byId("custom-color").hidden = state.accent !== "custom";
  preferences.returnValue = "";
  document.documentElement.setAttribute("data-settings-open", "");
  preferences.showModal();
  preferences.querySelector(".preferences-content").scrollTop = 0;
  previewObserver.observe(settingsOrb);
});
function refreshAvatarDraft() {
  const file = byId("avatar-file").files[0];
  byId("avatar-filename").textContent = file?.name ?? "";
  byId("remove-avatar").hidden = !avatarDraft && !file;
}
byId("choose-avatar").addEventListener("click", () => byId("avatar-file").click());
byId("avatar-file").addEventListener("change", refreshAvatarDraft);
byId("remove-avatar").addEventListener("click", () => {
  avatarDraft = "";
  byId("avatar-file").value = "";
  refreshAvatarDraft();
});
byId("accent").addEventListener("change", event => {
  byId("custom-color").hidden = event.currentTarget.value !== "custom";
});
for (const id of ["clear-memory", "clear-all-memories"]) {
  byId(id).addEventListener("click", () => {
    if (!window.confirm(labels.confirmClearMemory)) return;
    byId("memory").value = "";
    memoryDraft = [];
    renderMemoryDraft();
  });
}
function previewVisual() {
  return { ...state, ...Object.fromEntries(Array.from(appearanceControls, ([control, key]) => [
    key, control.type === "checkbox" ? control.checked : control.type === "range" ? control.valueAsNumber : control.value,
  ])) };
}

function queueVisualPreview() {
  if (previewFrame) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0;
    if (preferences.open) applyVisual(previewVisual());
  });
}

byId("preferred-language").addEventListener("change", renderLanguage);
const settingsNav = preferences.querySelector("[data-settings-nav]");
const settingsTabs = [...settingsNav.querySelectorAll("[role=tab]")];
const settingsButtons = [...preferences.querySelectorAll("button[type=submit]")];
function selectSettingsTab(selected) {
  for (const tab of settingsTabs) {
    const active = tab === selected;
    tab.tabIndex = active ? 0 : -1;
    tab.setAttribute("aria-selected", String(active));
    byId(tab.dataset.section).hidden = !active;
  }
  preferences.querySelector(".preferences-content").scrollTop = 0;
}
settingsNav.addEventListener("click", event => {
  const tab = event.target.closest("[role=tab]");
  if (tab) selectSettingsTab(tab);
});
settingsNav.addEventListener("keydown", event => {
  const tabs = settingsTabs.filter(tab => !tab.hidden);
  const index = tabs.indexOf(event.target);
  if (index < 0) return;
  const destinations = { ArrowLeft: (index + tabs.length - 1) % tabs.length,
    ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 };
  if (!Object.hasOwn(destinations, event.key)) return;
  event.preventDefault();
  const tab = tabs[destinations[event.key]];
  selectSettingsTab(tab);
  tab.focus();
});
function refreshSettingsControls() {
  byId("glass-controls").hidden = byId("rail").value === "solid";
  for (const output of preferences.querySelectorAll("output")) {
    const id = output.htmlFor[0];
    const unit = id === "glass-blur" || id === "text-size" ? " px" : "%";
    output.value = byId(id).value + unit;
  }
}
preferences.addEventListener("input", event => {
  if (!appearanceControls.has(event.target)) return;
  refreshSettingsControls();
  queueVisualPreview();
});
byId("reset-visual").addEventListener("click", () => {
  for (const [control, key] of appearanceControls) {
    if (control.type === "checkbox") control.checked = visualDefaults[key];
    else control.value = visualDefaults[key];
  }
  byId("custom-color").hidden = true;
  refreshSettingsControls();
  queueVisualPreview();
});
preferences.addEventListener("close", async () => {
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame = 0;
  previewObserver.unobserve(settingsOrb);
  settingsOrb.removeAttribute("data-visible");
  document.documentElement.removeAttribute("data-settings-open");
  if (preferences.returnValue !== "save") renderLanguage();
  if (preferences.returnValue === "deleteAccount") {
    byId("removal-status").textContent = "";
    byId("account-removal").showModal();
    return;
  }
  if (preferences.returnValue === "import") {
    await openImport().catch(() => report("profileUnavailable"));
    return;
  }
});
preferences.addEventListener("cancel", event => {
  if (savingSettings) event.preventDefault();
});
preferences.querySelector("form").addEventListener("submit", async event => {
  if (event.submitter && event.submitter.value !== "save") return;
  event.preventDefault();
  if (savingSettings) return;
  const session = vault;
  const status = byId("settings-status");
  const fail = key => { status.hidden = false; status.textContent = labels[key] ?? labels.storageFailed; };
  const values = Object.fromEntries(Object.entries(settingIds).map(([key, id]) => [key, byId(id).value.trim()]));
  if (session?.account && (!values.displayName || /[\p{Cc}]/u.test(values.displayName))) {
    selectSettingsTab(settingsTabs[0]);
    byId("display-name").focus();
    fail("displayNameInvalid");
    return;
  }
  const visual = previewVisual();
  const next = { ...state, ...values, ...Object.fromEntries(Object.keys(visualDefaults).map(key => [key, visual[key]])),
    personality: "", memoryEnabled: byId("memory-enabled").checked, avatar: avatarDraft ?? "",
    memories: memoryDraft.filter(entry => entry.content.trim()).map(entry => ({ ...entry, content: entry.content.trim() })) };
  const selected = byId("avatar-file").files[0];
  savingSettings = true;
  status.hidden = true;
  for (const button of settingsButtons) button.disabled = true;
  settingsNav.inert = preferences.querySelector(".preferences-content").inert = true;
  updateControls();
  try {
    if (selected) {
      try { next.avatar = await avatarImage(selected); }
      catch { fail("invalidAvatar"); return; }
    }
    await session.save(next);
    if (vault !== session) return;
    state = next;
    refreshIdentity();
    preferences.close("save");
    renderLanguage();
    report("saved");
  } catch (error) {
    fail(error.message);
  } finally {
    savingSettings = false;
    for (const button of settingsButtons) button.disabled = false;
    settingsNav.inert = preferences.querySelector(".preferences-content").inert = false;
    updateControls();
  }
});

confirmDelete.addEventListener("close", () => {
  if (confirmDelete.returnValue !== "delete") return;
  state.chats = state.chats.filter(chat => chat.id !== deleting);
  if (state.active === deleting) openChat(null);
  else {
    renderHistory();
    byId("new").focus();
  }
  persist();
});

function renderWelcome() {
  const { heading, subtitle, suggestions } = welcomeCopy(uiLanguage, temporary ? "" : state.displayName);
  byId("welcome").querySelector("h1").textContent = heading;
  byId("welcome-intro").textContent = subtitle;
  const container = byId("welcome").querySelector(".suggestions");
  container.replaceChildren(...suggestions.map(([label, text]) => {
    const button = node("button", label, "liquid-glass");
    button.type = "button";
    button.addEventListener("click", () => {
      prompt.value = text;
      fitPrompt();
      updateControls();
      prompt.focus();
    });
    return button;
  }));
}
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
  session.lang = uiLanguage === "da" ? "da-DK" : "en-US";
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

const nativePromptSize = CSS.supports("field-sizing", "content");
let promptFitFrame;
function fitPrompt() {
  if (nativePromptSize || promptFitFrame) return;
  promptFitFrame = requestAnimationFrame(() => {
    promptFitFrame = undefined;
    prompt.style.height = "0px";
    prompt.style.height = `${Math.min(170, Math.max(56, prompt.scrollHeight))}px`;
  });
}

prompt.addEventListener("input", () => {
  fitPrompt();
  send.disabled = !prompt.value.trim() || loadingFiles || savingSettings;
});
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
  if (!content || pending || loadingFiles || syncing || savingSettings) return;
  cancelCapture?.();
  stopSpeech();
  const controller = new AbortController();
  pending = controller;
  const attachments = replaceFrom < 0 ? files : [];
  const vision = attachments.find(file => file.vision)?.vision;
  const textFiles = attachments.filter(file => !file.vision);
  const previous = current();
  const chat = previous ?? { id: crypto.randomUUID(), title: content.replace(/\s+/g, " ").slice(0, 64), messages: [] };
  if (!previous) state.chats.unshift(chat);
  if (!temporary) state.active = chat.id;
  const previousMessages = chat.messages.slice();
  const messageLanguage = conversationLanguage(content, replaceFrom < 0 ? previousMessages : previousMessages.slice(0, replaceFrom));
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
        ...(!vault?.account && !temporary && {
          personality: state.personality, memory: state.memoryEnabled ? state.memory : "",
          instructions: state.instructions, style: state.style, length: state.length,
        }),
        language: messageLanguage, mode: state.mode, files: textFiles, ...(vision && { vision }), search, temporary: Boolean(temporary),
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
        draft.lastElementChild.textContent = partial;
        if (atBottom) scrollToLatest();
      });
    }, response.headers.get("x-khat-stream-filtered") === "1");
    answer = { role: "assistant", content: reply, sources, model, language: messageLanguage };
    chat.messages.push(answer);
    const learned = decodeURIComponent(response.headers.get("x-khat-memory") ?? "");
    if (vault?.account && !temporary && state.memoryEnabled && learned && state.memories.length < 40 &&
      !state.memories.some(entry => entry.content === learned)) {
      state.memories.push({ id: crypto.randomUUID(), content: learned, source: "explicit" });
    }
    report(response.headers.get("x-khat-fallback") === "true" ? "fallback" : "");
  } catch (error) {
    if (controller.signal.aborted && partial.trim()) {
      chat.messages.push({ role: "assistant", content: partial, sources, model, language: messageLanguage });
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
    renderMessages(atBottom);
    renderFiles();
    updateControls();
    fitPrompt();
    if (voiceRoom.open && voiceReply && answer) speak(answer);
    else if (!voiceRoom.open && window.matchMedia("(pointer: fine)").matches) prompt.focus();
    refreshUsage();
  }
}

const studio = setupStudio({ state: () => state, labels: () => labels, persist, report, vault: () => vault, onUsage: refreshUsage, isTemporary: () => Boolean(temporary) });
setupAdmin(() => labels, refreshUsage);
mountGlass();
motionState({});
renderLanguage();
updateControls();
initialize();
