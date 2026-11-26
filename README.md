# Khat 2.0

Khat is a bilingual AI workspace for chat and image generation. It uses the existing Cloudflare Worker and Workers AI binding. The interface follows the system theme by default and supports a custom accent, reduced motion, and English or Danish.

## Review and test

Use Node.js 22 or newer.

```sh
npm ci
npm test -- --run
npm run check
```

The automated tests mock model and Wikipedia responses. The build check runs TypeScript and a Wrangler deployment dry run. No Cloudflare API token is needed.

For a local browser review, use the test-only password shown below. Open http://localhost:8797 and sign in with username `khat`. You can create an encrypted profile and use the interface. This configuration omits the AI binding so testing uses no Workers AI allocation.

```sh
npm run e2e:dev -- --port 8797 --var KHAT_PASSWORD:local-test-only
```

With the local Worker running, install Playwright’s Chromium and run the browser smoke test from another terminal. Set `KHAT_CHROMIUM_PATH` if using a compatible system Chromium.

```sh
npx playwright install chromium
npm run test:browser
```

The browser test intercepts chat and Studio requests and simulates browser speech. It covers the profile lock, legacy import, personalization and memory, responsive themes, chat controls, source links, Studio cropping and downloads, and archive/search behavior.

## Cloudflare catalog and free allocation

Catalog and rates checked on 26 November 2026. Workers AI on the Workers Free plan includes 10,000 Neurons per day across the Cloudflare account. The documented prices below describe consumption within that allocation. These are Cloudflare-hosted models, and Khat does not enable paid services. Account owners should keep the account on Workers Free to prevent paid overage, since other Workers share the allocation. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Model catalog](https://developers.cloudflare.com/workers-ai/models/)

| Mode | Model | Neurons per million input / output tokens |
| --- | --- | --- |
| Khat Instant | [Llama 3.1 8B Instruct FP8](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/) | 13,778 / 26,128 |
| Khat Think | [Qwen3 30B A3B FP8](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/) | 4,625 / 30,475 |
| Khat Pro | [Gemma 4 26B A4B IT](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) | 9,091 / 27,273 |
| Existing model and fallback | [Llama 3.3 70B Instruct FP8 Fast](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) | 26,668 / 204,805 |
| Evaluated, excluded | [NVIDIA Nemotron 3 Super 120B A12B](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/) | 45,455 / 136,364. Cloudflare marks it deprecated as of 20 November 2026. |

Automatic selection uses prompt and context length and Danish/English reasoning cues. These rules are heuristic. The model shown on a completed reply is the model that started its stream. If the selected provider call fails before streaming, Khat can try a fallback within the remaining budget. A stream that fails in progress can be retried by the user. Thinking traces are omitted from the rendered answer. The candidate models were evaluated against the official catalog, API contracts, capabilities and rates. Live quality, latency, and account-specific access have not been benchmarked.

Studio calls [FLUX.1 Schnell](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) at four steps. Cloudflare lists 4.8 Neurons per 512×512 tile and 9.6 per step. The documented API does not accept output dimensions. Portrait and landscape add composition guidance and use a local center crop for the preview, history, and downloaded JPEG.

## Security and usage

- The Worker protects static assets and API routes with the existing `khat` / `KHAT_PASSWORD` authentication. Keep the existing secret bound in Cloudflare. The Worker fails closed when the secret is missing. Serve it over HTTPS.
- A SQLite-backed Cloudflare Durable Object atomically reserves usage for the entire Khat Worker, across locations. Each UTC day permits up to 35 chat requests, 8 Studio attempts, and 8,000 estimated Neurons, whichever limit is hit first. Failed or cancelled attempts consume their reservations. Each fallback reserves more estimated Neurons, and model input/output caps apply. Reservations estimate the upper cost using submitted UTF-8 bytes plus overhead and the output token cap. Studio reserves 500 Neurons for the generation and safety calls. These are conservative app limits, not a Cloudflare billing meter. The Cloudflare Free plan enforces the account-wide limit.
- The existing per-location rate limits still apply. The API validates input and modes, rejects cross-site requests, and limits request and response sizes. Markdown uses DOM text nodes and HTTP(S) links.
- All chats use a server-owned teen-appropriate safety prompt. Studio uses Gemma 4 for separate prompt and visual output screening. A denial, malformed response, or classifier failure withholds the image. Model-based screening can make mistakes. Text streams are guided by the system prompt and have no independent output classifier.
- Profiles use client-side AES-GCM encryption with PBKDF2-derived keys and unique salts. Profile names are visible in the picker. Each vault is unlocked by its own passphrase and can be open in only one tab at a time. Reloading locks it. A forgotten passphrase cannot be recovered. Protect the unlocked session and use a trusted device. The shared Worker login is separate from local profile passphrases.
- Profile data is local to this browser and origin. Khat has no server history endpoint and no cross-device sync. Requests send only the current profile’s relevant context to Workers AI. Existing unencrypted history can be imported into a profile by selecting the import option at creation. Khat removes old storage only after the encrypted copy is saved.

[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Durable Objects on Workers Free](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## Feature limitations

- Conversation search covers titles and messages in the current profile’s active or archived view. Editing a message replaces later turns on a successful reply. Regenerate acts on the latest reply. These actions do not re-send the original attachments. Stop cancels the browser stream and may keep partial text. Cloudflare can continue processing an already-started call.
- Memory is off by default. Inspect, edit, or clear it in Settings, then save. It is user-managed and has no automatic extraction. The assistant name, style, length, and instructions are preferences within the server safety rules.
- Search is Wikipedia only. The selected language’s Wikipedia receives up to 280 characters of the latest prompt when search is on. Attachments support up to three UTF-8 text, data, or source files of 12,000 characters each. Previous attachments retain filenames only.
- Studio stores up to 12 images in the encrypted local profile. Download anything you want to keep outside the browser before clearing site data.
- The vault requires a modern browser with IndexedDB, Web Crypto, and Web Locks. Speech availability depends on the browser, its platform service and device permissions. Markdown covers common headings, lists, quotes, emphasis, links, and fenced code with copy. Native Safari and physical Apple devices, Cloudflare account-level model access, and real image safety responses remain to be checked in a review environment.
