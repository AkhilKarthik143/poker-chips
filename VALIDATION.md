# Validation record

Validated locally on September 20, 2026 (America/Los_Angeles).

## Executed checks

| Check | Result |
| --- | --- |
| Clean lockfile install: `npm ci` | Pass; zero audit vulnerabilities |
| `npm run lint` | Pass, zero errors/warnings |
| `npm test` | 26 tests pass |
| Node 20.20.2: lint, all tests, four-player script | Pass |
| Node 24.20.0: lint and all tests | Pass |
| `node --test test/server.test.js`, three consecutive runs | 6/6 tests pass each run |
| `GET /healthz`, live server using `PORT=3000` | HTTP 200, `{"ok":true}` |
| `node scripts/simulate-four.js` | Pass: four players, two all-ins, all four streets |
| Four-player pots and final stacks | Pots 200 + 150; stacks 200/150/100/100; total 550 conserved after each action and payout |
| Three-player integration payout | Pots 300 + 80; final stacks 300/140/60; total 500 |
| Render Blueprint | Pass against official `https://render.com/schema/render.yaml.json` with JSON Schema 2020-12 validator |
| `npm audit --omit=dev` | Zero vulnerabilities |
| `git diff --check` | Pass |

## Browser acceptance

Environment: Codex in-app browser against the local Node service at `http://localhost:3000`. The user requested 360px support; tested with a 360×800 viewport, a 768×1024 tablet viewport, and the default desktop viewport. Temporary viewport overrides were reset afterward.

Observed working:

- Lobby create form and server connection indicator.
- Three-player table creation (guest seats driven by disposable Socket.IO clients).
- Blind posting, visible turn, stack and call amount.
- Call, half-pot quick bet with slider/number controls, check and all-in.
- Progress through preflop, flop, turn and river with real-card instructions.
- Refresh restored the host’s seat, stack (975) and current turn.
- Showdown picked Avery as winner of 3,000 chips.
- Host undo restored showdown; selecting Avery and June split it 1,500/1,500.
- Host rebuy restored Miles from 0 to 1,000 chips.
- No browser console errors or warnings during the completed main flow.
- At 360px, lobby, active table and payout screen each reported `document.documentElement.scrollWidth === innerWidth === 360`.
- At 768px, the expanded host controls reported matching page/viewport width of 768.
- A 24-character unbroken name and a one-billion-chip stack also fit the 360px table without horizontal overflow.
- Betting actions and quick controls use minimum 44px touch targets (main actions 48px). Focus styles and reduced-motion behavior are present.

The in-app screenshot capture did not consistently reflect the scaled mobile viewport; DOM geometry and interactive controls were used for the overflow measurements. Desktop screenshots were visually reviewed. No claim is made for physical-phone vibration hardware or a full cross-browser/device matrix.

## Delivery status

Source is committed in a standalone Git repository on `main`, with commits for setup, engine, server, interface, deployment and final verification. The public GitHub repository is https://github.com/AkhilKarthik143/poker-chips. Publication uses the authenticated browser because the local Git credential lacks write permission to this repository. See the Render dashboard for current deployment status; the Blueprint passed local schema validation.

Room persistence is intentionally in-memory. Refresh/drop recovery works while the server and room survive; restart/spin-down clears rooms, as documented in README.md.
