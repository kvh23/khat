import { translations } from "./i18n.js";
import { markdown, node, webUrl } from "./markdown.js";
import { readReply } from "./stream.js";

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
const storageKey = "khat.workspace.v1";
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let state = {
  language: navigator.language.toLowerCase().startsWith("da") ? "da" : "en",
  personality: "", memory: "", chats: [], active: null,
};
let storageFailed = false;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && Array.isArray(saved.chats)) {
    const { language, chats, active, personality, memory } = saved;
    state = {
      language: language === "en" || language === "da" ? language : state.language,
      chats, active,
      personality: typeof personality === "string" ? personality : "",
      memory: typeof memory === "string" ? memory : "",
    };
  }
} catch {
  storageFailed = true;
}
let labels = translations[state.language];
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

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    storageFailed = false;
  } catch {
    storageFailed = true;
    report("storageFailed");
  }
}

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
  byId("no-history").hidden = state.chats.length > 0;
  byId("new").disabled = Boolean(pending);
  for (const entry of state.chats) {
    const item = node("li");
    const select = node("button", entry.title);
    select.type = "button";
    select.disabled = Boolean(pending);
    select.setAttribute("aria-current", String(entry.id === state.active));
    select.addEventListener("click", () => openChat(entry.id));
    const remove = node("button", "×");
    remove.type = "button";
    remove.disabled = Boolean(pending);
    remove.setAttribute("aria-label", `${labels.delete}: ${entry.title}`);
    remove.addEventListener("click", () => {
      deleting = entry.id;
      confirmDelete.returnValue = "";
      confirmDelete.showModal();
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

function messageElement(message, streamed = false) {
  const element = node("article", undefined, `message ${message.role}`);
  if (message.role === "user") {
    element.textContent = message.content;
    if (message.files?.length) element.append(node("div", message.files.join(" · "), "message-label"));
    return element;
  }
  element.append(node("div", "Khat", "message-label"));
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
    element.append(read);
  }
  return element;
}

function scrollToLatest() {
  timeline.scrollTop = timeline.scrollHeight;
}

function renderMessages() {
  const chat = current();
  byId("welcome").hidden = Boolean(chat?.messages.length);
  stopSpeech();
  messages.replaceChildren(...(chat?.messages ?? []).map(message => messageElement(message)));
  scrollToLatest();
}

function updateControls() {
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
  const language = byId("language");
  language.textContent = state.language === "da" ? "EN" : "DA";
  language.setAttribute("aria-label", labels.switchLanguage);
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
  byId("personality").value = state.personality;
  byId("memory").value = state.memory;
  preferences.returnValue = "";
  preferences.showModal();
});
preferences.addEventListener("close", () => {
  if (preferences.returnValue !== "save") return;
  state.personality = byId("personality").value.trim();
  state.memory = byId("memory").value.trim();
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

byId("composer").addEventListener("submit", async event => {
  event.preventDefault();
  const content = prompt.value.trim();
  if (!content || pending || loadingFiles) return;
  recording?.abort();
  const controller = new AbortController();
  pending = controller;
  const attachments = files;
  const previous = current();
  const chat = previous ?? { id: crypto.randomUUID(), title: content.replace(/\s+/g, " ").slice(0, 64), messages: [] };
  if (!previous) state.chats.unshift(chat);
  state.active = chat.id;
  chat.messages.push({ role: "user", content, files: attachments.map(file => file.name) });
  prompt.value = "";
  files = [];
  renderFiles();
  renderHistory();
  renderMessages();
  updateControls();
  report("thinking");
  const draft = messageElement({ role: "assistant", content: "" }, true);
  messages.append(draft);
  let partial = "";
  let sources = [];
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        messages: modelHistory(chat.messages, 48000 - attachments.reduce((sum, file) => sum + file.text.length, 0)),
        personality: state.personality, memory: state.memory, language: state.language, files: attachments, search,
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error ?? "modelFailed");
    if (!response.body) throw new Error("modelFailed");
    sources = JSON.parse(decodeURIComponent(response.headers.get("x-khat-sources") ?? "%5B%5D"));
    const reply = await readReply(response.body, text => {
      const follow = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 95;
      partial = text;
      draft.lastElementChild.textContent = text;
      if (follow) scrollToLatest();
    });
    chat.messages.push({ role: "assistant", content: reply, sources, language: state.language });
    report();
  } catch (error) {
    if (controller.signal.aborted && partial.trim()) {
      chat.messages.push({ role: "assistant", content: partial, sources, language: state.language });
    } else {
      chat.messages.pop();
      prompt.value = content;
      files = attachments;
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
});

renderLanguage();
updateControls();
if (storageFailed) report("storageFailed");
