import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const options = process.argv.slice(2);
const root = options.find(option => !option.startsWith("--")) || "public";
const mobile = options.includes("--mobile");
const browser = await chromium.launch({ executablePath: process.env.KHAT_CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1250, height: 810 }, locale: "en-US", colorScheme: mobile ? "light" : "dark", hasTouch: mobile });
  const history = Array.from({ length: 26 }, (_, i) => ({ id: "c"+i, title: "Notebook "+i, messages: Array.from({length: i ? 1 : 120}, (_,j)=>({role:j%2?"assistant":"user",content:"A short sample.\n\n```js\nconst item = 42;\n```"})) }));
  let reads = 0;
  let writes = 0;
  await context.route("https://review.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/session") return route.fulfill({ json: { account: { id: "dummy", username: "fixture", role: "member" } } });
    if (url.pathname === "/api/studio-history") return route.fulfill({ json: {images: []} });
    if (url.pathname === "/api/usage") return route.fulfill({ json: {textLimit: 12,imageLimit: 3,estimatedNeurons:0,budget:8000} });
    if (url.pathname === "/api/workspace") {
      if (route.request().method() !== "GET") {
        writes++;
        return route.fulfill({ json: { revision: 1 } });
      }
      reads++;
      return route.fulfill({ json: { revision: 0, preferences: {}, chats: history, memories: [] } });
    }
    if (url.pathname === "/favicon.ico") return route.fulfill({ status: 404 });
    const name = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!/^\/[a-zA-Z0-9.-]+$/.test(name) || name.includes("..")) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript", body: await readFile(root+name) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(x => [x.name,x.value]));
  await page.goto("https://review.test/");
  if (mobile) {
    await page.locator("#menu").click();
  }
  await page.getByRole("button",{name:"Notebook 0",exact:true}).waitFor();
  const before = await metric();
  await page.locator("#settings").click();
  const dialog = page.locator("#preferences");
  const range = dialog.locator("#glass-opacity");
  await range.scrollIntoViewIfNeeded();
  const started = await metric();
  await range.evaluate(async slider => {
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(requestAnimationFrame);
      for (let step = 0; step < 8; step++) {
        slider.value = String(55 + (frame + step) % 35);
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });
  const after = await metric();
  const beforeSave = { reads, writes };
  await dialog.locator('[value="save"]').click();
  await page.waitForTimeout(800);
  if (options.includes("--verify")) {
    assert.deepEqual(beforeSave, { reads: 1, writes: 0 });
    assert.equal(writes, 1);
    await page.locator("#settings").click();
    const preview = dialog.locator(".personal-preview");
    await preview.scrollIntoViewIfNeeded();
    await preview.locator(".orb").waitFor();
    await page.waitForFunction(() => document.querySelector(".personal-preview").hasAttribute("data-visible"));
    await dialog.locator(".preferences-content").evaluate(element => { element.scrollTop = 0; });
    await dialog.locator("#theme").selectOption(mobile ? "dark" : "light");
    await page.waitForFunction(dark => document.documentElement.dataset.theme === (dark ? "dark" : "light"), mobile);
    await page.waitForFunction(() => !document.querySelector(".personal-preview").hasAttribute("data-visible"));
    assert.equal(await dialog.evaluate(element => getComputedStyle(element).backdropFilter), "none");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "auto" &&
      !document.documentElement.hasAttribute("data-settings-open"));
    assert.equal(writes, 1);
    assert.equal(await page.locator("#welcome .orb").count(), 1);
    assert.equal(await page.locator(".orb-small").count(), 1);
    await page.mouse.move(500, 45, { steps: 12 });
    assert.equal(await page.locator(".glass-lens, .glass-gleam, #refraction").count(), 0);
  }
  console.log(JSON.stringify({
    openTaskMs: Math.round((started.TaskDuration - before.TaskDuration) * 1000),
    sliderLayout: after.LayoutCount - started.LayoutCount,
    sliderStyle: after.RecalcStyleCount - started.RecalcStyleCount,
    sliderTaskMs: Math.round((after.TaskDuration - started.TaskDuration) * 1000),
    beforeSave, afterSave: { reads, writes },
  }));
} finally { await browser.close(); }
