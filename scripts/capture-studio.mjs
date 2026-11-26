import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const [assets = "public", output = "/tmp/khat-studio-shots"] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.KHAT_CHROMIUM_PATH });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce", colorScheme: "dark", locale: "en-US" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let jpeg;
    await page.route("https://review.test/**", route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/session") return route.fulfill({ json: { account: { id: "demo", username: "alex", role: "admin" } } });
      if (pathname === "/api/workspace") return route.fulfill({ json: {
        revision: 0, preferences: { displayName: "Alex" }, memories: [], chats: [
          { id: "demo", title: "Weekend ideas", messages: [{ role: "assistant", content: "A quiet walk would be a lovely start.", model: "instant" }] },
        ],
      } });
      if (pathname === "/api/admin") return route.fulfill({ json: {
        users: [{id: "demo", username: "alex", role: "admin", active: 1, text_limit: 24, image_limit: 5}],
        usage: { day: "2026-11-26", text: 2, image: 1 },
      } });
      if (pathname === "/api/studio-history") return route.fulfill({ json: { images: [] } });
      if (pathname === "/api/usage") return route.fulfill({ json: { textLimit: 24, imageLimit: 5, estimatedNeurons: 0, budget: 8000 } });
      if (pathname === "/api/image") return route.fulfill({ json: { image: jpeg } });
      const name = pathname === "/" ? "index.html" : pathname.slice(1);
      if (!/^[\w-]+\.(?:html|css|js|svg)$/.test(name)) return route.fulfill({ status: 404 });
      const types = { html: "text/html", css: "text/css", js: "text/javascript", svg: "image/svg+xml" };
      return readFile(resolve(assets, name)).then(body => route.fulfill({ body, contentType: types[name.split(".").at(-1)] }));
    });
    await page.goto("https://review.test");
    await page.locator("#temporary").waitFor();
    jpeg = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 640;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#232c45";
      ctx.fillRect(0, 0, 640, 640);
      ctx.fillStyle = "#dfc0a0";
      ctx.beginPath(); ctx.arc(476, 158, 60, 0, Math.PI * 2); ctx.fill();
      for (const [color, x, y] of [["#66738d", 255, 207], ["#384963", 465, 302], ["#222e46", 152, 373]]) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(x - 370, 640); ctx.lineTo(x, y); ctx.lineTo(x + 390, 640); ctx.fill();
      }
      return canvas.toDataURL("image/jpeg").split(",")[1];
    });
    const capture = name => page.screenshot({ path: resolve(output, `${width}-${name}.png`), animations: "disabled" });
    if (width === 1280) {
      await page.locator("#sidebar .brand").screenshot({ path: resolve(output, `${width}-brand.png`) });
      await page.getByRole("button", { name: "Weekend ideas", exact: true }).click();
      await page.locator(".message-label").first().screenshot({ path: resolve(output, `${width}-assistant.png`) });
    }
    if (width === 1280) {
      await page.locator("#new").click();
      await capture("welcome");
      await page.locator("#admin-open").click();
      await page.locator(".admin-user").waitFor();
      await capture("admin");
      await page.locator("#admin").getByRole("button", { name: "Close" }).click();
      await page.locator("#settings").click();
      if (await page.locator("#tab-appearance-settings").count()) await page.locator("#tab-appearance-settings").click();
      await capture("settings");
      await page.locator("#rail").selectOption("solid");
      await page.waitForFunction(() => document.documentElement.dataset.rail === "solid");
      if (!assets.includes("before")) {
        const surface = await page.locator("#preferences").evaluate(element => {
          const style = getComputedStyle(element);
          return { image: style.backgroundImage, blur: getComputedStyle(element, "::backdrop").backdropFilter };
        });
        if (surface.image !== "none" || surface.blur !== "none") throw new Error("Solid dialog still uses glass effects");
      }
      await capture("settings-solid");
      await page.locator('#preferences [value="cancel"]').last().click();
      await page.waitForFunction(() => document.documentElement.dataset.rail === "glass");
    }
    await page.locator("#composer-image").click();
    await page.locator("#image-prompt").fill("An illustration of mountains under a quiet evening sky");
    await capture("studio");
    await page.locator("#generate").click();
    await page.locator("#gallery img").waitFor();
    await page.locator("#gallery img").scrollIntoViewIfNeeded();
    await capture("result");
    await page.locator("#gallery .image-preview").click();
    await page.locator("#full-image").waitFor();
    await capture("preview");
    if (errors.length) throw new Error(errors.join("\n"));
    await page.close();
  }
} finally {
  await browser.close();
}
