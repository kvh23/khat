# Khat

Khat is a bilingual chat workspace for English and Danish. It runs on Cloudflare Workers with streamed replies from [Workers AI’s Llama 3.3 70B Instruct FP8 Fast model](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/).

## Review locally

Use Node.js 22 or newer and install the locked dependencies.

```sh
npm ci
npm test -- --run
npm run check
```

The tests mock Workers AI and Wikipedia. The build check type-checks the Worker and bundles it with Wrangler in dry-run mode.

For a local UI preview without using Workers AI, run the following command and open http://localhost:8794. Sign in with username `khat` and password `local-test-only`. Use an intercepted or mocked `/api/chat` response for chat testing in this configuration.

```sh
npm run e2e:dev -- --port 8794 --var KHAT_PASSWORD:local-test-only
```

## Cloudflare configuration

- Keep the existing `AI` binding and `KHAT_PASSWORD` Worker secret. The Worker fails closed when the secret is missing. Store real credentials in Cloudflare secrets and serve the app over HTTPS. Browser HTTP Basic authentication may cache credentials until the browser session ends.
- Static assets run through the Worker before they are served. The server checks the fixed username `khat` and the configured password for assets and API requests.
- The Cloudflare rate limit bindings allow 10 failed authentications per client IP and 18 chat requests per shared account per minute. Cloudflare enforces these limits per location, so they are approximate and do not serve as a global spending cap. Workers AI uses the existing account’s usage allowance.
- The server bounds requests, validates message roles and settings, rejects cross-site chat requests, and keeps the safety prompt server-side. The UI constructs Markdown with DOM nodes and allows only HTTP and HTTPS links. Model safety instructions offer best-effort guidance. There is no separate output moderation service.
- GitHub changes alone do not update the live Worker. Before releasing, verify that the target environment has the existing secret and the expected Workers AI model. Avoid reusing production credentials for review environments.

[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## Feature behavior and limitations

| Feature | Behavior |
| --- | --- |
| History | Start, reopen, or delete chats. Chats, language, personality, and memory are stored in the current browser. Clearing site data removes them. There is no cross-device sync, and users of the same browser profile share that storage. |
| Personality and memory | Edit either field in Settings. Khat sends these settings and the most recent messages to Workers AI. Memory changes only when you edit it. |
| Search | The Search Wikipedia toggle searches the selected language’s Wikipedia from the Worker and shows up to four source links. The first 280 characters of the latest message are sent as the search query. Search coverage is limited to Wikipedia. |
| Attachments | Send up to three supported UTF-8 text, data, or source files at once, up to 12,000 characters each. Each attachment’s contents are included on that send. History stores file names and messages. Reattach a file to supply its original contents again. PDF, images, Office files, and binary formats are unsupported. |
| Speech | Dictation and read-aloud use the browser’s speech APIs and the selected language. Availability depends on the browser, device voices, and microphone permissions. The browser may use its platform’s speech service. |
| Markdown | Replies support headings, simple lists and quotes, emphasis, links, inline code, and fenced code with a copy button. Raw HTML is displayed as text. Nested Markdown, tables, and syntax highlighting are outside the supported subset. |
| Appearance and language | The app follows OS appearance and reduced motion settings. It adapts to desktop, tablet, and phone widths. The language button switches the interface and the default reply and speech locale. |

## Verification

Automated tests cover authentication, request validation, both rate-limit responses, bilingual search with ordered sources, the model and context payload, provider errors, and SSE chunk handling.

Local Chromium smoke coverage uses the real Worker for assets and mocked chat and speech responses. It checks desktop, tablet, and phone widths, system themes, both interface languages, chat lifecycle and persistence, settings, attachments, source links, streaming and cancellation, Markdown and clipboard copy, error recovery, dictation, and read-aloud controls. Production credentials, live model responses, real microphone and voice output, and physical Apple devices require verification in the target environment.
