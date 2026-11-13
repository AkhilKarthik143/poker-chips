# Tablemate mobile UX audit and test plan

## People and real table situations

Tablemate is an informal chip tally for friends using real cards. The phone is a glanceable control in a dim, noisy room, often held in one hand.

- **Host:** sets up a table, helps late players, corrects mistakes, and ends the night.
- **Regular player:** knows the rules and wants to act without breaking conversation.
- **First-timer:** arrives from a friend's text, has never used Tablemate, and needs a seat quickly.

| Phone scenario | Current behavior and failure before this pass | Severity |
| --- | --- | --- |
| First-timer opens a code link | Link selects Join and fills code, but the entry form begins below a long introduction on a 360×740 screen. | P1 |
| First-timer types a code manually | Must find Join, enter name and code, then confirm in a dialog; the code field follows the name and no brief next-step cue is near the form. | P1 |
| Player is up to act while chatting | Turn name is in the dock; on ten-player tables the active seat's name truncates. | P0 |
| Player owes a call | To-call amount is in the dock, but can compete with a four-button grid and small text. | P1 |
| One hand holds a drink | Main betting controls are fixed low, but All-in takes a full-width row next to ordinary actions and can be hit accidentally. | P0 |
| Player mis-taps All-in | It sends immediately without a review. | P0 |
| Bar lighting is dim | Theme colors can be changed, but theme controls are buried; tiny seat labels and some 10–11 px play text are hard to scan. | P1 |
| Phone locks and unlocks mid-hand | Presence and rejoin run; reconnect banner says the seat is saved, but the masthead connection label disappears in-game. | P1 |
| Wi-Fi drops during an action | Actions disable and a reconnect banner appears; state is safe, but a timeout message appears in a short-lived toast. | P1 |
| Host needs Undo | Undo is in Host controls inside the rail drawer and has no confirmation. | P1 |
| Host handles a rebuy | A dock shortcut exists between hands, but the live-hand path goes through table settings and a drawer. | P1 |
| Player checks a hand dispute | Hand log is inside the rail drawer, so it needs two disclosures plus scrolling. | P1 |
| Friends settle up | Tonight is available between hands and in Players, but during a hand it is buried in a drawer. | P1 |
| Ten people share a table at 360 px | Oval seats are about 67 px wide; names are ellipsized and status chips crowd the cards. | P0 |
| Large text or low vision | Fixed geometry and several 10–11 px labels cause crowding; CSS sizes do not consistently respond to 200% text. | P0 |
| Host removes a player | Kick is hidden in Host controls but submits without a review of the selected name. | P1 |

## Audit and implementation order

Baseline headless Chromium at **360×740**: lobby entry panel starts at y≈425; ten occupied seats have 67 px card widths; the dock is ≈176 px tall. The 360 px document has no horizontal overflow, but the bottom seats sit beneath the dock until scrolling. The 390×844 and 768×1024 acceptance captures are part of verification below.

1. **P0: Ten-seat readability and text scaling.** On phone widths the elliptical positioning makes each card too narrow. Use a two-column seat roster with explicit seat, name, chips, bet and status. Preserve the oval on wider screens. The status already has words; keep them visible and give each seat an accessible label. Avoid font sizes below 12 px for play data.
2. **P0: Action safety.** Keep Fold / Check-Call / Raise in the bottom thumb zone. Separate All-in and require an explicit review of the full stack. Keep 48 px targets and spacing; guard host Undo and Kick.
3. **P1: One-tap hand utilities.** Put Hand log and Tonight near the table header; make host Undo and pending rebuys one-tap. Keep appearance, seat cosmetics, settings, Leave and Kick in the rail.
4. **P1: Join path.** Put the entry panel before the long introduction on phones, show the code before the name, add simple instructions and an inline error. Keep the existing preview and confirmation so the server contract remains unchanged.
5. **P1: Raise and connection clarity.** Keep steppers and quick bets. Size the sheet to `visualViewport` and the keyboard. Show a persistent in-table connection/turn state, with status text and a live region. A disconnected action stays disabled and tells the player what to do.
6. **P2: Polish.** Keep the familiar felt palette, make the active turn cue calm and brief, allow reduced motion, and provide an end-of-hand win line without casino-like effects.

**Information architecture:** table code/invite, betting, log and Tonight are the frequent actions; the rail holds hosting settings, appearance, and leave. The old rail uses an extra disclosure on screens under 1200 px, so a regular player has to hunt for the log. The lobby uses a marketing introduction before the entry task. The host gear opens controls but does not directly expose Undo.

**Accessibility:** Color is already supplemented by seat status words, and standard buttons have names. Dynamic table replacement may interrupt focus and turn announcements. The new persistent live status and focus restoration address that. Headless checks cover token contrast and layout; screen reader and 200% system text need real-device testing. All theme token pairs used for text, buttons, borders and focus are checked by `scripts/check-contrast.js`; the three recommended palettes are listed below. No color alone communicates turn, fold or connection state.

