import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { readFile } from "node:fs/promises";
const options = process.argv.slice(2);
const root = options.find(option => !option.startsWith("--")) || "public";
const baseline = options.includes("--baseline");
const browser = options.includes("--webkit") ? await webkit.launch() :
  await chromium.launch({ executablePath: process.env.KHAT_CHROMIUM_PATH });
const capture = process.env.KHAT_CAPTURE_DIR;

try {
  for (const width of [390, 768, 1024, 1280, 1440]) {
    const mobile = width < 761;
    let finish;
    let chatStarted;
    const chatRequest = new Promise(resolve => { chatStarted = resolve; });
    const context = await browser.newContext({ viewport: { width, height: 820 }, locale: "en-US", colorScheme: width === 390 || width === 1024 ? "light" : "dark", hasTouch: mobile });
    const history = Array.from({ length: 26 }, (_, i) => ({ id: "c"+i, title: "Notebook "+i, messages: Array.from({length: i ? 1 : 120}, (_,j)=>({role:j%2?"assistant":"user",content:"A short sample.\n\n```js\nconst item = 42;\n```"})) }));
    await context.route("https://review.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/chat") {
        await new Promise(resolve => {
          finish = resolve;
          chatStarted(route.request().postDataJSON());
        });
        return route.fulfill({ contentType: "text/event-stream", body: 'data: {"response":"Fixture reply"}\n\ndata: [DONE]\n\n' });
      }
      if (url.pathname === "/api/session") return route.fulfill({ json: { account: { id: "dummy", username: "fixture", role: "member" } } });
      if (url.pathname === "/api/studio-history") return route.fulfill({ json: {images: []} });
      if (url.pathname === "/api/usage") return route.fulfill({ json: {textLimit: 12,imageLimit: 3,estimatedNeurons:0,budget:8000} });
      if (url.pathname === "/api/workspace") {
        if (route.request().method() !== "GET") {
          return route.fulfill({ json: { revision: 1 } });
        }
        return route.fulfill({ json: { revision: 0, preferences: { displayName: "Alex" }, chats: history, memories: [] } });
      }
      if (url.pathname === "/favicon.ico") return route.fulfill({ status: 404 });
      const name = url.pathname === "/" ? "/index.html" : url.pathname;
      if (!/^\/[a-zA-Z0-9.-]+$/.test(name) || name.includes("..")) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : name.endsWith(".svg") ? "image/svg+xml" : "text/javascript", body: await readFile(root+name) });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://review.test/");
    await page.locator("#temporary").waitFor();
    const shot = name => capture && page.screenshot({ path: `${capture}/${baseline ? "before" : "after"}-${width}-${name}.png`, animations: "disabled" });
    const toggle = page.locator(mobile ? "#menu" : "#collapse");
    const prompt = page.locator("#prompt");
    const geometry = () => page.evaluate(() => {
      const main = document.querySelector("main").getBoundingClientRect();
      const composer = document.querySelector("#composer").getBoundingClientRect();
      return { main: main.width, center: Math.abs(main.x + main.width / 2 - composer.x - composer.width / 2),
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    await shot("welcome");
    if (baseline) {
      if (!mobile) await toggle.click();
      console.log(width, await geometry());
      await shot("collapsed");
      await context.close();
      continue;
    }
    await prompt.fill("Unsent draft");
    for (let repeat = 0; repeat < 4; repeat++) {
      await toggle.click();
      const result = await geometry();
      assert.equal(result.overflow, false);
      assert.ok(result.center < 2);
      if (mobile || repeat % 2 === 0) assert.ok(result.main > width - 28, JSON.stringify(result));
      assert.equal(await prompt.inputValue(), "Unsent draft");
      if (repeat === 0) await shot("collapsed");
    }
    await page.locator("#temporary").click();
    await page.locator("#temporary-note").waitFor();
    await shot("temporary");
    await page.locator("#temporary").click();
    if (mobile) await toggle.click();
    await page.getByRole("button", { name: "Notebook 0", exact: true }).click();
    const title = await page.locator("#chat-title").textContent();
    await toggle.click();
    assert.equal(await page.locator("#chat-title").textContent(), title);
    if (mobile) await toggle.click();
    const model = page.locator("#mode");
    await model.click();
    await page.getByRole("radio", { name: /Khat Think/ }).click();
    await page.locator("#model-options").waitFor({ state: "hidden" });
    assert.match(await model.innerText(), /Think/);
    await model.press("Enter");
    await shot("models");
    await page.getByRole("radio", { name: /Khat Think/ }).press("ArrowDown");
    await page.keyboard.press("Escape");
    assert.match(await model.innerText(), /Pro/);
    await prompt.fill("Check selected model");
    await page.locator("#send").click();
    await page.waitForFunction(() => document.documentElement.dataset.orbState === "thinking");
    await page.waitForFunction(() => document.querySelector("#timeline").getAttribute("aria-busy") === "true");
    assert.equal((await chatRequest).mode, "pro");
    await shot("pending");
    finish();
    await page.getByText("Fixture reply", { exact: true }).waitFor();

    if (mobile || await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    await page.locator("#settings").click();
      if (await page.locator("#tab-appearance-settings").count()) await page.locator("#tab-appearance-settings").click();
    const dialog = page.locator("#preferences");
    const settings = dialog.locator(".preferences-content");
    const actions = dialog.locator(".preferences-actions");
    const footer = await actions.boundingBox();
    await settings.evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.deepEqual(await actions.boundingBox(), footer);
    assert.ok(await settings.evaluate(element => element.scrollTop > 0 &&
      element.scrollHeight - element.clientHeight - element.scrollTop < 2));
    await shot("settings-bottom");
    await dialog.locator('[value="cancel"]').last().click();
    await page.locator("#settings").click();
      if (await page.locator("#tab-appearance-settings").count()) await page.locator("#tab-appearance-settings").click();
    await dialog.locator("#theme").selectOption("light");
    await dialog.locator("#accent").selectOption("custom");
    await dialog.locator("#custom-accent").fill("#6351ad");
    await dialog.locator('[value="save"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.effectiveTheme === "light" &&
      document.documentElement.dataset.accent === "custom");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${width}px passed`);
  }
} finally { await browser.close(); }
