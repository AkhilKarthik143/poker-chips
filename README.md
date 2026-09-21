# Tablemate / Poker Chips

Physical cards. Virtual chips. A mobile-first chip bank and authoritative betting engine for 2–10 people playing Texas Hold’em around the same table. The app never deals, displays, stores, or evaluates cards. No accounts, payments, or chat.

## Play with a real deck

1. The host creates a table, chooses a starting stack and blinds, and optionally enables a blind timer.
2. Friends open the **same service URL** on their phones, tap **Join a table**, and enter the four-letter code and their names. For local testing, phones must use your computer’s LAN address on the same Wi-Fi; `localhost` on a phone is the phone itself.
3. Deal physical hole cards. The host taps **Start first hand**. The server moves the dealer button, posts blinds and identifies the current player. With two players the dealer posts the small blind and acts first preflop.
4. Use Fold, Check, Call, Raise or All-in. A raise amount is the **total bet for that street**, including chips already in front of you. Quick buttons offer minimum, half-pot, pot and all-in. Half-pot/pot raises use the pot after calling.
5. When the street changes, reveal the appropriate physical community cards. If everyone remaining is all-in, betting skips to showdown: physically complete the board before choosing winners.
6. At showdown, compare the real cards. The host selects every tied winner **for each pot**, then confirms. The app only offers eligible players. All payouts settle together once every pot is assigned. Split-pot odd chips go clockwise from the dealer, starting with the first winning player to the dealer’s left.
7. Collect the cards and start the next hand. **Host controls** provide rebuys/add-ons, settings, kick and undo. **Your seat** provides sit-out and leave.

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

## House rules and recovery

- Whole-number chips, no antes, no rake. Settings and each chip add are capped at one billion; the full table ledger is capped at one trillion.
- Short all-ins do not reopen betting for players who already acted unless cumulative increases reach a full raise. Players who have not acted can raise. Uncalled chips return automatically. No betting into an uncontested side pot.
- Before the first hand, changing the starting stack resets all seated stacks. Afterward it only affects new seats; existing players use host-approved add-ons.
- Join, leave, kick, rebuy and settings changes happen between hands. Sit-out affects the **next** hand; it does not fold the current one. The dealer skips sitting-out or busted players.
- Blind timers double blinds only at the start of a hand. Multiple elapsed levels are applied then. A new timer starts with the next hand after settings change.
- Refresh or a dropped connection restores your seat using a random bearer token in localStorage. Do not clear browser storage mid-game. One active connection per seat; opening the seat in another tab moves control there. Tokens never appear in room broadcasts.
- Disconnects preserve stacks and do not fold. If the **current player** is disconnected, the host can fold that seat from Host controls. If the host disconnects, reconnect the host’s browser; host authority is not granted to a guest. If the host explicitly leaves between hands, authority transfers to the first remaining seat.
- Undo restores the last betting action or showdown assignment, including settled payouts, with up to 40 snapshots. Starting a hand or administrative changes establish a new undo boundary. Connections and tokens are not rewound.
- Tables expire after six hours without user activity, even if sockets remain open. Hand logs keep the most recent 200 entries.

## Deploy to Render

See [DEPLOY.md](DEPLOY.md) for exact repository and deployment commands. The included `render.yaml` creates one free Node web service using `npm ci`, `npm start`, `/healthz` and `NODE_VERSION=20`.

**Render’s free tier sleeps after inactivity. In-memory rooms are lost whenever the service restarts or spins down, and the first load can be slow. Wake it up before game night**, then create your table. A reconnect token cannot recover a room after a restart. Use a single always-on instance plus durable shared storage if you later need persistent rooms; persistence is outside this project’s requested scope.

Reference: [Render Blueprint specification](https://render.com/docs/blueprint-spec) and [free service behavior](https://render.com/docs/free).

## Code map

- `src/game.js` — pure immutable state transitions, validation, pots, payouts and undo; no I/O.
- `src/server.js` — Express, Socket.IO, private seat tokens, authorization, cleanup and public state projection.
- `public/` — vanilla HTML/CSS/JS; dark mobile interface, reconnect, vibration when supported, log and host menus. All assets are local.
- `test/game.test.js` — rule examples, split/side pots and randomized chip conservation.
- `test/server.test.js` — real Socket.IO clients; full hand and access/reconnect/cleanup coverage.
- `scripts/simulate-four.js` — reproducible four-player, two-all-in service simulation.
- `NOTES.md`, `VALIDATION.md` — assumptions, work record and validation evidence.

## Socket contract

Every request includes a payload object and receives `{ok:true, ...}` or `{ok:false, error}` through its acknowledgement. Seated clients receive personalized `state` events. **Every mutating table request requires `revision` equal to the latest state revision**; the server rejects duplicate or stale intents. Authorization comes from the socket’s bound seat, never a supplied actor ID.

| Event | Payload (in addition to revision where required) | Access |
| --- | --- | --- |
| `create` | `name`, optional `settings` | Unseated socket |
| `join` | `code`, `name` | Unseated; between hands |
| `rejoin` | `code`, `playerId`, `token` | Valid private seat token |
| `start-hand` | — | Host |
| `action` | `type`: fold/check/call/raise/all-in; `amount` for raise-to | Current player |
| `showdown-pick` | `potId`, `winnerIds` | Host |
| `host-settings` | `settings`: startingStack/smallBlind/bigBlind/blindMinutes | Host, between hands |
| `rebuy` | `playerId`, `amount` | Host, between hands |
| `sit-out` | `value`: boolean | Own seat |
| `leave` | — | Own seat, between hands |
| `kick` | `playerId` | Host, between hands |
| `host-fold` | — | Host, disconnected current player only |
| `undo` | — | Host |

The server limits each socket to 40 requests/second, payloads to 16 KiB and total live rooms to 1,000. Room codes invite players; seat tokens control an existing seat. This is a casual home-game tool, not a real-money gambling platform.
