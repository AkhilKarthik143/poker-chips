# Validation record

Validated locally on November 7, 2026 (America/Los_Angeles), on Node 24.20.0. The deployment target remains Node 20+ as configured in `render.yaml`.

## Executed checks

| Check | Result |
| --- | --- |
| Clean lockfile install: `npm ci` | Pass; 192 packages installed. npm reports 2 audit findings (1 moderate, 1 high). |
| `npm run lint` | Pass; zero errors or warnings. |
| `npm test` | Pass; 63 tests, including game conservation, undo, settlement, strict socket validation, client helpers, contrast and mocked push. |
| `node scripts/check-contrast.js` | Pass for Felt, Midnight, Burgundy, Graphite and Daylight; thresholds cover text, disabled text, accent buttons/surfaces, settle-up net colors, borders and focus rings. |
| `node scripts/simulate-four.js` | Pass: four players, two all-ins, every street; pots 200 + 150, final stacks 200/150/100/100, 550 chips conserved. |
| `npm start` and `GET /healthz` | Pass; HTTP 200 with `{"ok":true}`. |
| Manifest, service worker and icons | Pass in Chromium; correct static routes/content types, manifest JSON, local service-worker installation. |
| `git diff --check` | Pass. |
| CSP template scan | Pass; no inline `<script>` or `style="…"` attributes in `public/` templates. |
| Game-rule diff review | Pass; `src/game.js` adds ledger fields and settlement only, without changing betting, pot, or payout logic. |

## Browser acceptance

Used Playwright 1.65 with isolated Chromium contexts and ephemeral local servers; the user's existing browser tab and live table were not reused.

- Theme bootstrap applied before CSS, survived reload, updated `theme-color`, and preserved the selected theme. The lobby and table radio groups support arrow-key navigation.
- 2-, 6- and 10-player tables at 360×740, 390×844, 768×1024 and 1280×800 measured no horizontal overflow and no overlapping seat cards.
- Reorder, Tonight and raise overlays remained within all four viewport widths. A guest joined while a reorder drag was active; the latest state queued until drop, retained the draft, and the saved server order exactly matched the visible preview. Raised the tablet raise-panel gap after this check found a 3px overlap with the dock at 768px.
- Captured lobby, 2/6/10-player tables, reorder, raise and Tonight screenshots at all four viewport sizes under `/tmp/tablemate-qa` (temporary QA output, not part of the repository).
- Audited visible button, link, field, summary, radio and labeled-checkbox hit areas at 360×740 and 390×844 across the lobby, join confirmation, table, controls, Your seat/theme picker, reorder, Tonight, leave confirmation and raise panel. All measured hit areas were at least 44×44 CSS pixels.
- With VAPID missing, the push control is hidden. With mocked VAPID configuration and an iPhone user-agent outside standalone mode, the Your seat panel shows Add to Home Screen guidance and no permission button.
- Manifest and service-worker routes return expected MIME types; the same-origin worker installs. No browser script errors occurred in these runs.

Real push delivery was mocked because no VAPID keys are configured here. The Render Blueprint declares the three values but they must be added in the service environment to enable notifications.

## Not verified on physical devices

- Android vibration and the browser's native notification behavior.
- iOS audio and silent-switch behavior, Home Screen push delivery/click handling, and real-world wake-lock behavior.
- Push delivery against real FCM, Apple, Mozilla or Windows subscriptions and provider key rotation.

The prior project validation covered full hand play, reconnect, raise controls, showdown/undo, rebuy, and seat-order behavior. Rooms remain process-local: reconnect works only while the room survives, and a restart clears the room and its push subscriptions.
