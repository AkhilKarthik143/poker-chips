# Validation record

## Accounts follow-up acceptance (November 10, 2026)

- Current descendant branch `feature/customization` retains the `feature/accounts-stats` stage commits. `npm ci`, lint, 96 tests, four-player chip-conservation simulation, `git diff --check`, and `/healthz` passed. Node 24.20.0 used `node:sqlite`.
- File-backed SQLite smoke passed magic-link request/verify, private account and stats routes, a two-seat completed hand, zero-sum saved rows and updated personal stats. The temporary database was removed.
- Playwright Chromium captured `me.html` empty at 360×740 and populated at 360×740 and 390×844. No page errors or horizontal overflow. A 25px Back to table link was repaired to 44px and rechecked at both widths; the other visible controls were at least 44px.
- The old A6 group leaderboard was replaced by the later league feature. The optional Postgres adapter is absent; real email, Google, Node 20, physical-device and Render-disk behavior remain untested.

## Optional accounts and history local work (November 10, 2026)

- Node 24.20.0; SQLite `:memory:` smoke and upsert test pass. The Node 20 `better-sqlite3` path is installed but has not been run under Node 20 locally.
- Lint passes with zero warnings; 73 tests pass, including undo-safe action counters, saved-night idempotence and failure isolation, magic-link single use, session privacy, guest claim, and stats aggregation. `node scripts/simulate-four.js` passes.
- No database configured: `/api/config` reports accounts off; auth and account routes return 404 and guest socket tests pass.
- Real email delivery, cookie behavior behind Render, and persistent-disk behavior have not been exercised here.

## League local work (November 10, 2026)

- `feature/leagues` is based on the passing `feature/accounts-stats` branch. Lint and 76 tests pass.
- League integration test covers invite membership, member-only responses, season activation and rule freeze, server-owned league table settings, a guest sub, saved results, standings, void/restore with an audit reason, and champion close.
- Pure scoring tests cover fixed-point points, ties, net, capped net, ROI, drop-worst, qualification, rank movement and records.
- Live multi-device phone use, persistent Render storage and Postgres parity remain untested.

## League follow-up audit (November 10, 2026)

- Existing `feature/leagues` was based on `feature/accounts-stats`; `npm ci`, lint and all 76 baseline tests passed. Follow-up commits `6ceabad`, `b9d308e`, `08523cb`, `f434ad7` and `9f1fcdb` passed their lint/test gates. Final league branch: 82 tests pass with zero lint warnings.
- Added a table-driven permission matrix across 11 league endpoints, scoring fixtures for capped net, ROI zero buy-in, ties and drop-worst, and checks for 30-member capacity, no-database 404s, account-deletion history, privacy leakage, two live leagues, sole-owner deletion, an empty-season close, co-commissioner review and closed-result immutability.
- A file-backed SQLite smoke on port 3102 passed: health, two verified accounts, invite join, points season activation, a two-player hand, end-night persistence, cleared live code, standings and night history. The temporary smoke database was removed.
- Playwright Chromium captured all four league tabs at 360px (commissioner) and 390px (member). There were no page errors or horizontal scrollbars; visible controls met 44px tap targets. The member Rules view showed saved table settings, Nights showed a guest/sub and void reason, and Copy standings kept point units.
- `src/game.js` was not changed by the league follow-up; its diff from `main` comes from the earlier accounts/stats ledger work. No inline script or style was added. The vendored QR source already contains generated `style=` strings.
- Untested for real: physical phone browsers, actual email delivery, a live multi-device league night, Render persistent disk and Postgres. No Postgres adapter exists in this local repository.
- The league follow-ups were merged into the local `feature/customization` demo branch. Its final gate passed: lint, 94 tests and `node scripts/simulate-four.js`; the league page had no overflow at 360px or 390px, and active league-tab text met 4.5:1 contrast in all eight themes.

Validated locally on November 7, 2026 (America/Los_Angeles), on Node 24.20.0. The deployment target remains Node 20+ as configured in `render.yaml`.

## Executed checks

| Check | Result |
| --- | --- |
| Clean lockfile install: `npm ci` | Pass; 193 packages installed. npm reports 2 audit findings (1 moderate, 1 high), also recorded in the prior validation. |
| `npm run lint` | Pass; zero errors or warnings. |
| `npm test` | Pass; 64 tests, including invite URL parsing, game conservation, undo, settlement, strict socket validation, contrast and mocked push. |
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

## Room invite acceptance

Validated locally on November 7, 2026, against ephemeral servers using Playwright 1.65, bundled headless Chromium and installed Google Chrome. Desktop checks used 1280×900; mobile checks used 360×780 and 390×844. Guests used separate browser contexts.

