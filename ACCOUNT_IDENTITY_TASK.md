# Autonomous Task: Tablemate Account Identity — Username, Display Name, Avatar Builder, Profile Privacy, Onboarding

## Instructions
Continue working until all todos are complete.
Do not stop to ask questions.
Do not wait for confirmation at checkpoints.
Make reasonable assumptions and proceed. Log each assumption in Notes.
If a fix does not work, try a different approach.
Run validation after every meaningful change.
Update progress in this file as you go.

Run rules:
- Work on a new branch `feature/account-identity`, created from the newest of `feature/customization`, `feature/leagues`, `feature/accounts-stats` whose `npm run lint && npm test` pass (log which). Commit after each stage's Gate passes. Never push, never open a PR.
- Commit messages: `feat(identity): <summary>`. One commit per stage minimum.
- If a stage's Gate still fails after 3 genuinely different approaches, log it under Blockers in Notes, reset to the last Gate commit, and continue with any stage that does not depend on it. Never loop on one problem.
- Real inboxes and phone browsers cannot be verified here. Build defensively and list them under "Untested for real" in Notes.

## Task Description
Give signed-in users a real identity: a unique username, a display name, a built (not uploaded) avatar, and clear privacy controls, plus a short onboarding step after first sign-in. Builds on the accounts spec (accounts, sessions, `/api/me`, store and migrations).

### Principles (apply to every stage)
- Guest-first: guests still play with just a name. Identity features are for signed-in users only; the app never gates play on a profile.
- Feature flag: with no database configured, identity endpoints return 404, its UI is hidden, and every pre-existing test passes unchanged.
- Closed vocabularies for avatars: avatars are assembled from fixed enum parts. No image uploads, no URLs, no free-text colors. The only free text is the username and the display name.
- No public directory: there is no user search, no public profile pages, and no lookup by email. A profile is visible only to its owner and to people who share a league with them (if leagues exist), with identical 404 responses for "does not exist" and "not allowed".
- Privacy: emails, account ids, session tokens and settings never appear in `view()`, broadcasts, or any response to another user. `@username` appears at a table only if the owner opted in.
- Strict CSP stays: no inline scripts, no inline `style="..."` in markup or templates. SVG colors come from CSS classes backed by theme tokens, not from `fill="var(...)"` attributes or inline styles. No new runtime dependencies.
- Do not change betting, pot, payout or undo logic.

### Prerequisite check
Required: accounts with sessions and `GET /api/me`, `PATCH /api/me`, the store interface with migrations, `public/me.html`. Optional: seat cosmetics (customization spec: 24 avatar icon ids, 12 seat color ids, `seat:cosmetics`, `view().cosmetics`), leagues (shared-league visibility), `scripts/check-contrast.js`, `openSheet()`. If seat cosmetics exist, reuse its icon ids and color tokens and reconcile as described in I3. If leagues do not exist, profiles are visible only to their owner; log it. If something required is missing, implement the minimum and log it.

### I1. Username
- Schema migration: `accounts` gains `username`, `username_lower` (unique index), `username_changed_at`; new `username_history(username_lower, account_id, released_at)`.
- Rules (pure `validateUsername` in `src/identity.js`, with a client copy in `public/identity.js`): 3 to 20 characters, ASCII letters, digits and underscore only, must start with a letter, no double underscore, stored lowercase for uniqueness and shown in the user's chosen casing. Reserved words are rejected (at least: admin, administrator, support, help, tablemate, host, dealer, system, root, moderator, commissioner, league, staff, official, null, undefined, api, www). A small offensive-term blocklist is checked after normalizing leetspeak (0→o, 1→i/l, 3→e, 4→a, 5→s, 7→t, `$`→s, `@`→a) and stripping underscores; keep the list short and in `src/reserved-names.js`, and log in Notes that it is a minimal baseline, not complete moderation.
- A test asserts the server and client validators agree on a shared fixture list.
- Change policy: allowed once per 30 days (`username_changed_at`); the previous username is held for its previous owner for 30 days (cannot be taken by anyone else, the owner may switch back); deleting an account also holds its username for 30 days.
- Endpoints (signed in, origin-checked, rate-limited): `GET /api/username/check?u=` (30 per minute per session; returns `{ available, reason }` where reason is one of `invalid`, `reserved`, `taken`, `held`, `cooldown`), and username changes through `PUT /api/me/profile` (I2).
- Tests: validation matrix (length, charset, leading digit, double underscore, reserved, leet blocklist, case-insensitive uniqueness), cooldown, hold-after-change, owner can revert within the hold, concurrent claims (two requests for one name: exactly one wins), rate limit, no-DB mode returns 404.

