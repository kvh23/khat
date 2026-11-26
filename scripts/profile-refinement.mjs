import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const root = process.argv[2] || "public";
const browser = await chromium.launch({ executablePath: process.env.KHAT_CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1250, height: 810 }, locale: "en-US", colorScheme: "dark" });
  const history = Array.from({ length: 26 }, (_, i) => ({ id: "c"+i, title: "Notebook "+i, messages: Array.from({length: i ? 1 : 120}, (_,j)=>({role:j%2?"assistant":"user",content:"A short sample.\n\n```js\nconst item = 42;\n```"})) }));
  let gallery = 0;
  await context.route("https://review.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/session") return route.fulfill({ json: { account: { id: "dummy", username: "fixture", role: "member" } } });
    if (url.pathname === "/api/studio-history") { gallery++; return route.fulfill({ json: {images: []} }); }
    if (url.pathname === "/api/usage") return route.fulfill({ json: {textLimit: 12,imageLimit: 3,estimatedNeurons:0,budget:8000} });
    if (url.pathname === "/api/workspace") return route.fulfill({ json: {revision:0,preferences:{}, chats:history,memories:[]} });
    if (url.pathname === "/favicon.ico") return route.fulfill({ status: 404 });
    const name = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!/^\/[a-zA-Z0-9.-]+$/.test(name) || name.includes("..")) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript", body: await readFile(root+name) });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(x => [x.name,x.value]));
  await page.goto("https://review.test/");
  await page.getByRole("button",{name:"Notebook 0",exact:true}).waitFor();
  const before = await metric();
  await page.getByRole("button",{name:"Notebook 0",exact:true}).click();
  await page.getByRole("button",{name:"Hide sidebar",exact:true}).click();
  await page.waitForTimeout(350);
  await page.getByRole("button",{name:"Show sidebar",exact:true}).click();
  await page.waitForTimeout(350);
  const input = page.getByLabel("Message Khat",{exact:true});
  await input.pressSequentially("This is a benchmark draft. Another line.",{delay:10});
  await page.mouse.move(450,32);
  await page.mouse.move(900,32,{steps:16});
  const after = await metric();
  console.log(JSON.stringify({galleryAtStartup:gallery, layout:after.LayoutCount-before.LayoutCount,
    recalc:after.RecalcStyleCount-before.RecalcStyleCount,
    layoutMs:Math.round((after.LayoutDuration-before.LayoutDuration)*1000),
    taskMs:Math.round((after.TaskDuration-before.TaskDuration)*1000)}));
} finally { await browser.close(); }