## Feeling and engagement

Felt, cream, violet and warm gold suit a home game: calm, trustworthy and lightly playful. The strong primary buttons and repeating turn ring can feel more urgent than necessary. The three restrained touches are a single clear **Your turn** cue, a plain-language winner line after a hand, and an end-of-night Tonight recap. No streaks, nudges, countdown pressure or financial language beyond the optional tally.

## Options for the three largest problems

| Problem | Standard | Bolder | Unconventional | Choice |
| --- | --- | --- | --- | --- |
| Ten-seat readability | Wider cards in a scrollable two-column roster | Rotating zoomed oval | Physical-table map that expands the active seat on touch | **Roster:** names and states remain legible without a gesture. |
| Accidental All-in | Confirmation dialog | Hold-to-commit control | Ask a neighbor to approve on their phone | **Confirmation:** review is familiar, quick and works one-handed. |
| Hidden mid-hand utilities | Hand log / Tonight shortcuts | Bottom navigation bar | Swipe anywhere on felt for a radial menu | **Shortcuts:** visible labels need no instruction. |

## Recommended palettes

These use the existing token vocabulary in `public/tokens.css`; theme choice is a user preference. Token contrast validation requires text ≥4.5:1 and borders/focus ≥3:1 against adjacent surfaces. High contrast uses stronger 7:1 text and 4.5:1 borders.

| Situation | Palette | Core surface / text / accent / focus |
| --- | --- | --- |
| Bright rooms | **Felt** | `#fffdf5` / `#253044` / `#6434df` / `#6434df` |
| Dim rooms | **Midnight** | `#0b1424` / `#f4f8ff` / `#77a7ff` / `#54d9d0` |
| Low vision | **High contrast** | `#070d18` / `#ffffff` / `#ffe071` / `#ffe071` |

## 30-minute usability test on personal phones

Recruit **five** participants: two regular poker players, two casual players, and one first-timer; include a mix of ages and tech comfort, and at least one person using larger text. Use a real deck and a local test table with 2–10 seats. Do not coach during tasks. Split time: 3 minutes context/consent, 20 minutes tasks, 5 minutes interview, 2 minutes wrap-up.

Tasks, in order: (1) join from an eight-letter code, (2) make a raise with a quick bet and then a manual amount, (3) try to fold out of turn and recover, (4) find the hand log, (5) as host approve a rebuy and undo a mistaken action, (6) find Tonight and explain who settles with whom. Alternate host role between participants. Include one Wi-Fi interruption and one lock/unlock while a hand is active.

Record time from prompt to completion, number of taps, errors, mis-taps, accidental submissions, help requests, and whether each participant can state whose turn it is, what they owe, and whether they are connected. Targets: join in **under 30 seconds** after opening the page; each normal action in **two taps or fewer**; no accidental All-in, Kick or Leave; log and Tonight reached in one tap; all five identify turn and connection correctly. Observe thumb reach, keyboard obstruction, reading distance, interruptions, and whether the host expects Undo to affect just the last action. Ask afterward: “What felt uncertain?”, “What would you change before using this with friends?”, and “Did any screen feel too urgent?”

Prioritize findings by risk × frequency: P0 for a wrong bet, inaccessible action or unreadable state; P1 for repeat confusion or delay; P2 for cosmetic friction. Reproduce each issue at the participant's viewport and text setting, then fix and rerun the same task with a fresh participant.

## Verification and remaining device work

- `npm run lint && npm test` passed: 126 tests, including a Chromium flow for joining from a link, the raise sheet, All-in / Undo / Kick reviews, one-tap hand log and Tonight access, and ten occupied seats.
- `scripts/check-contrast.js` passed all eight themes. The recommended Felt and Midnight focus rings and the high-contrast overlay are checked against adjacent surfaces.
- Headless Chromium captured [360×740](artifacts/mobile-ux/table-360x740.png), [390×844](artifacts/mobile-ux/table-390x844.png), and [768×1024](artifacts/mobile-ux/table-768x1024.png) table viewports, plus the [360 px raise sheet](artifacts/mobile-ux/raise-360x740.png) and [200% root text](artifacts/mobile-ux/table-large-text-360x740.png). The browser assertion found no horizontal page overflow at those sizes; all ten seat statuses are at least 12 px, and 360/390 px seat cards are at least 140 px wide.
- The automated join flow confirms code prefill and task order. The **under-30-second** target needs a timed human test. Real iOS/Android on-screen keyboards, screen reader announcements, system large text, low-light legibility, and flaky bar Wi-Fi remain device-test subjects. Browser `visualViewport` sizing was verified by code and the raise capture; desktop headless Chromium cannot reproduce a physical soft keyboard.
