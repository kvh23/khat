import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const base = "http://localhost:8799";
const password = "local-only account passphrase";
const gate = "Basic " + Buffer.from("khat:local-test-only").toString("base64");
const local = await mkdtemp(join(tmpdir(), "khat-d1-"));
const config = ["--config", "wrangler.accounts.jsonc", "--persist-to", local];
const wrangler = "node_modules/wrangler/bin/wrangler.js";
let worker;
let browser;
let log = "";

async function call(path, { actor, data, status = 200, headers = {}, noGate = false } = {}) {
  const response = await fetch(base + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      ...(!noGate && { Authorization: gate }),
      ...(actor && { Cookie: actor.cookie, "X-Khat-Account": actor.account.id }),
      ...(data !== undefined && { "Content-Type": "application/json" }),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = status === 204 ? null : await response.json();
  assert.equal(response.status, status, `${path} ${JSON.stringify(body)}`);
  return { body, headers: response.headers };
}

async function signed(path, data) {
  const { body, headers } = await call(path, { data });
  const raw = headers.get("set-cookie");
  assert.match(raw, /^__Host-khat_session=[\w-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800$/);
  return { account: body.account, cookie: raw.split(";")[0] };
}

try {
  execFileSync(process.execPath, [wrangler, "d1", "migrations", "apply", "khat-accounts", "--local", ...config], { stdio: "ignore" });
  const invite = execFileSync(process.execPath, ["scripts/bootstrap-invite.mjs", "--local", ...config],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(" ").at(-1);
  worker = spawn(process.execPath, [wrangler, "dev", "--port", "8799", ...config, "--var", "KHAT_PASSWORD:local-test-only"], { detached: true });
  worker.stdout.on("data", data => { log = (log + data).slice(-5000); });
  worker.stderr.on("data", data => { log = (log + data).slice(-5000); });
  for (let count = 0; count < 100 && !log.includes("Ready on"); count++) await delay(100);
  assert.match(log, /Ready on/);

  assert.equal((await call("/api/session", { noGate: true, status: 401 })).body.error, "unauthorized");
  assert.deepEqual((await call("/api/session")).body, { account: null });
  assert.equal((await call("/api/chat", { data: {}, status: 401 })).body.error, "signInRequired");
  const admin = await signed("/api/register", { username: "administrator", password, invite });
  await call("/api/admin/user", { actor: admin, data: {
    id: admin.account.id, active: false, textLimit: 24, imageLimit: 5,
  }, status: 204 });
  const personalLimits = (await call("/api/usage", { actor: admin })).body;
  assert.equal(personalLimits.textLimit, 24);
  assert.equal(personalLimits.imageLimit, 5);

  assert.equal(admin.account.role, "admin");
  const issued = (await call("/api/admin/invite", { actor: admin, data: {} })).body.invite;

  const register = { username: "mountain", password, invite: issued };
  const results = await Promise.all([
    signed("/api/register", register).catch(error => error),
    signed("/api/register", { ...register, username: "forest" }).catch(error => error),
  ]);
  const users = results.filter(result => result.account);
  assert.equal(users.length, 1);
  const member = users[0];
  await call("/api/login", { data: { username: member.account.username, password: "incorrect long password" }, status: 401 });
  const device = await signed("/api/login", { username: member.account.username, password });
  const read = actor => call("/api/workspace", { actor }).then(result => result.body);
  const initial = await read(member);
  const workspace = {
    revision: initial.revision,
    preferences: { displayName: "Test name", motionEnabled: false, memoryEnabled: true, orbStyle: "aurora" },
    chats: [{ id: "shared-id", title: "Private notebook", messages: [{ role: "user", content: "Sensitive example fixture" }] }],
    memories: [{ id: "private-note", content: "I enjoy learning about mountains.", source: "manual" }],
  };
  await call("/api/workspace", { actor: member, data: workspace, status: 204 });
  assert.equal((await read(device)).chats[0].messages[0].content, "Sensitive example fixture");
  assert.equal((await read(admin)).chats.length, 0);
  assert.equal((await read(admin)).memories.length, 0);
  await call("/api/workspace?since=1", { actor: member, status: 204 });
  await call("/api/workspace", { actor: admin, headers: { "X-Khat-Account": member.account.id }, status: 409 });
  await call("/api/workspace", { actor: admin, data: workspace, headers: { "X-Khat-Account": member.account.id }, status: 409 });
  await call("/api/workspace", { actor: member, data: workspace, status: 409 });
  await call("/api/workspace", { actor: member, data: { ...workspace, revision: 1 }, headers: { Origin: "https://other.example" }, status: 403 });
  const adminData = { revision: 0, preferences: {}, chats: [{ id: "shared-id", title: "Admin notebook", messages: [] }], memories: [] };
  await call("/api/workspace", { actor: admin, data: adminData, status: 204 });
  assert.equal((await read(member)).chats[0].title, "Private notebook");
  assert.equal((await read(admin)).chats[0].title, "Admin notebook");
  const update = { ...workspace, revision: 1, chats: [{ ...workspace.chats[0], messages: [] }], memories: [] };
  await call("/api/workspace", { actor: member, data: update, status: 204 });
  assert.equal((await read(device)).chats[0].messages.length, 0);
  assert.equal((await read(device)).memories.length, 0);

  await call("/api/admin", { actor: member, status: 403 });
  await call("/api/studio-history", { actor: member, data: { id: "member-image", prompt: "Trees", data: "data:image/jpeg;base64,/9j/eA==" }, status: 204 });
  await call("/api/studio-history", { actor: admin, data: { id: "member-image", remove: true }, status: 204 });
  assert.equal((await call("/api/studio-history", { actor: member })).body.images.length, 1);
  assert.equal((await call("/api/studio-history", { actor: admin })).body.images.length, 0);
  const exported = await call("/api/export", { actor: member });
  assert.match(exported.headers.get("content-disposition"), /attachment/);
  assert.equal(exported.body.images[0].prompt, "Trees");
  const settings = { id: member.account.id, active: true, textLimit: 1, imageLimit: 0 };
  await call("/api/admin/user", { actor: admin, data: settings, status: 204 });
  await call("/api/image", { actor: member, data: { prompt: "Pines", style: "plain", ratio: "square" }, status: 429 });
  const message = { messages: [{ role: "user", content: "Remember that I prefer concise answers" }], temporary: true };
  await call("/api/chat", { actor: member, data: message, status: 502 });
  await call("/api/chat", { actor: member, data: message, status: 429 });
  const overview = (await call("/api/admin", { actor: admin })).body;
  assert.equal(overview.usage.users[member.account.id].text, 1);
  const memberUsage = (await call("/api/usage", { actor: member })).body;
  assert.match(memberUsage.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(memberUsage.text, 1);
  assert.equal(memberUsage.textLimit, 1);
  assert.equal(memberUsage.users, undefined);
  await call("/api/usage", { actor: member, headers: { "X-Khat-Account": admin.account.id }, status: 409 });
  assert.doesNotMatch(JSON.stringify(overview), /Private notebook|Sensitive example|Trees/);
  await call("/api/logout", { actor: member, data: {}, status: 204 });
  await call("/api/workspace", { actor: member, status: 401 });
  assert.equal((await read(device)).chats.length, 1);
  await call("/api/admin/user", { actor: admin, data: { ...settings, active: false }, status: 204 });
  await call("/api/workspace", { actor: device, status: 401 });
  await call("/api/admin/user", { actor: admin, data: settings, status: 204 });
  const recovered = await signed("/api/login", { username: member.account.username, password });
  await call("/api/delete-account", { actor: recovered, data: { password: "incorrect long password" }, status: 401 });
  await call("/api/delete-account", { actor: recovered, data: { password }, status: 204 });
  await call("/api/workspace", { actor: recovered, status: 401 });
  await call("/api/delete-account", { actor: admin, data: { password }, status: 409 });
  console.log("D1 account smoke passed: invite races, cookie security, isolation, stale tabs, conflicts, device sync, private export, daily limits and deletion.");

  if (!process.argv.includes("--browser")) process.exitCode = 0;
  else {
    browser = await chromium.launch({ executablePath: process.env.KHAT_CHROMIUM_PATH });
    const context = await browser.newContext({ httpCredentials: { username: "khat", password: "local-test-only" }, locale: "en-US" });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.SpeechRecognition = class {
        start() {
          this.onstart?.();
          this.timer = setTimeout(() => {
            if (window.voiceFixture) this.onresult({ resultIndex: 0, results: [[{ transcript: "Talk about the stars" }]] });
            this.stop();
          }, window.voiceFixture ? 160 : 1600);
        }
        stop() { clearTimeout(this.timer); this.onend(); }
        abort() { this.stop(); }
      };
      if (window.speechSynthesis) {
        speechSynthesis.speak = utterance => {
          window.spokenFixture = utterance.text;
          utterance.onstart?.();
        };
      }
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        const signal = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        signal.connect(destination);
        signal.start();
        const track = destination.stream.getAudioTracks()[0];
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); context.close(); };
        await context.resume();
        return destination.stream;
      };
    });
    let browserGalleryReads = 0;
    page.on("request", request => {
      if (request.method() === "GET" && request.url().endsWith("/api/studio-history")) browserGalleryReads++;
    });
    await page.goto(base);
    await page.getByLabel("Username", { exact: true }).fill(admin.account.username);
    await page.locator("#account-auth").getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("heading", { name: "What’s on your mind?" }).waitFor();
    assert.equal(browserGalleryReads, 0);
    const expected = [];
    const checks = [];
    await page.route("**/api/chat", async route => {
      expected.push(route.request().postDataJSON());
      checks.push(await page.locator("html").getAttribute("data-orb-state"));
      await route.fulfill({
        contentType: "text/event-stream",
        headers: { "x-khat-memory": encodeURIComponent("I prefer concise answers.") },
        body: 'data: {"response":"Hello"}\n\ndata: [DONE]\n\n',
      });
    });
    const label = name => page.getByLabel(name, { exact: true });
    const button = name => page.getByRole("button", { name, exact: true });
    const orb = page.locator(".orb-hero i").first();
    const send = async content => {
      await label("Message Khat").fill(content);
      await button("Send").click();
      await page.locator(".assistant").getByText("Hello").waitFor();
    };
    const image = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 120;
      const context = canvas.getContext("2d");
      context.fillStyle = "#789eac";
      context.fillRect(0, 0, 120, 120);
      return canvas.toDataURL("image/jpeg").split(",")[1];
    });
    await button("Settings").click();
    await label("Display name").fill("Khat friend");
    await label("Profile picture").setInputFiles({
      name: "avatar.jpg", mimeType: "image/jpeg", buffer: Buffer.from(image, "base64"),
    });
    await label("First orb color").fill("#446688");
    await label("Orb style").selectOption("aurora");
    await label("Enable animations").uncheck();
    await label("Include memory in AI requests").check();
    const saveSettings = page.waitForResponse(response => response.url().endsWith("/api/workspace") &&
      response.request().method() === "POST" && response.status() === 204);
    await button("Save").click();
    await saveSettings;
    await page.waitForFunction(() => document.documentElement.dataset.orbStyle === "aurora");
    assert.equal(await orb.evaluate(element => getComputedStyle(element).animationName), "none");
    const beforeTemporary = await read(admin);
    await button("Temporary chat").click();
    assert.equal(await page.getByText("Temporary chat", { exact: true }).filter({ visible: true }).count(), 1);
    assert.equal(await page.locator("#temporary-note").isVisible(), true);
    assert.equal(await page.locator("#chat-title").isVisible(), false);
    await send("Temporarily remember that I prefer concise answers");
    assert.equal(expected.at(-1).temporary, true);
    assert.equal(expected.at(-1).memory, "");
    const afterTemporary = await read(admin);
    assert.deepEqual(afterTemporary.chats, beforeTemporary.chats);
    assert.deepEqual(afterTemporary.memories, beforeTemporary.memories);
    assert.equal(afterTemporary.revision, beforeTemporary.revision);
    assert.equal(checks.at(-1), "thinking");
    assert.equal(await page.locator("html").getAttribute("data-orb-state"), "idle");
    await button("Temporary chat").click();
    assert.equal(await page.locator("#temporary-note").isVisible(), false);
    assert.equal(await page.locator("#chat-title").isVisible(), true);
    assert.equal(await page.getByText("Temporarily remember", { exact: false }).count(), 0);
    const savedReply = page.waitForResponse(response => response.url().endsWith("/api/workspace") &&
      response.request().method() === "POST" && response.status() === 204);
    await send("Remember that I prefer concise answers");
    assert.equal(expected.at(-1).temporary, false);
    await savedReply;
    const saved = await read(admin);
    assert.equal(saved.memories[0].content, "I prefer concise answers.");
    assert.equal(saved.chats.some(item => item.title.startsWith("Temporarily")), false);
    assert.equal(saved.preferences.orbStyle, "aurora");
    assert.equal(saved.preferences.orbOne, "#446688");
    assert.match(saved.preferences.avatar, /^data:image\/jpeg;base64,/);
    await page.route("**/api/image", async route => {
      assert.equal(await page.locator("html").getAttribute("data-orb-state"), "image");
      assert.equal(await page.locator("#studio-skeleton").isVisible(), true);
      await route.fulfill({ json: { image } });
    });
    await button("Studio").click();
    await label("Describe an image").fill("Mint silhouette");
    await button("Generate image").click();
    await page.getByText("Image ready.", { exact: true }).waitFor();
    assert.equal(browserGalleryReads, 1);
    assert.equal((await call("/api/studio-history", { actor: admin })).body.images[0].prompt, "Mint silhouette");
    assert.equal(await page.locator("html").getAttribute("data-orb-state"), "idle");
    await button("Close").click();
    await button("Settings").click();
    await label("Enable animations").check();
    await button("Save").click();
    await page.waitForFunction(() => document.documentElement.dataset.motion === "on");
    await button("Dictate").click();
    await page.waitForFunction(() => document.documentElement.dataset.orbState === "listening");
    await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector(".orb-small")).getPropertyValue("--voice-level").trim()) > .05);
    await page.waitForFunction(() => document.documentElement.dataset.orbState === "idle");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".orb-small")).getPropertyValue("--voice-level").trim()), "0");

    const existingMessage = await page.locator(".message.user").first().elementHandle();
    await page.evaluate(() => { window.voiceFixture = true; });
    await button("Voice").click();
    await button("Listen").click();
    await page.waitForFunction(() => document.documentElement.dataset.orbState === "speaking");
    assert.equal(await page.evaluate(() => window.spokenFixture), "Hello");
    assert.equal(expected.at(-1).messages.at(-1).content, "Talk about the stars");
    assert.equal(await existingMessage.evaluate(element => element.isConnected), true);
    await page.locator("#voice-room").getByRole("button", { name: "Stop", exact: true }).click();
    await page.locator("#voice-room").getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.orbState === "idle");

    const frameP95 = await page.evaluate(() => new Promise(resolve => {
      const times = [];
      let last;
      const frame = time => {
        if (last) times.push(time - last);
        last = time;
        if (times.length < 50) requestAnimationFrame(frame);
        else resolve(times.sort((a,b) => a-b)[47]);
      };
      requestAnimationFrame(frame);
    }));
    console.log(`Chromium motion sample: p95 frame interval ${frameP95.toFixed(1)} ms over 50 frames.`);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    for (const [width, height] of [[1440, 900], [820, 1180], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      const layout = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll("body *")].map(node => ({ id: node.id, className: node.className,
          tag: node.tagName, right: Math.round(node.getBoundingClientRect().right) })).filter(node => node.right > innerWidth + 1).slice(0, 12),
      }));
      assert.equal(layout.width, width, JSON.stringify(layout));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await button("Administration").click();
    await page.getByText("administrator", { exact: true }).waitFor();
    await button("Close").click();
    await button("Sign out").click();
    await button("Sign in").waitFor();
    const newInvite = (await call("/api/admin/invite", { actor: admin, data: {} })).body.invite;
    await button("Use an invitation").click();
    await label("Username").fill("new_browser_member");
    await page.locator("#account-auth").getByLabel("Password", { exact: true }).fill(password);
    await page.locator("#account-auth").getByLabel("Invitation code", { exact: true }).fill(newInvite);
    await button("Create account").click();
    await page.getByRole("heading", { name: "What’s on your mind?" }).waitFor();
    assert.equal(await button("Administration").isVisible(), false);
    assert.equal(await page.locator("html").getAttribute("data-orb-style"), "fluid");
    console.log("Account Chromium smoke passed: login, saved motion preferences, reduced motion, temporary chat, memory, admin and logout.");
  }
} catch (error) {
  console.error(error);
  console.error(log);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (worker?.pid) {
    try { process.kill(-worker.pid, "SIGTERM"); } catch {}
    await delay(350);
  }
  await rm(local, { recursive: true, force: true });
}