### I2. Profile, display name and privacy
- `accounts` gains `avatar_json` and `profile_json` (`{ profileVisibility: 'private' | 'leagues', showUsernameAtTables, showAvatarAtTables }`, defaults `leagues`, `false`, `true`).
- Display name stays as is (validated by `validName`, not globally unique; per-room uniqueness is already enforced at the table). Signed-in create/join forms are prefilled with the display name and stay editable.
- Endpoints: `GET /api/me` includes `username`, `displayName`, `avatar`, privacy flags, and `usernameChangeAvailableAt`; `PUT /api/me/profile { username?, displayName?, avatar?, privacy? }` (strict schema, partial updates, one transaction); `GET /api/u/:username` (signed in): returns `{ displayName, username, avatar, memberSince (month and year), sharedLeagues: [{ id, name }] }` only to the owner or to a user sharing at least one league with the owner and only when `profileVisibility` is `leagues`; every other case returns an identical 404 body. No stats, no email, no activity on this endpoint.
- Where names appear: league rosters and standings show display name plus `@username` to disambiguate; table views show the display name and avatar, and `@username` only when `showUsernameAtTables` is true. `view()` carries avatars (enum parts only) and the opt-in username, never account ids.
- Account deletion (accounts spec A8, if present) clears the profile and holds the username for 30 days.
- Tests: profile visibility matrix (owner, shared-league member, other signed-in user, guest, `private` setting) with byte-identical 404 for hidden vs missing, partial update atomicity, `view()` never exposes username unless opted in, no email or account id in any response, no-DB mode returns 404.

### I3. Avatar builder
- Avatar spec (strict, closed): `{ shape, icon, bg, accent, pattern, frame }` with `shape` in `circle | rounded | hex`, `icon` from the shared icon id list (reuse the 24 customization icons if present, otherwise create 24 simple poker-themed and neutral inline SVG symbols), `bg` and `accent` from 12 color ids, `pattern` in `none | stripes | dots | chevrons | rings`, `frame` in `none | plain | double`. Server validates enums in `src/identity.js`; client list lives in `public/avatar.js`; a parity test loads the public file with `node:vm` and compares the lists.
- Rendering: `public/avatar.js` (classic script, one global) with a pure `renderAvatar(spec, size)` that builds SVG with `createElementNS`, using CSS classes (`.av-bg-1` to `.av-bg-12`, `.av-accent-*`, `.av-ink-light`, `.av-ink-dark`, pattern classes) defined in `style.css` from theme tokens `--avatar-c1..--avatar-c12`. The container gets `role="img"` and an `aria-label` ("Avatar of {name}"); patterns and frames are decorative. A deterministic default avatar comes from a hash of the account id (never exposing it); guests get a deterministic default from their seat index.
- Contrast: the icon ink color is chosen per background id so icon vs background is at least 3:1 in every theme and in high contrast; extend `scripts/check-contrast.js` to assert it. Tune tokens until it passes.
- Builder UI: sheet with live preview, a grid for each part (radiogroup semantics, visible names, keyboard accessible), Randomize and Reset, and Save. Opens from `me.html` and from onboarding. Works at 360px with 44px targets.
- Table integration: seats and the Players list render the account avatar when `showAvatarAtTables` is true. If seat cosmetics exist, keep the seat color stripe from `seat:cosmetics` independent of the avatar background, and the existing unique-color rule applies to the stripe only; if the user shares no avatar, fall back to the cosmetics icon and color. League rosters and standings render avatars too.
- Tests: spec validation (unknown keys, bad enums), render determinism (same spec gives the same serialized SVG, fixed fixtures), default-avatar stability, parity test, `view()` includes only enum parts, contrast script passes.

