# Table workspace redesign

Mode: redesign the table workspace while preserving Tablemate's visual tokens, themes, URLs, DOM action IDs, poker state, Socket.IO messages, and server permissions.

## Audit

- The desktop grid stretches with a tall sidebar. The main column then leaves a large empty region below the table. The sidebar has its own hand log scroll area, but the rail itself has no viewport limit.
- The fixed dock gives invite, seat changes, buy-in, Tonight, rebuys and Start game nearly equal weight. It wraps into multiple rows on phones and can cover the bottom seat.
- Waiting and complete states put a broad message card above the oval. Ten seat cards are tall and force the ellipse geometry to expand far beyond a normal desktop viewport.
- Seat cards use the public username in place of the chosen table name, and the sidebar repeats both names. Long names grow card height.
- Host settings, rebuy policy, player management, personal preferences and session tools share one long panel. These controls are reachable, but they compete with the live player list.
- Strengths to retain: distinct local and acting seats, the clockwise mobile seat map, uploaded photo/fallback avatars, guarded all-in, server-authorized actions, reduced motion, and theme tokens.

## Component plan

1. Make the header a compact table identity and status row, with Invite and Manage actions. Keep Tonight in Manage and the hand log in one responsive access point, while moving administration out of the betting bar.
2. Give the stage the full workspace width. Open the hand log in a compact desktop drawer or a disclosure below the table on smaller screens; size the stage from measured seat cards.
3. Render short seat cards with one display name, a prominent stack, compact role/state labels, and a bet row only when relevant. Retain the same avatar renderer and seat ordering.
4. Make the dock state-specific: Invite/Start while waiting, betting actions during a hand, and the next hand after settlement. Keep the all-in confirmation.
5. Put host settings, player and rebuy management, session tools, and personal preferences in a dedicated Manage Table drawer. Preserve existing form IDs, validation and handlers.
6. Verify waiting, active, showdown, and complete states with 2, 3, 6 and 10 seats at phone, tablet and desktop widths. Check control access and captured screenshots as well as lint and tests.

Highest-risk change: seat geometry and the dynamic drawer during live state updates. The layout harness checks card collisions; DOM IDs and state mutation handlers stay intact.

## Implemented and verified

- The header now combines table identity, hand, connected count, turn, Invite, and Manage. The fixed dock shows only the current game action and balances. Secondary actions live in Manage Table. The player cards show the roster, so the duplicate Players sidebar has been removed. The table uses the full laptop workspace; Hand log opens in a compact header drawer on desktop and a disclosure below the table on smaller screens.
- Seat cards show one table name, avatar, stack, position, status, and only nonzero bets. The same name is used for turn cues and winner selection. The existing avatar renderer still handles uploaded photos, fallback art, and privacy settings. The account seat note remains in the player list.
- The board and seats are measured together for desktop ellipse placement. The mobile layout keeps the clockwise seat map above a readable two-column roster. The showdown winner form opens as a focused sheet; the hand result stays inside the table board.
- Browser layout checks passed for waiting 1/2/3/4/6/8/10, active 2/3/6/10, showdown 2, and complete 2/3 across 320×700, 360×740, 390×844, 430×932, 768×1024, 1024×768, 1280×800, 1440×900, and 844×390. Checks cover overflow, seat/board collisions, desktop dock clearance, full-width table, hand-log drawer, names, avatar loading, and the mobile seat map. Captures are under `artifacts/qa/table-layout/`.
- A browser flow tested phone invite joining, guarded All-in, raise, Undo, Manage, Tonight, player removal confirmation, rebuy request and approval, ten-player readability, 200% root text scaling, and the last seat scrolling clear of the mobile dock. The showdown selection and result were exercised by the layout harness.
- `npm run lint` passed. `npm test` passed: 133 tests, 0 failures. No server, poker logic, or Socket.IO contract changed.

Real-device checks remain useful for touch feel, mobile browser keyboard behavior, and reduced-motion appearance.
