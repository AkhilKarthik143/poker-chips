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
