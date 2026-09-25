# Decisions and progress

- Scope: chip accounting for in-person Texas Hold’em; no cards, dealing, evaluation, payments, or chat.
- Host selects one or more winners for each pot. Majority voting is not needed because the brief allows either.
- Integer chips only; a raise amount is the total street bet (raise-to).
- Rebuys/add-ons, seat removal and settings changes happen between hands. Sit out applies to the next hand. Disconnects preserve seats and never auto-fold. Host can fold the disconnected current player to unblock play.
- Host can undo a betting action or showdown award until the next hand or administrative change. Undo never reverses identities or connection state.
- Blind timer doubles blinds between hands; active-hand stakes never change.
- In-memory, one process/instance, maximum 10 seats. Room expires after 6 hours without user activity. No durable recovery after a server restart.
- User explicitly asks for autonomous execution without checkpoints; this overrides design-skill confirmation checkpoints.
- The environment initially has Node 24 and no `gh` CLI on PATH. Target runtime remains Node 20 as requested.

## Design decisions

Greenfield mobile tool for friends around a real table. Custom club-room design: forest (#0c201b), panel green (#142c24), warm white (#f3efdf), brass (#d9bb78). Georgia display headings, native sans-serif controls, tabular chip totals. 8px spacing rhythm; 12px panel corners, 8px controls; restrained shadows and 150ms feedback. No external assets or fonts needed.

Dials: variance 4 (editorial lobby, stable table grid), motion 2 (state feedback only), density 6 (stack/action summary always visible, administration tucked away), assets 1, brand fidelity 1. Lobby introduces the physical-card workflow; table prioritizes current street, turn and money. Phone-distance type and 44px+ controls; quiet, social temperature. At 360px, seats use a two-column grid and action controls wrap; no decorative playing cards.

## Progress

- Phase 1: project skeleton, scripts and lint configuration established.
- Phase 2: immutable betting engine completed; tests cover heads-up/multiway blinds, min raises, cumulative and single short all-ins, side pots, odd chips, undo, refunds and 100 deterministic varied hands.
- Phase 3: authoritative room server completed; private crypto seat tokens, revision checks, host authorization, connection replacement, idle cleanup and real-client integration tests.
- Phase 4: mobile UI completed and exercised in the in-app browser. A full hand, refresh restoration, raise quick buttons, showdown, undo, split payout and rebuy worked. Lobby and table measured exactly 360px wide with no horizontal overflow; tablet table measured 768px without overflow. Tap targets corrected to at least 44px. Normal blinds no longer display misleading provisional side-pot labels.
- Phase 5: Render Blueprint, README, no-auth DEPLOY instructions and standalone four-player simulation delivered. Official Render schema validation passed. No remote and no `gh` executable available: used the requested DEPLOY.md fallback, without creating a remote service.
- Phase 6: Node 20.20.2 and Node 24.20.0 validated; lint and tests passed; health endpoint returned 200; server suite repeated three times successfully; four-player/two-all-in simulation conserved 550 chips with pots 200/150 and final stacks 200/150/100/100.
- Phase 7: debug/dead-code review completed; only the intentional server startup message and simulation result write to stdout. Runtime dependency audit reported zero vulnerabilities. Final validation is recorded in VALIDATION.md.

## Additional decisions

- Existing players cannot join mid-hand: joining is enabled between hands, preventing seat changes from invalidating undo. Max 10 seats includes disconnected and sitting-out players.
- Rebuys/add-ons require the host. This keeps changes to the chip ledger intentional and visible in the hand log.
- Maximum individual starting stack/blind/add-on is one billion, maximum table ledger is one trillion; payouts can exceed one billion. Added a large-stack payout regression test.
- On a transient rejoin timeout the browser retains the token and retries. Opening the same seat in another tab does not delete that tab’s shared token.
- All-in only permits a legal call or raise. When no other opponent has chips left to bet, use Call; extra unmatched chips are not put into an empty side pot.
- Model for cumulative short raises checked against [Poker TDA rules](https://www.pokertda.com/view-poker-tda-rules/). Hosting fields checked against [Render’s specification](https://render.com/docs/blueprint-spec).

- Follow-up: added explicit Small blind / Big blind badges to player seats, using the existing brass styling. They remain visible across streets and all-ins, independently of the current bet amount. Dealer marker remains visible for heads-up dealer/small-blind combinations.

- Publishing follow-up: GitHub repository created at https://github.com/AkhilKarthik143/poker-chips. Existing local token rejects pushes with HTTP 403; publishing the same tracked source through the signed-in GitHub browser session instead. Render is signed in and already sees the repository.
- Seat reorder follow-up: seating now keeps an explicit ordered `seatOrder` array. The host can reorder only between hands; the reorder assigns the requested order to physical seat indexes and resets the dealer button to seat 0 for the next hand. This deterministic reset was chosen over preserving the previous button seat, and is covered by game/server tests.


## Seat visualization follow-up

- Extension of the existing forest/brass system: native type, 12px cards, static directional marker, no external assets. Both game and host control share `seatOval` and the saved clockwise `seatOrder`.
- At 360px use a tall oval: top/bottom seats and four seats on each side. Ten physical slots (including visible open seats) remain stable across table sizes. Vertical scrolling preserves legibility without overlapping seats.
- Pointer dragging inserts an occupied seat at the target occupied slot. A ghost named for the dragged player marks the target while moving; numbered list arrows remain the keyboard/touch fallback. Both use the existing revision-protected host socket event.
- Preserve the prior documented dealer reset on saving a changed arrangement. An unchanged draft previews ordinary rotation from the current dealer; changed drafts preview reset, skipping sitting-out/busted players and applying heads-up rules.
- Fixed join-after-removal seat-order alignment. Server-side rules remain authoritative. Drafts reset on saved-order broadcasts, and save failures appear inline.
- Browser acceptance: Chrome at 360px and 1280px, 2/4/6/9/10 players; both oval layouts checked for overlap/clipping, drag/save and next hand exercised, direct socket mid-hand rejection confirmed. Screenshots/harness are in ignored work/. Full suite: 31 passing tests including chip conservation and heads-up reorder/rotation.
- Reused GitHub AkhilKarthik143/poker-chips and Render poker-chips (srv-daoo6p8473hc73d5nkeg). Live https://poker-chips-o7n9.onrender.com/healthz returned HTTP 200. Git push still returns 403, gh is absent, and the new UI is not live. Exact authentication/push/existing-service deployment steps are in DEPLOY.md. render.yaml remains npm ci / npm start / healthz / Node 20; no runtime change required.


## Compact ellipse redesign
- Coordinates are x = W/2 + radiusX*cos(angle), y = H/2 + radiusY*sin(angle). Ten physical slots include open seats. Occupied players are spread in saved order across slots floor(i*10/playerCount). Angle = pi/2 + 2*pi*(slot-ownSlot)/10, placing the current player at bottom-center with clockwise successors.
- Card width = min(140, floor((W-24)/4.5)); radiusX = (W-cardWidth-12)/2; radiusY = (H-112)/2. H = 380 for 1–2, 440 for 3–4, 540 for 5–10 occupied players. ResizeObserver remeasures each shared live/reorder oval. Cards are absolute, 100px tall; open slots are 44px tall. Felt uses the same center and radii. Decorative arrow removed.
- Contrast layers: page #10141b, rail #1d2633, felt #24523f, cards #344357, critical text #f8fafc, action accent #f3cc78. Desktop page max 1536px with 304px rail and game track capped at 1160px (actual 1160px at sufficiently wide viewport).
- Compact status header replaces gameplay marketing. Fixed safe-area dock provides host Start game, invite/buy-in confirmation, and seat controls; mobile log collapses. Status words/icons, dashed folded/open borders, and You label distinguish states without color.
- Buy-in remains host controlled. Open slots invite friends; unseated guests review read-only buy-in and confirm joining. Server rejects stale buy-in confirmation. Hand-log timestamps are server-stamped on broadcast, grouped by hand.
- Browser checks passed 2/4/6/9/10 players at 360/768/1600px: no seat overlap or horizontal clipping, drag/save, next-hand start and mid-hand rejection. 32 unit/integration tests pass.

- Follow-up: removed all empty placeholders from live and host reorder ovals. The actual seated-player count now divides the ellipse angle (2*pi*(index-ownIndex)/playerCount); two players sit opposite each other. Folded/away players retain their real seats. Invite players remains in the dock.

## Felt-and-gold UI release (2026-09-24)

- Used the exact supplied tokens in public/tokens.css, imported before style.css. No token values were adjusted. Removed legacy literal colors from public CSS/HTML; all component colors now reference tokens. Borders and token-derived shadows distinguish adjacent dark layers.
- Kept physical-card play: this repository has no virtual card renderer, deck state, or 52-card test suite. Card tokens are reserved for future use; no simulated community cards or hidden cards were invented.
- Preserved occupied-only seating: no empty slots are rendered. Empty-seat tokens/styles remain available but do not create seats.
- Seat geometry: x=W/2+rx*cos(angle), y=H/2+ry*sin(angle), angle=pi/2+2*pi*(index-ownIndex)/occupiedCount. rx=(W-cardWidth-12)/2; ry=(H-112)/2. H is 380 for 1–2, 440 for 3–4, 580 for 9, otherwise 540. Card width=min(140,floor((W-24)/divisor)), divisor=2 for up to 4 players, 3 for 5–6, 4.5 otherwise. Cards are 88px tall.
- Compact copy-code header, Invite/settings, gold primary actions, neutral Check/Call, fixed 89–100px dock, raise panel above dock. Mobile rail is collapsible; desktop rail is open. Status labels retain icons and distinct borders, active ring respects reduced motion.
- Contrast (WCAG relative luminance), primary text against each layer: bg-page 16.6:1, bg-panel 15.39:1, bg-table 14.03:1, bg-seat-empty 14.26:1, bg-seat-occupied 11.98:1, bg-action-bar 15.83:1. All exceed 4.5:1. Critical status text remains primary; status colors are borders and indicators.
- Validation: lint and all 32 tests pass, including chip conservation, betting, dealer/blinds, socket authorization, and reorder. Browser checks cover 2/4/6/9/10 players at 360/768/1600px, drag/save, next hand, and server rejection mid-hand. Additional 360/768/1200/1600px checks cover fixed dock bounds, raise overlay, horizontal overflow, grayscale status labels and /healthz. No 52-card suite exists to run.

## Security hardening (2026-09-24)

Failing tests were added before fixes. The initial six new groups failed as expected; follow-up prototype-key and same-origin LAN regression tests also failed before repair.

- Duplicate names: enforced NFKC normalization, trimming, case-insensitive uniqueness across all seated players, and 1–20 characters. Controls/format characters and angle brackets are rejected; existing context-specific HTML escaping remains on every rendered name/log.
- Disconnect ambiguity: disconnect is not seat removal. Releasing a disconnected name while promising that its token can reclaim the unchanged name conflicts with strict room-wide uniqueness and chip preservation. Names remain reserved on disconnected seats; leave/kick frees the name. Tests cover reserved disconnect, self-reconnect and reuse after removal.
- Payload validation: all 15 event handlers have strict schemas for required/optional fields, nested settings, bounded integers, UUIDs, token format, room codes and ID arrays. Unknown keys, numeric strings, null, arrays, invalid amounts and inherited property keys are rejected before mutation. Atomicity and chip-conservation assertions pass.
- Identity: existing 256-bit random tokens and socket binding are retained; every seated mutation now additionally supplies and verifies that seat's token. Host authority still comes only from server state. Forged/unknown tokens, host spoofing and duplicate revisions are rejected. Existing expired-room recovery clears identity and returns the browser to entry.
- Abuse: retained 40 requests/second/socket; added shared per-IP fixed windows (12 creates/minute, 30 combined join/preview/rejoin attempts/minute). Limiter map is bounded to 10,000 entries and expired entries are swept. Render's trusted edge uses the final appended X-Forwarded-For hop only when RENDER=true; local/default servers ignore forwarded headers.
- Entropy: eight independently random letters from 24 symbols give 24^8 = 110,075,314,176 possibilities (36.68 bits), up from 331,776 four-letter possibilities. Combined with entry throttling and six-hour idle expiry this reduces practical casual room guessing; codes remain invitations, not authentication.
- Origin checks: production CORS and WebSocket handshake allow only RENDER_EXTERNAL_URL (fallback: the current deployed HTTPS origin). Local same-origin LAN use remains supported. CSP connect-src is now self-only, removing broad ws:/wss: grants.
- Error exposure: only explicit RequestError messages leave the server; unexpected exceptions get a generic client message and server-side diagnostic logging. Request errors also emit only to the requesting socket. Tokens/history remain absent from broadcasts and previews. No cards, deck state, debug endpoints, or card-security/render tests exist in this physical-card app.
- Source audit found no committed credentials/API keys in tracked source or browser bundles; session tokens are runtime-only.
- Validation: lint plus all 40 tests pass, including new fuzz/schema/name/token/origin/rate-limit tests and existing full chip-conservation, seat-order and betting regressions. Four-player simulation conserves 550 chips through two all-ins, all streets and payouts. Responsive browser check passes after eight-letter codes and token changes.

- Live verification caught same-origin polling GETs without an Origin header being denied. A failing polling regression test reproduced it. Handshakes now accept a configured-origin Referer only with browser Sec-Fetch-Site: same-origin when Origin is absent; foreign and unverified origins remain rejected. Final suite: 41 passing tests.
