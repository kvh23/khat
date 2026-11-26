# Khat — Liquid Intelligence 3.0

Khat is a bilingual AI workspace for chat and image generation. It uses the existing Cloudflare Worker and Workers AI binding. The interface follows the system theme by default and supports a custom accent, reduced motion, and English or Danish.

[3.0 implementation notes, model evaluation, screenshots, and motion demo](docs/liquid-intelligence.md) · [Refinement profile and quota behavior](docs/refinement.md)

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

## Accounts, privacy, and motion

The shared `khat` / `KHAT_PASSWORD` gate still protects assets and every API route. When D1 is available, account actions and generation also require an individual account session. The shared password is still required on each device. When the production D1 binding has not been configured, the app continues using its existing local encrypted profiles.

- Usernames use 3–24 letters, numbers or underscores. Passwords are 12–128 characters. The SQLite-backed PasswordHasher Durable Object performs salted PBKDF2-SHA-256 (600,000 iterations) within Durable Objects' CPU allowance. It stores no passwords or hashes. D1 contains only salted password hashes and digests of the random invitation and session tokens.
- Invitations permit one successful registration. Admin-created invitations expire after seven days. Account sessions expire after seven days and are limited to five per user. Cookies use Secure, HttpOnly, SameSite=Strict and the `__Host-` prefix. Signing out ends the current session. Disabling or deleting an account revokes all sessions. The browser may still remember the separate shared Basic Auth login. Email recovery and self-service password resets are outside this release.
- Chats, messages, approved memories, visual preferences, and compact Studio and avatar images are stored in D1, separately for each account. Data is readable by the Cloudflare account owner through D1. The application admin dashboard shows accounts, daily counters, and limits. It has no routes for viewing another person's private chats, memories, or images.
- Conversation changes sync at sign-in, on focus, and periodically while the workspace is idle and visible. A revision check prevents simultaneous edits on two devices from silently overwriting each other. On a conflict, reload to get the currently saved version. Account export contains current server data. Keep a copy of any unsaved draft before reloading.
- The account migration tool in Settings copies chats, the former memory note, and Studio images that fit the account gallery. The old vault and any images that could not be copied stay on the device. Account visual preferences begin with defaults.
- Memory starts disabled. Enable it in Settings to retrieve up to three matching memories per chat. Khat recognizes a limited set of explicitly requested formatting and language preferences in English and Danish and saves the corresponding canonical text. Interests and projects can be added, edited, or removed manually. Khat does not automatically extract personal details or scan old chats for memories.
- Temporary chats run in the open tab and are cleared when you leave the conversation or reload. They send conversation context to Workers AI to provide replies. They do not query D1 for memory, create memories, or save chat history. Wikipedia still receives the query if search is enabled.
- New accounts default to 12 text requests and 3 image attempts per UTC day. Admins can change member limits. The existing app-wide 35 text / 8 image / 8,000 estimated Neuron ceiling remains. Successful reservations count even if generation is cancelled or the provider fails. The dashboard reports actual reserved requests rather than an estimate of the remaining Cloudflare account balance.
- Account deletion requires the password and cascades to owned rows and sessions. The last active administrator cannot delete their own account until the Cloudflare owner designates another admin in D1. D1 Time Travel can retain a historical database version for up to seven days on Workers Free. Keep the site private to trusted friends and family and avoid collecting unnecessary personal information.
- The orb follows actual generation, first response text, dictation, and Studio activity. The voice meter processes microphone amplitude in the browser and releases its stream after listening. Dictation itself continues to use the browser's speech API. Unsupported or denied microphone analysis leaves the listening state visible without amplitude updates. Animation controls apply per account and always respect reduced-motion settings.