### I4. Onboarding and profile editing UI
- After the first successful magic-link verify (new account), redirect to `public/welcome.html`: step 1 username with live availability (debounced 400 ms) and three suggestions derived from the display name and a random suffix, step 2 display name, step 3 avatar builder, step 4 privacy toggles. A visible "Skip for now" assigns a generated unique username (`player` plus 5 random lowercase letters or digits) and a default avatar; nothing blocks entering the app.
- `me.html` gains a Profile section: edit username (showing the cooldown date when locked), display name, avatar, privacy toggles, and "Preview how others see me".
- All pages respect themes, `aria-live` for availability messages, focus management, and the CSP rules above.
- Tests: onboarding skip yields a valid unique username, a second new account skipping at the same time never collides, suggestions are valid and available at generation time.

### I5. Docs
Update `README.md` (username rules, change and hold policy, privacy model and what other users can see, avatar builder, no public directory, endpoints) and `VALIDATION.md`.

## Context
- Relevant files: `src/server.js`, `src/validation.js`, `src/store/*`, `src/auth.js`; new `src/identity.js`, `src/reserved-names.js`; `public/me.html`, `public/me.js`, `public/app.js`, `public/style.css`, `public/tokens.css`; new `public/welcome.html`, `public/welcome.js`, `public/identity.js`, `public/avatar.js`; `scripts/check-contrast.js`; `test/*.test.js`; `eslint.config.js`, `README.md`, `VALIDATION.md`.
- Dependencies: none new. Reuse the `node:vm` test pattern for classic scripts and the existing store, sessions and rate-limit helpers.
- Scripts: `npm run lint` is `eslint . --max-warnings 0`; `npm test` is `node --test test/*.test.js`; `npm start` runs `node src/server.js` (port 3000, `GET /healthz`).
- Constraints: strict CSP, closed vocabularies, no public directory or lookup, identical 404s for hidden profiles, additive changes only, do not touch `poker-chips-github.zip`, do not push. Out of scope: avatar uploads, public profiles, user search or friend requests, badges and titles on profiles, profile stats, email change flows.

## Todo Checklist

### Investigation
- [x] Create branch `feature/account-identity` (see Run rules); run `npm ci`
- [x] Run baseline `npm run lint` and `npm test`; record pass counts in Notes
- [x] List existing identity, cosmetics, league and contrast paths; record reconciliation plan in Notes
- [x] Read the accounts migrations and `view()`; plan the new migration and where avatars enter `view()`
- [x] Document findings in Notes

