# Tablemate / Poker Chips

Physical cards. Virtual chips. A mobile-first chip bank and authoritative betting engine for 2–10 people playing Texas Hold’em around the same table. The app never deals, displays, stores, or evaluates cards. Accounts are optional; there are no payments or chat.

**[Play Tablemate on Render](https://poker-chips-o7n9.onrender.com/)**

## Play with a real deck

1. The host creates a table, chooses a starting stack and blinds, and optionally enables a blind timer.
2. Friends open the **same service URL** on their phones, tap **Join a table**, and enter the eight-letter code and their names. For local testing, phones must use your computer’s LAN address on the same Wi-Fi; `localhost` on a phone is the phone itself.
3. Deal physical hole cards. The host taps **Start first hand**. The server moves the dealer button, posts blinds and identifies the current player. With two players the dealer posts the small blind and acts first preflop.
4. Use Fold, Check, Call, Raise or All-in. A raise amount is the **total bet for that street**, including chips already in front of you. Quick buttons offer minimum, half-pot, pot and all-in. Half-pot/pot raises use the pot after calling.
5. When the street changes, reveal the appropriate physical community cards. If everyone remaining is all-in, betting skips to showdown: physically complete the board before choosing winners.
6. At showdown, compare the real cards. The host selects every tied winner **for each pot**, then confirms. The app only offers eligible players. All payouts settle together once every pot is assigned. Split-pot odd chips go clockwise from the dealer, starting with the first winning player to the dealer’s left.
7. Collect the cards and start the next hand. **Host controls** provide rebuys/add-ons, settings, kick and undo. **Your seat** provides sit-out and leave.

## Share a room invite

From the table’s **Invite** or **Invite players** control, share the QR code, copy the room code, copy the invite link, or use the device share sheet when available. The link uses the current service origin and includes only the public room code (`?code=ABCDEFGH`). Opening it fills the existing **Join a table** code field; the guest still chooses a name and confirms the normal join flow. The QR is generated locally with the vendored `qrcode-generator` browser library, so no invite data is sent to a QR service.

## Local run

Node 20 is the requested deployment target. Node 20+ is supported; no frontend build step is required.

```sh
npm ci
npm start
# Open http://localhost:3000
```

```sh
PORT=8080 npm start
npm run dev       # node --watch
npm run lint
npm test
node scripts/simulate-four.js
```

The service binds `0.0.0.0` and reads `process.env.PORT`, defaulting to 3000. `GET /healthz` returns HTTP 200 and `{"ok":true}`. Keep a single service instance: rooms are process-local.

## Optional accounts and saved nights

Guest play stays available with no setup. Set `TABLEMATE_DB_PATH=./data/tablemate.db` to enable SQLite night history, personal stats and magic-link accounts. Node 22.5+ uses `node:sqlite`; Node 20 uses `better-sqlite3`. Leave the variable unset to disable these features and keep the existing guest behavior. In production, also configure `RESEND_API_KEY` and `MAIL_FROM`; without them account routes remain disabled. Development prints sign-in links to stdout. `GET /api/config` reports whether accounts are available.

The server saves a night after each completed hand, when the host sends `host:endNight`, and when an occupied room expires or empties. Active rooms and seat connections remain in memory and are lost on restart. A signed-in player is linked to their seat; a former guest can claim a saved night using the private seat token retained on that device. The **My stats** page shows lifetime totals and a net-over-time chart. Account export returns account details and night rows. Account deletion removes login sessions and account links from saved rows while keeping anonymous table totals for other players. Magic links last 15 minutes; sessions last 30 days. Email, session secrets, claim hashes and account IDs are never broadcast to table peers.

Account APIs: `POST /api/auth/request`, `POST /api/auth/verify`, `POST /api/auth/logout`, `GET/PATCH/DELETE /api/me`, `GET /api/me/stats`, `POST /api/nights/claim`, and `GET /api/me/export`. Mutating APIs require the same origin; signed-in APIs require an HttpOnly session cookie.

Tablemate is an **informal tally for friends, not a gambling or payments platform**. It never moves money.

## House rules and recovery

- Whole-number chips, no antes, no rake. Settings and each chip add are capped at one billion; the full table ledger is capped at one trillion.
- Short all-ins do not reopen betting for players who already acted unless cumulative increases reach a full raise. Players who have not acted can raise. Uncalled chips return automatically. No betting into an uncontested side pot.
- Before the first hand, changing the starting stack resets all seated stacks. Afterward it only affects new seats; existing players use host-approved add-ons.
- Join, leave, kick, rebuy and settings changes happen between hands. Sit-out affects the **next** hand; it does not fold the current one. The dealer skips sitting-out or busted players.
- A player can request a rebuy during a hand; the host can approve it between hands or deny it. Requests do not invalidate an in-flight betting action. Players can also donate only their own chips between hands.
- Blind timers double blinds only at the start of a hand. Multiple elapsed levels are applied then. A new timer starts with the next hand after settings change.
- Refresh or a dropped connection restores your seat using a random bearer token in localStorage. Do not clear browser storage mid-game. One active connection per seat; opening the seat in another tab moves control there. Tokens never appear in room broadcasts.
- Disconnects preserve stacks and do not fold. If the **current player** is disconnected, the host can fold that seat from Host controls. If the host disconnects, reconnect the host’s browser; host authority is not granted to a guest. If the host explicitly leaves between hands, authority transfers to the first remaining seat.
- Undo restores the last betting action or showdown assignment, including settled payouts, with up to 40 snapshots. Starting a hand or administrative changes establish a new undo boundary. Connections and tokens are not rewound.
- Rooms are in-memory and expire after six hours without user activity or a server restart. Use **Tonight → Copy summary** before leaving the table. Hand logs keep the most recent 200 entries.

## Tonight ledger and settle-up

The Players panel, between-hands dock and Leave confirmation show the nightly ledger. It tracks each seat’s buy-ins and rebuys, current stack or departed cash-out, and hands won/played. A player who leaves and rejoins is merged by their normalized, case-insensitive name. The app sorts net results and suggests deterministic transfers that settle the table; **Copy summary** is plain text for the group chat. A host can optionally set a cash value per 1,000 chips. These are informal estimates only: the app does not handle money and is not a gambling or payments platform.

## Alerts, themes and turn notifications

- **Your seat → Alerts & display** controls turn/win sounds, vibration where supported, and screen wake lock where available. Browser audio unlocks after a user gesture; an iPhone silent switch can mute it. The in-page features work without push configuration.
- **Color theme** appears in the lobby and Your seat. Felt, Midnight, Burgundy, Graphite and Daylight are available, along with **Match system**. The choice is stored in local browser storage.
- Web Push is optional and disabled until the server has all three VAPID values. See [DEPLOY.md](DEPLOY.md) for key generation and configuration. Enable it from Your seat on the device that should receive alerts. On iPhone/iPad, add Tablemate to the Home Screen first. Subscriptions are kept in memory and must be enabled again after a server restart.

## Deploy to Render

See [DEPLOY.md](DEPLOY.md) for exact repository and deployment commands. The included `render.yaml` creates one free Node web service using `npm ci`, `npm start`, `/healthz` and `NODE_VERSION=20`.

**Render’s free tier sleeps after inactivity. In-memory rooms are lost whenever the service restarts or spins down, and the first load can be slow. Wake it up before game night**, then create your table. A reconnect token cannot recover a room after a restart. Use a single always-on instance plus durable shared storage if you later need persistent rooms; persistence is outside this project’s requested scope.

Reference: [Render Blueprint specification](https://render.com/docs/blueprint-spec) and [free service behavior](https://render.com/docs/free).

## Code map

- `src/game.js` — pure immutable state transitions, validation, pots, payouts and undo; no I/O.
- `src/server.js` — Express, Socket.IO, private seat tokens, authorization, cleanup and public state projection.
- `public/` — vanilla HTML/CSS/JS; responsive table, five themes, in-page alerts, optional service worker and local icons. All assets are local.
- `public/vendor/qrcode.js` — local MIT-licensed `qrcode-generator` browser build used for room invite QR codes.
- `test/game.test.js` — rule examples, split/side pots and randomized chip conservation.
- `test/server.test.js` — real Socket.IO clients; full hand and access/reconnect/cleanup coverage.
- `test/push.test.js` — mocked Web Push delivery, subscription privacy, hidden/disconnected presence and VAPID-off behavior.
- `test/contrast.test.js`, `scripts/check-contrast.js` — palette contrast gate for text, accent buttons, disabled text, borders, focus and settle-up net colors.
- `scripts/simulate-four.js` — reproducible four-player, two-all-in service simulation.
- `NOTES.md`, `VALIDATION.md` — assumptions, work record and validation evidence.

## Socket contract

Every request includes a payload object and receives `{ok:true, ...}` or `{ok:false, error}` through its acknowledgement. Seated clients receive personalized `state` events. **Every mutating table request requires its private `token` and `revision` equal to the latest state revision**; the server rejects duplicate or stale intents. Authorization comes from the socket’s bound seat, never a supplied actor ID.

| Event | Payload (in addition to revision where required) | Access |
| --- | --- | --- |
| `create` | `name`, optional `settings` | Unseated socket |
| `join` | `code`, `name`, optional confirmed `expectedBuyIn` | Unseated; between hands |
| `table-preview` | `code` | Unseated; read-only |
| `rejoin` | `code`, `playerId`, `token` | Valid private seat token |
| `start-hand` | — | Host |
| `host:endNight` | optional `revision` | Host, between hands after at least one hand |
| `action` | `type`: fold/check/call/raise/all-in; `amount` for raise-to | Current player |
| `showdown-pick` | `potId`, `winnerIds` | Host |
| `host-settings` | `settings`: startingStack/smallBlind/bigBlind/blindMinutes/optional centsPer1000Chips | Host, between hands |
| `host:reorderSeats` | Full `order` array of player IDs | Host, between hands |
| `rebuy` | `playerId`, `amount` | Host, between hands |
| `sit-out` | `value`: boolean | Own seat |
| `donate` | `recipientId`, `amount` | Own seat, between hands |
| `leave` | — | Own seat, between hands |
| `kick` | `playerId` | Host, between hands |
| `host-fold` | — | Host, disconnected current player only |
| `undo` | — | Host |
| `rebuy:request` | optional `amount` | Own seat; any time, defaults to starting stack |
| `rebuy:cancel` | — | Own seat with a pending request |
| `rebuy:deny` | `playerId` | Host |
| `rebuy:approve` | `playerId`, optional `amount` | Host, between hands |
| `push:subscribe` | `subscription` | Own seat; requires server VAPID configuration |
| `push:unsubscribe` | — | Own seat |
| `presence` | `hidden`: boolean | Own seat; reports page visibility |

Gameplay and administration mutations (`start-hand`, `action`, `showdown-pick`, `host-settings`, `host:reorderSeats`, `rebuy`, `sit-out`, `donate`, `leave`, `kick`, `host-fold`, `undo`, and `rebuy:approve`) require the latest `revision` and the seat’s private `token`. `rebuy:request`, `rebuy:cancel`, `rebuy:deny`, Web Push and presence events are authenticated but do not change the revision; the client may still include its current revision. Entry events use their specific preview/join/rejoin checks. Seat tokens and push subscriptions never appear in state projections. The server limits each socket to 40 requests/second, payloads to 16 KiB and total live rooms to 1,000. Room codes invite players; seat tokens control an existing seat.


## Visual seating

Play at https://poker-chips-o7n9.onrender.com/ (deployment details in DEPLOY.md). Free-tier cold starts can be slow.
Seats appear clockwise around an oval, with D/SB/BB markers and a highlighted current actor. Only occupied seats are shown. Between hands, hosts can drag occupied seats onto another occupied slot or select List view for numbered arrow controls, preview next-hand blinds, then Save order. Saving a changed arrangement resets the next button to the first eligible seat; subsequent hands rotate normally. Everyone receives the saved order immediately.

### Security and names
Names are trimmed, Unicode-normalized, limited to 20 characters, and unique within a room without regard to case. Control characters and angle brackets are rejected; displayed names are HTML-escaped by the client. Disconnected seats retain their name and chips until leave/kick, allowing the original token to reconnect safely.

Room codes contain eight random letters. Each mutation needs both the socket-bound seat token and current revision. Strict schemas reject unexpected fields and unsafe numbers. Production accepts only the configured Render origin. Entry attempts share per-IP limits across connections (12 creates or 30 join/preview/rejoin attempts per minute); seated requests are capped at 40 per second per connection. No virtual cards exist or are transmitted.