| Scenario | Result |
| --- | --- |
| Google Chrome desktop and mobile viewport | Pass; created a room, decoded the exact QR payload on desktop, prefetched and joined from a separate 390×844 context, and verified shared room state without horizontal overflow or browser errors. |
| Invite dialog visual hierarchy and actions | Pass; QR and room code lead, invite URL is subdued, the section label no longer competes with the dialog title, hosts see **Save buy-in**, and guests see **Done**. Host buy-in changes still persist. |
| Copy-button feedback | Pass; link and code buttons show their copied labels and restore the original labels after 1.8 seconds. Clipboard values matched. |
| Narrow mobile layout | Pass at 320×740 and 390×844; all eight room-code characters remain visible, the QR remains 224px and 280px respectively, and there is no horizontal overflow. |
| Create a room; generate the origin-based invite URL and QR | Pass; URL and room code matched the active origin and generated room code. |
| Decode generated QR with Chromium `BarcodeDetector` | Pass; decoded payload exactly matched the invite URL; image was nonblank. |
| Mobile QR sizing and overflow | Pass; QR rendered 264 CSS px wide at 360 px viewport width, with no horizontal overflow. |
| Copy link and room code | Pass; clipboard contents and success feedback matched the expected values. |
| Web Share supported, cancelled and failed | Pass; supported share received the exact URL, cancellation did not copy, and a share error fell back to clipboard. |
| Clipboard API unavailable | Pass; legacy copy selected and copied the invite. When both copy methods were unavailable, selected text and clear manual-copy feedback remained. |
| Fresh invite opened with URL-encoded code | Pass; Join tab and field were prefilled; joining still required name entry and explicit confirmation. |
| Two guests open and join the same invite concurrently | Pass; both joined the same room. |
| Rejoin after refresh and multiplayer state | Pass; the seat was restored, both clients saw both players, and both saw the completed hand. |
| Manual code entry, leave flow and manual-entry preservation | Pass; manual join and leave worked, and a later same-page URL change did not overwrite an entered code. |
| Invalid, malformed, empty, missing and nonexistent room codes | Pass; invalid values were rejected with useful feedback, missing query retained create mode, and a valid-shaped nonexistent code did not crash. |
| Invite opened while already seated in a different room | Pass; the existing seat was restored and the invite code remained ready in the lobby after leaving. |
| Ten-seat capacity and eleventh guest | Pass; the room reached ten players and rejected the next join with a useful message. |
| Browser errors during share/manual-entry checks | Pass; no uncaught page errors. |

Physical phone camera scanning and the deployed Render hostname were not available in this local run. QR decoding was verified in Chromium; production invite URLs use the active page origin and still need a deployed-site check.

## Theme and customization local work (November 10, 2026)

- Branch `feature/customization` builds from passing `feature/leagues`; all work remains local and unpushed.
- Final local gate: `npm run lint` zero warnings; `npm test` 85/85 passing; `node scripts/simulate-four.js` conserved 550 chips; `node scripts/check-contrast.js` passed eight themes and high contrast; `GET /healthz` returned `{ "ok": true }`.
- Lint passes with zero warnings. The current suite covers settings schema/client enum parity and migration, no-DB routes, signed-in sync precedence, cosmetics Socket.IO validation/broadcast/revision/privacy, saved preset CRUD and ownership, host rebuy limits and mid-hand deferral. `node scripts/check-contrast.js` covers eight themes, seat colors and high-contrast tokens.
- Playwright Chromium at 1440×900 and 390×844 captured the lobby and populated game for Miami Vice, Royal Flush and Retro Arcade. The browser reported no page errors or horizontal overflow. Felt screenshots and customization panels were also inspected. Art remained outside functional content; the mobile decorative layer is hidden.
- League standings with a closed-season champion, nights, members and rules were captured at 360×740 and 390×844; all four tabs had no horizontal overflow or page errors. Signed-in preset save, rename and delete were also exercised in Chromium.
- Account settings/saved presets were exercised against an in-memory SQLite server. Real Resend delivery and persistent disk behavior are not verified locally. Node 20 fallback and physical-device sound/vibration/ergonomics remain untested.

## Account identity local work (November 10, 2026)

- Branch `feature/account-identity` starts from passing `feature/customization` (96 tests). SQLite migration v7 adds username, released-name history, avatar and privacy columns. No remote was changed.
- Stage gates: I1 lint and 99 tests; I2 lint and 101 tests; I3 lint and 103 tests plus contrast; I4/I5 lint and 105 tests. Final gate: lint with zero warnings, 105 tests, four-player chip-conservation simulation, and contrast across eight themes. The explicit no-DB test run also passed 105/105.
- Username tests cover server/client parity, case-insensitive uniqueness, cooldown and exact 30-day boundary, owner revert, post-deletion hold, concurrent claim, rate limit and no-DB 404. Profile tests cover owner/shared-league/private/guest visibility, byte-identical hidden/missing 404 bodies, atomic update validation, table opt-in and removal on sign-out. Avatar tests cover closed enums, parity, deterministic SVG, unknown keys and the server's deterministic fallback.
- A file-backed two-account smoke passed local sign-in, competing username claims, avatar saves, identical hidden/missing profile 404s, private two-seat Socket.IO views and `/healthz`; the temporary SQLite database was removed. Playwright Chromium exercised the complete local magic-link onboarding flow, builder save, profile page, profile builder dialog and a populated ten-seat table with ten account avatars. At 360×740 Felt and 390×844 Retro Arcade, ten full-page screenshots showed no overlap, horizontal overflow, uncaught page errors or visible interactive targets below 44×44 pixels. Screenshots are under ignored `artifacts/qa/identity-*.png`.
- The contrast script checks avatar icon ink against all twelve avatar backgrounds in each of eight themes and high-contrast mode. Real inboxes, physical phone browsers, screen readers and production Google sign-in remain untested.