[Workers Free CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) · [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/#cpu-per-invocation) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

### Local account tests

```sh
npm ci
npm test -- --run
npm run check
npm run test:accounts
npx playwright install chromium
npm run test:accounts -- --browser
```

The account smoke test starts an isolated local Worker and D1 on port 8799, applies the migration, creates a short-lived test admin invite, and removes its test storage after completion. Browser checks use mocked AI and speech. The script also samples 50 animation frame intervals in Chromium. For an interactive local review use a separate store and avoid reusing the fixture password outside localhost:

```sh
npx wrangler d1 migrations apply khat-accounts --local --config wrangler.accounts.jsonc --persist-to .wrangler/accounts-review
node scripts/bootstrap-invite.mjs --local --config wrangler.accounts.jsonc --persist-to .wrangler/accounts-review
npx wrangler dev --config wrangler.accounts.jsonc --port 8798 --persist-to .wrangler/accounts-review --var KHAT_PASSWORD:local-test-only
```

On http://localhost:8798 sign in to the outer gate as `khat` with `local-test-only`. Choose **Use an invitation** and redeem the local administrator code. This config intentionally omits the AI binding.

### Cloudflare setup after review

On a checkout of the approved changes, use an authenticated Wrangler CLI. Use a separate Worker name and D1 database for a live Free-plan staging check before enabling production accounts. The existing production Workers Builds integration can publish when the final configuration is merged, so provision and migrate D1 before merging that configuration.

1. On Workers Free, create production D1 and add the generated `DB` binding and UUID to `wrangler.jsonc`. Check the config diff before committing it.

   ```sh
   npx wrangler d1 create khat-accounts --binding DB --update-config --config wrangler.jsonc
   npx wrangler d1 migrations apply khat-accounts --remote --config wrangler.jsonc
   ```

2. Ensure the new D1 entry has `"migrations_dir": "migrations"`. Add `"vars": { "ACCOUNTS_REQUIRED": "true" }` so the account APIs fail closed if the bindings are missing. Keep both Durable Object bindings and both migration tags, and keep `AI` and the deployed **KHAT_PASSWORD** secret. Never put the secret in source or chat.
3. Generate the initial operator invitation from an authorized terminal. Share only member invitations and keep the bootstrap code private.

   ```sh
   node scripts/bootstrap-invite.mjs --remote --config wrangler.jsonc
   ```

4. Test the staging login, invite redemption, account isolation, account export, model calls, and Cloudflare Free metrics. Then submit the real D1 configuration for approval and release through the existing Workers Builds workflow. Once deployed, use the bootstrap code with **Use an invitation** and issue member codes from **Administration**.

D1 Free includes up to 5 million rows read per day, 100,000 rows written per day, and 5 GB total account storage. Workspace writes update changed rows and limit each submitted workspace to 700 KB, 60 chats with at most 160 messages each, and 40 memories. Studio stores up to 12 compact JPEGs per account. The Free plan also applies its account-wide Workers, AI, and Durable Objects limits. No billing changes are required.

## Cloudflare catalog and free allocation

Catalog and rates checked on 26 November 2026. Workers AI on the Workers Free plan includes 10,000 Neurons per day across the Cloudflare account. The documented prices below describe consumption within that allocation. These are Cloudflare-hosted models, and Khat does not enable paid services. Account owners should keep the account on Workers Free to prevent paid overage, since other Workers share the allocation. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Model catalog](https://developers.cloudflare.com/workers-ai/models/)

| Mode | Model | Neurons per million input / output tokens |
| --- | --- | --- |
| Khat Instant | [Granite 4.0 H Micro](https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/) | 1,542 / 10,158 |
| Khat Think | [GLM-4.7-Flash](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/) | 5,500 / 36,400 |
| Khat Pro | [Gemma 4 26B A4B IT](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) | 9,091 / 27,273 |
| Existing model and fallback | [Llama 3.3 70B Instruct FP8 Fast](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) | 26,668 / 204,805 |
| Evaluated, excluded | [NVIDIA Nemotron 3 Super 120B A12B](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/) | 45,455 / 136,364. Cloudflare marks it deprecated as of 20 November 2026. |

Automatic selection uses prompt and context length and Danish/English reasoning cues. These rules are heuristic. The model shown on a completed reply is the model that started its stream. If the selected provider call fails before streaming, Khat can try a fallback within the remaining budget. A stream that fails in progress can be retried by the user. Thinking traces are omitted from the rendered answer. The candidate models were evaluated against the official catalog, API contracts, capabilities and rates. Live quality, latency, and account-specific access have not been benchmarked.

Studio calls [FLUX.1 Schnell](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) at two, four, or eight steps. Cloudflare lists 4.8 Neurons per 512×512 tile and 9.6 per step. The documented API does not accept output dimensions. Portrait and landscape add composition guidance and use a local center crop for the preview, history, and downloaded JPEG.

## Security and usage

- The Worker protects static assets and API routes with the existing `khat` / `KHAT_PASSWORD` authentication. Keep the existing secret bound in Cloudflare. The Worker fails closed when the secret is missing. Serve it over HTTPS.
- A SQLite-backed Cloudflare Durable Object atomically reserves usage for the entire Khat Worker, across locations. Each UTC day permits up to 35 chat requests, 8 Studio attempts, and 8,000 estimated Neurons, whichever limit is hit first. Failed or cancelled attempts consume their reservations. Each fallback reserves more estimated Neurons, and model input/output caps apply. Reservations estimate the upper cost using submitted UTF-8 bytes plus overhead and the output token cap. Studio reserves 500 Neurons for the generation and safety calls. These are conservative app limits, not a Cloudflare billing meter. The Cloudflare Free plan enforces the account-wide limit.
- The existing per-location rate limits still apply. The API validates input and modes, rejects cross-site requests, and limits request and response sizes. Markdown uses DOM text nodes and HTTP(S) links.
- All chats use a server-owned teen-appropriate safety prompt. Studio uses Gemma 4 for separate prompt and visual output screening. A denial, malformed response, or classifier failure withholds the image. Model-based screening can make mistakes. Text streams are guided by the system prompt and have no independent output classifier.
- Legacy local profiles use client-side AES-GCM encryption with PBKDF2-derived keys and unique salts. Profile names are visible in the picker. Each vault is unlocked by its own passphrase and can be open in only one tab at a time. Reloading locks it. A forgotten passphrase cannot be recovered. Protect the unlocked session and use a trusted device. The shared Worker login is separate from local profile passphrases.
- Legacy profile data is local to this browser and origin until imported into an account. Requests send only the current profile’s relevant context to Workers AI. Existing unencrypted history can be imported into a profile by selecting the import option at creation. Khat removes old storage only after the encrypted copy is saved.

[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Durable Objects on Workers Free](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## Feature limitations

- Conversation search covers titles and messages in the current profile’s active or archived view. Editing a message replaces later turns on a successful reply. Regenerate acts on the latest reply. These actions do not re-send the original attachments. Stop cancels the browser stream and may keep partial text. Cloudflare can continue processing an already-started call.
- Memory is off by default. Inspect, edit, or clear it in Settings, then save. It is user-managed and has no automatic extraction. The assistant name, style, length, and instructions are preferences within the server safety rules.
- Search is Wikipedia only. The selected language’s Wikipedia receives up to 280 characters of the latest prompt when search is on. Attachments support up to three UTF-8 text, data, or source files of 12,000 characters each. Previous attachments retain filenames only.
- Studio stores up to 12 images per account or encrypted local profile. Download anything you want to keep outside the browser before clearing site data.
- The legacy vault requires a modern browser with IndexedDB, Web Crypto, and Web Locks. Speech availability depends on the browser, its platform service and device permissions. Markdown covers common headings, lists, quotes, emphasis, links, simple pipe tables, and fenced code with lightweight highlighting and copy. Native Safari and physical Apple devices, Cloudflare account-level model access, and real image safety responses remain to be checked in a review environment.
