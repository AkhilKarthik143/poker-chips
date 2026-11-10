# Tablemate / Poker Chips

Physical cards. Virtual chips. A mobile-first chip bank and authoritative betting engine for 2–10 people playing Texas Hold’em around the same table. The app never deals, displays, stores, or evaluates cards. Accounts are optional; there are no payments or chat.

**[Play Tablemate on Render](https://poker-chips-o7n9.onrender.com/)**

The account, league, theme and customization work described below is currently on local branches. The Render link may serve an earlier version until these commits are deployed.

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

Guest play stays available with no setup. Set `TABLEMATE_DB_PATH=./data/tablemate.db` to enable SQLite night history, personal stats and accounts. Node 22.5+ uses `node:sqlite`; Node 20 uses `better-sqlite3`. Leave the variable unset to disable these features and keep the existing guest behavior. For email sign-in in production, configure `RESEND_API_KEY` and `MAIL_FROM`. For Google sign-in, configure `GOOGLE_CLIENT_ID` with a Google OAuth **Web application** client ID and add the app's origin to its authorized JavaScript origins in Google Cloud. For this local demo, authorize `http://127.0.0.1:3101`; for deployment, authorize the exact HTTPS origin. Google sign-in uses Google's own button and server-side ID-token verification; it does not need a client secret or redirect URI. Accounts are available when either sign-in method is configured with SQLite. `GET /api/config` reports which methods are available.

With accounts enabled, the home panel and header show **Sign in**. For a local browser demo without email delivery, run `TABLEMATE_DB_PATH=./data/tablemate.db TABLEMATE_DEV_LOGIN=1 npm start` and open the site through `localhost` or `127.0.0.1`. After entering an email, the sign-in page shows a one-time link you can open there. The link is returned only for loopback requests using the development console mailer; do not use this switch on a shared server. Normal development still prints links to the terminal, and production email sign-in requires delivery.

The sign-in page shows **Continue with Google**. It becomes active when `GOOGLE_CLIENT_ID` is configured; otherwise it remains disabled with a clear message. Google identities are linked by Google's stable subject ID. Verified Gmail or Workspace accounts can join an existing Tablemate account with the same email. For other email domains, use the email link if that Tablemate account already exists. The Google identity is included in account export and removed on account deletion.

The server saves a night after each completed hand, when the host sends `host:endNight`, and when an occupied room expires or empties. Active rooms and seat connections remain in memory and are lost on restart. A signed-in player is linked to their seat; a former guest can claim a saved night using the private seat token retained on that device. The **My stats** page shows lifetime totals and a net-over-time chart. Account export returns account details and night rows. Account deletion removes login sessions and account links from saved rows while keeping anonymous table totals for other players. Magic links last 15 minutes; sessions last 30 days. Email, session secrets, claim hashes and account IDs are never broadcast to table peers.

Account APIs: `POST /api/auth/request`, `POST /api/auth/verify`, `POST /api/auth/google`, `POST /api/auth/logout`, `GET/PATCH/DELETE /api/me`, `GET /api/me/stats`, `POST /api/nights/claim`, `GET /api/me/export`, `GET/PUT/PATCH /api/me/settings`, and `GET/POST /api/me/presets` plus `PATCH/DELETE /api/me/presets/:id`. Mutating APIs require the same origin; signed-in APIs require an HttpOnly session cookie. With no database/account service, settings and saved preset routes return 404.

Tablemate is an **informal tally for friends, not a gambling or payments platform**. It never moves money.

## Leagues

Signed-in friends can create a league, join with an eight-letter invite code, and maintain a roster. The commissioner can set table rules and create a draft season; a co-commissioner can help with invites and night review. Only commissioners and co-commissioners can open the league's table. The server applies the league settings and keeps one live room per league. Guests may still join by room code as subs; their chips remain in the night history, but they do not enter standings. League pages, nights, records and audit entries are visible only to active members.

The commissioner chooses a scoring format for each season: total net chips, per-night points (default table 10/7/5/3/2/1), net chips capped by a buy-in multiple, or ROI. Drop-worst (up to three nights, retaining at least one) and minimum attendance are optional except that ROI cannot drop nights. Scores are stored as integer hundredths; ROI uses integer basis points. For example, a first place night worth 10 and a second place night worth 7 produces 17.00 points. Ties split the occupied place points. Scoring rules lock on activation; only one season can be active. Closing a season stores its qualified champion and makes its results immutable.

A completed league night is saved with stable member IDs. A commissioner or co-commissioner may void or restore an active-season night with a required reason; every such review is logged. Individual chip totals are not editable through league review. The roster supports commissioner transfer, co-commissioner promotion, removal, and invite-code rotation. The league page includes standings, nights, members and table/season rules.

League APIs under `/api/leagues`: create/list, join by invite, member detail, leave, invite rotation, member role/removal/transfer, live room, seasons (draft/edit/activate/close/standings), nights, records and audit, and night void/restore. They require a signed-in session and member authorization. The socket `create` event accepts an optional top-level `leagueId`; it never enters game settings or broadcasts.

## House rules and recovery

- Whole-number chips, no antes, no rake. Settings and each chip add are capped at one billion; the full table ledger is capped at one trillion.
- Short all-ins do not reopen betting for players who already acted unless cumulative increases reach a full raise. Players who have not acted can raise. Uncalled chips return automatically. No betting into an uncontested side pot.
- Before the first hand, changing the starting stack resets all seated stacks. Afterward it only affects new seats; existing players use host-approved add-ons.
- Join, leave, kick, rebuy and settings changes happen between hands. Sit-out affects the **next** hand; it does not fold the current one. The dealer skips sitting-out or busted players.
- A player can request a rebuy during a hand. In host mode the host approves or denies it. In auto mode, eligible requests up to the configured cap are applied between hands, with a per-player auto limit; other requests remain for host review. Requests do not invalidate an in-flight betting action. Players can also donate only their own chips between hands.
- Blind timers double blinds only at the start of a hand. Multiple elapsed levels are applied then. A new timer starts with the next hand after settings change.
- Refresh or a dropped connection restores your seat using a random bearer token in localStorage. Do not clear browser storage mid-game. One active connection per seat; opening the seat in another tab moves control there. Tokens never appear in room broadcasts.
- Disconnects preserve stacks and do not fold. If the **current player** is disconnected, the host can fold that seat from Host controls. If the host disconnects, reconnect the host’s browser; host authority is not granted to a guest. If the host explicitly leaves between hands, authority transfers to the first remaining seat.
- Undo restores the last betting action or showdown assignment, including settled payouts, with up to 40 snapshots. Starting a hand or administrative changes establish a new undo boundary. Connections and tokens are not rewound.
- Rooms are in-memory and expire after six hours without user activity or a server restart. Use **Tonight → Copy summary** before leaving the table. Hand logs keep the most recent 200 entries.

## Tonight ledger and settle-up

The Players panel, between-hands dock and Leave confirmation show the nightly ledger. It tracks each seat’s buy-ins and rebuys, current stack or departed cash-out, and hands won/played. A player who leaves and rejoins is merged by their normalized, case-insensitive name. The app sorts net results and suggests deterministic transfers that settle the table; **Copy summary** is plain text for the group chat. A host can optionally set a cash value per 1,000 chips. These are informal estimates only: the app does not handle money and is not a gambling or payments platform.

## Personal settings, seat style and table presets

The lobby and **Your seat → Personal settings** offer three generated sound packs, fixed vibration patterns, reduced motion, high contrast, compact/comfortable/large layout, left-handed controls and screen wake lock. Sound still requires a browser user gesture; vibration and wake lock depend on device support. Guests keep preferences in local browser storage. Signed-in settings sync across devices through the account API: the server copy wins on sign-in, or the local copy is uploaded if the account has none. Only allowlisted values are stored. Personal settings are private; nothing in the settings blob is sent in table broadcasts.

Each occupied seat has an avatar and color. **Your seat → Avatar & seat color** opens a picker with 24 local SVG icons and 12 numbered colors. A short nickname/pronunciation note can be shown in the Players panel. These three public seat fields are validated on the server; duplicate colors are rejected. A signed-in player's saved defaults seed a new seat, while guests get deterministic room defaults. Seat style changes do not affect betting, payouts, undo or table revisions.

The create form offers **Casual**, **Turbo** and **High stakes** presets. Choosing one fills editable game settings and the rebuy policy. Signed-in accounts can save, rename, reorder and delete up to ten presets; guests can use all built-ins. The server validates every saved preset and applies the table's settings on creation. Rebuy policy stays at the room level and never enters game settings or undo history. Host controls can change it for the current night.

## Alerts, themes and turn notifications

- **Personal settings** controls generated turn/win sounds, vibration where supported, and screen wake lock where available. Browser audio unlocks after a user gesture; an iPhone silent switch can mute it. The in-page features work without push configuration.
- **Color theme** appears in the lobby and Your seat. Felt, Midnight, Burgundy, Graphite, Daylight, Miami Vice, Royal Flush and Retro Arcade are available, along with **System**. The three new themes have static SVG/CSS environmental artwork outside the playing surface. The choice is cached locally and syncs when signed in.
- Web Push is optional and disabled until the server has all three VAPID values. See [DEPLOY.md](DEPLOY.md) for key generation and configuration. Enable it from Your seat on the device that should receive alerts. On iPhone/iPad, add Tablemate to the Home Screen first. Subscriptions are kept in memory and must be enabled again after a server restart.

## Deploy to Render

See [DEPLOY.md](DEPLOY.md) for exact repository and deployment commands. The included `render.yaml` creates one free Node web service using `npm ci`, `npm start`, `/healthz` and `NODE_VERSION=20`.

**Render’s free tier sleeps after inactivity. In-memory rooms are lost whenever the service restarts or spins down, and the first load can be slow. Wake it up before game night**, then create your table. A reconnect token cannot recover a room after a restart. Use a single always-on instance plus durable shared storage if you later need persistent rooms; persistence is outside this project’s requested scope.

Reference: [Render Blueprint specification](https://render.com/docs/blueprint-spec) and [free service behavior](https://render.com/docs/free).

## Code map

- `src/game.js` — pure immutable state transitions, validation, pots, payouts and undo; no I/O.
- `src/server.js` — Express, Socket.IO, private seat tokens, authorization, cleanup and public state projection.
- `public/` — vanilla HTML/CSS/JS; responsive table, eight themes, in-page alerts, optional service worker and local icons. All assets are local.
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
| `create` | `name`, optional `settings`, `leagueId`, `rebuyPolicy` | Unseated socket |
| `join` | `code`, `name`, optional confirmed `expectedBuyIn` | Unseated; between hands |
| `table-preview` | `code` | Unseated; read-only |
| `rejoin` | `code`, `playerId`, `token` | Valid private seat token |
| `start-hand` | — | Host |
| `host:endNight` | optional `revision` | Host, between hands after at least one hand |
| `action` | `type`: fold/check/call/raise/all-in; `amount` for raise-to | Current player |
| `showdown-pick` | `potId`, `winnerIds` | Host |
| `host-settings` | `settings`: startingStack/smallBlind/bigBlind/blindMinutes/optional centsPer1000Chips | Host, between hands |
| `host:reorderSeats` | Full `order` array of player IDs | Host, between hands |
| `host:rebuyPolicy` | `mode`: host/auto; `cap` and optional `maxPerPlayer` in auto mode | Host; authenticated, no revision bump |
| `seat:cosmetics` | optional `avatar`, `color`, `note` (at least one) | Own seat; authenticated, no revision bump |
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

Gameplay and administration mutations (`start-hand`, `action`, `showdown-pick`, `host-settings`, `host:reorderSeats`, `rebuy`, `sit-out`, `donate`, `leave`, `kick`, `host-fold`, `undo`, and `rebuy:approve`) require the latest `revision` and the seat’s private `token`. `seat:cosmetics`, `host:rebuyPolicy`, `rebuy:cancel`, `rebuy:deny`, Web Push and presence events are authenticated but do not change the revision; the client may still include its current revision. `rebuy:request` normally does not change the revision, but an immediately approved auto rebuy changes chips and increments it. Entry events use their specific preview/join/rejoin checks. Seat tokens, account IDs, settings blobs, presets and push subscriptions never appear in state projections. The server limits each socket to 40 requests/second, payloads to 16 KiB and total live rooms to 1,000. Room codes invite players; seat tokens control an existing seat.


## Visual seating

Play at https://poker-chips-o7n9.onrender.com/ (deployment details in DEPLOY.md). Free-tier cold starts can be slow.
Seats appear clockwise around an oval, with D/SB/BB markers and a highlighted current actor. Only occupied seats are shown. Between hands, hosts can drag occupied seats onto another occupied slot or select List view for numbered arrow controls, preview next-hand blinds, then Save order. Saving a changed arrangement resets the next button to the first eligible seat; subsequent hands rotate normally. Everyone receives the saved order immediately.

### Security and names
Names are trimmed, Unicode-normalized, limited to 20 characters, and unique within a room without regard to case. Control characters and angle brackets are rejected; displayed names are HTML-escaped by the client. Disconnected seats retain their name and chips until leave/kick, allowing the original token to reconnect safely.

Room codes contain eight random letters. Each mutation needs both the socket-bound seat token and current revision. Strict schemas reject unexpected fields and unsafe numbers. Production accepts only the configured Render origin. Entry attempts share per-IP limits across connections (12 creates or 30 join/preview/rejoin attempts per minute); seated requests are capped at 40 per second per connection. No virtual cards exist or are transmitted.
