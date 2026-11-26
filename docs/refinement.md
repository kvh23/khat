# Liquid Intelligence refinement

## Profile

A local headless Chromium profile used the same 1,250 × 810 dark desktop, synthetic account, 26 conversation titles and one 120-message conversation. The workload opened the longest conversation, collapsed and reopened the sidebar, typed a short draft, and moved the pointer over navigation. Network fixture responses kept AI and network variance out of this measurement.

| Chromium CDP metric | 3.0 | Refinement |
| --- | ---: | ---: |
| Gallery requests before opening Studio | 1 | 0 |
| Layout passes during the workload | 157 | 57 |
| Style recalculations | 234 | 123 |
| Cumulative layout time | 119 ms | 69 ms |
| Main-thread task time | 1,027 ms | 534 ms |

Reproduce using Node.js 22+, `npm ci`, and an installed Playwright Chromium. Set `KHAT_CHROMIUM_PATH` for a compatible preinstalled Chromium.

```sh
mkdir -p /tmp/khat-refinement-baseline
git archive f2c2dce public | tar -x -C /tmp/khat-refinement-baseline
node scripts/profile-refinement.mjs /tmp/khat-refinement-baseline/public
node scripts/profile-refinement.mjs
```

The profile is a local comparison. It does not certify Safari, iOS, device-wide frame rates, or production inference latency.

## Changes

- The drawer shifts with a transform on mobile and applies a single layout change on desktop. The composer uses native field sizing when supported, with a frame-coalesced measurement fallback.
- Starting, stopping or completing a stream retains the existing message DOM. The renderer rebuilds the changed tail and preserves the user's scroll position when they move away from the live response. On server-filtered streams, the browser skips its redundant reasoning-text pass. Older streams retain local filtering.
- Studio retrieves its account gallery on the first open. The startup path no longer requests image bytes. Account-backed chat selection also avoids sending a workspace write for a value the server does not store.
- Glass chooses a tier from browser support, pointer capability, resource hints and accessibility preferences. It uses a small translated highlight layer, keeps most surfaces blur-free and uses opaque surfaces for high-contrast, reduced-transparency or unsupported environments. The orb uses isolated light layers and updates audio values only on the orb and waveform. Voice states still follow actual browser audio and speech events.
- Daily generation defaults are 12 chat requests and 3 image attempts per user. These are independent of the storage limits of up to 60 saved conversations and 12 saved images, subject to the existing workspace size limit. Studio now shows image usage and the gallery cap separately. Administrators can adjust their own limits in Administration and can still set member limits. Existing account limits are preserved. Shared caps remain 35 chat requests, 8 image attempts and 8,000 estimated Neurons per UTC day.

No new migrations, services, billing changes or secret configuration are required. Existing D1 reads remain owner-scoped. No production D1 latency or native Apple hardware benchmark was available during review.
