const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.KHAT_CHROMIUM_PATH });
  try {
    const context = await browser.newContext({
      httpCredentials: { username: 'khat', password: 'local-test-only' },
      viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light',
      permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true,
    });
    await context.addInitScript(() => {
      window.SpeechRecognition = class {
        start() { this.onstart?.(); setTimeout(() => {
          this.onresult({ resultIndex: 0, results: [[{ transcript: 'Hej' }]] });
          this.onend();
        }, 20); }
        abort() { this.onend(); }
        stop() { this.onend(); }
      };
      window.speechSynthesis.speak = utterance => { window.spoken = utterance.lang; };
      if (!sessionStorage.migrationSeeded) {
        localStorage.setItem('khat.workspace.v1', JSON.stringify({
          language: 'en', memory: 'Migrated note', chats: [{
            id: 'old', title: 'Old private chat', messages: [{ role: 'user', content: 'previous private text' }],
          }],
        }));
        sessionStorage.migrationSeeded = 'yes';
      }
    });
    const page = await context.newPage();
    const failures = [];
    const posts = [];
    const pictures = [];
    let mode = 'ok';
    let imageMode = 'ok';
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/api/chat', async route => {
      const input = route.request().postDataJSON();
      posts.push(input);
      if (mode === 'hold') return;
      if (mode === 'fail') return route.fulfill({ status: 429, json: { error: 'dailyLimit' } });
      const reply = '**Reply**\n\n```js\nconsole.log("hello");\n```\n\n<img src=x onerror=alert(1)>';
      return route.fulfill({
        contentType: 'text/event-stream',
        headers: {
          'x-khat-model': mode === 'fallback' ? 'legacy' : 'think', 'x-khat-fallback': String(mode === 'fallback'),
          'x-khat-sources': encodeURIComponent(JSON.stringify([{ title: 'Copenhagen', url: 'https://en.wikipedia.org/?curid=99' }])),
        },
        body: `data: ${JSON.stringify({ response: reply })}\n\ndata: [DONE]\n\n`,
      });
    });
    await page.goto('http://localhost:8797/');
    const jpeg = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 200;
      const context = canvas.getContext('2d');
      context.fillStyle = '#b4d0b6';
      context.fillRect(0, 0, 200, 200);
      return canvas.toDataURL('image/jpeg').split(',')[1];
    });
    await page.route('**/api/image', route => {
      pictures.push(route.request().postDataJSON());
      return imageMode === 'ok'
        ? route.fulfill({ json: { image: jpeg } })
        : route.fulfill({ status: 422, json: { error: 'imageBlocked' } });
    });
    const button = (name, context = page) => context.getByRole('button', { name, exact: true });
    const heading = name => page.getByRole('heading', { name, exact: true });
    const password = 'unique test passphrase';
    const create = async name => {
      await page.getByLabel('Profile name', { exact: true }).fill(name);
      await page.getByLabel('New passphrase (12 characters minimum)').fill(password + name);
      await button('Create profile', page.locator('#create-form')).click();
      await heading('What’s on your mind?').waitFor();
    };
    const lock = async () => {
      await button('Lock profile').click();
      await heading('Your space, kept private.').waitFor();
    };
    const unlock = async (name, secret = password + name) => {
      await page.locator('#profiles').getByLabel('Profile', { exact: true }).selectOption({ label: name });
      await page.locator('#profiles').getByLabel('Passphrase', { exact: true }).fill(secret);
      await button('Unlock').click();
    };

    await heading('Your space, kept private.').waitFor();
    await page.getByLabel('Import existing local conversations and settings').check();
    await create('First');
    assert.equal(await page.evaluate(() => localStorage.getItem('khat.workspace.v1')), null);
    await button('Old private chat').waitFor();
    await button('Hide sidebar').click();
    await page.locator('#sidebar').waitFor({ state: 'hidden' });
    await button('Show sidebar').click();
    await button('Settings').click();
    const settings = page.locator('#preferences');
    assert.equal(await settings.getByLabel('Memory', { exact: true }).inputValue(), 'Migrated note');
    assert.equal(await settings.getByLabel('Include memory in AI requests').isChecked(), false);
    await settings.getByLabel('Theme').selectOption('dark');
    await settings.getByLabel('Accent color').selectOption('blue');
    await settings.getByLabel('AI name').fill('Aster');
    await settings.getByLabel('Response length').selectOption('brief');
    await settings.getByLabel('Communication style').selectOption('warm');
    await settings.getByLabel('AI personality').fill('Friendly');
    await settings.getByLabel('Custom instructions').fill('Use examples.');
    await button('Save', settings).click();
    await page.waitForFunction(() => document.documentElement.dataset.effectiveTheme === "dark");
    assert.equal(await page.locator('html').getAttribute('data-effective-theme'), 'dark');
    assert.equal(await page.locator('html').getAttribute('data-accent'), 'blue');
    await page.locator('#mode').click();
    await page.getByRole('radio', { name: /Khat Think/ }).click();
    await button('Dictate').click();
    await page.waitForFunction(() => document.querySelector('#prompt').value === 'Hej');
    await page.locator('#upload').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Text file') });
    await button('Remove: notes.txt').waitFor();
    await button('Search Wikipedia').click();
    await button('Send').click();
    await page.locator('.messages').getByText('Khat Think', { exact: true }).waitFor();
    const renderedTable = await page.evaluate(async () => {
      const { markdown } = await import("/markdown.js");
      const element = document.createElement("div");
      element.append(markdown("| Size | Unit |\n| --- | --- |\n| 42 | mm |\n\nSource [1] <img src=x>\n\n```js\nconst size = 42;\n```",
        { copy: "Copy", code: "Code" }, () => {}, [{ url: "https://example.test", title: "Source" }]));
      return { headers: [...element.querySelectorAll("th")].map(item => item.textContent),
        links: element.querySelectorAll("a.citation").length, unsafe: element.querySelectorAll("img").length,
        keyword: element.querySelector(".code-keyword")?.textContent };
    });
    assert.deepEqual(renderedTable, { headers: ["Size", "Unit"], links: 1, unsafe: 0, keyword: "const" });
    assert.equal(posts[0].memory, '');
    assert.equal(posts[0].mode, 'think');
    assert.equal(posts[0].aiName, 'Aster');
    assert.equal(posts[0].style, 'warm');
    assert.equal(posts[0].length, 'brief');
    assert.equal(posts[0].instructions, 'Use examples.');
    assert.equal(posts[0].files[0].text, 'Text file');
    await page.getByText('Wikipedia sources').click();
    await page.getByRole('link', { name: 'Copenhagen' }).waitFor();
    assert.equal(await page.locator('.message.assistant img').count(), 0);
    await button('Copy', page.locator('.code-header')).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'console.log("hello");');
    await button('Copy', page.locator('.user')).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Hej');
    await button('Read aloud').click();
    assert.equal(await page.evaluate(() => window.spoken), 'en-US');
    await button('Stop reading').click();

    await button('Settings').click();
    await settings.getByLabel('Include memory in AI requests').check();
    await button('Save', settings).click();
    await button('Edit', page.locator('.user')).click();
    await page.getByLabel('Message text').fill('Changed question');
    await button('Send', page.locator('#edit-dialog')).click();
    await page.getByText('Changed question').waitFor();
    await button('Regenerate').waitFor();
    assert.equal(posts.at(-1).memory, 'Migrated note');
    assert.deepEqual(posts.at(-1).messages, [{ role: 'user', content: 'Changed question' }]);
    mode = 'fallback';
    await button('Regenerate').click();
    await page.getByText('Khat used a fallback model.').waitFor();
    assert.equal(await page.locator('.message.assistant').count(), 1);
    mode = 'fail';
    await button('Regenerate').click();
    await page.getByText('Khat’s daily generation limit is reached. Try again after midnight UTC.').waitFor();
    assert.equal(await page.locator('.message.assistant').count(), 1);

    await button('Settings').click();
    await button('Clear memory').click();
    await settings.getByLabel('Theme').selectOption('auto');
    await settings.getByLabel('Accent color').selectOption('custom');
    await settings.getByLabel('Custom accent', { exact: true }).fill('#764f80');
    await button('Save', settings).click();
    await page.waitForFunction(() => document.documentElement.dataset.accent === 'custom');
    assert.equal(await page.locator('.hero-mark').evaluate(mark => getComputedStyle(mark).backgroundColor), 'rgb(118, 79, 128)');
    mode = 'hold';
    await page.locator('#prompt').fill('Stop me');
    await button('Send').click();
    await page.locator('#activity').waitFor();
    await page.waitForFunction(() => document.querySelector('#stop').hidden === false);
    await button('Stop').click();
    await page.getByText('Response stopped.').waitFor();
    assert.equal(await page.locator('#prompt').inputValue(), 'Stop me');

    await button('Conversation options: Hej').click();
    await page.getByLabel('Conversation name').fill('Renamed chat');
    await button('Save', page.locator('#conversation-options')).click();
    await page.getByLabel('Search chats').fill('Changed question');
    await button('Renamed chat').waitFor();
    assert.equal(await button('Old private chat').isVisible(), false);
    await button('Conversation options: Renamed chat').click();
    await button('Archive', page.locator('#conversation-options')).click();
    await button('Archive', page.locator('.history-tools')).click();
    await button('Renamed chat').waitFor();
    await button('Conversation options: Renamed chat').click();
    await button('Restore').click();
    await button('Archive', page.locator('.history-tools')).click();
    await button('Renamed chat').waitFor();
    await page.getByLabel('Search chats').fill('');

    await button('Studio').click();
    await page.getByLabel('Describe an image').fill('Pine trees on a hill');
    await page.getByLabel('Aspect ratio').selectOption('portrait');
    await page.getByLabel('Image style').selectOption('illustration');
    await button('Generate image').click();
    await page.getByText('Image ready.').waitFor();
    assert.deepEqual(pictures[0], { prompt: 'Pine trees on a hill', ratio: 'portrait', style: 'illustration' });
    await button('Preview: Pine trees on a hill').click();
    await page.waitForFunction(() => document.querySelector('#full-image').naturalWidth === 150);
    assert.equal(await page.locator('#full-image').evaluate(img => img.naturalHeight), 200);
    await button('Close', page.locator('#image-preview')).click();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download' }).click();
    assert.match((await download).suggestedFilename(), /^khat-.+\.jpg$/);
    imageMode = 'block';
    await button('Generate image').click();
    await page.locator('#image-status').getByText('Studio couldn’t approve this image request for a teen-safe workspace.').waitFor();
    assert.equal(await page.locator('#gallery img').count(), 1);
    await button('Close', page.locator('#studio')).click();

    await lock();
    await unlock('First', 'incorrect secret phrase');
    await page.getByText('Incorrect passphrase.').waitFor();
    await page.locator('#toggle-create').click();
    await create('Second');
    assert.equal(await button('Renamed chat').isVisible(), false);
    await button('Studio').click();
    assert.equal(await page.locator('#gallery img').count(), 0);
    await button('Close', page.locator('#studio')).click();
    await lock();
    await unlock('First');
    await button('Renamed chat').waitFor();
    await button('Studio').click();
    await button('Preview: Pine trees on a hill').waitFor();
    await button('Delete', page.locator('#gallery')).click();
    assert.equal(await page.locator('#gallery img').count(), 0);
    await button('Close', page.locator('#studio')).click();
    await page.reload();
    await heading('Your space, kept private.').waitFor();
    await unlock('First');
    await button('Renamed chat').waitFor();
    await button('Settings').click();
    assert.equal(await settings.getByLabel('Memory', { exact: true }).inputValue(), '');
    await button('Cancel', settings).click();
    await button('Conversation options: Renamed chat').click();
    await button('Delete', page.locator('#conversation-options')).click();
    await button('Delete', page.locator('#confirm')).click();
    await button('Renamed chat').waitFor({ state: 'hidden' });
    await button('Switch to Danish').click();
    await heading('Hvad tænker du på?').waitFor();
    for (const [width, height, colorScheme] of [[1440, 900, 'light'], [820, 1180, 'dark'], [390, 844, 'dark'], [320, 568, 'light']]) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), true);
      await page.waitForFunction(scheme => document.documentElement.dataset.effectiveTheme === scheme, colorScheme);
      assert.equal(await page.locator('html').getAttribute('data-effective-theme'), colorScheme);
    }
    await button('Vis sidepanelet').click();
    await button('Ny chat').waitFor();

    assert.deepEqual(failures, []);
    console.log('Khat 2.0 Chromium smoke passed: auth, encrypted profiles and legacy migration, personalization, chat controls, model metadata, files/search/speech/Markdown, Studio, history, responsive design and localization.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
