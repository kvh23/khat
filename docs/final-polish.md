# Performance and final polish

Settings applied all appearance settings on every visual input event. This repeatedly wrote inherited CSS properties on the document root and also updated unrelated sidebar controls. The dialog and composer could apply backdrop filters, and decorative motion continued behind Settings. The workspace network trace showed one initial read and one write after Save in the baseline.

- Removed the pointer listeners, moving glass highlights, and their SVG filter. The welcome and activity orbs still use the existing motion controller.
- Settings applies visual previews at most once per animation frame and only writes changed appearance properties. It pauses the preview orb when it scrolls out of view and pauses decorative motion behind the dialog. Save commits the preview and Cancel restores the saved preferences.
- Navigation and dialogs use stationary surface highlights. The focused composer is the only surface that uses live backdrop filtering, with lightweight and opaque variants available through the existing device and accessibility preferences.

## Measurements

Headless Chromium on Linux, desktop viewport, fixture workspace, 240 slider input events across 30 animation frames. Medians from three runs per version. Browser task duration includes all main-thread work reported by Chromium during each sample.

| Settings workload | Before | After |
| --- | ---: | ---: |
| Main-thread tasks during slider input | 488 ms | 298 ms |
| Layout passes during slider input | 30 | 27 |
| Style recalculations during slider input | 31 | 30 |
| Workspace writes before Save | 0 | 0 |
| Workspace writes after Save | 1 | 1 |

Run `KHAT_CHROMIUM_PATH=/usr/bin/chromium node scripts/profile-settings.mjs --verify` to profile and verify the fixture. Add `--mobile` for the narrow viewport, or pass a path to a baseline public directory for a measurement without assertions. The timings are specific to the fixture and environment. Safari and physical iOS devices were outside this run.

## Verification

- Desktop and mobile-layout Chromium checks for live preview, single-write Save, cancellation, preview visibility, glass filtering, and orb preservation.
- All 34 Vitest tests, the D1 account and Chromium smoke suites, and the TypeScript and Wrangler dry run passed.
