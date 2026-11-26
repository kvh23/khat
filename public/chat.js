import { translations } from "./i18n.js";
import { markdown, node, webUrl } from "./markdown.js";
import { readReply } from "./stream.js";
import { canImportLegacy, createProfile, profiles, unlock } from "./vault.js";
import { setupStudio } from "./studio.js";

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
const defaults = () => ({
  language: deviceLanguage,
  personality: "", memory: "", memoryEnabled: false, aiName: "", instructions: "",
  length: "balanced", style: "balanced", theme: "auto", accent: "ink", customAccent: "#526c83",
  mode: "auto", collapsed: false, chats: [], active: null, images: [],
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
};
const modelNames = { instant: "Khat Instant", think: "Khat Think", pro: "Khat Pro", legacy: "Llama 3.3 70B" };
let state = defaults();
let labels = translations[state.language];
let vault;
let archives = false;
let optionsId;
let editing;
let pending;
let recording;
let speaking;
let deleting;
let files = [];
let search = false;
let loadingFiles = false;
let notice = "";

function report(key = "") {
  notice = key;
  status.textContent = labels[key] ?? "";
}

async function persist() {
  if (!vault) return false;
  try {
    await vault.save(state);
    return true;
  } catch {
    report("storageFailed");
    return false;
  }
}

function appearance() {
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.dataset.effectiveTheme = state.theme === "auto" ? (systemDark.matches ? "dark" : "light") : state.theme;
  root.dataset.accent = state.accent;
  const hex = /^#[0-9a-f]{6}$/i.test(state.customAccent) ? state.customAccent : "#526c83";
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

function enterProfile(session) {
  vault = session;
  state = { ...defaults(), ...session.data };
  if (!Object.hasOwn(translations, state.language)) state.language = deviceLanguage;
  byId("profile-name").textContent = session.name;
  byId("mode").value = state.mode;
  byId("history-search").value = "";
  byId("archives").setAttribute("aria-pressed", "false");
  byId("search").setAttribute("aria-pressed", "false");
  archives = search = false;
  report();
  shell.hidden = false;
  profileDialog.close();
  renderLanguage();
  updateControls();
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
byId("lock").addEventListener("click", async () => {
  if (!vault || pending || byId("lock").disabled) return;
  byId("lock").disabled = true;
  try {
    await vault.flush();
  } catch {
    report("storageFailed");
    return;
  } finally {
    byId("lock").disabled = false;
  }
  recording?.abort();
  stopSpeech();
  vault.release();
  vault = undefined;
  state = { ...defaults(), language: state.language };
  prompt.value = "";
  files = [];
  renderLanguage();
  await showProfiles();
});

function current() {
  return state.chats.find(chat => chat.id === state.active);
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
  button.textContent = labels.read;
  button.setAttribute("aria-pressed", "false");
}

function speak(message, button) {
  const wasSpeaking = speaking?.button === button;
  stopSpeech();
  if (wasSpeaking) return;
  const utterance = new SpeechSynthesisUtterance(message.content);
  utterance.lang = message.language === "da" ? "da-DK" : "en-US";
  speaking = { button, utterance };
  button.textContent = labels.stopReading;
  button.setAttribute("aria-pressed", "true");
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
  element.append(markdown(message.content, labels, report));
  if (message.sources?.length) {
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
  messages.replaceChildren(...(chat?.messages ?? []).map((message, index) => messageElement(message, false, index)));
  scrollToLatest();
}

function updateControls() {
  byId("activity").hidden = !pending;
  for (const id of ["mode", "lock", "studio-open"]) byId(id).disabled = Boolean(pending);
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
  for (const id of ["language", "profile-language"]) {
    const language = byId(id);
    language.textContent = state.language === "da" ? "EN" : "DA";
    language.setAttribute("aria-label", labels.switchLanguage);
  }
  byId("lock").setAttribute("aria-label", labels.lock);
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
  report(notice);
}

function openChat(id) {
  recording?.abort();
  state.active = id;
  prompt.value = "";
  files = [];
  renderFiles();
  renderHistory();
  renderMessages();
  closeMenu();
  report();
  persist();
  updateControls();
  if (window.matchMedia("(pointer: fine)").matches) prompt.focus();
}

systemDark.addEventListener("change", appearance);
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
byId("new").addEventListener("click", () => openChat(null));
byId("menu").addEventListener("click", () => {
  const open = byId("sidebar").classList.toggle("open");
  byId("menu").setAttribute("aria-expanded", String(open));
});
byId("language").addEventListener("click", () => {
  recording?.abort();
  state.language = state.language === "da" ? "en" : "da";
  persist();
  renderLanguage();
});
byId("settings").addEventListener("click", () => {
  for (const [key, id] of Object.entries(settingIds)) byId(id).value = state[key];
  byId("memory-enabled").checked = state.memoryEnabled;
  byId("custom-color").hidden = state.accent !== "custom";
  preferences.returnValue = "";
  preferences.showModal();
});
byId("accent").addEventListener("change", event => {
  byId("custom-color").hidden = event.currentTarget.value !== "custom";
});
byId("clear-memory").addEventListener("click", () => { byId("memory").value = ""; });
preferences.addEventListener("close", () => {
  if (preferences.returnValue !== "save") return;
  for (const [key, id] of Object.entries(settingIds)) state[key] = byId(id).value.trim();
  state.memoryEnabled = byId("memory-enabled").checked;
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
    const additions = await Promise.all(selected.map(async file => {
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
      report();
    }
  } catch {
    report("invalidFile");
  } finally {
    loadingFiles = false;
    updateControls();
  }
});

byId("voice").addEventListener("click", event => {
  if (recording) return recording.stop();
  const button = event.currentTarget;
  const session = new Recognition();
  recording = session;
  session.lang = state.language === "da" ? "da-DK" : "en-US";
  const finish = () => {
    if (recording !== session) return;
    recording = null;
    button.setAttribute("aria-pressed", "false");
    if (notice === "listening") report();
  };
  session.onresult = result => {
    if (recording !== session || pending) return;
    const text = result.results[result.resultIndex][0].transcript;
    prompt.value = `${prompt.value.trim()} ${text}`.trim().slice(0, prompt.maxLength);
    updateControls();
  };
  session.onend = finish;
  session.onerror = event => {
    if (recording !== session) return;
    finish();
    if (event.error !== "aborted") report("voiceFailed");
  };
  try {
    session.start();
    button.setAttribute("aria-pressed", "true");
    report("listening");
  } catch {
    finish();
    report("voiceFailed");
  }
});

prompt.addEventListener("input", updateControls);
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
  submitChat(prompt.value.trim());
});

async function submitChat(content, replaceFrom = -1, regenerate = false) {
  if (!content || pending || loadingFiles) return;
  recording?.abort();
  const controller = new AbortController();
  pending = controller;
  const attachments = replaceFrom < 0 ? files : [];
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
  const draft = messageElement({ role: "assistant", content: "" }, true);
  messages.append(draft);
  let partial = "";
  let sources = [];
  let model;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        messages: modelHistory(chat.messages, 48000 - attachments.reduce((sum, file) => sum + file.text.length, 0)),
        personality: state.personality, memory: state.memoryEnabled ? state.memory : "",
        aiName: state.aiName, instructions: state.instructions, style: state.style, length: state.length,
        language: state.language, mode: state.mode, files: attachments, search,
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error ?? "modelFailed");
    if (!response.body) throw new Error("modelFailed");
    model = response.headers.get("x-khat-model");
    sources = JSON.parse(decodeURIComponent(response.headers.get("x-khat-sources") ?? "%5B%5D"));
    const reply = await readReply(response.body, text => {
      const follow = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 95;
      partial = text;
      draft.lastElementChild.textContent = text;
      if (follow) scrollToLatest();
    });
    chat.messages.push({ role: "assistant", content: reply, sources, model, language: state.language });
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
    report(controller.signal.aborted ? "stopped" : Object.hasOwn(labels, error.message) ? error.message : "modelFailed");
  } finally {
    pending = null;
    persist();
    renderHistory();
    renderMessages();
    renderFiles();
    updateControls();
    if (window.matchMedia("(pointer: fine)").matches) prompt.focus();
  }
}

setupStudio({ state: () => state, labels: () => labels, persist, report });
renderLanguage();
updateControls();
showProfiles();