### Implementation
- [x] I1: username rules, history and hold, check endpoint, tests. Gate: lint + test, commit
- [x] I2: profile endpoints, privacy flags, `GET /api/u/:username`, `view()` additions, tests. Gate: lint + test, commit
- [ ] I3: avatar spec, renderer, tokens and CSS classes, contrast checks, builder sheet, table and league integration, tests. Gate: lint + test, commit
- [ ] I4: onboarding flow and profile editing UI, tests. Gate: lint + test, commit
- [ ] I5: docs. Gate: lint + test, commit
- [ ] Add defensive checks for edge cases (simultaneous username claims, username held by a deleted account, cooldown boundary at exactly 30 days, avatar spec from an older version, a 10-player table with all avatars, display name equal to another member's)

### Validation
- [ ] Run `npm run lint` and fix any issues (zero warnings)
- [ ] Run `npm test` and ensure all pass, including new tests for username validation, hold and cooldown, profile visibility and 404 uniformity, avatar validation and rendering, parity, onboarding
- [ ] Run `npm test` again with no DB env vars set and confirm all original tests pass unchanged and identity routes return 404
- [ ] Run `node scripts/check-contrast.js` and ensure every theme (including high contrast if present) passes, including avatar ink vs background
- [ ] Run `node scripts/simulate-four.js` and ensure it exits 0
- [ ] Start with `TABLEMATE_DB_PATH=./data/smoke.db npm start` in the background and smoke it with curl and `socket.io-client`: sign up two accounts, claim usernames, confirm the second claim of a taken name fails, set an avatar, join one table, and assert `view()` shows avatars for both and `@username` for neither; confirm `GET /healthz` returns `{"ok":true}`; stop the server and delete `data/smoke.db`
- [ ] Run a leak test: serialize every `view()` payload and every response to a second user and assert none contains an email, account id, session token or privacy flag, and that hidden and missing profiles return byte-identical 404 bodies
- [ ] Run `grep -rnE "style=\"|<script>[^<]|fill=\"var" public/` and confirm no inline styles, inline scripts, or var-in-attribute fills were added
- [ ] If Playwright is installed, screenshot onboarding, the avatar builder, the profile section, and a 10-seat table with avatars at 360x740 and 390x844 in two themes; confirm no overlap, no horizontal scroll, and tap targets of at least 44px; otherwise list manual checks in Notes
- [ ] Verify regressions: `git diff main -- src/game.js` shows no change to betting, pot, payout or undo logic

### Cleanup
- [ ] Remove debug code and stray `console.log`
- [ ] Update docs/CHANGELOG (README, VALIDATION.md)
- [ ] Final validation: `npm run lint && npm test && node scripts/simulate-four.js && node scripts/check-contrast.js`
- [ ] Write the final summary at the top of Notes

## Definition of Done
- `src/identity.js` validates usernames (length, charset, reserved words, leet-normalized blocklist, case-insensitive uniqueness) with a client parity test, and enforces the 30-day change cooldown and the 30-day hold on released names
- `PUT /api/me/profile`, `GET /api/username/check` and `GET /api/u/:username` work with strict schemas, rate limits, origin checks and identical 404s for hidden versus missing profiles
- Avatars are built from the closed spec, rendered by the pure `renderAvatar` using theme-token classes, pass the contrast check in every theme, and appear at tables, in the Players list and in league views only when `showAvatarAtTables` is true
- `@username` appears at a table only when the owner opted in; `view()` never exposes emails, account ids or settings
- Onboarding works end to end and can be skipped without blocking play; skipped accounts get a valid unique generated username
- All commands in Validation pass: lint with zero warnings, `npm test` green, `check-contrast`, `simulate-four` exits 0, `/healthz` OK, leak test clean, no inline styles or scripts or var-in-attribute fills
- With no DB configured, the original tests pass unchanged and guest play is unaffected
- No regressions in betting, pots, payouts, undo, reconnect/rejoin, seat-token privacy
- At least one commit per stage on `feature/account-identity`, and `README.md` updated

## Notes
Agent: log progress, assumptions, and blockers here.

### Final summary
(write last)

### Progress log
- Baseline: `feature/customization` was newest. `npm ci`, lint and all 96 tests passed. Created `feature/account-identity` from it.
- Investigation: accounts, sessions, SQLite v1–v6, `/api/me`, seat cosmetics, league membership and contrast script all exist. `view()` is built in `src/server.js`; account links live in `room.accounts` and are absent from broadcasts. Avatar and opt-in username projection will be added there.
- I1: SQLite v7 identity columns and held-name table, server/client username validators, checks, cooldown and atomic claims. Lint and 99 tests passed.
- I2: owner profile API, atomic partial updates, shared-league profile lookup, restricted room identity projection and league roster/standing identity fields. Lint and 101 tests passed.

### Assumption log
- Username changes to a different name start a 30-day cooldown, including the first claim; changing casing alone does not. A prior owner may reclaim a held name during cooldown. (I1)
- The offensive-term list is a minimal baseline, not complete moderation. (I1)
- Existing account emails remain in the owner-only `/api/me` response for compatibility; public profile and room projections exclude them. (I2)

### Blockers
- (stage, what failed, approaches tried)

### Untested for real
- (phone browsers, real email onboarding, screen readers, anything else)
